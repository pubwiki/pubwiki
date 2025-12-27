use mlua::prelude::*;

/// 安装 json 模块，提供 json.encode 和 json.decode 函数
pub fn install_json_api(lua: &Lua) -> LuaResult<()> {
    let json_table = lua.create_table()?;
    
    // json.encode(value) - 将 Lua 值转换为 JSON 字符串
    let json_encode = lua.create_function(|lua, value: LuaValue| {
        lua_to_json(lua, &value)
    })?;
    json_table.set("encode", json_encode)?;
    
    // json.decode(str) - 将 JSON 字符串转换为 Lua 值
    let json_decode = lua.create_function(|lua, json_str: String| {
        json_to_lua(lua, &json_str)
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

/// 将 Lua 值转换为 JSON 字符串
fn lua_to_json(_lua: &Lua, value: &LuaValue) -> LuaResult<String> {
    let json_value = lua_value_to_serde(value)?;
    serde_json::to_string(&json_value)
        .map_err(|e| LuaError::external(format!("JSON encode error: {}", e)))
}

/// 将 Lua 值转换为 serde_json::Value
fn lua_value_to_serde(value: &LuaValue) -> LuaResult<serde_json::Value> {
    match value {
        LuaValue::Nil => Ok(serde_json::Value::Null),
        LuaValue::Boolean(b) => Ok(serde_json::Value::Bool(*b)),
        LuaValue::Integer(i) => Ok(serde_json::Value::Number((*i).into())),
        LuaValue::Number(n) => {
            // 处理特殊浮点数值
            if n.is_nan() || n.is_infinite() {
                Ok(serde_json::Value::Null)
            } else {
                serde_json::Number::from_f64(*n)
                    .map(serde_json::Value::Number)
                    .ok_or_else(|| LuaError::external("Cannot convert number to JSON"))
            }
        }
        LuaValue::String(s) => {
            let str_val = s.to_str()
                .map_err(|e| LuaError::external(format!("Invalid UTF-8 string: {}", e)))?;
            Ok(serde_json::Value::String(str_val.to_string()))
        }
        LuaValue::Table(t) => {
            // 检查是否是数组（连续整数键从 1 开始）
            if is_array(t)? {
                let mut arr = Vec::new();
                let len = t.raw_len();
                for i in 1..=len {
                    let v: LuaValue = t.raw_get(i)?;
                    arr.push(lua_value_to_serde(&v)?);
                }
                Ok(serde_json::Value::Array(arr))
            } else {
                // 作为对象处理
                let mut map = serde_json::Map::new();
                for pair in t.clone().pairs::<LuaValue, LuaValue>() {
                    let (k, v) = pair?;
                    let key = match k {
                        LuaValue::String(s) => s.to_str()
                            .map_err(|e| LuaError::external(format!("Invalid UTF-8 key: {}", e)))?
                            .to_string(),
                        LuaValue::Integer(i) => i.to_string(),
                        LuaValue::Number(n) => n.to_string(),
                        _ => continue, // 跳过不能作为 JSON 键的类型
                    };
                    map.insert(key, lua_value_to_serde(&v)?);
                }
                Ok(serde_json::Value::Object(map))
            }
        }
        LuaValue::UserData(ud) => {
            // 检查是否是 JsonNull
            if ud.is::<JsonNull>() {
                Ok(serde_json::Value::Null)
            } else {
                Err(LuaError::external("Cannot encode userdata to JSON"))
            }
        }
        LuaValue::LightUserData(_) => Err(LuaError::external("Cannot encode lightuserdata to JSON")),
        LuaValue::Function(_) => Err(LuaError::external("Cannot encode function to JSON")),
        LuaValue::Thread(_) => Err(LuaError::external("Cannot encode thread to JSON")),
        LuaValue::Error(e) => Err(LuaError::external(format!("Cannot encode error to JSON: {}", e))),
        _ => Err(LuaError::external("Cannot encode unknown type to JSON")),
    }
}

/// 检查 Lua table 是否是数组（连续整数键从 1 开始）
fn is_array(table: &LuaTable) -> LuaResult<bool> {
    let len = table.raw_len();
    if len == 0 {
        // 空表：检查是否有任何键
        let mut has_keys = false;
        for pair in table.clone().pairs::<LuaValue, LuaValue>() {
            let _ = pair?;
            has_keys = true;
            break;
        }
        // 如果没有键，当作空数组处理
        return Ok(!has_keys);
    }
    
    // 检查所有键是否都是 1 到 len 的整数
    let mut count = 0;
    for pair in table.clone().pairs::<LuaValue, LuaValue>() {
        let (k, _) = pair?;
        count += 1;
        match k {
            LuaValue::Integer(i) if i >= 1 && i <= len as i64 => continue,
            _ => return Ok(false),
        }
    }
    
    // 键的数量应该等于 len
    Ok(count == len)
}

/// 将 JSON 字符串转换为 Lua 值
fn json_to_lua(lua: &Lua, json_str: &str) -> LuaResult<LuaValue> {
    let json_value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| LuaError::external(format!("JSON decode error: {}", e)))?;
    
    serde_to_lua_value(lua, &json_value)
}

/// 将 serde_json::Value 转换为 Lua 值
fn serde_to_lua_value(lua: &Lua, value: &serde_json::Value) -> LuaResult<LuaValue> {
    match value {
        serde_json::Value::Null => Ok(LuaValue::Nil),
        serde_json::Value::Bool(b) => Ok(LuaValue::Boolean(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(LuaValue::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(LuaValue::Number(f))
            } else {
                Err(LuaError::external("Cannot convert JSON number to Lua"))
            }
        }
        serde_json::Value::String(s) => {
            let lua_str = lua.create_string(s)?;
            Ok(LuaValue::String(lua_str))
        }
        serde_json::Value::Array(arr) => {
            let table = lua.create_table()?;
            for (i, v) in arr.iter().enumerate() {
                let lua_value = serde_to_lua_value(lua, v)?;
                table.raw_set(i + 1, lua_value)?; // Lua 数组从 1 开始
            }
            Ok(LuaValue::Table(table))
        }
        serde_json::Value::Object(map) => {
            let table = lua.create_table()?;
            for (k, v) in map.iter() {
                let lua_value = serde_to_lua_value(lua, v)?;
                table.raw_set(k.as_str(), lua_value)?;
            }
            Ok(LuaValue::Table(table))
        }
    }
}
