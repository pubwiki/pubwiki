use mlua::prelude::*;
use std::ffi::CString;
use std::os::raw::c_char;

use crate::bridge::callback::{register_callback, PromiseResult};
use crate::bridge::emval_ffi::{JsVal, EM_VAL};
use crate::bridge::js_proxy::val_to_lua;
use crate::serde::{lua_value_to_rdf, rdf_to_lua_value, XSD_STRING};


#[link(wasm_import_module = "env")]
unsafe extern "C" {
    // RDF 四元组存储 API（异步接口）
    // 新签名：接受 object 字符串 + datatype 字符串
    fn js_rdf_insert_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_ptr: *const c_char, datatype_ptr: *const c_char, graph_ptr: *const c_char, callback_id: u32);
    fn js_rdf_delete_async(context_id: u32, subject_ptr: *const c_char, predicate_ptr: *const c_char, object_ptr: *const c_char, datatype_ptr: *const c_char, graph_ptr: *const c_char, callback_id: u32);
    fn js_rdf_query_async(context_id: u32, pattern_handle: EM_VAL, callback_id: u32);
    fn js_rdf_batch_insert_async(context_id: u32, quads_handle: EM_VAL, callback_id: u32);
    
    // 版本控制 API
    fn js_rdf_current_ref(context_id: u32) -> EM_VAL;
    fn js_rdf_checkout_async(context_id: u32, ref_ptr: *const c_char, callback_id: u32);
    fn js_rdf_checkpoint_async(context_id: u32, callback_id: u32);
    
    // SPARQL 流式查询 API
    fn js_rdf_sparql_query_start(context_id: u32, sparql_ptr: *const c_char, callback_id: u32);
    fn js_rdf_sparql_query_next(query_id: u32, callback_id: u32);
    fn js_rdf_sparql_query_close(query_id: u32);
}


