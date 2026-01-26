#![feature(iterator_try_collect)]

// Minimal binary to force Emscripten to generate JS glue alongside the WASM.
// The exported C ABI functions are defined in lib.rs; they are retained
// by the -sEXPORTED_FUNCTIONS link flag configured in .cargo/config.toml.

use mlua::prelude::*;
use std::cell::RefCell;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::rc::Rc;
use std::collections::HashMap;
use async_executor::LocalExecutor;

mod bridge;
mod lua_api;

use bridge::*;
use lua_api::*;

fn read_c_string(ptr: *const c_char) -> LuaResult<String> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .map(|s| s.to_string())
        .map_err(|e| LuaError::external(e))
}

// ==================== 异步执行器支持 ====================

// 全局 Executor（使用 thread_local 因为 WASM 是单线程的）
thread_local! {
    static EXECUTOR: RefCell<LocalExecutor<'static>> = RefCell::new(LocalExecutor::new());
    static INSTANCE_MANAGER: RefCell<LuaInstanceManager> = RefCell::new(LuaInstanceManager::new());
    static EXECUTION_MANAGER: RefCell<ExecutionManager> = RefCell::new(ExecutionManager::new());
}

/// LuaInstance - 包装一个持久的 Lua 实例及其输出缓冲
struct LuaInstance {
    lua: Lua,
    output: Rc<RefCell<String>>,
}

impl LuaInstance {
    fn new(context_id: u32, working_dir: String) -> LuaResult<Self> {
        let lua = Lua::new();
        let output = Rc::new(RefCell::new(String::new()));

        // 设置工作目录
        lua.set_app_data(WorkingDirectory(working_dir));

        // 初始化 async-friendly 的 table 操作
        init_async_table(&lua)?;

        // 安装各种 API
        install_print_collector(&lua, &output)?;
        install_io_write_collector(&lua, &output)?;
        install_require_loader(&lua)?;
        install_fs_api(&lua, context_id)?;
        // RDF、JSON 和 String 模块已迁移到 JS 侧，通过 registerJsModule 注入

        Ok(LuaInstance { lua, output })
    }

    fn clear_output(&self) {
        self.output.borrow_mut().clear();
    }

    fn get_output(&self) -> String {
        self.output.borrow().clone()
    }
}

/// LuaInstanceManager - 管理持久的 Lua 实例
struct LuaInstanceManager {
    next_instance_id: u32,
    instances: HashMap<u32, LuaInstance>,
}

impl LuaInstanceManager {
    fn new() -> Self {
        LuaInstanceManager {
            next_instance_id: 1,
            instances: HashMap::new(),
        }
    }

    /// 创建新的 Lua 实例，返回实例 ID
    fn create_instance(&mut self, context_id: u32, working_dir: String) -> Result<u32, String> {
        let instance_id = self.next_instance_id;
        self.next_instance_id = self.next_instance_id.wrapping_add(1);

        match LuaInstance::new(context_id, working_dir) {
            Ok(instance) => {
                self.instances.insert(instance_id, instance);
                Ok(instance_id)
            }
            Err(e) => Err(format!("Failed to create Lua instance: {}", e))
        }
    }

    /// 销毁 Lua 实例
    fn destroy_instance(&mut self, instance_id: u32) -> bool {
        self.instances.remove(&instance_id).is_some()
    }

    /// 获取 Lua 实例的引用
    fn get_instance(&self, instance_id: u32) -> Option<&LuaInstance> {
        self.instances.get(&instance_id)
    }
}

/// ExecutionManager - 统一管理 Lua 执行任务的 ID 分配和状态跟踪
struct ExecutionManager {
    next_id: u32,
    pending_executions: HashMap<u32, ()>,
}

impl ExecutionManager {
    fn new() -> Self {
        ExecutionManager {
            next_id: 1,
            pending_executions: HashMap::new(),
        }
    }

    /// 注册新的执行任务，返回执行 ID
    fn register(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        self.pending_executions.insert(id, ());
        id
    }

    /// 标记执行完成，移除记录。返回 true 如果 ID 存在
    fn complete(&mut self, id: u32) -> bool {
        self.pending_executions.remove(&id).is_some()
    }

    /// 检查是否有待处理的任务
    fn has_pending(&self) -> bool {
        !self.pending_executions.is_empty()
    }
}

// FFI: JavaScript 回调
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    // 当 Lua 执行完成时调用（无论成功或失败）
    // result_handle: EM_VAL handle for the result value (or null on error)
    // output_ptr: captured print/io.write output
    // error_ptr: error message (null on success)
    fn js_lua_execution_callback(
        execution_id: u32, 
        result_handle: emval_ffi::EM_VAL,
        output_ptr: *const c_char,
        error_ptr: *const c_char
    );
}

