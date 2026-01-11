use mlua::prelude::*;
use std::ffi::CString;
use std::os::raw::c_char;

use crate::bridge::callback::{register_callback, PromiseResult};
use crate::bridge::emval_ffi::{JsVal, EM_VAL};
use crate::bridge::js_proxy::JsProxy;

// 从 require 模块导入 WorkingDirectory
pub use super::require::WorkingDirectory;


#[link(wasm_import_module = "env")]
unsafe extern "C" {
    // 异步接口：返回 Promise ID，callback_id 用于注册回调
    // context_id: VFS 上下文 ID，用于隔离不同的并发执行
    fn js_fs_read_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_write_async(context_id: u32, path_ptr: *const c_char, content_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_unlink_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_exists_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_mkdir_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_rmdir_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_stat_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
    fn js_fs_readdir_async(context_id: u32, path_ptr: *const c_char, callback_id: u32) -> u32;
}

/// 解析路径：使用基于栈的算法规范化路径
/// 
/// 这个函数是公共的，可以被其他模块使用（如 require.rs）
pub fn resolve_path(lua: &Lua, path: &str) -> String {
    // 构建完整路径
    let full_path = if path.starts_with('/') {
        // 绝对路径，直接使用
        path.to_string()
    } else {
        // 相对路径，需要拼接工作目录
        let working_dir = lua.app_data_ref::<WorkingDirectory>()
            .map(|wd| wd.0.clone())
            .unwrap_or_else(|| "/".to_string());
        
        if working_dir.ends_with('/') {
            format!("{}{}", working_dir, path)
        } else {
            format!("{}/{}", working_dir, path)
        }
    };
    
    // 使用栈来规范化路径
    let mut stack: Vec<&str> = Vec::new();
    
    for segment in full_path.split('/') {
        match segment {
            "" | "." => {
                // 空段（连续斜杠）和当前目录，跳过
                continue;
            }
            ".." => {
                // 父目录，弹出栈顶（但不能超出根目录）
                if !stack.is_empty() {
                    stack.pop();
                }
                // 如果栈已空（已在根目录），忽略此 ..
            }
            _ => {
                // 普通目录或文件名，压入栈
                stack.push(segment);
            }
        }
    }
    
    // 重建路径
    if stack.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", stack.join("/"))
    }
}

