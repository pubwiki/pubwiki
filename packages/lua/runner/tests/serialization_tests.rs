use lua_runner::lua_value_to_json;
use mlua::prelude::*;

#[test]
fn test_array_ser() {
    let lua = Lua::new();
    
    // 创建一个 Lua 值
    let func: LuaValue = lua.load(r#"
        local value = {
            [2] = "a",
            [90] = "b",
            c = "d"
        }
        return value
    "#).eval().unwrap();
    
    println!("Lua value type: {:?}", func.type_name());
    
    // 尝试将值序列化为 JSON
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
