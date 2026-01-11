use mlua::prelude::*;

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

/// 手动调用 __newindex metamethod（如果存在）
fn call_newindex<'a>(
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
                        return call_newindex(t, key, value).await;
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

/// 手动调用 __index metamethod（如果存在）
fn call_index<'a>(
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
                        return call_index(t, key).await;
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
pub fn init_async_table(lua: &Lua) -> LuaResult<()> {
    // 获取 table 库
    let table: LuaTable = lua.globals().get("table")?;
    
    // 创建 async-friendly 的 insert 函数
    let async_insert = lua.create_async_function(|_, (list, pos_or_value, value): (LuaTable, LuaValue, Option<LuaValue>)| async move {
        // 根据参数个数判断调用方式
        // table.insert(list, value) - 在末尾插入
        // table.insert(list, pos, value) - 在指定位置插入
        
        if value.is_none() {
            // 两参数形式: table.insert(list, value)
            let value_to_insert = pos_or_value;
            
            // 获取当前表长度（优先使用 __len 元方法）
            let len = get_table_len(&list).await?;
            
            // 在末尾插入 (index = len + 1)
            // 手动调用 __newindex metamethod
            call_newindex(list.clone(), LuaValue::Integer((len + 1) as i64), value_to_insert).await?;
        } else {
            // 三参数形式: table.insert(list, pos, value)
            let pos: i64 = match pos_or_value {
                LuaValue::Integer(n) => n,
                LuaValue::Number(n) => n as i64,
                _ => return Err(LuaError::external("bad argument #2 to 'insert' (number expected)")),
            };
            
            let value_to_insert = value.unwrap();
            // 获取当前表长度（优先使用 __len 元方法）
            let len = get_table_len(&list).await?;
            
            // 验证位置
            if pos < 1 || pos > (len as i64 + 1) {
                return Err(LuaError::external(format!(
                    "bad argument #2 to 'insert' (position out of bounds)"
                )));
            }
            
            // 将 pos 及之后的元素向后移动
            // 手动调用 __index 和 __newindex metamethods
            for i in (pos as usize..=len).rev() {
                let val = call_index(list.clone(), LuaValue::Integer(i as i64)).await?;
                call_newindex(list.clone(), LuaValue::Integer((i + 1) as i64), val).await?;
            }
            
            // 在指定位置插入新值
            call_newindex(list.clone(), LuaValue::Integer(pos), value_to_insert).await?;
        }
        
        Ok(())
    })?;
    
    // 创建 async-friendly 的 remove 函数
    let async_remove = lua.create_async_function(|_, (list, pos): (LuaTable, Option<i64>)| async move {
        // 获取当前表长度（优先使用 __len 元方法）
        let len = get_table_len(&list).await?;
        
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
        // 手动调用 __index metamethod
        let removed_value = call_index(list.clone(), LuaValue::Integer(pos)).await?;
        
        // 将 pos 之后的元素向前移动
        // 手动调用 __index 和 __newindex metamethods
        for i in (pos as usize)..len {
            let val = call_index(list.clone(), LuaValue::Integer((i + 1) as i64)).await?;
            call_newindex(list.clone(), LuaValue::Integer(i as i64), val).await?;
        }
        
        // 移除最后一个元素
        // 手动调用 __newindex metamethod
        call_newindex(list.clone(), LuaValue::Integer(len as i64), LuaValue::Nil).await?;
        
        Ok(removed_value)
    })?;
    
    // 替换 table 库中的函数
    table.set("insert", async_insert)?;
    table.set("remove", async_remove)?;
    
    Ok(())
}
