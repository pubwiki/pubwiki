use std::cell::RefCell;
use std::collections::HashSet;
use std::os::raw::c_void;

use mlua::prelude::*;
use serde::ser::{self, Serialize, SerializeMap, SerializeSeq, Serializer};

use crate::bridge::{JsProxy, JsVal};

// ==================== SerializableLuaValue ====================

/// A wrapper around `LuaValue` that implements `serde::Serialize`.
/// 
/// This is similar to mlua's `SerializableValue`, but with added support for:
/// - `JsProxy` userdata (serialized via JS's JSON.stringify)
/// - Tables containing embedded JsProxy values
/// 
/// Empty tables are serialized as objects `{}` (not arrays `[]`).
pub struct SerializableLuaValue<'a> {
    value: &'a LuaValue,
    /// Track visited tables to detect cycles
    visited: RefCell<HashSet<*const c_void>>,
}

impl<'a> SerializableLuaValue<'a> {
    /// Create a new serializable wrapper around a Lua value.
    pub fn new(value: &'a LuaValue) -> Self {
        Self {
            value,
            visited: RefCell::new(HashSet::new()),
        }
    }
}

impl Serialize for SerializableLuaValue<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self.value {
            LuaValue::Nil => serializer.serialize_unit(),
            LuaValue::Boolean(b) => serializer.serialize_bool(*b),
            LuaValue::Integer(n) => serializer.serialize_i64(*n),
            LuaValue::Number(n) => {
                // Handle NaN and Infinity as null
                if n.is_nan() || n.is_infinite() {
                    serializer.serialize_unit()
                } else {
                    serializer.serialize_f64(*n)
                }
            }
            LuaValue::String(s) => {
                match s.to_str() {
                    Ok(borrowed) => serializer.serialize_str(&borrowed),
                    Err(_) => {
                        // Non-UTF8 string: serialize as bytes
                        let bytes = s.as_bytes();
                        serializer.serialize_bytes(&bytes)
                    }
                }
            }
            LuaValue::Table(table) => {
                serialize_table(table, serializer, &self.visited)
            }
            LuaValue::UserData(ud) => {
                // Check if it's a JsProxy
                if let Ok(proxy) = ud.borrow::<JsProxy>() {
                    serialize_js_proxy(&proxy, serializer)
                } else {
                    Err(ser::Error::custom("Unsupported UserData type for serialization"))
                }
            }
            LuaValue::Function(_) => {
                Err(ser::Error::custom("Cannot serialize Lua function"))
            }
            LuaValue::Thread(_) => {
                Err(ser::Error::custom("Cannot serialize Lua thread"))
            }
            LuaValue::LightUserData(_) => {
                Err(ser::Error::custom("Cannot serialize LightUserData"))
            }
            LuaValue::Error(e) => {
                Err(ser::Error::custom(format!("Cannot serialize Lua error: {}", e)))
            }
            _ => {
                Err(ser::Error::custom(format!(
                    "Unsupported Lua type for serialization: {}",
                    self.value.type_name()
                )))
            }
        }
    }
}

/// Serialize a JsProxy by calling JS's JSON.stringify and parsing the result
fn serialize_js_proxy<S>(proxy: &JsProxy, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let json_obj = JsVal::global("JSON");
    let result = json_obj.call_method("stringify", &[proxy.val()]);
    
    if !result.is_string() {
        return Err(ser::Error::custom("Failed to stringify JsProxy to JSON"));
    }
    
    let json_str = result.as_string();
    
    // Parse the JSON string and re-serialize it
    // This is necessary because we need to serialize using the provided serializer
    let json_value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| ser::Error::custom(format!("Invalid JSON from JsProxy: {}", e)))?;
    
    json_value.serialize(serializer)
}

/// Check if a table is array-like (consecutive integer keys from 1)
fn is_array_table(table: &LuaTable) -> bool {
    let len = table.raw_len();
    
    // Empty table is treated as object, not array
    if len == 0 {
        return false;
    }
    
    // Check if all keys are integers from 1 to len
    let mut count = 0;
    if let Ok(pairs) = table.pairs::<LuaValue, LuaValue>().collect::<Result<Vec<_>, _>>() {
        for (k, _) in pairs {
            if let LuaValue::Integer(i) = k {
                if i >= 1 && i <= len as i64 {
                    count += 1;
                    continue;
                }
            }
            return false;
        }
    }
    
    count == len
}

