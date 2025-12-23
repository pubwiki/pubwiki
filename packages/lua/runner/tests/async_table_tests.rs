use lua_runner::async_table::init_async_table;
use lua_runner::lua_value_to_json;
use mlua::prelude::*;

/// 测试基本的 table.insert - 两参数形式（在末尾插入）
#[test]
fn test_insert_at_end() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        table.insert(t, 4)
        assert(#t == 4)
        assert(t[4] == 4)
    "#).exec().unwrap();
}

/// 测试 table.insert - 三参数形式（在指定位置插入）
#[test]
fn test_insert_at_position() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        table.insert(t, 2, 99)
        assert(#t == 4)
        assert(t[1] == 1)
        assert(t[2] == 99)
        assert(t[3] == 2)
        assert(t[4] == 3)
    "#).exec().unwrap();
}

/// 测试 table.remove - 默认移除末尾元素
#[test]
fn test_remove_from_end() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3, 4}
        local removed = table.remove(t)
        assert(removed == 4)
        assert(#t == 3)
        assert(t[3] == 3)
    "#).exec().unwrap();
}

/// 测试 table.remove - 从指定位置移除
#[test]
fn test_remove_from_position() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3, 4}
        local removed = table.remove(t, 2)
        assert(removed == 2)
        assert(#t == 3)
        assert(t[1] == 1)
        assert(t[2] == 3)
        assert(t[3] == 4)
    "#).exec().unwrap();
}

/// 测试 table.remove - 空表
#[test]
fn test_remove_from_empty_table() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {}
        local removed = table.remove(t)
        assert(removed == nil)
        assert(#t == 0)
    "#).exec().unwrap();
}