/// 安装 RDF 四元组存储 API 到 Lua 全局环境（异步版本）
/// context_id: 执行上下文 ID，用于隔离不同的并发执行
/// 新 API：所有变更操作返回 Ref，支持 graph 参数，使用 datatype 保留值类型
pub fn install_rdf_api(lua: &Lua, context_id: u32) -> LuaResult<()> {
    let state_table = lua.create_table()?;
    
    // State:insert(subject, predicate, object, graph?) - 异步插入四元组，返回 Ref
    // object 在 Rust 侧序列化为 (字符串, datatype)
    let insert_fn = lua.create_async_function(move |lua, (_, subject, predicate, object, graph): (LuaTable, String, String, LuaValue, Option<String>)| async move {
        let (callback_id, rx) = register_callback();
        
        // 在 Rust 侧序列化 object 为 (字符串值, datatype)
        let (object_str, datatype) = lua_value_to_rdf(&lua, object)?;
        
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let object_c = CString::new(object_str).map_err(|e| LuaError::external(e))?;
        let datatype_c = CString::new(datatype).map_err(|e| LuaError::external(e))?;
        let graph_c = graph.map(|g| CString::new(g)).transpose().map_err(|e| LuaError::external(e))?;
        let graph_ptr = graph_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        
        unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_c.as_ptr(), datatype_c.as_ptr(), graph_ptr, callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 是 ref 字符串的 EM_VAL
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let ref_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, ref_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("insert", insert_fn)?;
    
    // State:delete(subject, predicate, object?, graph?) - 异步删除四元组，返回 Ref
    // object 为 nil 时删除所有匹配的四元组
    let delete_fn = lua.create_async_function(move |lua, (_, subject, predicate, object, graph): (LuaTable, String, String, Option<LuaValue>, Option<String>)| async move {
        let (callback_id, rx) = register_callback();
        
        // 如果 object 存在，在 Rust 侧序列化
        let (object_c, datatype_c) = match object {
            Some(val) if !matches!(val, LuaValue::Nil) => {
                let (object_str, datatype) = lua_value_to_rdf(&lua, val)?;
                (
                    Some(CString::new(object_str).map_err(|e| LuaError::external(e))?),
                    Some(CString::new(datatype).map_err(|e| LuaError::external(e))?)
                )
            }
            _ => (None, None),
        };
        
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let graph_c = graph.map(|g| CString::new(g)).transpose().map_err(|e| LuaError::external(e))?;
        
        let object_ptr = object_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        let datatype_ptr = datatype_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        let graph_ptr = graph_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        
        unsafe {
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_ptr, datatype_ptr, graph_ptr, callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 是 ref 字符串的 EM_VAL
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let ref_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, ref_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("delete", delete_fn)?;
    
    // State:match(pattern) - 异步查询四元组，pattern 支持 graph 字段
    // 返回结果中包含 datatype 字段，用于正确反序列化
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
        // 对于 object，需要序列化以便精确匹配
        if let Ok(object) = pattern.get::<LuaValue>("object") {
            if !matches!(object, LuaValue::Nil) {
                let (object_str, datatype) = lua_value_to_rdf(&lua, object)?;
                pattern_obj.set("object", &JsVal::from_str(&object_str));
                pattern_obj.set("objectDatatype", &JsVal::from_str(&datatype));
            }
        }
        if let Ok(graph) = pattern.get::<String>("graph") {
            pattern_obj.set("graph", &JsVal::from_str(&graph));
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
                
                // 结果是数组，需要将每个元素的 object 根据 datatype 反序列化
                let result_table = lua.create_table()?;
                let length = result_val.get("length").as_f64() as u32;
                
                for i in 0..length {
                    let item = result_val.get_index(i);
                    let item_table = lua.create_table()?;
                    
                    // subject 和 predicate 直接是字符串
                    item_table.set("subject", item.get("subject").as_string())?;
                    item_table.set("predicate", item.get("predicate").as_string())?;
                    
                    // object 需要根据 datatype 反序列化
                    let object_str = item.get("object").as_string();
                    let datatype_val = item.get("datatype");
                    let datatype = if datatype_val.is_string() {
                        datatype_val.as_string()
                    } else {
                        XSD_STRING.to_string()
                    };
                    let object_lua = rdf_to_lua_value(&lua, &object_str, &datatype)?;
                    item_table.set("object", object_lua)?;
                    
                    // graph 可能为 null
                    let graph_val = item.get("graph");
                    if !graph_val.is_null() && !graph_val.is_undefined() {
                        item_table.set("graph", graph_val.as_string())?;
                    }
                    
                    result_table.set(i + 1, item_table)?;
                }
                
                Ok(LuaValue::Table(result_table))
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("match", match_fn)?;
    
    // State:batchInsert(quads) - 异步批量插入四元组，返回 Ref
    // 每个 quad 的 object 需要序列化
    let batch_insert_fn = lua.create_async_function(move |lua, (_, quads): (LuaTable, LuaTable)| async move {
        let (callback_id, rx) = register_callback();
        
        // 构建序列化后的 quads 数组
        let quads_arr = JsVal::array();
        for pair in quads.pairs::<i64, LuaTable>() {
            let (_, quad) = pair?;
            let quad_obj = JsVal::object();
            
            quad_obj.set("subject", &JsVal::from_str(&quad.get::<String>("subject")?));
            quad_obj.set("predicate", &JsVal::from_str(&quad.get::<String>("predicate")?));
            
            // 序列化 object
            let object: LuaValue = quad.get("object")?;
            let (object_str, datatype) = lua_value_to_rdf(&lua, object)?;
            quad_obj.set("object", &JsVal::from_str(&object_str));
            quad_obj.set("datatype", &JsVal::from_str(&datatype));
            
            // graph 是可选的
            if let Ok(graph) = quad.get::<String>("graph") {
                quad_obj.set("graph", &JsVal::from_str(&graph));
            }
            
            quads_arr.push(&quad_obj);
        }
        
        unsafe {
            js_rdf_batch_insert_async(context_id, quads_arr.handle(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 是 ref 字符串的 EM_VAL
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let ref_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, ref_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("batchInsert", batch_insert_fn)?;
    
    // State:set(subject, predicate, object, graph?) - 异步设置四元组（先删除后插入），返回 Ref
    // 当 object 为 nil 时，只执行删除操作（delete 语义）
    // 使用新的字符串+datatype 序列化
    let set_fn = lua.create_async_function(move |lua, (_, subject, predicate, object, graph): (LuaTable, String, String, LuaValue, Option<String>)| async move {
        // 1. 先删除所有匹配的四元组（object 为 null 表示删除所有）
        let (delete_cb_id, delete_rx) = register_callback();
        let subject_c = CString::new(subject.clone()).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate.clone()).map_err(|e| LuaError::external(e))?;
        let graph_c = graph.as_ref().map(|g| CString::new(g.clone())).transpose().map_err(|e| LuaError::external(e))?;
        let graph_ptr = graph_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        
        unsafe {
            // object_ptr 和 datatype_ptr 都为 null 表示删除所有匹配
            js_rdf_delete_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), std::ptr::null(), std::ptr::null(), graph_ptr, delete_cb_id)
        };
        
        let delete_result = match delete_rx.recv().await {
            Ok(PromiseResult::Success { handle }) => handle,
            Ok(PromiseResult::Error { message }) => return Err(LuaError::external(message)),
            Err(e) => return Err(LuaError::external(format!("Channel error: {}", e))),
        };
        
        // 2. 如果 object 是 nil，只执行删除，不插入（delete 语义）
        if matches!(object, LuaValue::Nil) {
            // 返回删除操作的 ref
            if delete_result == 0 {
                return Ok(LuaValue::Nil);
            }
            let ref_val = JsVal::from_handle(delete_result as EM_VAL);
            return val_to_lua(&lua, ref_val, context_id);
        }
        
        // 3. 插入新的四元组（使用序列化）
        let (insert_cb_id, insert_rx) = register_callback();
        let (object_str, datatype) = lua_value_to_rdf(&lua, object)?;
        let subject_c = CString::new(subject).map_err(|e| LuaError::external(e))?;
        let predicate_c = CString::new(predicate).map_err(|e| LuaError::external(e))?;
        let object_c = CString::new(object_str).map_err(|e| LuaError::external(e))?;
        let datatype_c = CString::new(datatype).map_err(|e| LuaError::external(e))?;
        let graph_c = graph.map(|g| CString::new(g)).transpose().map_err(|e| LuaError::external(e))?;
        let graph_ptr = graph_c.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());
        
        unsafe {
            js_rdf_insert_async(context_id, subject_c.as_ptr(), predicate_c.as_ptr(), object_c.as_ptr(), datatype_c.as_ptr(), graph_ptr, insert_cb_id)
        };
        
        match insert_rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // 返回最后一个操作（插入）的 ref
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let ref_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, ref_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("set", set_fn)?;
    
    // State:get(subject, predicate, graph?) - 异步获取单个值
    // 返回值根据 datatype 反序列化
    let get_fn = lua.create_async_function(move |lua, (_, subject, predicate, graph): (LuaTable, String, String, Option<String>)| async move {
        let (callback_id, rx) = register_callback();
        
        let pattern_obj = JsVal::object();
        pattern_obj.set("subject", &JsVal::from_str(&subject));
        pattern_obj.set("predicate", &JsVal::from_str(&predicate));
        if let Some(g) = graph {
            pattern_obj.set("graph", &JsVal::from_str(&g));
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
                
                // 结果是数组，获取第一个元素的 object 和 datatype 字段
                let first = result_val.get_index(0);
                if first.is_undefined() {
                    return Ok(LuaValue::Nil);
                }
                
                let object_val = first.get("object");
                if object_val.is_undefined() {
                    return Ok(LuaValue::Nil);
                }
                
                // 根据 datatype 反序列化
                let object_str = object_val.as_string();
                let datatype_val = first.get("datatype");
                let datatype = if datatype_val.is_string() {
                    datatype_val.as_string()
                } else {
                    XSD_STRING.to_string()
                };
                
                rdf_to_lua_value(&lua, &object_str, &datatype)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("get", get_fn)?;
    
    // State:currentRef() - 获取当前版本引用（同步）
    let current_ref_fn = lua.create_function(move |lua, _: LuaTable| {
        let handle = unsafe { js_rdf_current_ref(context_id) };
        if handle == 0 as EM_VAL {
            return Ok(LuaValue::Nil);
        }
        let ref_val = JsVal::from_handle(handle);
        val_to_lua(lua, ref_val, context_id)
    })?;
    state_table.set("currentRef", current_ref_fn)?;
    
    // State:checkout(ref) - 切换到指定版本（异步）
    let checkout_fn = lua.create_async_function(move |_lua, (_, ref_str): (LuaTable, String)| async move {
        let (callback_id, rx) = register_callback();
        let ref_c = CString::new(ref_str).map_err(|e| LuaError::external(e))?;
        
        unsafe {
            js_rdf_checkout_async(context_id, ref_c.as_ptr(), callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok(()),
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("checkout", checkout_fn)?;
    
    // State:checkpoint() - 创建检查点，返回 Ref（异步）
    let checkpoint_fn = lua.create_async_function(move |lua, _: LuaTable| async move {
        let (callback_id, rx) = register_callback();
        
        unsafe {
            js_rdf_checkpoint_async(context_id, callback_id)
        };
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                if handle == 0 {
                    return Ok(LuaValue::Nil);
                }
                let ref_val = JsVal::from_handle(handle as EM_VAL);
                val_to_lua(&lua, ref_val, context_id)
            }
            Ok(PromiseResult::Error { message }) => Err(LuaError::external(message)),
            Err(e) => Err(LuaError::external(format!("Channel error: {}", e))),
        }
    })?;
    state_table.set("checkpoint", checkpoint_fn)?;
    
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
