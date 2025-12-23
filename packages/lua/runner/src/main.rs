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

use require::*;
use print::*;
use fs::*;
use rdf::*;
use utf8_string::*;
use async_table::*;
use js_module::*;

pub mod callback;
pub mod require;
pub mod print;
pub mod fs;
pub mod rdf;
pub mod utf8_string;
pub mod async_table;
pub mod js_module;

fn read_c_string(ptr: *const c_char) -> LuaResult<String> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .map(|s| s.to_string())
        .map_err(|e| LuaError::external(e))
}

/// 将 Lua 值转换为 JSON 字符串（使用 serde_json）
pub fn lua_value_to_json(_lua: &Lua, value: &LuaValue) -> LuaResult<String> {
    // 使用 mlua 的序列化功能
    let json_value = value.to_serializable();
    serde_json::to_string(&json_value)
        .map_err(|e| LuaError::external(format!("JSON stringify error: {}", e)))
}

/// 将 JSON 字符串转换为 Lua 值（使用 serde_json）
pub fn json_to_lua_value(lua: &Lua, json: &str) -> LuaResult<LuaValue> {
    let json_value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| LuaError::external(format!("JSON parse error: {}", e)))?;
    
    lua.to_value(&json_value)
}

// ==================== 异步执行器支持 ====================

// 全局 Executor（使用 thread_local 因为 WASM 是单线程的）
thread_local! {
    static EXECUTOR: RefCell<LocalExecutor<'static>> = RefCell::new(LocalExecutor::new());
    static INSTANCE_MANAGER: RefCell<LuaInstanceManager> = RefCell::new(LuaInstanceManager::new());
    static EXECUTION_MANAGER: RefCell<ExecutionManager> = RefCell::new(ExecutionManager::new());
    static LUA_ITERATOR_MANAGER: RefCell<LuaIteratorManager> = RefCell::new(LuaIteratorManager::new());
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
        install_utf8_string_methods(&lua)?;
        install_require_loader(&lua)?;
        install_fs_api(&lua, context_id)?;
        install_rdf_api(&lua, context_id)?;

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

/// LuaIteratorState - 存储 Lua 迭代器的状态
/// Lua 迭代器由三个部分组成：迭代函数、状态、控制变量
struct LuaIteratorState {
    instance_id: u32,
    iter_func_key: String,  // Registry key for the iterator function
    state_key: String,      // Registry key for the state
    control_key: String,    // Registry key for the control variable
    closed: bool,
}

/// LuaIteratorManager - 管理从 Lua 导出的迭代器
struct LuaIteratorManager {
    next_id: u32,
    iterators: HashMap<u32, LuaIteratorState>,
}

impl LuaIteratorManager {
    fn new() -> Self {
        LuaIteratorManager {
            next_id: 1,
            iterators: HashMap::new(),
        }
    }

    /// 注册新的迭代器，返回迭代器 ID
    fn register(&mut self, instance_id: u32, iter_func_key: String, state_key: String, control_key: String) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        self.iterators.insert(id, LuaIteratorState {
            instance_id,
            iter_func_key,
            state_key,
            control_key,
            closed: false,
        });
        id
    }

    /// 获取迭代器状态
    fn get(&self, id: u32) -> Option<&LuaIteratorState> {
        self.iterators.get(&id)
    }

    /// 获取迭代器状态（可变）
    fn get_mut(&mut self, id: u32) -> Option<&mut LuaIteratorState> {
        self.iterators.get_mut(&id)
    }

    /// 关闭并移除迭代器
    fn close(&mut self, id: u32) -> Option<LuaIteratorState> {
        self.iterators.remove(&id)
    }
}

// FFI: JavaScript 回调
#[link(wasm_import_module = "env")]
extern "C" {
    // 当 Lua 执行完成时调用（无论成功或失败）
    fn js_lua_execution_callback(execution_id: u32, result_json_ptr: *const c_char);
    
    // 当 Lua 迭代器返回下一个值时调用
    fn js_lua_iterator_callback(callback_id: u32, result_json_ptr: *const c_char);
}

#[derive(Debug)]
enum ExecutionResult {
    Success {
        output: String,
        result: String, // JSON
    },
    Error {
        output: String,
        error: String,
    },
}

