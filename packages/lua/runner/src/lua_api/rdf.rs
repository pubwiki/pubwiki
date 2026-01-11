use mlua::prelude::*;
use std::ffi::CString;
use std::os::raw::c_char;

use crate::bridge::callback::{register_callback, PromiseResult};
use crate::bridge::emval_ffi::{JsVal, EM_VAL};
use crate::bridge::js_proxy::{lua_to_val, val_to_lua};


#[link(wasm_import_module = "env")]
unsafe extern "C" {
    // RDF 三元组存储 API（异步接口，使用 EM_VAL handles）
    fn js_rdf_insert_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_handle: EM_VAL, callback_id: u32);
    fn js_rdf_delete_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_handle: EM_VAL, callback_id: u32);
    fn js_rdf_query_async(context_id: u32, pattern_handle: EM_VAL, callback_id: u32);
    fn js_rdf_batch_insert_async(context_id: u32, triples_handle: EM_VAL, callback_id: u32);
    
    // SPARQL 流式查询 API
    fn js_rdf_sparql_query_start(context_id: u32, sparql_ptr: *const c_char, callback_id: u32);
    fn js_rdf_sparql_query_next(query_id: u32, callback_id: u32);
    fn js_rdf_sparql_query_close(query_id: u32);
}


/// 安装 RDF 三元组存储 API 到 Lua 全局环境（异步版本）
/// context_id: 执行上下文 ID，用于隔离不同的并发执行
pub fn install_rdf_api(lua: &Lua, context_id: u32) -> LuaResult<()> {
    let state_table = lua.create_table()?;
    
    // State:insert(subject, predicate, object) - 异步插入三元组
    let insert_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, LuaValue)| async move {
        let (callback_id, rx) = register_callback();
        
        let object_val = lua_to_val(&lua, object, context_id)?;
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        
        unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_val.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok(()),
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("insert", insert_fn)?;
    
    // State:delete(subject, predicate, object?) - 异步删除三元组
    let delete_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, Option<LuaValue>)| async move {
        let (callback_id, rx) = register_callback();
        
        let object_val = match object {
            Some(val) => lua_to_val(&lua, val, context_id)?,
            None => JsVal::null(),
        };
        
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        
        unsafe {
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_val.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok(()),
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("delete", delete_fn)?;
    
    // State:match(pattern) - 异步查询三元组
    let match_fn = lua.create_async_function(move |lua, (_, pattern): (LuaTable, LuaTable)| async move {
        let (callback_id, rx) = register_callback();
        
        // 构造 pattern 对象
        let pattern_obj = JsVal::object();
        
        if let Ok(subject) = pattern.get::<String>("subject") {
            pattern_obj.set("subject", &JsVal::from_str(&subject));
        }
        if let Ok(predicate) = pattern.get::<String>("predicate") {
            pattern_obj.set("predicate", &JsVal::from_str(&predicate));
        }
        if let Ok(object) = pattern.get::<LuaValue>("object") {
            if !matches!(object, LuaValue::Nil) {
                let object_val = lua_to_val(&lua, object, context_id)?;
                pattern_obj.set("object", &object_val);
            }
        }
        
        unsafe {
            js_rdf_query_async(context_id, pattern_obj.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 为 0 表示 undefined
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let result_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, result_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("match", match_fn)?;
    
    // State:batchInsert(triples) - 异步批量插入三元组
    let batch_insert_fn = lua.create_async_function(move |lua, (_, triples): (LuaTable, LuaTable)| async move {
        let (callback_id, rx) = register_callback();
        
        let triples_val = lua_to_val(&lua, LuaValue::Table(triples), context_id)?;
        
        unsafe {
            js_rdf_batch_insert_async(context_id, triples_val.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok(()),
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("batchInsert", batch_insert_fn)?;
    
    // State:set(subject, predicate, object) - 异步设置三元组（先删除后插入）
    let set_fn = lua.create_async_function(move |lua, (_, subject, predicate, object): (LuaTable, String, String, LuaValue)| async move {
        // 1. 先删除所有匹配的三元组
        let (delete_cb_id, delete_rx) = register_callback();
        let subject_c = CString::new(subject.clone()).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate.clone()).map_err(|e| LuaError::external(e))?;
        let null_val = JsVal::null();
        
        unsafe {
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), null_val.handle(), delete_cb_id)
        };
        
        match delete_rx.recv().await {
            Ok(PromiseResult::Success { .. }) => {}
            Ok(PromiseResult::Error { message }) => return Err(LuaError::external(message)),
            Err(e) => return Err(LuaError::external(format!("Channel error: {}", e))),
        }
        
        // 2. 插入新的三元组
        let (insert_cb_id, insert_rx) = register_callback();
        let object_val = lua_to_val(&lua, object, context_id)?;
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        
        unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_val.handle(), insert_cb_id)
        };
        
        match insert_rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok(()),
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("set", set_fn)?;
    
    // State:get(subject, predicate) - 异步获取单个值
    let get_fn = lua.create_async_function(move |lua, (_, subject, predicate): (LuaTable, String, String)| async move {
        let (callback_id, rx) = register_callback();
        
        let pattern_obj = JsVal::object();
        pattern_obj.set("subject", &JsVal::from_str(&subject));
        pattern_obj.set("predicate", &JsVal::from_str(&predicate));
        
        unsafe {
            js_rdf_query_async(context_id, pattern_obj.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 为 0 表示 undefined
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let result_val = JsVal::from_handle(handle as EM_VAL);
                
                // 结果是数组，获取第一个元素的 object 字段
                let first = result_val.get_index(0);
                if first.is_undefined() {
                    return Ok(LuaValue::Nil);
                }
                
                let object_val = first.get("object");
                if object_val.is_undefined() {
                    return Ok(LuaValue::Nil);
                }
                
                val_to_lua(&lua, object_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("get", get_fn)?;
    
    // State:query(sparql) - SPARQL 查询，返回迭代器
    let query_fn = lua.create_async_function(move |lua, (_self, sparql): (LuaTable, String)| async move {
        // 1. 启动查询，获取 query_id
        let (callback_id, rx) = register_callback();
        let sparql_c = CString::new(sparql)
            .map_err(|e| LuaError::external(e))?;
        
        unsafe {
            js_rdf_sparql_query_start(context_id, sparql_c.as_ptr(), callback_id)
        };
        
        // 等待查询启动，获取 query_id（作为数字返回）
        let query_id = match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                if handle == 0 {
                    return Err(LuaError::external("Invalid query_id"));
                }
                let result_val = JsVal::from_handle(handle as EM_VAL);
                result_val.as_f64() as u32
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
            let (cb_id, rx) = register_callback();
            
            unsafe {
                js_rdf_sparql_query_next(query_id, cb_id)
            };
            
            match rx.recv().await {
                Ok(PromiseResult::Success { handle }) => {
                    // handle 为 0 表示查询结束
                    if handle == 0 {
                        unsafe { js_rdf_sparql_query_close(query_id) };
                        return Ok(LuaValue::Nil);
                    }
                    
                    let result_val = JsVal::from_handle(handle as EM_VAL);
                    
                    // 检查是否是 done 标记
                    let done_val = result_val.get("done");
                    if done_val.is_true() {
                        unsafe { js_rdf_sparql_query_close(query_id) };
                        return Ok(LuaValue::Nil);
                    }
                    
                    // 返回 value
                    let value_val = result_val.get("value");
                    if value_val.is_undefined() {
                        val_to_lua(&lua, result_val, context_id)
                    } else {
                        val_to_lua(&lua, value_val, context_id)
                    }
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
