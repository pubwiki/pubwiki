use mlua::prelude::*;
use crate::bridge::JsProxy;
use crate::bridge::emval_ffi::JsVal;

// ==================== 类表对象抽象 ====================

/// 统一的类表对象封装，支持 LuaTable 和 JsProxy
#[derive(Clone)]
enum TableLike {
    Table(LuaTable),
    JsProxy(LuaAnyUserData),
}

impl TableLike {
    /// 从 LuaValue 创建 TableLike
    fn from_value(value: LuaValue) -> LuaResult<Self> {
        match value {
            LuaValue::Table(t) => Ok(TableLike::Table(t)),
            LuaValue::UserData(ud) => {
                // 检查是否是 JsProxy
                if let Ok(proxy) = ud.borrow::<JsProxy>() {
                    // 检查是否是数组类型
                    if proxy.val().is_array() {
                        drop(proxy); // 释放 borrow
                        Ok(TableLike::JsProxy(ud))
                    } else {
                        Err(LuaError::external("bad argument #1 (table or array expected, got object)"))
                    }
                } else {
                    Err(LuaError::external("bad argument #1 (table or array expected)"))
                }
            }
            _ => Err(LuaError::external("bad argument #1 (table or array expected)")),
        }
    }

    /// 转换为 LuaValue（保留以备将来使用）
    #[allow(dead_code)]
    fn to_value(&self) -> LuaValue {
        match self {
            TableLike::Table(t) => LuaValue::Table(t.clone()),
            TableLike::JsProxy(ud) => LuaValue::UserData(ud.clone()),
        }
    }
}

// ==================== TableLike 操作 ====================

/// 获取类表对象的长度
async fn get_len(list: &TableLike) -> LuaResult<usize> {
    match list {
        TableLike::Table(t) => get_table_len(t).await,
        TableLike::JsProxy(ud) => {
            // JsProxy 实现了 __len，通过 metatable 调用
            let metatable = ud.metatable()?;
            if let Ok(len_method) = metatable.get::<LuaFunction>("__len") {
                let len: i64 = len_method.call_async(ud.clone()).await?;
                return Ok(len as usize);
            }
            // JsProxy 应该始终有 __len，但作为后备
            Err(LuaError::external("JsProxy missing __len metamethod"))
        }
    }
}

/// 获取类表对象的索引值
async fn get_index(list: &TableLike, key: LuaValue) -> LuaResult<LuaValue> {
    match list {
        TableLike::Table(t) => call_table_index(t.clone(), key).await,
        TableLike::JsProxy(ud) => {
            // JsProxy 实现了 __index，通过 metatable 调用
            let metatable = ud.metatable()?;
            if let Ok(index_method) = metatable.get::<LuaFunction>("__index") {
                return index_method.call_async((ud.clone(), key)).await;
            }
            Err(LuaError::external("JsProxy missing __index metamethod"))
        }
    }
}

/// 设置类表对象的索引值
async fn set_index(list: &TableLike, key: LuaValue, value: LuaValue) -> LuaResult<()> {
    match list {
        TableLike::Table(t) => call_table_newindex(t.clone(), key, value).await,
        TableLike::JsProxy(ud) => {
            // JsProxy 实现了 __newindex，通过 metatable 调用
            let metatable = ud.metatable()?;
            if let Ok(newindex_method) = metatable.get::<LuaFunction>("__newindex") {
                newindex_method.call_async::<()>((ud.clone(), key, value)).await?;
                return Ok(());
            }
            Err(LuaError::external("JsProxy missing __newindex metamethod"))
        }
    }
}

/// 对 JsProxy 数组调用 splice 方法来删除元素
/// 这样可以真正删除元素并调整数组长度，与 Lua 语义一致
fn splice_jsproxy(ud: &LuaAnyUserData, index: usize, delete_count: usize) -> LuaResult<()> {
    let proxy = ud.borrow::<JsProxy>()?;
    let val = proxy.val();
    
    // 调用 JS 的 splice 方法: arr.splice(index, deleteCount)
    // 注意：JS 使用 0-based 索引，而 Lua 使用 1-based 索引
    // 传入的 index 已经是 Lua 1-based，需要转换为 JS 0-based
    let js_index = JsVal::from_i32((index - 1) as i32);
    let js_delete_count = JsVal::from_i32(delete_count as i32);
    
    val.call_method("splice", &[&js_index, &js_delete_count]);
    
    Ok(())
}

// ==================== LuaTable 专用操作 ====================

/// 获取表的长度（优先使用 __len 元方法）
async fn get_table_len(list: &LuaTable) -> LuaResult<usize> {
    // 检查是否有 __len 元方法
    if let Some(metatable) = list.metatable() {
        if let Ok(len_method) = metatable.raw_get::<LuaFunction>("__len") {
            // 调用 __len(table)
            let len: i64 = len_method.call_async(list.clone()).await?;
            return Ok(len as usize);
        }
    }
    
    // 没有 __len 元方法，使用 raw_len
    Ok(list.raw_len())
}

/// 手动调用表的 __newindex metamethod（如果存在）
fn call_table_newindex<'a>(
    list: LuaTable,
    key: LuaValue,
    value: LuaValue,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = LuaResult<()>> + 'a>> {
    Box::pin(async move {
        // 获取 metatable
        if let Some(metatable) = list.metatable() {
            // 查找 __newindex
            if let Ok(newindex) = metatable.raw_get::<LuaValue>("__newindex") {
                match newindex {
                    LuaValue::Function(func) => {
                        // 调用 __newindex(table, key, value)
                        func.call_async::<()>((list.clone(), key, value)).await?;
                        return Ok(());
                    }
                    LuaValue::Table(t) => {
                        // __newindex 是表，递归设置
                        return call_table_newindex(t, key, value).await;
                    }
                    _ => {
                        // __newindex 不是函数或表，回退到 raw_set
                        list.raw_set(key, value)?;
                        return Ok(());
                    }
                }
            }
        }
        
        // 没有 metatable 或没有 __newindex，使用 raw_set
        list.raw_set(key, value)?;
        Ok(())
    })
}

