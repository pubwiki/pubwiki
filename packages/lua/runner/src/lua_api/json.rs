use mlua::prelude::*;
use crate::serde::{lua_value_to_json, json_to_lua_value};

/// 安装 json 模块，提供 json.encode 和 json.decode 函数
pub fn install_json_api(lua: &Lua) -> LuaResult<()> {
    let json_table = lua.create_table()?;
    
    // json.encode(value) - 将 Lua 值转换为 JSON 字符串
    let json_encode = lua.create_function(|lua, value: LuaValue| {
        lua_value_to_json(lua, &value)
    })?;
    json_table.set("encode", json_encode)?;
    
    // json.decode(str) - 将 JSON 字符串转换为 Lua 值
    let json_decode = lua.create_function(|lua, json_str: String| {
        json_to_lua_value(lua, &json_str)
    })?;
    json_table.set("decode", json_decode)?;
    
    // json.null - 用于表示 JSON null 的特殊值
    // 使用 lightuserdata 创建一个唯一的 null 标记
    let null_value = lua.create_userdata(JsonNull)?;
    json_table.set("null", null_value)?;
    
    // 将 json 模块注册到全局表
    lua.globals().set("json", json_table)?;
    
    Ok(())
}

/// JSON null 的标记类型
#[derive(Clone, Copy)]
struct JsonNull;

impl LuaUserData for JsonNull {
    fn add_methods<M: LuaUserDataMethods<Self>>(methods: &mut M) {
        // 实现 __tostring 以便在打印时显示为 "null"
        methods.add_meta_method(LuaMetaMethod::ToString, |_, _, ()| {
            Ok("null")
        });
        
        // 实现 __eq 以便与自身比较
        methods.add_meta_method(LuaMetaMethod::Eq, |_, _, other: LuaValue| {
            match other {
                LuaValue::UserData(ud) => Ok(ud.is::<JsonNull>()),
                _ => Ok(false),
            }
        });
    }
}