/// 报告 Lua 执行结果给 JavaScript
/// result_val: Some(JsVal) on success, None on error
fn report_execution_result(
    execution_id: u32, 
    result_val: Option<JsVal>,
    output: String,
    error: Option<String>
) {
    // 清理执行记录
    EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().complete(execution_id);
    });
    
    // 准备 C 字符串
    let output_cstr = CString::new(output).unwrap_or_else(|_| CString::new("").unwrap());
    let error_cstr = error.map(|e| CString::new(e).unwrap_or_else(|_| CString::new("<invalid utf8>").unwrap()));
    
    // 获取 result handle（成功时有值，失败时为 null）
    let result_handle = match result_val {
        Some(val) => val.into_handle(),
        None => JsVal::null().into_handle(),
    };
    
    // 调用 JavaScript 回调
    unsafe {
        js_lua_execution_callback(
            execution_id, 
            result_handle,
            output_cstr.as_ptr(),
            error_cstr.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null())
        );
    }
}

/// 实际执行 Lua 代码的异步函数（使用临时 Lua 实例）
async fn execute_lua_code_impl(execution_id: u32, code: String, context_id: u32, working_dir: String) {
    // 创建临时 LuaInstance
    let instance = match LuaInstance::new(context_id, working_dir) {
        Ok(inst) => inst,
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(format!("Failed to create Lua instance: {}", e))
            );
            return;
        }
    };

    instance.clear_output();

    // 加载并执行 Lua 代码（异步）
    let chunk = match instance.lua.load(&code).set_name("input").into_function() {
        Ok(chunk) => chunk,
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                instance.get_output(),
                Some(format!("Lua load error: {}", e))
            );
            return;
        }
    };

    let exec_result = chunk.call_async::<LuaValue>(()).await;
    let output_str = instance.get_output();
    
    match exec_result {
        Ok(value) => {
            // 将 Lua 返回值转换为 JsVal
            let result_val = lua_to_val(&instance.lua, value, 0).ok();
            
            report_execution_result(
                execution_id, 
                result_val,
                output_str,
                None
            );
        }
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                output_str,
                Some(format!("Lua execution error: {}", e))
            );
        }
    }
}

/// 在持久 Lua 实例上执行代码的异步函数（带参数支持）
async fn execute_lua_on_instance_with_args_impl(
    execution_id: u32, 
    instance_id: u32, 
    code: String, 
    args_handle: u32
) {
    // 先检查实例是否存在
    let instance_exists = INSTANCE_MANAGER.with(|mgr| {
        mgr.borrow().get_instance(instance_id).is_some()
    });

    if !instance_exists {
        report_execution_result(
            execution_id, 
            None,
            String::new(),
            Some(format!("Lua instance {} not found", instance_id))
        );
        return;
    }
    
    // 如果有参数，设置 __args__ 全局变量
    if args_handle != 0 {
        let set_result = INSTANCE_MANAGER.with(|mgr| {
            let mgr = mgr.borrow();
            if let Some(instance) = mgr.get_instance(instance_id) {
                let proxy = JsProxy::from_handle(args_handle as emval_ffi::EM_VAL, instance_id);
                instance.lua.globals().set("__args__", proxy)
            } else {
                Err(LuaError::external("Instance not found"))
            }
        });
        
        if let Err(e) = set_result {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(format!("Failed to set args: {}", e))
            );
            return;
        }
    }
    
    let chunk = INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        if let Some(instance) = mgr.get_instance(instance_id) {
            instance.clear_output();
            Ok(instance.lua.load(&code).set_name("input").into_function())
        } else {
            Err("Instance not found")
        }
    });

    let chunk = match chunk {
        Ok(Ok(chunk)) => chunk,
        Ok(Err(e)) => {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(format!("Lua load error: {}", e))
            );
            return;
        }
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(e.to_string())
            );
            return;
        }
    };

    // 执行函数（异步）
    let exec_result = chunk.call_async::<LuaValue>(()).await;

    // 获取输出和处理结果
    INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        let instance = mgr.get_instance(instance_id).unwrap();
        let output_str = instance.get_output();
        
        match exec_result {
            Ok(value) => {
                let result_val = lua_to_val(&instance.lua, value, 0).ok();
                report_execution_result(
                    execution_id, 
                    result_val,
                    output_str,
                    None
                );
            }
            Err(e) => {
                report_execution_result(
                    execution_id, 
                    None,
                    output_str,
                    Some(format!("Lua execution error: {}", e))
                );
            }
        }
    });
}

/// 异步版本的 lua_run，立即返回执行 ID（使用临时 Lua 实例）
#[unsafe(no_mangle)]
pub extern "C" fn lua_run_async(code_ptr: *const c_char, context_id: u32, working_dir_ptr: *const c_char) -> u32 {
    // 注册执行任务，获取 ID
    let execution_id = EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().register()
    });
    
    // 读取代码
    let code = match read_c_string(code_ptr) {
        Ok(s) => s,
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(format!("Failed to read code: {}", e))
            );
            return execution_id;
        }
    };

    // 读取工作目录（如果未提供则默认为 "/"）
    let working_dir = read_c_string(working_dir_ptr).unwrap_or_else(|_| "/".to_string());

    // 在 executor 中生成异步任务
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        
        exec.spawn(async move {
            execute_lua_code_impl(execution_id, code, context_id, working_dir).await;
        }).detach();
    });
    
    execution_id
}