/// Serialize a Lua table, detecting arrays vs objects
fn serialize_table<S>(
    table: &LuaTable,
    serializer: S,
    visited: &RefCell<HashSet<*const c_void>>,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    // Cycle detection
    let ptr = table.to_pointer();
    if visited.borrow().contains(&ptr) {
        return Err(ser::Error::custom("Recursive table detected"));
    }
    visited.borrow_mut().insert(ptr);
    
    let result = if is_array_table(table) {
        serialize_array(table, serializer, visited)
    } else {
        serialize_object(table, serializer, visited)
    };
    
    visited.borrow_mut().remove(&ptr);
    result
}

/// Serialize a Lua table as a JSON array
fn serialize_array<S>(
    table: &LuaTable,
    serializer: S,
    visited: &RefCell<HashSet<*const c_void>>,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let len = table.raw_len();
    let mut seq = serializer.serialize_seq(Some(len))?;
    
    for i in 1..=len {
        let value: LuaValue = table.get(i).map_err(ser::Error::custom)?;
        // Create a new wrapper that shares the visited set
        let wrapper = SerializableLuaValueRef {
            value: &value,
            visited,
        };
        seq.serialize_element(&wrapper)?;
    }
    
    seq.end()
}

/// Serialize a Lua table as a JSON object
fn serialize_object<S>(
    table: &LuaTable,
    serializer: S,
    visited: &RefCell<HashSet<*const c_void>>,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let pairs: Vec<(LuaValue, LuaValue)> = table
        .pairs()
        .collect::<Result<Vec<_>, _>>()
        .map_err(ser::Error::custom)?;
    
    let mut map = serializer.serialize_map(Some(pairs.len()))?;
    
    for (k, v) in pairs {
        // Convert key to string
        let key_str = match &k {
            LuaValue::String(s) => {
                s.to_str().map_err(ser::Error::custom)?.to_string()
            }
            LuaValue::Integer(n) => n.to_string(),
            LuaValue::Number(n) => n.to_string(),
            _ => continue, // Skip unsupported key types
        };
        
        let wrapper = SerializableLuaValueRef {
            value: &v,
            visited,
        };
        map.serialize_entry(&key_str, &wrapper)?;
    }
    
    map.end()
}

/// Internal helper: a reference wrapper for recursive serialization
/// This borrows the visited set instead of owning it
struct SerializableLuaValueRef<'a, 'b> {
    value: &'a LuaValue,
    visited: &'b RefCell<HashSet<*const c_void>>,
}

impl Serialize for SerializableLuaValueRef<'_, '_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self.value {
            LuaValue::Nil => serializer.serialize_unit(),
            LuaValue::Boolean(b) => serializer.serialize_bool(*b),
            LuaValue::Integer(n) => serializer.serialize_i64(*n),
            LuaValue::Number(n) => {
                if n.is_nan() || n.is_infinite() {
                    serializer.serialize_unit()
                } else {
                    serializer.serialize_f64(*n)
                }
            }
            LuaValue::String(s) => {
                match s.to_str() {
                    Ok(borrowed) => serializer.serialize_str(&borrowed),
                    Err(_) => {
                        let bytes = s.as_bytes();
                        serializer.serialize_bytes(&bytes)
                    }
                }
            }
            LuaValue::Table(table) => {
                serialize_table(table, serializer, self.visited)
            }
            LuaValue::UserData(ud) => {
                if let Ok(proxy) = ud.borrow::<JsProxy>() {
                    serialize_js_proxy(&proxy, serializer)
                } else {
                    Err(ser::Error::custom("Unsupported UserData type"))
                }
            }
            _ => Err(ser::Error::custom(format!(
                "Unsupported Lua type: {}",
                self.value.type_name()
            ))),
        }
    }
}

// ==================== Public API ====================