/// 报告 Lua 执行结果给 JavaScript
fn report_execution_result(execution_id: u32, result: ExecutionResult) {
    // 清理执行记录
    EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().complete(execution_id);
    });
    
    // 构造 JSON 结果
    let result_json = match result {
        ExecutionResult::Success { output, result } => {
            let result_value: serde_json::Value = 
                serde_json::from_str(&result).unwrap_or(serde_json::Value::Null);
            serde_json::json!({
                "result": result_value,
                "output": output,
                "error": serde_json::Value::Null
            })
        }
        ExecutionResult::Error { output, error } => {
            serde_json::json!({
                "result": serde_json::Value::Null,
                "output": output,
                "error": error
            })
        }
    };
    
    // 调用 JavaScript 回调
    let json_str = result_json.to_string();
    let json_cstr = CString::new(json_str).unwrap_or_else(|_| {
        CString::new(r#"{"result":null,"output":"","error":"<invalid utf8>"}"#).unwrap()
    });
    
    unsafe {
        js_lua_execution_callback(execution_id, json_cstr.as_ptr());
    }
}

/// 实际执行 Lua 代码的异步函数（使用临时 Lua 实例）
async fn execute_lua_code_impl(execution_id: u32, code: String, context_id: u32, working_dir: String) {
    // 创建临时 LuaInstance
    let instance = match LuaInstance::new(context_id, working_dir) {
        Ok(inst) => inst,
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Failed to create Lua instance: {}", e)
            });
            return;
        }
    };

    instance.clear_output();

    // 加载并执行 Lua 代码（异步）
    let chunk = match instance.lua.load(&code).set_name("input").into_function() {
        Ok(chunk) => chunk,
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: instance.get_output(),
                error: format!("Lua load error: {}", e)
            });
            return;
        }
    };

    let exec_result = chunk.call_async::<LuaValue>(()).await;
    let output_str = instance.get_output();
    
    match exec_result {
        Ok(value) => {
            // 将 Lua 返回值转换为 JSON
            let result_json = match lua_value_to_json(&instance.lua, &value) {
                Ok(json) => json,
                Err(_) => "null".to_string(),
            };
            
            report_execution_result(execution_id, ExecutionResult::Success {
                output: output_str,
                result: result_json,
            });
        }
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: output_str,
                error: format!("Lua execution error: {}", e)
            });
        }
    }
}

/// 在持久 Lua 实例上执行代码的异步函数
async fn execute_lua_on_instance_impl(execution_id: u32, instance_id: u32, code: String) {
    // 先检查实例是否存在
    let instance_exists = INSTANCE_MANAGER.with(|mgr| {
        mgr.borrow().get_instance(instance_id).is_some()
    });

    if !instance_exists {
        report_execution_result(execution_id, ExecutionResult::Error {
            output: String::new(),
            error: format!("Lua instance {} not found", instance_id)
        });
        return;
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
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Lua load error: {}", e)
            });
            return;
        }
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: e.to_string()
            });
            return;
        }
    };

    // 执行函数（异步）
    let exec_result = chunk.call_async::<LuaValue>(()).await;

    // 获取输出和处理结果
    let result = INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        let instance = mgr.get_instance(instance_id).unwrap();
        let output_str = instance.get_output();
        
        match exec_result {
            Ok(value) => {
                let result_json = match lua_value_to_json(&instance.lua, &value) {
                    Ok(json) => json,
                    Err(_) => "null".to_string(),
                };
                
                ExecutionResult::Success {
                    output: output_str,
                    result: result_json,
                }
            }
            Err(e) => {
                ExecutionResult::Error {
                    output: output_str,
                    error: format!("Lua execution error: {}", e)
                }
            }
        }
    });

    report_execution_result(execution_id, result);
}

