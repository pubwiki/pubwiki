/// JsProxy - 将 JS 对象代理为 Lua UserData
///
/// 核心功能：
/// - 懒加载：仅在访问字段时才从 JS 获取数据
/// - 统一调用：同步/异步函数调用语法一致（通过 CallbackManager 异步处理 Promise）
/// - 类型转换：自动在 Lua 和 JS 类型之间转换
///
/// 这个版本使用自定义的 emval_ffi 模块直接与 JS 交互
/// 异步函数调用通过 CallbackManager 处理，替代 ASYNCIFY

use super::callback::{register_callback, PromiseResult};
use super::emval_ffi::{JsVal, EM_VAL};
use mlua::prelude::*;

// ==================== FFI 声明 ====================

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// 调用 JS 函数（支持 Promise，通过 callback 返回结果）
    /// - func_handle: 要调用的函数的 EM_VAL handle
    /// - args_handles: 参数 handles 数组指针
    /// - args_count: 参数数量
    /// - callback_id: 回调 ID，用于返回结果
    fn js_jsproxy_call(
        func_handle: EM_VAL,
        args_handles: *const EM_VAL,
        args_count: u32,
        callback_id: u32,
    );
}

// ==================== JsProxy 结构体 ====================

/// 代理 JS 对象的 UserData
pub struct JsProxy {
    /// 底层的 JS 值引用
    val: JsVal,
    /// 实例 ID（用于回调路由）
    instance_id: u32,
}

#[allow(dead_code)]
impl JsProxy {
    /// 从 JsVal 创建代理
    pub fn new(val: JsVal, instance_id: u32) -> Self {
        JsProxy { val, instance_id }
    }

    /// 从 EM_VAL handle 创建代理（获取所有权）
    pub fn from_handle(handle: EM_VAL, instance_id: u32) -> Self {
        let val = JsVal::from_handle(handle);
        JsProxy { val, instance_id }
    }

    /// 获取内部 JsVal 的引用
    pub fn val(&self) -> &JsVal {
        &self.val
    }

    /// 获取实例 ID
    pub fn instance_id(&self) -> u32 {
        self.instance_id
    }
}

impl Clone for JsProxy {
    fn clone(&self) -> Self {
        JsProxy {
            val: self.val.clone(),
            instance_id: self.instance_id,
        }
    }
}

// ==================== 类型转换 ====================

/// 检查 table 是否是数组类型（连续整数键从 1 开始）
fn is_array_like(table: &LuaTable) -> LuaResult<bool> {
    let len = table.raw_len();
    if len == 0 {
        // 空表检查是否有非整数键
        for pair in table.pairs::<LuaValue, LuaValue>() {
            let (k, _) = pair?;
            if !matches!(k, LuaValue::Integer(_)) {
                return Ok(false);
            }
        }
        return Ok(true);
    }

    // 检查是否所有键都是 1..=len 的整数
    let mut count = 0;
    for pair in table.pairs::<LuaValue, LuaValue>() {
        let (k, _) = pair?;
        match k {
            LuaValue::Integer(i) if i >= 1 && i <= len as i64 => count += 1,
            _ => return Ok(false),
        }
    }
    Ok(count == len)
}

/// Lua 值转 JS JsVal
pub fn lua_to_val(lua: &Lua, value: LuaValue, instance_id: u32) -> LuaResult<JsVal> {
    match value {
        LuaValue::Nil => Ok(JsVal::null()),
        LuaValue::Boolean(b) => Ok(JsVal::from_bool(b)),
        LuaValue::Integer(n) => Ok(JsVal::from_i32(n as i32)),
        LuaValue::Number(n) => Ok(JsVal::from_f64(n)),
        LuaValue::String(s) => {
            let s: &str = &s.to_str()?;
            Ok(JsVal::from_str(s))
        }
        LuaValue::Table(t) => {
            if is_array_like(&t)? {
                // 创建 JS 数组
                let arr = JsVal::array();
                for pair in t.pairs::<i64, LuaValue>() {
                    let (_, v) = pair?;
                    let js_val = lua_to_val(lua, v, instance_id)?;
                    arr.push(&js_val);
                }
                Ok(arr)
            } else {
                // 创建 JS 对象
                let obj = JsVal::object();
                for pair in t.pairs::<LuaValue, LuaValue>() {
                    let (k, v) = pair?;
                    let key_str = match k {
                        LuaValue::String(s) => s.to_str()?.to_string(),
                        LuaValue::Integer(n) => n.to_string(),
                        LuaValue::Number(n) => n.to_string(),
                        _ => continue, // 跳过不支持的键类型
                    };
                    let js_val = lua_to_val(lua, v, instance_id)?;
                    obj.set(&key_str, &js_val);
                }
                Ok(obj)
            }
        }
        LuaValue::UserData(ud) => {
            // 如果是 JsProxy，直接返回其内部 JsVal 的克隆
            if let Ok(proxy) = ud.borrow::<JsProxy>() {
                Ok(proxy.val.clone())
            } else {
                Err(LuaError::external("Cannot convert UserData to JS value"))
            }
        }
        LuaValue::Function(_) => {
            // TODO: 实现 Lua 函数到 JS 的转换
            Err(LuaError::external("Function conversion not yet supported"))
        }
        _ => Err(LuaError::external(format!(
            "Unsupported Lua type: {:?}",
            value.type_name()
        ))),
    }
}

