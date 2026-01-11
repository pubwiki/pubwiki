/// JavaScript 模块注册和调用
/// 
/// 允许从 JavaScript 注册模块，并在 Lua 中通过 require() 调用
/// 支持同步和异步函数，使用函数缓存优化性能
/// 支持 async iterator，在 Lua 中可以像普通迭代器一样使用
///
/// 使用 emval handles 直接传递参数，避免 JSON 序列化开销

use mlua::prelude::*;
use std::ffi::CString;
use std::os::raw::c_char;

use super::callback::{register_callback, PromiseResult};
use super::emval_ffi::{JsVal, EM_VAL};
use super::js_proxy::{lua_to_val, val_to_lua};

// FFI 声明：调用 JavaScript 模块函数
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// 调用 JS 模块函数（使用 EM_VAL handles）
    /// - instance_id: Lua 实例 ID
    /// - module_name_ptr: 模块名 C 字符串
    /// - function_name_ptr: 函数名 C 字符串
    /// - args_handles: 参数 EM_VAL handles 数组指针
    /// - args_count: 参数数量
    /// - callback_id: 回调 ID
    /// 返回: 结果的 EM_VAL handle（通过 callback 返回）
    fn js_call_js_module(
        instance_id: u32,
        module_name_ptr: *const c_char,
        function_name_ptr: *const c_char,
        args_handles: *const EM_VAL,
        args_count: u32,
        callback_id: u32,
    );
    
    // Async iterator 支持
    fn js_async_iterator_next(
        iterator_id: u32,
        callback_id: u32,
    );
    
    fn js_async_iterator_close(
        iterator_id: u32,
    );
}

/// 生成函数缓存的 registry key
fn make_cache_key(instance_id: u32, module_name: &str, function_name: &str) -> String {
    format!("__js_module_fn_{}_{}_{}__", instance_id, module_name, function_name)
}

/// 创建 async iterator 的迭代器函数
/// 返回一个 Lua 函数，每次调用时获取下一个值，返回 nil 时表示迭代结束
fn create_async_iterator_function(lua: &Lua, iterator_id: u32, instance_id: u32) -> LuaResult<LuaFunction> {
    lua.create_async_function(move |lua, _: ()| {
        async move {
            // 注册回调
            let (callback_id, rx) = register_callback();
            
            // 调用 JavaScript 的 iterator.next()
            unsafe {
                js_async_iterator_next(iterator_id, callback_id);
            }
            
            // 等待结果
            let result = rx.recv().await
                .map_err(|e| LuaError::external(format!("Iterator receive error: {}", e)))?;
            
            match result {
                PromiseResult::Success { handle } => {
                    // handle 为 0 表示 undefined
                    if handle == 0 {
                        // 返回 undefined，表示迭代结束
                        unsafe {
                            js_async_iterator_close(iterator_id);
                        }
                        return Ok(LuaValue::Nil);
                    }
                    
                    let result_val = JsVal::from_handle(handle as EM_VAL);
                    
                    // 获取 done 和 value
                    let done_val = result_val.get("done");
                    let done = done_val.is_true();
                    
                    if done {
                        // 迭代结束，关闭 iterator 并返回 nil
                        unsafe {
                            js_async_iterator_close(iterator_id);
                        }
                        Ok(LuaValue::Nil)
                    } else {
                        // 返回 value
                        let value_val = result_val.get("value");
                        val_to_lua(&lua, value_val, instance_id)
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
            // 将参数转换为 EM_VAL handles
            let mut args_handles: Vec<EM_VAL> = Vec::new();
            let mut args_vals: Vec<JsVal> = Vec::new(); // 保持 JsVal 存活
            
            for arg in args.iter() {
                let val = lua_to_val(&lua, arg.clone(), instance_id)?;
                args_handles.push(val.handle());
                args_vals.push(val);
            }

            // 注册回调
            let (callback_id, rx) = register_callback();

            // 准备 C 字符串
            let module_name_c = CString::new(module_name)
                .map_err(|e| LuaError::external(e))?;
            let function_name_c = CString::new(function_name)
                .map_err(|e| LuaError::external(e))?;

            // 调用 JavaScript
            unsafe {
                js_call_js_module(
                    instance_id,
                    module_name_c.as_ptr(),
                    function_name_c.as_ptr(),
                    args_handles.as_ptr(),
                    args_handles.len() as u32,
                    callback_id,
                );
            }

            // 等待结果
            let result = rx.recv().await
                .map_err(|e| LuaError::external(format!("Callback receive error: {}", e)))?;

            match result {
                PromiseResult::Success { handle } => {
                    // handle 为 0 表示 undefined
                    if handle == 0 {
                        return Ok(LuaValue::Nil);
                    }
                    
                    let result_val = JsVal::from_handle(handle as EM_VAL);
                    
                    // 检查是否是 async iterator 标记
                    // JS 端会返回一个对象 { __async_iterator_id: number }
                    let iterator_id_val = result_val.get("__async_iterator_id");
                    if !iterator_id_val.is_undefined() && iterator_id_val.is_number() {
                        let iterator_id = iterator_id_val.as_f64() as u32;
                        // 返回一个迭代器函数
                        let iter_func = create_async_iterator_function(&lua, iterator_id, instance_id)?;
                        Ok(LuaValue::Function(iter_func))
                    } else {
                        // 普通返回值 - 转换为 Lua 值
                        val_to_lua(&lua, result_val, instance_id)
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