/// 在持久 Lua 实例上执行代码并创建迭代器（内部实现）
async fn create_lua_iterator_impl(execution_id: u32, instance_id: u32, code: String) {
    // 先检查实例是否存在
    let instance_exists = INSTANCE_MANAGER.with(|mgr| {
        mgr.borrow().get_instance(instance_id).is_some()
    });

    if !instance_exists {
        report_execution_result(execution_id, ExecutionResult::Error {
            output: String::new(),
            error: format!("Lua instance {} not found", instance_id)
        });
        return;
    }
    
    // 加载代码并获取迭代器
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
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Lua load error: {}", e)
            });
            return;
        }
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: e.to_string()
            });
            return;
        }
    };

    // 执行代码获取迭代器（异步）
    let exec_result = chunk.call_async::<LuaMultiValue>(()).await;

    // 处理结果
    let result = INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        let instance = mgr.get_instance(instance_id).unwrap();
        let output_str = instance.get_output();
        
        match exec_result {
            Ok(values) => {
                // Lua 迭代器返回 (iter_func, state, control)
                let values: Vec<LuaValue> = values.into_iter().collect();
                
                if values.is_empty() {
                    return ExecutionResult::Error {
                        output: output_str,
                        error: "Expected iterator but got no values".to_string()
                    };
                }
                
                // 第一个值必须是函数
                let iter_func = match &values[0] {
                    LuaValue::Function(f) => f.clone(),
                    _ => {
                        return ExecutionResult::Error {
                            output: output_str,
                            error: format!("Expected function as first return value, got {:?}", values[0].type_name())
                        };
                    }
                };
                
                // 获取 state 和 control（可能是 nil）
                let state = values.get(1).cloned().unwrap_or(LuaValue::Nil);
                let control = values.get(2).cloned().unwrap_or(LuaValue::Nil);
                
                // 生成唯一的 registry key
                let iter_id = LUA_ITERATOR_MANAGER.with(|mgr| mgr.borrow().next_id);
                let iter_func_key = format!("__lua_iter_func_{}__", iter_id);
                let state_key = format!("__lua_iter_state_{}__", iter_id);
                let control_key = format!("__lua_iter_control_{}__", iter_id);
                
                // 将值存储到 Lua registry
                if let Err(e) = instance.lua.set_named_registry_value(&iter_func_key, iter_func) {
                    return ExecutionResult::Error {
                        output: output_str,
                        error: format!("Failed to store iterator function: {}", e)
                    };
                }
                if let Err(e) = instance.lua.set_named_registry_value(&state_key, state) {
                    return ExecutionResult::Error {
                        output: output_str,
                        error: format!("Failed to store iterator state: {}", e)
                    };
                }
                if let Err(e) = instance.lua.set_named_registry_value(&control_key, control) {
                    return ExecutionResult::Error {
                        output: output_str,
                        error: format!("Failed to store iterator control: {}", e)
                    };
                }
                
                // 注册迭代器
                let iterator_id = LUA_ITERATOR_MANAGER.with(|mgr| {
                    mgr.borrow_mut().register(instance_id, iter_func_key, state_key, control_key)
                });
                
                // 返回迭代器 ID
                let result_json = serde_json::json!({
                    "__lua_iterator_id": iterator_id
                }).to_string();
                
                ExecutionResult::Success {
                    output: output_str,
                    result: result_json,
                }
            }
            Err(e) => {
                ExecutionResult::Error {
                    output: output_str,
                    error: format!("Lua execution error: {}", e)
                }
            }
        }
    });

    report_execution_result(execution_id, result);
}