/// JS JsVal 转 Lua 值
pub fn val_to_lua(lua: &Lua, val: JsVal, instance_id: u32) -> LuaResult<LuaValue> {
    if val.is_undefined() || val.is_null() {
        Ok(LuaValue::Nil)
    } else if val.is_true() {
        Ok(LuaValue::Boolean(true))
    } else if val.is_false() {
        Ok(LuaValue::Boolean(false))
    } else if val.is_number() {
        let n: f64 = val.as_f64();
        // 检查是否可以表示为整数
        if n.fract() == 0.0 && n >= i64::MIN as f64 && n <= i64::MAX as f64 {
            Ok(LuaValue::Integer(n as i64))
        } else {
            Ok(LuaValue::Number(n))
        }
    } else if val.is_string() {
        let s = val.as_string();
        Ok(LuaValue::String(lua.create_string(&s)?))
    } else {
        // 对象、函数等都包装为 JsProxy，支持懒加载和调用
        let proxy = JsProxy::new(val, instance_id);
        let ud = lua.create_userdata(proxy)?;
        Ok(LuaValue::UserData(ud))
    }
}

// ==================== UserData 实现 ====================

impl LuaUserData for JsProxy {
    fn add_methods<M: LuaUserDataMethods<Self>>(methods: &mut M) {
        // __index: 属性访问 proxy.field 或 proxy[key]
        // 对于 JS 数组的整数索引，自动将 Lua 1-based 转换为 JS 0-based
        methods.add_meta_method(LuaMetaMethod::Index, |lua, this, key: LuaValue| {
            match &key {
                LuaValue::String(s) => {
                    let key_str = s.to_str()?;
                    val_to_lua(lua, this.val.get(&key_str), this.instance_id)
                }
                LuaValue::Integer(n) => {
                    let idx = if this.val.is_array() && *n >= 1 {
                        (*n - 1) as u32  // Lua 1-based -> JS 0-based
                    } else {
                        *n as u32
                    };
                    val_to_lua(lua, this.val.get_index(idx), this.instance_id)
                }
                LuaValue::Number(n) => {
                    let n_int = *n as i64;
                    let idx = if this.val.is_array() && n_int >= 1 {
                        (n_int - 1) as u32  // Lua 1-based -> JS 0-based
                    } else {
                        n_int as u32
                    };
                    val_to_lua(lua, this.val.get_index(idx), this.instance_id)
                }
                _ => Err(LuaError::external("Key must be string or number")),
            }
        });

        // __newindex: 属性设置 proxy.field = value
        // 对于 JS 数组的整数索引，自动将 Lua 1-based 转换为 JS 0-based
        methods.add_meta_method_mut(
            LuaMetaMethod::NewIndex,
            |lua, this, (key, value): (LuaValue, LuaValue)| {
                let js_value = lua_to_val(lua, value, this.instance_id)?;
                
                match &key {
                    LuaValue::String(s) => {
                        let key_str = s.to_str()?;
                        this.val.set(&key_str, &js_value);
                    }
                    LuaValue::Integer(n) => {
                        let idx = if this.val.is_array() && *n >= 1 {
                            (*n - 1) as u32  // Lua 1-based -> JS 0-based
                        } else {
                            *n as u32
                        };
                        this.val.set_index(idx, &js_value);
                    }
                    LuaValue::Number(n) => {
                        let n_int = *n as i64;
                        let idx = if this.val.is_array() && n_int >= 1 {
                            (n_int - 1) as u32  // Lua 1-based -> JS 0-based
                        } else {
                            n_int as u32
                        };
                        this.val.set_index(idx, &js_value);
                    }
                    _ => return Err(LuaError::external("Key must be string or number")),
                };
                Ok(())
            },
        );

        // __call: 函数调用 proxy(args...)
        // 使用 CallbackManager 异步处理 JS 函数调用（支持 Promise）
        methods.add_async_meta_method(LuaMetaMethod::Call, |lua, this, args: LuaMultiValue| {
            let instance_id = this.instance_id;
            let func_handle = this.val.handle();
            
            async move {
                // 将 Lua 参数转换为 JsVal
                let mut js_args: Vec<JsVal> = Vec::new();
                for arg in args.iter() {
                    let js_val = lua_to_val(&lua, arg.clone(), instance_id)?;
                    js_args.push(js_val);
                }
                
                // 收集 handles
                let handles: Vec<EM_VAL> = js_args.iter().map(|v| v.handle()).collect();
                
                // 注册回调
                let (callback_id, rx) = register_callback();
                
                // 调用 JS 函数
                unsafe {
                    js_jsproxy_call(
                        func_handle,
                        handles.as_ptr(),
                        handles.len() as u32,
                        callback_id,
                    );
                }
                
                // 等待结果
                let result = rx.recv().await
                    .map_err(|e| LuaError::external(format!("JsProxy call receive error: {}", e)))?;
                
                match result {
                    PromiseResult::Success { handle } => {
                        // handle 为 0 表示 undefined
                        if handle == 0 {
                            Ok(LuaValue::Nil)
                        } else {
                            let result_val = JsVal::from_handle(handle as EM_VAL);
                            val_to_lua(&lua, result_val, instance_id)
                        }
                    }
                    PromiseResult::Error { message } => {
                        Err(LuaError::external(message))
                    }
                }
            }
        });

        // __len: #proxy
        methods.add_meta_method(LuaMetaMethod::Len, |_, this, _: ()| {
            let length = this.val.length();
            Ok(length as i64)
        });

        // __tostring: tostring(proxy)
        methods.add_meta_method(LuaMetaMethod::ToString, |_, this, _: ()| {
            let type_str = this.val.type_of();
            if type_str == "object" {
                // 尝试使用 JSON.stringify
                let json = JsVal::global("JSON");
                let result = json.call_method("stringify", &[&this.val]);
                if result.is_string() {
                    Ok(format!("[JsProxy: {}]", result.as_string()))
                } else {
                    Ok("[JsProxy: object]".to_string())
                }
            } else if type_str == "function" {
                Ok("[JsProxy: function]".to_string())
            } else {
                Ok(format!("[JsProxy: {}]", type_str))
            }
        });

        // __pairs: for k, v in pairs(proxy)
        methods.add_meta_method(LuaMetaMethod::Pairs, |lua, this, _: ()| {
            // 获取所有键
            let keys = this.val.keys();

            // 创建迭代器状态
            let iter_state = lua.create_table()?;
            iter_state.set("keys", lua.create_userdata(JsProxy::new(keys, this.instance_id))?)?;
            iter_state.set("index", 0i64)?;
            iter_state.set("proxy", lua.create_userdata(this.clone())?)?;

            // 创建迭代器函数
            let iter_func = lua.create_function(|lua, state: LuaTable| {
                let index: i64 = state.get("index")?;
                let keys_ud: LuaAnyUserData = state.get("keys")?;
                let keys_proxy = keys_ud.borrow::<JsProxy>()?;
                let len = keys_proxy.val.length() as i64;

                if index >= len {
                    return Ok((LuaValue::Nil, LuaValue::Nil));
                }

                let key = keys_proxy.val.get_index(index as u32);
                let key_str = key.as_string();

                let proxy_ud: LuaAnyUserData = state.get("proxy")?;
                let proxy_ref = proxy_ud.borrow::<JsProxy>()?;
                let value = proxy_ref.val.get(&key_str);

                state.set("index", index + 1)?;

                Ok((
                    LuaValue::String(lua.create_string(&key_str)?),
                    val_to_lua(lua, value, proxy_ref.instance_id)?,
                ))
            })?;

            Ok((iter_func, iter_state, LuaValue::Nil))
        });

        // 辅助方法：获取类型
        methods.add_method("typeof", |_, this, _: ()| {
            Ok(this.val.type_of())
        });

        // 辅助方法：检查是否是数组
        methods.add_method("isArray", |_, this, _: ()| Ok(this.val.is_array()));

        // 辅助方法：转换为 JSON 字符串
        methods.add_method("toJSON", |_, this, _: ()| {
            let json = JsVal::global("JSON");
            let result = json.call_method("stringify", &[&this.val]);
            if result.is_string() {
                Ok(result.as_string())
            } else {
                Err(LuaError::external("Failed to stringify to JSON"))
            }
        });

        // 辅助方法：检查是否为 null
        methods.add_method("isNull", |_, this, _: ()| Ok(this.val.is_null()));

        // 辅助方法：检查是否为 undefined
        methods.add_method("isUndefined", |_, this, _: ()| Ok(this.val.is_undefined()));
    }
}
