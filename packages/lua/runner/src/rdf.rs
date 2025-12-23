use mlua::prelude::*;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_uchar};
use std::slice;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use async_channel::Receiver;

use crate::{json_to_lua_value, lua_value_to_json};
use crate::callback::{CallbackManager, PromiseResult};


#[link(wasm_import_module = "env")]
extern "C" {
    // RDF 三元组存储 API（异步接口，带回调 ID）
    fn js_rdf_insert_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_json_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_rdf_delete_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_json_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_rdf_query_async(context_id: u32, pattern_json_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_rdf_batch_insert_async(context_id: u32, triples_json_ptr: *const c_char, callback_id: u32) -> u32;
    
    // SPARQL 流式查询 API
    fn js_rdf_sparql_query_start(context_id: u32, sparql_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_rdf_sparql_query_next(query_id: u32, callback_id: u32) -> u32;
    fn js_rdf_sparql_query_close(query_id: u32);
}

// RDF Promise 回调管理器
static RDF_CALLBACK_MANAGER: Lazy<Mutex<CallbackManager>> = Lazy::new(|| Mutex::new(CallbackManager::new()));

/// 注册 RDF Promise 回调通道，返回 (callback_id, receiver)
fn register_rdf_callback() -> (u32, Receiver<PromiseResult>) {
    let mut manager = RDF_CALLBACK_MANAGER.lock().unwrap();
    manager.register()
}

/// 被 JavaScript 调用，用于传递 RDF Promise 结果
#[no_mangle]
pub extern "C" fn lua_rdf_promise_resolve(
    callback_id: u32,
    data_ptr: *const c_uchar,
    data_len: u32
) {
    let data = if data_ptr.is_null() || data_len == 0 {
        Vec::new()
    } else {
        unsafe { slice::from_raw_parts(data_ptr, data_len as usize) }.to_vec()
    };

    let _ = RDF_CALLBACK_MANAGER.lock().unwrap().resolve(callback_id, data);
}

/// 被 JavaScript 调用，用于传递 RDF Promise 错误
#[no_mangle]
pub extern "C" fn lua_rdf_promise_reject(
    callback_id: u32,
    error_ptr: *const c_char
) {
    let message = unsafe {
        CStr::from_ptr(error_ptr).to_string_lossy().into_owned()
    };

    let _ = RDF_CALLBACK_MANAGER.lock().unwrap().reject(callback_id, message);
}


/// 安装 RDF 三元组存储 API 到 Lua 全局环境（异步版本）
/// context_id: 执行上下文 ID，用于隔离不同的并发执行
pub fn install_rdf_api(lua: &Lua, context_id: u32) -> LuaResult<()> {
    let state_table = lua.create_table()?;
    
    // State:insert(subject, predicate, object) - 异步插入三元组
    let insert_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, LuaValue)| async move {
        // 注册回调并获取 ID
        let (callback_id, rx) = register_rdf_callback();
        
        // 将 object 转为 JSON
        let object_json = lua_value_to_json(&lua, &object)?;
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let object_c = CString::new(object_json).map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async RDF insert"));
        }
        
        // 等待 Promise 完成
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                Ok(())
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("insert", insert_fn)?;
    
    // State:delete(subject, predicate, object?) - 异步删除三元组
    let delete_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, Option<LuaValue>)| async move {
        let (callback_id, rx) = register_rdf_callback();
        
        let object_json = match object {
            Some(val) => lua_value_to_json(&lua, &val)?,
            None => "null".to_string(),
        };
        
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let object_c = CString::new(object_json).map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async RDF delete"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                Ok(())
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("delete", delete_fn)?;
    
    // State:match(pattern) - 异步查询三元组（原 query 函数）
    let match_fn = lua.create_async_function(move |lua, (_, pattern): (LuaTable, LuaTable)| async move {
        let (callback_id, rx) = register_rdf_callback();
        
        // 构造 pattern JSON
        let subject: Option<String> = pattern.get("subject")?;
        let predicate: Option<String> = pattern.get("predicate")?;
        let object: Option<LuaValue> = pattern.get("object")?;
        
        let object_json = object.as_ref()
            .map(|v| lua.from_value::<serde_json::Value>(v.clone()))
            .transpose()?;
        
        let pattern_json = serde_json::json!({
            "subject": subject,
            "predicate": predicate,
            "object": object_json
        });
        
        let pattern_str = serde_json::to_string(&pattern_json)
            .map_err(|e| LuaError::external(format!("JSON stringify error: {}", e)))?;
        let pattern_c = CString::new(pattern_str).map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_query_async(context_id, pattern_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async RDF query"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                json_to_lua_value(&lua, &result)
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("match", match_fn)?;
    
    // State:batchInsert(triples) - 异步批量插入三元组
    let batch_insert_fn = lua.create_async_function(move |lua, (_, triples): (LuaTable, LuaTable)| async move {
        let (callback_id, rx) = register_rdf_callback();
        
        let triples_json = lua_value_to_json(&lua, &LuaValue::Table(triples))?;
        let triples_c = CString::new(triples_json).map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_batch_insert_async(context_id, triples_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async RDF batch insert"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                Ok(())
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("batchInsert", batch_insert_fn)?;
    
    // State:set(subject, predicate, object) - 异步设置三元组（先删除后插入）
    let set_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, LuaValue)| async move {
        // 1. 先删除所有匹配的三元组
        let (delete_cb_id, delete_rx) = register_rdf_callback();
        let subject_c = CString::new(subject.clone()).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate.clone()).map_err(|e| LuaError::external(e))?;
        let null_c = CString::new("null").map_err(|e| LuaError::external(e))?;
        
        let delete_promise = unsafe {
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), null_c.as_ptr(), delete_cb_id)
        };
        
        if delete_promise == 0 {
            return Err(LuaError::external("Failed to start async RDF delete"));
        }
        
        match delete_rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
            }
            Ok(PromiseResult::Error { message }) => {
                return Err(LuaError::external(message));
            }
            Err(e) => {
                return Err(LuaError::external(format!("Channel error: {}", e)));
            }
        }
        
        // 2. 插入新的三元组
        let (insert_cb_id, insert_rx) = register_rdf_callback();
        let object_json = lua_value_to_json(&lua, &object)?;
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let object_c = CString::new(object_json).map_err(|e| LuaError::external(e))?;
        
        let insert_promise = unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_c.as_ptr(), insert_cb_id)
        };
        
        if insert_promise == 0 {
            return Err(LuaError::external("Failed to start async RDF insert"));
        }
        
        match insert_rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                Ok(())
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("set", set_fn)?;
    
    // State:get(subject, predicate) - 异步获取单个值
    let get_fn = lua.create_async_function(move |lua, (_, subject, predicate): (LuaTable, String, String)| async move {
        let (callback_id, rx) = register_rdf_callback();
        
        let pattern_json = serde_json::json!({
            "subject": subject,
            "predicate": predicate,
            "object": serde_json::Value::Null
        });
        
        let pattern_str = serde_json::to_string(&pattern_json)
            .map_err(|e| LuaError::external(format!("JSON stringify error: {}", e)))?;
        let pattern_c = CString::new(pattern_str).map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_query_async(context_id, pattern_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async RDF query"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let result = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                if result.starts_with("ERROR:") {
                    return Err(LuaError::external(result.trim_start_matches("ERROR:")));
                }
                
                // 解析结果数组
                let triples: Vec<serde_json::Value> = serde_json::from_str(&result)
                    .map_err(|e| LuaError::external(format!("JSON parse error: {}", e)))?;
                
                // 如果有结果，返回第一个三元组的 object；否则返回 nil
                if let Some(first_triple) = triples.first() {
                    if let Some(object) = first_triple.get("object") {
                        return lua.to_value(object);
                    }
                }
                
                Ok(LuaValue::Nil)
            }
            Ok(PromiseResult::Error { message }) => {
                Err(LuaError::external(message))
            }
            Err(e) => {
                Err(LuaError::external(format!("Channel error: {}", e)))
            }
        }
    })?;
    state_table.set("get", get_fn)?;
    
    // State:query(sparql) - SPARQL 查询，返回迭代器
    let query_fn = lua.create_async_function(move |lua, (_self, sparql): (LuaTable, String)| async move {
        // 1. 启动查询，获取 query_id
        let (callback_id, rx) = register_rdf_callback();
        let sparql_c = CString::new(sparql)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_rdf_sparql_query_start(context_id, sparql_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start SPARQL query"));
        }
        
        // 等待查询启动，获取 query_id
        let query_id = match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                let id_str = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                id_str.parse::<u32>()
                    .map_err(|e| LuaError::external(format!("Invalid query ID: {}", e)))?
            }
            Ok(PromiseResult::Error { message }) => {
                return Err(LuaError::external(message));
            }
            Err(e) => {
                return Err(LuaError::external(format!("Channel error: {}", e)));
            }
        };
        
        // 2. 创建迭代器函数
        let iter_fn = lua.create_async_function(move |lua, ()| async move {
            // 获取下一个结果
            let (cb_id, rx) = register_rdf_callback();
            
            let promise_id = unsafe {
                js_rdf_sparql_query_next(query_id, cb_id)
            };
            
            if promise_id == 0 {
                // 查询失败，关闭并返回 nil
                unsafe { js_rdf_sparql_query_close(query_id) };
                return Ok(LuaValue::Nil);
            }
            
            match rx.recv().await {
                Ok(PromiseResult::Success { data }) => {
                    if data.is_empty() {
                        // 查询结束（done = true）
                        unsafe { js_rdf_sparql_query_close(query_id) };
                        return Ok(LuaValue::Nil);
                    }
                    
                    // 返回当前结果
                    let result_json = String::from_utf8(data)
                        .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                    json_to_lua_value(&lua, &result_json)
                }
                Ok(PromiseResult::Error { message }) => {
                    unsafe { js_rdf_sparql_query_close(query_id) };
                    Err(LuaError::external(message))
                }
                Err(e) => {
                    unsafe { js_rdf_sparql_query_close(query_id) };
                    Err(LuaError::external(format!("Channel error: {}", e)))
                }
            }
        })?;
        
        Ok(LuaValue::Function(iter_fn))
    })?;
    state_table.set("query", query_fn)?;
    
    lua.globals().set("State", state_table)?;
    Ok(())
}