/// 获取 Lua 迭代器下一个值的实现
async fn lua_iterator_next_impl(iterator_id: u32, callback_id: u32) {
    // 获取迭代器状态
    let state = LUA_ITERATOR_MANAGER.with(|mgr| {
        mgr.borrow().get(iterator_id).map(|s| (s.instance_id, s.iter_func_key.clone(), s.state_key.clone(), s.control_key.clone(), s.closed))
    });
    
    let (instance_id, iter_func_key, state_key, control_key, closed) = match state {
        Some(s) => s,
        None => {
            // 迭代器不存在或已关闭
            report_iterator_result(callback_id, IteratorResult::Done);
            return;
        }
    };
    
    if closed {
        report_iterator_result(callback_id, IteratorResult::Done);
        return;
    }
    
    // 从 Lua registry 获取迭代器组件并调用
    let result = INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        let instance = match mgr.get_instance(instance_id) {
            Some(i) => i,
            None => {
                return Err("Lua instance not found".to_string());
            }
        };
        
        // 获取迭代器组件
        let iter_func: LuaFunction = instance.lua.named_registry_value(&iter_func_key)
            .map_err(|e| format!("Failed to get iterator function: {}", e))?;
        let state: LuaValue = instance.lua.named_registry_value(&state_key)
            .map_err(|e| format!("Failed to get iterator state: {}", e))?;
        let control: LuaValue = instance.lua.named_registry_value(&control_key)
            .map_err(|e| format!("Failed to get iterator control: {}", e))?;
        
        Ok((iter_func, state, control, instance_id))
    });
    
    let (iter_func, state, control, instance_id) = match result {
        Ok(r) => r,
        Err(e) => {
            report_iterator_result(callback_id, IteratorResult::Error { error: e });
            return;
        }
    };
    
    // 调用迭代器函数（异步）
    let call_result = iter_func.call_async::<LuaMultiValue>((state, control)).await;
    
    // 处理结果
    match call_result {
        Ok(values) => {
            let values: Vec<LuaValue> = values.into_iter().collect();
            
            if values.is_empty() || values[0] == LuaValue::Nil {
                // 迭代结束
                LUA_ITERATOR_MANAGER.with(|mgr| {
                    if let Some(state) = mgr.borrow_mut().get_mut(iterator_id) {
                        state.closed = true;
                    }
                });
                report_iterator_result(callback_id, IteratorResult::Done);
            } else {
                // 更新控制变量
                let new_control = values[0].clone();
                INSTANCE_MANAGER.with(|mgr| {
                    let mgr = mgr.borrow();
                    if let Some(instance) = mgr.get_instance(instance_id) {
                        let _ = instance.lua.set_named_registry_value(&control_key, new_control);
                    }
                });
                
                // 返回所有值
                let result_json = INSTANCE_MANAGER.with(|mgr| {
                    let mgr = mgr.borrow();
                    if let Some(instance) = mgr.get_instance(instance_id) {
                        // 将所有返回值转换为 JSON 数组
                        let json_values: Vec<serde_json::Value> = values.iter()
                            .map(|v| {
                                lua_value_to_json(&instance.lua, v)
                                    .ok()
                                    .and_then(|s| serde_json::from_str(&s).ok())
                                    .unwrap_or(serde_json::Value::Null)
                            })
                            .collect();
                        serde_json::to_string(&json_values).unwrap_or_else(|_| "[]".to_string())
                    } else {
                        "[]".to_string()
                    }
                });
                
                report_iterator_result(callback_id, IteratorResult::Value { value: result_json });
            }
        }
        Err(e) => {
            report_iterator_result(callback_id, IteratorResult::Error { 
                error: format!("Iterator call error: {}", e) 
            });
        }
    }
}

/// 迭代器结果类型
enum IteratorResult {
    Value { value: String },  // JSON array of values
    Done,
    Error { error: String },
}

/// 报告迭代器结果给 JavaScript
fn report_iterator_result(callback_id: u32, result: IteratorResult) {
    let result_json = match result {
        IteratorResult::Value { value } => {
            serde_json::json!({
                "value": serde_json::from_str::<serde_json::Value>(&value).unwrap_or(serde_json::Value::Null),
                "done": false,
                "error": serde_json::Value::Null
            })
        }
        IteratorResult::Done => {
            serde_json::json!({
                "value": serde_json::Value::Null,
                "done": true,
                "error": serde_json::Value::Null
            })
        }
        IteratorResult::Error { error } => {
            serde_json::json!({
                "value": serde_json::Value::Null,
                "done": true,
                "error": error
            })
        }
    };
    
    let json_str = result_json.to_string();
    let json_cstr = CString::new(json_str).unwrap_or_else(|_| {
        CString::new(r#"{"value":null,"done":true,"error":"<invalid utf8>"}"#).unwrap()
    });
    
    unsafe {
        js_lua_iterator_callback(callback_id, json_cstr.as_ptr());
    }
}

/// 异步版本的 lua_run，立即返回执行 ID（使用临时 Lua 实例）
#[no_mangle]
pub extern "C" fn lua_run_async(code_ptr: *const c_char, context_id: u32, working_dir_ptr: *const c_char) -> u32 {
    // 注册执行任务，获取 ID
    let execution_id = EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().register()
    });
    
    // 读取代码
    let code = match read_c_string(code_ptr) {
        Ok(s) => s,
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Failed to read code: {}", e)
            });
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
#[no_mangle]
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
#[no_mangle]
pub extern "C" fn lua_destroy_instance(instance_id: u32) -> i32 {
    INSTANCE_MANAGER.with(|mgr| {
        if mgr.borrow_mut().destroy_instance(instance_id) {
            1  // 成功
        } else {
            0  // 实例不存在
        }
    })
}