/// 手动调用表的 __index metamethod（如果存在）
fn call_table_index<'a>(
    list: LuaTable,
    key: LuaValue,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = LuaResult<LuaValue>> + 'a>> {
    Box::pin(async move {
        // 先尝试 raw_get
        let raw_value = list.raw_get::<LuaValue>(key.clone())?;
        if !raw_value.is_nil() {
            return Ok(raw_value);
        }
        
        // 如果 raw_get 返回 nil，查找 __index
        if let Some(metatable) = list.metatable() {
            if let Ok(index) = metatable.raw_get::<LuaValue>("__index") {
                match index {
                    LuaValue::Function(func) => {
                        // 调用 __index(table, key)
                        return func.call_async((list.clone(), key)).await;
                    }
                    LuaValue::Table(t) => {
                        // __index 是表，递归查找
                        return call_table_index(t, key).await;
                    }
                    _ => {
                        return Ok(LuaValue::Nil);
                    }
                }
            }
        }
        
        Ok(LuaValue::Nil)
    })
}

/// 初始化 async-friendly 的 table 操作
/// 这些函数会替换标准库中的 table.insert 和 table.remove
/// 以支持在包含异步操作的 metamethod 中调用
/// 同时支持 LuaTable 和 JsProxy（JS 数组代理）
pub fn init_async_table(lua: &Lua) -> LuaResult<()> {
    // 获取 table 库
    let table: LuaTable = lua.globals().get("table")?;
    
    // 创建 async-friendly 的 insert 函数
    // 支持 LuaTable 和 JsProxy
    let async_insert = lua.create_async_function(|_, (obj, pos_or_value, value): (LuaValue, LuaValue, Option<LuaValue>)| async move {
        // 根据参数个数判断调用方式
        // table.insert(list, value) - 在末尾插入
        // table.insert(list, pos, value) - 在指定位置插入
        
        // 解析第一个参数为 TableLike
        let list = TableLike::from_value(obj)?;
        
        if value.is_none() {
            // 两参数形式: table.insert(list, value)
            let value_to_insert = pos_or_value;
            
            // 获取当前表长度（优先使用 __len 元方法）
            let len = get_len(&list).await?;
            
            // 在末尾插入 (index = len + 1)
            set_index(&list, LuaValue::Integer((len + 1) as i64), value_to_insert).await?;
        } else {
            // 三参数形式: table.insert(list, pos, value)
            let pos: i64 = match pos_or_value {
                LuaValue::Integer(n) => n,
                LuaValue::Number(n) => n as i64,
                _ => return Err(LuaError::external("bad argument #2 to 'insert' (number expected)")),
            };
            
            let value_to_insert = value.unwrap();
            // 获取当前表长度（优先使用 __len 元方法）
            let len = get_len(&list).await?;
            
            // 验证位置
            if pos < 1 || pos > (len as i64 + 1) {
                return Err(LuaError::external(format!(
                    "bad argument #2 to 'insert' (position out of bounds)"
                )));
            }
            
            // 将 pos 及之后的元素向后移动
            for i in (pos as usize..=len).rev() {
                let val = get_index(&list, LuaValue::Integer(i as i64)).await?;
                set_index(&list, LuaValue::Integer((i + 1) as i64), val).await?;
            }
            
            // 在指定位置插入新值
            set_index(&list, LuaValue::Integer(pos), value_to_insert).await?;
        }
        
        Ok(())
    })?;
    
    // 创建 async-friendly 的 remove 函数
    // 支持 LuaTable 和 JsProxy
    let async_remove = lua.create_async_function(|_, (obj, pos): (LuaValue, Option<i64>)| async move {
        // 解析第一个参数为 TableLike
        let list = TableLike::from_value(obj)?;
        
        // 获取当前表长度（优先使用 __len 元方法）
        let len = get_len(&list).await?;
        
        if len == 0 {
            return Ok(LuaValue::Nil);
        }
        
        // 确定要移除的位置
        let pos = pos.unwrap_or(len as i64);
        
        // 验证位置
        if pos < 1 || pos > len as i64 {
            return Err(LuaError::external(format!(
                "bad argument #2 to 'remove' (position out of bounds)"
            )));
        }
        
        // 获取要移除的值
        let removed_value = get_index(&list, LuaValue::Integer(pos)).await?;
        
        // 根据类型选择不同的删除策略
        match &list {
            TableLike::JsProxy(ud) => {
                // 对于 JsProxy，使用 splice 方法来真正删除元素
                // 这样可以调整数组长度，与 Lua 语义一致
                splice_jsproxy(ud, pos as usize, 1)?;
            }
            TableLike::Table(_) => {
                // 对于 LuaTable，使用传统的移动元素方式
                // 将 pos 之后的元素向前移动
                for i in (pos as usize)..len {
                    let val = get_index(&list, LuaValue::Integer((i + 1) as i64)).await?;
                    set_index(&list, LuaValue::Integer(i as i64), val).await?;
                }
                
                // 移除最后一个元素（设置为 nil）
                set_index(&list, LuaValue::Integer(len as i64), LuaValue::Nil).await?;
            }
        }
        
        Ok(removed_value)
    })?;
    
    // 替换 table 库中的函数
    table.set("insert", async_insert)?;
    table.set("remove", async_remove)?;
    
    Ok(())
}