/// 测试 __newindex metamethod 是否被触发
#[test]
fn test_newindex_metamethod_triggered() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local log = {}
        local t = {1, 2, 3}
        
        setmetatable(t, {
            __newindex = function(table, key, value)
                -- 注意：在 metamethod 内部使用 rawset 避免递归
                rawset(log, #log + 1, "newindex: " .. tostring(key) .. " = " .. tostring(value))
                rawset(table, key, value)
            end
        })
        
        table.insert(t, 4)
        
        -- 应该触发 __newindex
        assert(#log > 0, "Expected __newindex to be called")
        assert(t[4] == 4)
    "#).exec().unwrap();
}

/// 测试 get/set 会正常工作（即使 metamethods 不被触发）
/// 这验证了我们的实现确实调用了 get/set 而不是 raw_get/raw_set
#[test]
fn test_get_set_used_not_raw() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local newindex_called = false
        local t = {1, 2, 3}
        
        -- 设置一个会拦截所有赋值的 metamethod
        setmetatable(t, {
            __newindex = function(table, key, value)
                newindex_called = true
                rawset(table, key, value)
            end
        })
        
        -- 在末尾插入，这会在一个新的索引上赋值，触发 __newindex
        table.insert(t, 99)
        
        -- 验证 __newindex 被调用了
        assert(newindex_called, "Expected __newindex to be called for new key")
        assert(#t == 4)
        assert(t[4] == 99)
    "#).exec().unwrap();
}

/// 测试带有复杂 metamethod 的场景
#[test]
fn test_complex_metamethod_scenario() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local access_log = {}
        local t = {10, 20, 30}
        
        setmetatable(t, {
            __index = function(table, key)
                rawset(access_log, #access_log + 1, {type = "get", key = key})
                return rawget(table, key)
            end,
            __newindex = function(table, key, value)
                rawset(access_log, #access_log + 1, {type = "set", key = key, value = value})
                rawset(table, key, value)
            end
        })
        
        -- 执行插入操作
        table.insert(t, 2, 15)
        
        -- 验证结果
        assert(#t == 4)
        assert(t[1] == 10)
        assert(t[2] == 15)
        assert(t[3] == 20)
        assert(t[4] == 30)
        
        -- 验证 metamethods 被调用
        assert(#access_log > 0, "Expected metamethods to be called")
    "#).exec().unwrap();
}

/// 测试错误处理 - 无效的位置参数
#[test]
fn test_insert_invalid_position() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    let result = lua.load(r#"
        local t = {1, 2, 3}
        table.insert(t, 10, 99)  -- 位置超出范围
    "#).exec();

    assert!(result.is_err());
}

/// 测试错误处理 - remove 的无效位置
#[test]
fn test_remove_invalid_position() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    let result = lua.load(r#"
        local t = {1, 2, 3}
        table.remove(t, 10)  -- 位置超出范围
    "#).exec();

    assert!(result.is_err());
}

/// 测试 insert 在位置 1 插入
#[test]
fn test_insert_at_beginning() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {2, 3, 4}
        table.insert(t, 1, 1)
        assert(#t == 4)
        assert(t[1] == 1)
        assert(t[2] == 2)
        assert(t[3] == 3)
        assert(t[4] == 4)
    "#).exec().unwrap();
}

/// 测试 remove 第一个元素
#[test]
fn test_remove_first_element() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3, 4}
        local removed = table.remove(t, 1)
        assert(removed == 1)
        assert(#t == 3)
        assert(t[1] == 2)
        assert(t[2] == 3)
        assert(t[3] == 4)
    "#).exec().unwrap();
}

/// 测试连续的 insert 和 remove 操作
#[test]
fn test_multiple_operations() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        
        table.insert(t, 4)
        assert(#t == 4)
        
        table.insert(t, 2, 99)
        assert(#t == 5)
        assert(t[2] == 99)
        
        local removed = table.remove(t, 2)
        assert(removed == 99)
        assert(#t == 4)
        
        local last = table.remove(t)
        assert(last == 4)
        assert(#t == 3)
        
        assert(t[1] == 1)
        assert(t[2] == 2)
        assert(t[3] == 3)
    "#).exec().unwrap();
}

/// 测试带有不同类型值的操作
#[test]
fn test_with_different_value_types() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, "two", 3.5, true}
        
        table.insert(t, {nested = "table"})
        assert(#t == 5)
        
        table.insert(t, 2, false)
        assert(#t == 6)
        
        local removed = table.remove(t)
        assert(type(removed) == "table")
        
        assert(#t == 5)
    "#).exec().unwrap();
}

/// 测试在 metamethod 中调用 async 函数 - 核心测试！
/// 这验证了我们的实现确实解决了 "yield across C-call boundary" 问题
#[test]
fn test_async_call_in_metamethod() {
    use async_executor::LocalExecutor;
    use futures_lite::future;
    use std::time::Duration;

    let ex = LocalExecutor::new();
    
    future::block_on(ex.run(async {
        let lua = Lua::new();
        init_async_table(&lua).unwrap();

        // 创建一个真正执行异步操作的函数（带 sleep）
        let async_fn = lua.create_async_function(|_, msg: String| async move {
            // 真实的异步等待
            async_io::Timer::after(Duration::from_millis(10)).await;
            Ok(format!("processed: {}", msg))
        }).unwrap();
        
        lua.globals().set("async_operation", async_fn).unwrap();

        // 测试：在 __newindex 中调用 async 函数
        lua.load(r#"
            local t = {1, 2, 3}
            local results = {}
            local call_count = 0
            
            setmetatable(t, {
                __newindex = function(table, key, value)
                    -- 这里调用 async 函数！
                    -- 如果是标准的 C 实现，这里会抛出错误
                    local result = async_operation("key=" .. tostring(key))
                    call_count = call_count + 1
                    -- 使用 rawset 避免递归
                    rawset(results, call_count, result)
                    rawset(table, key, value)
                end
            })
            
            -- 这个 table.insert 会触发 __newindex
            -- __newindex 中会调用 async_operation
            table.insert(t, 4)
            
            assert(#t == 4, "Table should have 4 elements")
            assert(t[4] == 4, "t[4] should be 4")
            assert(call_count == 1, "Should have called metamethod once")
            assert(results[1] == "processed: key=4", "Result should match")
        "#).exec_async().await.unwrap();
    }));
}

/// 测试在 metamethod 中调用 async 函数 - 插入到中间位置
/// 验证在 __newindex 中可以调用 async 函数
#[test]
fn test_async_call_with_insert_middle() {
    use async_executor::LocalExecutor;
    use futures_lite::future;
    use std::time::Duration;

    let ex = LocalExecutor::new();
    
    future::block_on(ex.run(async {
        let lua = Lua::new();
        init_async_table(&lua).unwrap();

        // 创建一个真正执行异步操作的函数（带 sleep）
        let async_fn = lua.create_async_function(|_, msg: String| async move {
            // 真实的异步等待
            async_io::Timer::after(Duration::from_millis(5)).await;
            Ok(format!("async: {}", msg))
        }).unwrap();
        
        lua.globals().set("async_op", async_fn).unwrap();

        lua.load(r#"
            local t = {10, 20, 30}
            local set_count = 0
            
            setmetatable(t, {
                __newindex = function(table, key, value)
                    -- 在 __newindex 中调用 async 函数
                    -- 这是核心测试：async 调用应该能正常 yield
                    async_op("setting key=" .. tostring(key) .. " value=" .. tostring(value))
                    set_count = set_count + 1
                    rawset(table, key, value)
                end
            })
            
            -- 在中间插入，会触发 __newindex（新位置 4）
            table.insert(t, 2, 15)
            
            assert(#t == 4, "Table should have 4 elements")
            assert(t[2] == 15, "t[2] should be 15")
            -- 验证 __newindex 确实被调用了，并且 async 函数也被调用了
            assert(set_count > 0, "Should have called __newindex with async_op, got " .. tostring(set_count))
        "#).exec_async().await.unwrap();
    }));
}

/// 测试 __len 元方法 - insert 在末尾
#[test]
fn test_len_metamethod_insert_end() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        local custom_len = 5
        
        setmetatable(t, {
            __len = function(table)
                -- 返回自定义长度
                return custom_len
            end
        })
        
        -- table.insert 应该使用 __len 返回的长度
        table.insert(t, 99)
        
        -- 99 应该被插入到位置 custom_len + 1 = 6
        assert(t[6] == 99, "Expected t[6] == 99, got " .. tostring(t[6]))
        
        -- 原来的元素应该保持不变
        assert(t[1] == 1)
        assert(t[2] == 2)
        assert(t[3] == 3)
    "#).exec().unwrap();
}

/// 测试 __len 元方法 - insert 在指定位置
#[test]
fn test_len_metamethod_insert_position() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {10, 20, 30}
        local custom_len = 10
        
        setmetatable(t, {
            __len = function(table)
                return custom_len
            end
        })
        
        -- 在位置 2 插入，应该基于 __len 返回的长度来移动元素
        table.insert(t, 2, 15)
        
        -- 验证插入成功
        assert(t[1] == 10)
        assert(t[2] == 15)
        assert(t[3] == 20)
        assert(t[4] == 30)
    "#).exec().unwrap();
}

/// 测试 __len 元方法 - remove
/// 注意：我们的实现使用 __len 获取长度，这与标准 Lua 的 table.remove 略有不同
#[test]
fn test_len_metamethod_remove() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3, 4, 5}
        local custom_len = 3
        
        setmetatable(t, {
            __len = function(table)
                return custom_len
            end
        })
        
        -- table.remove 应该使用 __len 返回的长度
        -- 默认移除末尾元素，即位置 custom_len = 3
        local removed = table.remove(t)
        
        -- 应该移除位置 3 的元素（值为 3）
        assert(removed == 3, "Expected removed == 3, got " .. tostring(removed))
        
        -- 由于 __len 返回 3，所以只有位置 1-3 被视为有效
        -- 位置 3 被设为 nil
        assert(t[3] == nil, "Expected t[3] == nil, got " .. tostring(t[3]))
        
        -- 位置 4 和 5 的元素保持不变
        assert(t[4] == 4)
        assert(t[5] == 5)
    "#).exec().unwrap();
}

/// 测试 __len 元方法返回 0
/// 当 __len 返回 0 时，insert 在位置 1 插入，不移动任何元素（因为认为表是空的）
#[test]
fn test_len_metamethod_returns_zero() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        
        setmetatable(t, {
            __len = function(table)
                return 0
            end
        })
        
        -- insert 应该在位置 1 插入（0 + 1）
        -- 由于 __len 返回 0，表被视为空，不会移动任何元素
        table.insert(t, 99)
        
        -- 99 被插入到位置 1
        assert(t[1] == 99, "Expected t[1] == 99, got " .. tostring(t[1]))
        
        -- 原来位置 2 和 3 的元素保持不变
        assert(t[2] == 2, "Expected t[2] == 2, got " .. tostring(t[2]))
        assert(t[3] == 3, "Expected t[3] == 3, got " .. tostring(t[3]))
    "#).exec().unwrap();
}

/// 测试 __len 元方法和边界检查
#[test]
fn test_len_metamethod_boundary_check() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    let result = lua.load(r#"
        local t = {1, 2, 3}
        
        setmetatable(t, {
            __len = function(table)
                return 5
            end
        })
        
        -- 尝试在位置 7 插入，应该超出边界（len + 1 = 6）
        table.insert(t, 7, 99)
    "#).exec();

    // 应该报错
    assert!(result.is_err(), "Expected error for out of bounds insert");
}

/// 测试 __len 元方法 - 动态长度
#[test]
fn test_len_metamethod_dynamic() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local actual_len = 3
        local t = {1, 2, 3}
        
        setmetatable(t, {
            __len = function(table)
                return actual_len
            end,
            __newindex = function(table, key, value)
                rawset(table, key, value)
                -- 更新 actual_len
                if type(key) == "number" and key > actual_len then
                    actual_len = key
                end
            end
        })
        
        -- 第一次 insert
        table.insert(t, 99)
        assert(t[4] == 99, "First insert: t[4] should be 99")
        
        -- 第二次 insert，长度应该已经更新
        table.insert(t, 88)
        assert(t[5] == 88, "Second insert: t[5] should be 88")
    "#).exec().unwrap();
}

/// 测试 __len 元方法在 remove 中的使用
#[test]
fn test_len_metamethod_remove_empty() {
    let lua = Lua::new();
    init_async_table(&lua).unwrap();

    lua.load(r#"
        local t = {1, 2, 3}
        
        setmetatable(t, {
            __len = function(table)
                return 0  -- 假装表是空的
            end
        })
        
        -- remove 应该认为表是空的
        local removed = table.remove(t)
        assert(removed == nil, "Expected nil when removing from 'empty' table")
    "#).exec().unwrap();
}

/// 测试 __len 元方法是异步函数
#[test]
fn test_async_len_metamethod() {
    use async_executor::LocalExecutor;
    use futures_lite::future;
    use std::time::Duration;

    let ex = LocalExecutor::new();
    
    future::block_on(ex.run(async {
        let lua = Lua::new();
        init_async_table(&lua).unwrap();

        // 创建一个异步函数用于 __len
        let async_len = lua.create_async_function(|_, _tbl: LuaTable| async move {
            // 模拟异步计算长度
            async_io::Timer::after(Duration::from_millis(5)).await;
            Ok(5)
        }).unwrap();
        
        lua.globals().set("async_get_len", async_len).unwrap();

        lua.load(r#"
            local t = {1, 2, 3}
            
            setmetatable(t, {
                __len = function(table)
                    -- __len 调用异步函数
                    return async_get_len(table)
                end
            })
            
            -- insert 应该等待异步 __len 完成
            table.insert(t, 99)
            
            -- 99 应该被插入到位置 6（5 + 1）
            assert(t[6] == 99, "Expected t[6] == 99, got " .. tostring(t[6]))
        "#).exec_async().await.unwrap();
    }));
}

// Serialization tests (moved from main.rs test module)

#[test]
fn test_array_ser() {
    let lua = Lua::new();
    
    // 创建一个 Lua 函数
    let func: LuaValue = lua.load(r#"
        local value = {
            [2] = "a",
            [90] = "b",
            c = "d"
        }
        return value
    "#).eval().unwrap();
    
    println!("Lua value type: {:?}", func.type_name());
    
    // 尝试将函数序列化为 JSON
    let result = lua_value_to_json(&lua, &func);
    
    match result {
        Ok(json) => {
            println!("Array serialized to JSON: {}", json);
        }
        Err(e) => {
            println!("Array serialization error: {}", e);
        }
    }
} 

#[test]
fn test_function_ser() {
    let lua = Lua::new();
    
    // 创建一个 Lua 函数
    let func: LuaValue = lua.load(r#"
        return function(x, y)
            return x + y
        end
    "#).eval().unwrap();
    
    println!("Lua value type: {:?}", func.type_name());
    
    // 尝试将函数序列化为 JSON
    let result = lua_value_to_json(&lua, &func);
    
    match result {
        Ok(json) => {
            println!("Function serialized to JSON: {}", json);
        }
        Err(e) => {
            println!("Function serialization error: {}", e);
        }
    }
    
    // 测试其他类型的序列化
    let table: LuaValue = lua.load(r#"
        return {
            name = "test",
            value = 42,
            nested = { a = 1, b = 2 }
        }
    "#).eval().unwrap();
    
    let table_json = lua_value_to_json(&lua, &table).unwrap();
    println!("Table serialized to JSON: {}", table_json);
    
    // 测试包含函数的表
    let mixed: LuaValue = lua.load(r#"
        return {
            name = "test",
            func = function() return 1 end,
            value = 42
        }
    "#).eval().unwrap();
    
    let mixed_result = lua_value_to_json(&lua, &mixed);
    match mixed_result {
        Ok(json) => {
            println!("Mixed table serialized to JSON: {}", json);
        }
        Err(e) => {
            println!("Mixed table serialization error: {}", e);
        }
    }
}