/// 为 Lua 实例注册 JavaScript 模块
#[no_mangle]
pub extern "C" fn lua_register_js_module(instance_id: u32, module_name_ptr: *const c_char) {
    let module_name = match read_c_string(module_name_ptr) {
        Ok(s) => s,
        Err(_) => return,
    };
    
    INSTANCE_MANAGER.with(|mgr| {
        let mgr = mgr.borrow();
        if let Some(instance) = mgr.get_instance(instance_id) {
            let _ = install_js_module_loader(&instance.lua, instance_id, &module_name);
        }
    });
}

/// 在持久 Lua 实例上执行代码（异步）
#[no_mangle]
pub extern "C" fn lua_run_on_instance_async(instance_id: u32, code_ptr: *const c_char) -> u32 {
    // 注册执行任务，获取 ID
    let execution_id = EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().register()
    });
    
    // 读取代码
    let code = match read_c_string(code_ptr) {
        Ok(s) => s,
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Failed to read code: {}", e)
            });
            return execution_id;
        }
    };

    // 在 executor 中生成异步任务
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        
        exec.spawn(async move {
            execute_lua_on_instance_impl(execution_id, instance_id, code).await;
        }).detach();
    });
    
    execution_id
}

/// 在持久 Lua 实例上执行代码并返回迭代器（异步）
/// 返回值：>0 为执行 ID，0 表示错误
#[no_mangle]
pub extern "C" fn lua_run_iter_on_instance_async(instance_id: u32, code_ptr: *const c_char) -> u32 {
    // 注册执行任务，获取 ID
    let execution_id = EXECUTION_MANAGER.with(|mgr| {
        mgr.borrow_mut().register()
    });
    
    // 读取代码
    let code = match read_c_string(code_ptr) {
        Ok(s) => s,
        Err(e) => {
            report_execution_result(execution_id, ExecutionResult::Error {
                output: String::new(),
                error: format!("Failed to read code: {}", e)
            });
            return execution_id;
        }
    };

    // 在 executor 中生成异步任务
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        
        exec.spawn(async move {
            create_lua_iterator_impl(execution_id, instance_id, code).await;
        }).detach();
    });
    
    execution_id
}

/// 获取 Lua 迭代器的下一个值（异步）
/// callback_id 用于标识这次异步调用
#[no_mangle]
pub extern "C" fn lua_iterator_next_async(iterator_id: u32, callback_id: u32) {
    // 在 executor 中生成异步任务
    EXECUTOR.with(|executor| {
        let exec = executor.borrow();
        
        exec.spawn(async move {
            lua_iterator_next_impl(iterator_id, callback_id).await;
        }).detach();
    });
}

/// 关闭 Lua 迭代器，释放相关资源
#[no_mangle]
pub extern "C" fn lua_iterator_close(iterator_id: u32) {
    // 从管理器中移除迭代器
    let state = LUA_ITERATOR_MANAGER.with(|mgr| {
        mgr.borrow_mut().close(iterator_id)
    });
    
    // 清理 Lua registry 中的引用
    if let Some(state) = state {
        INSTANCE_MANAGER.with(|mgr| {
            let mgr = mgr.borrow();
            if let Some(instance) = mgr.get_instance(state.instance_id) {
                let _ = instance.lua.unset_named_registry_value(&state.iter_func_key);
                let _ = instance.lua.unset_named_registry_value(&state.state_key);
                let _ = instance.lua.unset_named_registry_value(&state.control_key);
            }
        });
    }
}

/// 手动驱动 Executor（JavaScript 需要定期调用或在事件循环中调用）
#[no_mangle]
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
#[no_mangle]
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
