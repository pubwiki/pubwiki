/// JavaScript 模块注册和调用
/// 
/// 允许从 JavaScript 注册模块，并在 Lua 中通过 require() 调用
/// 支持同步和异步函数，使用函数缓存优化性能
/// 支持 async iterator，在 Lua 中可以像普通迭代器一样使用

use mlua::prelude::*;
use std::ffi::CString;
use std::os::raw::c_char;
use std::sync::Mutex;
use once_cell::sync::Lazy;

use crate::callback::{CallbackManager, PromiseResult};
use crate::{json_to_lua_value, lua_value_to_json};

// FFI 声明：调用 JavaScript 模块函数
#[link(wasm_import_module = "env")]
extern "C" {
    fn js_call_js_module(
        instance_id: u32,
        module_name_ptr: *const c_char,
        function_name_ptr: *const c_char,
        args_json_ptr: *const c_char,
        callback_id: u32,
    ) -> u32;
    
    // Async iterator 支持
    fn js_async_iterator_next(
        iterator_id: u32,
        callback_id: u32,
    ) -> u32;
    
    fn js_async_iterator_close(
        iterator_id: u32,
    );
}

// 全局回调管理器
static JS_MODULE_CALLBACK_MANAGER: Lazy<Mutex<CallbackManager>> =
    Lazy::new(|| Mutex::new(CallbackManager::new()));

/// 注册一个 JS 模块回调，返回 (callback_id, receiver)
pub fn register_js_module_callback() -> (u32, async_channel::Receiver<PromiseResult>) {
    let mut manager = JS_MODULE_CALLBACK_MANAGER.lock().unwrap();
    manager.register()
}

/// 由 JavaScript 调用来解析 Promise
#[no_mangle]
pub extern "C" fn lua_js_module_promise_resolve(
    callback_id: u32,
    data_ptr: *const u8,
    data_len: u32,
) {
    let data = if data_ptr.is_null() || data_len == 0 {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(data_ptr, data_len as usize) }.to_vec()
    };

    let mut manager = JS_MODULE_CALLBACK_MANAGER.lock().unwrap();
    manager.resolve(callback_id, data);
}

/// 由 JavaScript 调用来拒绝 Promise
#[no_mangle]
pub extern "C" fn lua_js_module_promise_reject(callback_id: u32, error_ptr: *const c_char) {
    let message = if error_ptr.is_null() {
        "Unknown error".to_string()
    } else {
        unsafe {
            std::ffi::CStr::from_ptr(error_ptr)
                .to_string_lossy()
                .into_owned()
        }
    };

    let mut manager = JS_MODULE_CALLBACK_MANAGER.lock().unwrap();
    manager.reject(callback_id, message);
}

/// 生成函数缓存的 registry key
fn make_cache_key(instance_id: u32, module_name: &str, function_name: &str) -> String {
    format!("__js_module_fn_{}_{}_{}__", instance_id, module_name, function_name)
}

/// 创建 async iterator 的迭代器函数
/// 返回一个 Lua 函数，每次调用时获取下一个值，返回 nil 时表示迭代结束
fn create_async_iterator_function(lua: &Lua, iterator_id: u32) -> LuaResult<LuaFunction> {
    lua.create_async_function(move |lua, _: ()| {
        async move {
            // 注册回调
            let (callback_id, rx) = register_js_module_callback();
            
            // 调用 JavaScript 的 iterator.next()
            unsafe {
                js_async_iterator_next(iterator_id, callback_id);
            }
            
            // 等待结果
            let result = rx.recv().await
                .map_err(|e| LuaError::external(format!("Iterator receive error: {}", e)))?;
            
            match result {
                PromiseResult::Success { data } => {
                    let json_str = String::from_utf8(data)
                        .map_err(|e| LuaError::external(e))?;
                    
                    // 解析 {value, done} 结构
                    let parsed: serde_json::Value = serde_json::from_str(&json_str)
                        .map_err(|e| LuaError::external(format!("JSON parse error: {}", e)))?;
                    
                    let done = parsed.get("done")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    
                    if done {
                        // 迭代结束，关闭 iterator 并返回 nil
                        unsafe {
                            js_async_iterator_close(iterator_id);
                        }
                        Ok(LuaValue::Nil)
                    } else {
                        // 返回 value
                        if let Some(value) = parsed.get("value") {
                            let value_json = serde_json::to_string(value)
                                .map_err(|e| LuaError::external(e))?;
                            crate::json_to_lua_value(&lua, &value_json)
                        } else {
                            Ok(LuaValue::Nil)
                        }
                    }
                }
                PromiseResult::Error { message } => {
                    // 发生错误时也关闭 iterator
                    unsafe {
                        js_async_iterator_close(iterator_id);
                    }
                    Err(LuaError::external(message))
                }
            }
        }
    })
}