/// 安装文件系统 API 到 Lua 全局环境
/// context_id: VFS 上下文 ID，用于隔离不同的并发执行
pub fn install_fs_api(lua: &Lua, context_id: u32) -> LuaResult<()> {
    let fs_table = lua.create_table()?;
    
    // 异步读取文件
    let read_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        // 发起异步请求
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe { 
            js_fs_read_async(context_id, path_c.as_ptr(), callback_id) 
        };
        
        if promise_id == 0 {
            return Ok((None, Some("Failed to start async operation".to_string())));
        }
        
        // 等待 Promise 完成（通过回调通知）
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 为 0 表示 undefined
                if handle == 0 {
                    return Ok((None, Some("File content is undefined".to_string())));
                }
                let content_val = JsVal::from_handle(handle as EM_VAL);
                let content = content_val.as_string();
                Ok((Some(content), None))
            }
            Ok(PromiseResult::Error { message }) => {
                Ok((None, Some(message)))
            }
            Err(e) => {
                Ok((None, Some(format!("Channel error: {}", e))))
            }
        }
    })?;
    
    fs_table.set("read", read_fn)?;
    
    // 异步写入文件
    let write_fn = lua.create_async_function(
        move |lua, (path, content): (String, String)| async move {
            // 解析路径（处理相对路径）
            let resolved_path = resolve_path(&lua, &path);
            
            // 注册回调通道并获取 callback id
            let (callback_id, rx) = register_callback();
            
            let path_c = CString::new(resolved_path)
                .map_err(|e| LuaError::external(e))?;
            let content_c = CString::new(content)
                .map_err(|e| LuaError::external(e))?;
            
            let promise_id = unsafe {
                js_fs_write_async(context_id, path_c.as_ptr(), content_c.as_ptr(), callback_id)
            };
            
            if promise_id == 0 {
                return Ok((false, Some("Failed to start async operation".to_string())));
            }
            
            match rx.recv().await {
                Ok(PromiseResult::Success { .. }) => Ok((true, None)),
                Ok(PromiseResult::Error { message }) => Ok((false, Some(message))),
                Err(e) => Ok((false, Some(format!("Channel error: {}", e)))),
            }
        }
    )?;
    
    fs_table.set("write", write_fn)?;
    
    // 异步删除文件
    let unlink_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_unlink_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Ok((false, Some("Failed to start async operation".to_string())));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok((true, None)),
            Ok(PromiseResult::Error { message }) => Ok((false, Some(message))),
            Err(e) => Ok((false, Some(format!("Channel error: {}", e)))),
        }
    })?;
    
    fs_table.set("unlink", unlink_fn)?;
    
    // 异步检查文件是否存在
    let exists_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_exists_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Ok(false);
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => {
                // 收到 Success 表示文件存在
                Ok(true)
            }
            Ok(PromiseResult::Error { .. }) => Ok(false),
            Err(_) => Ok(false),
        }
    })?;
    fs_table.set("exists", exists_fn)?;
    
    // 异步创建目录
    let mkdir_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_mkdir_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Ok((false, Some("Failed to start async operation".to_string())));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok((true, None)),
            Ok(PromiseResult::Error { message }) => Ok((false, Some(message))),
            Err(e) => Ok((false, Some(format!("Channel error: {}", e)))),
        }
    })?;
    
    fs_table.set("mkdir", mkdir_fn)?;
    
    // 异步删除目录
    let rmdir_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_rmdir_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Ok((false, Some("Failed to start async operation".to_string())));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { .. }) => Ok((true, None)),
            Ok(PromiseResult::Error { message }) => Ok((false, Some(message))),
            Err(e) => Ok((false, Some(format!("Channel error: {}", e)))),
        }
    })?;
    
    fs_table.set("rmdir", rmdir_fn)?;
    
    // 异步获取文件/目录状态信息
    let stat_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_stat_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async operation"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 为 0 表示 undefined
                if handle == 0 {
                    return Ok((None, Some("Stat result is undefined".to_string())));
                }
                // 直接返回 JsProxy，让 Lua 代码访问属性
                let proxy = JsProxy::from_handle(handle as EM_VAL, context_id);
                Ok((Some(lua.create_userdata(proxy)?), None::<String>))
            }
            Ok(PromiseResult::Error { message }) => Ok((None, Some(message))),
            Err(e) => Ok((None, Some(format!("Channel error: {}", e)))),
        }
    })?;
    
    fs_table.set("stat", stat_fn)?;
    
    // 异步读取目录内容（返回带有 stat 信息的列表）
    let readdir_fn = lua.create_async_function(move |lua, path: String| async move {
        // 解析路径（处理相对路径）
        let resolved_path = resolve_path(&lua, &path);
        
        // 注册回调通道并获取 callback id
        let (callback_id, rx) = register_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_readdir_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async operation"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { handle }) => {
                // handle 为 0 表示 undefined
                if handle == 0 {
                    return Ok((None, Some("Readdir result is undefined".to_string())));
                }
                // 直接返回 JsProxy（JS 数组），让 Lua 代码通过索引和属性访问
                let proxy = JsProxy::from_handle(handle as EM_VAL, context_id);
                Ok((Some(lua.create_userdata(proxy)?), None::<String>))
            }
            Ok(PromiseResult::Error { message }) => Ok((None, Some(message))),
            Err(e) => Ok((None, Some(format!("Channel error: {}", e)))),
        }
    })?;
    
    fs_table.set("readdir", readdir_fn)?;

    lua.globals().set("fs", fs_table)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    /// 辅助函数：创建 Lua 环境并设置工作目录
    fn create_lua_with_workdir(workdir: &str) -> Lua {
        let lua = Lua::new();
        lua.set_app_data(WorkingDirectory(workdir.to_string()));
        lua
    }
    
    #[test]
    fn test_absolute_path() {
        let lua = create_lua_with_workdir("/any");
        
        // 绝对路径应该保持不变
        assert_eq!(resolve_path(&lua, "/usr/lib/mylib.lua"), "/usr/lib/mylib.lua");
        assert_eq!(resolve_path(&lua, "/mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "/"), "/");
    }
    
    #[test]
    fn test_relative_path_with_dot_slash() {
        let lua = create_lua_with_workdir("/lua");
        
        // ./ 开头的相对路径
        assert_eq!(resolve_path(&lua, "./mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "./sub/mylib.lua"), "/lua/sub/mylib.lua");
    }
    
    #[test]
    fn test_relative_path_without_slash() {
        let lua = create_lua_with_workdir("/lua");
        
        // 无前缀的相对路径
        assert_eq!(resolve_path(&lua, "mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "sub/mylib.lua"), "/lua/sub/mylib.lua");
    }
    
    #[test]
    fn test_parent_directory() {
        let lua = create_lua_with_workdir("/lua/sub");
        
        // ../ 父目录
        assert_eq!(resolve_path(&lua, "../mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "../../mylib.lua"), "/mylib.lua");
    }
    
    #[test]
    fn test_parent_beyond_root() {
        let lua = create_lua_with_workdir("/lua");
        
        // 尝试超出根目录，应该停留在根目录
        assert_eq!(resolve_path(&lua, "../mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "../../mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "../../../mylib.lua"), "/mylib.lua");
    }
    
    #[test]
    fn test_root_parent() {
        let lua = create_lua_with_workdir("/");
        
        // 从根目录使用 ..，应该保持在根目录
        assert_eq!(resolve_path(&lua, "../mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "../../mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "../"), "/");
        assert_eq!(resolve_path(&lua, "../../"), "/");
    }
    
    #[test]
    fn test_current_directory() {
        let lua = create_lua_with_workdir("/lua");
        
        // . 表示当前目录
        assert_eq!(resolve_path(&lua, "./mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "././mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "./sub/./mylib.lua"), "/lua/sub/mylib.lua");
    }
    
    #[test]
    fn test_multiple_slashes() {
        let lua = create_lua_with_workdir("/lua");
        
        // 连续斜杠应该被规范化
        // //mylib.lua 是绝对路径（以 / 开头），规范化为 /mylib.lua
        assert_eq!(resolve_path(&lua, "//mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "sub//mylib.lua"), "/lua/sub/mylib.lua");
        assert_eq!(resolve_path(&lua, "/usr///lib//mylib.lua"), "/usr/lib/mylib.lua");
        assert_eq!(resolve_path(&lua, "///mylib.lua"), "/mylib.lua");
    }
    
    #[test]
    fn test_complex_paths() {
        let lua = create_lua_with_workdir("/lua/project");
        
        // 复杂路径组合
        assert_eq!(resolve_path(&lua, "./foo/../bar/./baz.lua"), "/lua/project/bar/baz.lua");
        assert_eq!(resolve_path(&lua, "../lib/./utils/../helper.lua"), "/lua/lib/helper.lua");
        assert_eq!(resolve_path(&lua, "../../root.lua"), "/root.lua");
    }
    
    #[test]
    fn test_absolute_complex_paths() {
        let lua = create_lua_with_workdir("/any");
        
        // 绝对路径的复杂情况
        assert_eq!(resolve_path(&lua, "/lua/./foo/../bar/baz.lua"), "/lua/bar/baz.lua");
        assert_eq!(resolve_path(&lua, "/usr/../lib/mylib.lua"), "/lib/mylib.lua");
        assert_eq!(resolve_path(&lua, "/a/b/../../c/./d/../e.lua"), "/c/e.lua");
    }
    
    #[test]
    fn test_trailing_slash() {
        let lua = create_lua_with_workdir("/lua");
        
        // 尾部斜杠
        assert_eq!(resolve_path(&lua, "mylib.lua/"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "./sub/"), "/lua/sub");
        assert_eq!(resolve_path(&lua, "../"), "/");
    }
    
    #[test]
    fn test_workdir_with_trailing_slash() {
        let lua = create_lua_with_workdir("/lua/");
        
        // 工作目录带尾部斜杠
        assert_eq!(resolve_path(&lua, "mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua, "./mylib.lua"), "/lua/mylib.lua");
    }
    
    #[test]
    fn test_edge_cases() {
        let lua = create_lua_with_workdir("/lua");
        
        // 边界情况
        assert_eq!(resolve_path(&lua, "."), "/lua");
        assert_eq!(resolve_path(&lua, ".."), "/");
        assert_eq!(resolve_path(&lua, "./"), "/lua");
        assert_eq!(resolve_path(&lua, "../"), "/");
        assert_eq!(resolve_path(&lua, ""), "/lua");
    }
    
    #[test]
    fn test_no_workdir_set() {
        let lua = Lua::new();
        // 没有设置工作目录，应该默认使用 /
        
        assert_eq!(resolve_path(&lua, "mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "./mylib.lua"), "/mylib.lua");
        assert_eq!(resolve_path(&lua, "../mylib.lua"), "/mylib.lua");
    }
    
    #[test]
    fn test_real_world_scenarios() {
        // 模拟真实使用场景
        
        // 场景1: 在 /lua 目录下创建模块
        let lua1 = create_lua_with_workdir("/lua");
        assert_eq!(resolve_path(&lua1, "./mylib.lua"), "/lua/mylib.lua");
        assert_eq!(resolve_path(&lua1, "./mylib/init.lua"), "/lua/mylib/init.lua");
        
        // 场景2: 在子目录中访问父目录的模块
        let lua2 = create_lua_with_workdir("/lua/sub");
        assert_eq!(resolve_path(&lua2, "../utils.lua"), "/lua/utils.lua");
        
        // 场景3: 跨目录访问
        let lua3 = create_lua_with_workdir("/project/src");
        assert_eq!(resolve_path(&lua3, "../../lib/helper.lua"), "/lib/helper.lua");
        
        // 场景4: 绝对路径不受工作目录影响
        let lua4 = create_lua_with_workdir("/anywhere");
        assert_eq!(resolve_path(&lua4, "/lua/mylib.lua"), "/lua/mylib.lua");
    }
}