/// 将 Lua 值转换为 JSON 字符串
/// 支持：
/// 1. 普通 Lua 值（number, string, boolean, table）
/// 2. JsProxy userdata（调用 JS 的 JSON.stringify）
/// 3. 表内嵌入的 JsProxy（递归处理）
pub fn lua_value_to_json(_lua: &Lua, value: &LuaValue) -> LuaResult<String> {
    let serializable = SerializableLuaValue::new(value);
    serde_json::to_string(&serializable)
        .map_err(|e| LuaError::external(format!("JSON stringify error: {}", e)))
}

/// 将 JSON 字符串转换为 Lua 值
pub fn json_to_lua_value(lua: &Lua, json: &str) -> LuaResult<LuaValue> {
    let json_value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| LuaError::external(format!("JSON parse error: {}", e)))?;
    
    lua.to_value(&json_value)
}

// ==================== RDF Datatype 支持 ====================

/// XSD datatype 常量
pub const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
pub const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";
pub const XSD_DOUBLE: &str = "http://www.w3.org/2001/XMLSchema#double";
pub const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";
pub const PUBWIKI_LUAVALUE: &str = "https://pub.wiki/datatype#luavalue";

/// 将 LuaValue 转换为 (字符串值, datatype URI)
/// 用于 RDF 存储时序列化 Lua 值
pub fn lua_value_to_rdf(lua: &Lua, value: LuaValue) -> LuaResult<(String, String)> {
    match value {
        LuaValue::String(s) => {
            Ok((s.to_str()?.to_string(), XSD_STRING.to_string()))
        }
        LuaValue::Integer(n) => {
            Ok((n.to_string(), XSD_INTEGER.to_string()))
        }
        LuaValue::Number(n) => {
            // 检查是否为整数
            if n.fract() == 0.0 && n >= i64::MIN as f64 && n <= i64::MAX as f64 {
                Ok((format!("{}", n as i64), XSD_INTEGER.to_string()))
            } else {
                Ok((n.to_string(), XSD_DOUBLE.to_string()))
            }
        }
        LuaValue::Boolean(b) => {
            Ok((if b { "true" } else { "false" }.to_string(), XSD_BOOLEAN.to_string()))
        }
        LuaValue::Table(_) => {
            let json_str = lua_value_to_json(lua, &value)?;
            Ok((json_str, PUBWIKI_LUAVALUE.to_string()))
        }
        LuaValue::UserData(ud) => {
            // JsProxy: 使用 JSON.stringify
            if let Ok(proxy) = ud.borrow::<JsProxy>() {
                let json_obj = JsVal::global("JSON");
                let result = json_obj.call_method("stringify", &[proxy.val()]);
                if result.is_string() {
                    return Ok((result.as_string(), PUBWIKI_LUAVALUE.to_string()));
                }
            }
            Err(LuaError::external("Unsupported UserData type for RDF insert"))
        }
        LuaValue::Nil => {
            Err(LuaError::external("Cannot insert nil value into RDF store"))
        }
        _ => {
            Err(LuaError::external(format!(
                "Unsupported value type for RDF insert: {:?}",
                value.type_name()
            )))
        }
    }
}

/// 根据 datatype 将 RDF 值转换回 LuaValue
pub fn rdf_to_lua_value(lua: &Lua, value: &str, datatype: &str) -> LuaResult<LuaValue> {
    match datatype {
        XSD_STRING => {
            Ok(LuaValue::String(lua.create_string(value)?))
        }
        XSD_INTEGER => {
            let n: i64 = value.parse()
                .map_err(|e| LuaError::external(format!("Invalid integer '{}': {}", value, e)))?;
            Ok(LuaValue::Integer(n))
        }
        XSD_DOUBLE => {
            let n: f64 = value.parse()
                .map_err(|e| LuaError::external(format!("Invalid double '{}': {}", value, e)))?;
            Ok(LuaValue::Number(n))
        }
        XSD_BOOLEAN => {
            Ok(LuaValue::Boolean(value == "true"))
        }
        PUBWIKI_LUAVALUE => {
            json_to_lua_value(lua, value)
        }
        _ => {
            // 未知 datatype，作为字符串返回
            Ok(LuaValue::String(lua.create_string(value)?))
        }
    }
}