/// 创建 JS 函数调用包装器
fn create_js_function_wrapper(
    lua: &Lua,
    instance_id: u32,
    module_name: String,
    function_name: String,
) -> LuaResult<LuaFunction> {
    lua.create_async_function(move |lua, args: LuaMultiValue| {
        let instance_id = instance_id;
        let module_name = module_name.clone();
        let function_name = function_name.clone();

        async move {
            // 将参数转换为 JSON 数组
            let mut args_array = Vec::new();
            for arg in args.iter() {
                args_array.push(lua_value_to_json(&lua, arg)?);
            }
            let args_json = format!("[{}]", args_array.join(","));

            // 注册回调
            let (callback_id, rx) = register_js_module_callback();

            // 准备 C 字符串
            let module_name_c = CString::new(module_name)
                .map_err(|e| LuaError::external(e))?;
            let function_name_c = CString::new(function_name)
                .map_err(|e| LuaError::external(e))?;
            let args_json_c = CString::new(args_json)
                .map_err(|e| LuaError::external(e))?;

            // 调用 JavaScript
            unsafe {
                js_call_js_module(
                    instance_id,
                    module_name_c.as_ptr(),
                    function_name_c.as_ptr(),
                    args_json_c.as_ptr(),
                    callback_id,
                );
            }

            // 等待结果
            let result = rx.recv().await
                .map_err(|e| LuaError::external(format!("Callback receive error: {}", e)))?;

            match result {
                PromiseResult::Success { data } => {
                    let json_str = String::from_utf8(data)
                        .map_err(|e| LuaError::external(e))?;
                    
                    // 检查是否是 async iterator 标记
                    let parsed: serde_json::Value = serde_json::from_str(&json_str)
                        .map_err(|e| LuaError::external(format!("JSON parse error: {}", e)))?;
                    
                    if let Some(iterator_id) = parsed.get("__async_iterator_id")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32)
                    {
                        // 返回一个迭代器函数
                        let iter_func = create_async_iterator_function(&lua, iterator_id)?;
                        Ok(LuaValue::Function(iter_func))
                    } else {
                        // 普通返回值
                        json_to_lua_value(&lua, &json_str)
                    }
                }
                PromiseResult::Error { message } => {
                    Err(LuaError::external(message))
                }
            }
        }
    })
}

/// 获取或创建缓存的 JS 函数包装器
fn get_or_create_cached_function(
    lua: &Lua,
    instance_id: u32,
    module_name: String,
    function_name: String,
) -> LuaResult<LuaFunction> {
    let cache_key = make_cache_key(instance_id, &module_name, &function_name);

    // 尝试从 named registry 中获取缓存的函数
    if let Ok(cached_func) = lua.named_registry_value::<LuaFunction>(&cache_key) {
        return Ok(cached_func);
    }

    // 创建新的函数包装器
    let wrapper = create_js_function_wrapper(lua, instance_id, module_name, function_name)?;

    // 将函数存储到 named registry 中缓存
    lua.set_named_registry_value(&cache_key, wrapper.clone())?;

    Ok(wrapper)
}

/// 创建模块的 __index 元方法
fn create_module_index_metamethod(
    lua: &Lua,
    instance_id: u32,
    module_name: String,
) -> LuaResult<LuaFunction> {
    lua.create_async_function(move |lua, (_table, key): (LuaTable, String)| {
        let instance_id = instance_id;
        let module_name = module_name.clone();
        let function_name = key;

        async move {
            get_or_create_cached_function(&lua, instance_id, module_name, function_name)
        }
    })
}

/// 为指定的 Lua 实例安装 JS 模块加载器
/// 
/// 这会在 package.preload 中注册一个加载器，当 Lua 调用 require(module_name) 时
/// 返回一个代理表，该表使用元方法来拦截函数调用并转发到 JavaScript
pub fn install_js_module_loader(
    lua: &Lua,
    instance_id: u32,
    module_name: &str,
) -> LuaResult<()> {
    // 获取 package.preload 表
    let package: LuaTable = lua.globals().get("package")?;
    let preload: LuaTable = package.get("preload")?;

    let module_name_owned = module_name.to_string();

    // 创建模块加载器函数
    let loader = lua.create_function(move |lua, _: ()| {
        let module_table = lua.create_table()?;
        let module_metatable = lua.create_table()?;

        // 设置 __index 元方法来捕获函数调用
        let index_fn = create_module_index_metamethod(
            &lua,
            instance_id,
            module_name_owned.clone(),
        )?;

        module_metatable.set("__index", index_fn)?;
        module_table.set_metatable(Some(module_metatable))?;

        Ok(module_table)
    })?;

    // 注册到 package.preload
    preload.set(module_name, loader)?;

    Ok(())
}
