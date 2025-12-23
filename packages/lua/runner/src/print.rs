use mlua::prelude::*;
use mlua::Variadic;
use std::cell::RefCell;
use std::rc::Rc;

pub fn install_print_collector(lua: &Lua, buffer: &Rc<RefCell<String>>) -> LuaResult<()> {
    let buffer = Rc::clone(buffer);
    lua.globals().set(
        "print",
        lua.create_function(move |_lua, values: Variadic<LuaValue>| {
            let mut output = String::new();
            let mut first = true;

            for value in values.iter() {
                if first {
                    first = false;
                } else {
                    output.push('\t');
                }

                let value_str = match value {
                    LuaValue::String(s) => s.to_str()?.to_string(),
                    LuaValue::Number(n) => n.to_string(),
                    LuaValue::Integer(i) => i.to_string(),
                    LuaValue::Boolean(b) => b.to_string(),
                    LuaValue::Nil => "nil".to_string(),
                    LuaValue::Table(_) => "table".to_string(),
                    LuaValue::Function(_) => "function".to_string(),
                    LuaValue::Thread(_) => "thread".to_string(),
                    LuaValue::UserData(_) => "userdata".to_string(),
                    LuaValue::LightUserData(_) => "userdata".to_string(),
                    LuaValue::Error(e) => format!("error: {}", e),
                    _ => "unknown".to_string(),
                };
                output.push_str(&value_str);
            }

            let line = output + "\n";
            buffer.borrow_mut().push_str(&line);

            Ok(())
        })?,
    )?;
    Ok(())
}

pub fn install_io_write_collector(lua: &Lua, buffer: &Rc<RefCell<String>>) -> LuaResult<()> {
    let buffer = Rc::clone(buffer);

    // 获取或创建 io 表
    let io: LuaTable = match lua.globals().get("io")? {
        LuaValue::Table(t) => t,
        _ => {
            let t = lua.create_table()?;
            lua.globals().set("io", t.clone())?;
            t
        }
    };

    // 替换 io.write 函数
    io.set(
        "write",
        lua.create_function(move |_lua, values: Variadic<LuaValue>| {
            let mut output = String::new();

            for value in values.iter() {
                let value_str = match value {
                    LuaValue::String(s) => s.to_str()?.to_string(),
                    LuaValue::Number(n) => n.to_string(),
                    LuaValue::Integer(i) => i.to_string(),
                    LuaValue::Boolean(b) => b.to_string(),
                    LuaValue::Nil => "nil".to_string(),
                    _ => return Err(LuaError::external("io.write expects string or number")),
                };
                output.push_str(&value_str);
            }

            buffer.borrow_mut().push_str(&output);

            Ok(())
        })?,
    )?;

    Ok(())
}