/// 创建持久的 Lua 实例
#[unsafe(no_mangle)]
pub extern "C" fn lua_create_instance(context_id: u32, working_dir_ptr: *const c_char) -> i32 {
    let working_dir = read_c_string(working_dir_ptr).unwrap_or_else(|_| "/".to_string());
    
    INSTANCE_MANAGER.with(|mgr| {
        match mgr.borrow_mut().create_instance(context_id, working_dir) {
            Ok(instance_id) => instance_id as i32,
            Err(_) => -1  // 错误时返回 -1
        }
    })
}

/// 销毁持久的 Lua 实例
#[unsafe(no_mangle)]
pub extern "C" fn lua_destroy_instance(instance_id: u32) -> i32 {
    INSTANCE_MANAGER.with(|mgr| {
        if mgr.borrow_mut().destroy_instance(instance_id) {
            1  // 成功
        } else {
            0  // 实例不存在
        }
    })
}

/// 为 Lua 实例注册 JavaScript 模块（使用 JsProxy）
/// 
/// module_handle: 模块对象的 EM_VAL handle
/// mode: 0 = "module"(需要 require), 1 = "global"(设置到全局), 2 = "patch"(patch 现有全局表)
#[unsafe(no_mangle)]
pub extern "C" fn lua_register_js_module(
    instance_id: u32, 
    module_name_ptr: *const c_char,
    module_handle: emval_ffi::EM_VAL,
    mode: u32
) {
    let module_name = match read_c_string(module_name_ptr) {
        Ok(s) => s,
        Err(_) => return,
    };
    
    INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        if let Some(instance) = mgr.get_instance(instance_id) {
            // 将 JS 对象转换为 JsProxy
            let module_val = JsVal::from_handle(module_handle);
            let proxy = JsProxy::new(module_val.clone(), instance_id);
            
            // 创建 userdata
            if let Ok(ud) = instance.lua.create_userdata(proxy) {
                match mode {
                    1 => {
                        // global 模式：直接设置到全局
                        let _ = instance.lua.globals().set(module_name.clone(), ud.clone());
                    }
                    2 => {
                        // patch 模式：将 JS 对象的属性合并到现有全局表
                        if let Ok(existing_table) = instance.lua.globals().get::<LuaTable>(module_name.as_str()) {
                            // 使用 Object.keys() 遍历 JS 对象的属性
                            let keys_array = module_val.keys();
                            let keys_len = keys_array.length();
                            for i in 0..keys_len {
                                let key_val = keys_array.get_index(i);
                                let key = key_val.as_string();
                                let value = module_val.get(&key);
                                let value_proxy = JsProxy::new(value, instance_id);
                                if let Ok(value_ud) = instance.lua.create_userdata(value_proxy) {
                                    let _ = existing_table.set(key, value_ud);
                                }
                            }
                        }
                        // patch 模式不注册到 package.preload
                        return;
                    }
                    _ => {
                        // module 模式 (mode=0)：只注册到 package.preload
                    }
                }
                
                // module 和 global 模式都注册到 package.preload（保持 require 可用）
                if let Ok(package) = instance.lua.globals().get::<LuaTable>("package") {
                    if let Ok(preload_table) = package.get::<LuaTable>("preload") {
                        let module_name_owned = module_name.clone();
                        if let Ok(loader) = instance.lua.create_function(move |_, _: ()| {
                            // 返回同一个 userdata（已经是 JsProxy）
                            Ok(ud.clone())
                        }) {
                            let _ = preload_table.set(module_name_owned, loader);
                        }
                    }
                }
            }
        }
    });
}

/// 在持久 Lua 实例上执行代码（异步），支持传递 JS 参数
/// args_handle: EM_VAL handle，0 表示无参数
#[unsafe(no_mangle)]
pub extern "C" fn lua_run_on_instance_async(instance_id: u32, code_ptr: *const c_char, args_handle: u32) -> u32 {
    // 注册执行任务，获取 ID
    let execution_id = EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().register()
    });
    
    // 读取代码
    let code = match read_c_string(code_ptr) {
        Ok(s) => s,
        Err(e) => {
            report_execution_result(
                execution_id, 
                None,
                String::new(),
                Some(format!("Failed to read code: {}", e))
            );
            return execution_id;
        }
    };

    // 在 executor 中生成异步任务
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        
        exec.spawn(async move {
            execute_lua_on_instance_with_args_impl(execution_id, instance_id, code, args_handle).await;
        }).detach();
    });
    
    execution_id
}

/// 手动驱动 Executor（JavaScript 需要定期调用或在事件循环中调用）
#[unsafe(no_mangle)]
pub extern "C" fn lua_executor_tick() -> i32 {
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        if exec.try_tick() {
            1  // 有任务被执行
        } else {
            0  // 没有待处理任务
        }
    })
}

/// 检查是否有待处理的执行任务
#[unsafe(no_mangle)]
pub extern "C" fn lua_has_pending_tasks() -> i32 {
    EXECUTION_MANAGER.with(|mgr| {
        if mgr.borrow().has_pending() {
            1
        } else {
            0
        }
    })
}


#[allow(unused)]
fn main() {}
