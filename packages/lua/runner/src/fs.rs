use mlua::prelude::*;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_uchar};
use std::slice;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use async_channel::Receiver;

use crate::callback::{CallbackManager, PromiseResult};

// 从 require 模块导入 WorkingDirectory
pub use crate::require::WorkingDirectory;


#[link(wasm_import_module = "env")]
extern "C" {
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

// 文件系统 Promise 回调管理器
static FS_CALLBACK_MANAGER: Lazy<Mutex<CallbackManager>> = Lazy::new(|| Mutex::new(CallbackManager::new()));

/// 注册 Promise 回调通道，返回 (callback_id, receiver)
fn register_promise_callback() -> (u32, Receiver<PromiseResult>) {
    let mut manager = FS_CALLBACK_MANAGER.lock().unwrap();
    manager.register()
}

/// 被 JavaScript 调用，用于传递 Promise 结果
#[no_mangle]
pub extern "C" fn lua_fs_promise_resolve(
    callback_id: u32,
    data_ptr: *const c_uchar,
    data_len: u32
) {
    let data = if data_ptr.is_null() || data_len == 0 {
        Vec::new()
    } else {
        unsafe { slice::from_raw_parts(data_ptr, data_len as usize) }.to_vec()
    };

    // try to resolve via manager; ignore if missing
    let _ = FS_CALLBACK_MANAGER.lock().unwrap().resolve(callback_id, data);
}

/// 被 JavaScript 调用，用于传递 Promise 错误
#[no_mangle]
pub extern "C" fn lua_fs_promise_reject(
    callback_id: u32,
    error_ptr: *const c_char
) {
    let message = unsafe {
        CStr::from_ptr(error_ptr).to_string_lossy().into_owned()
    };

    let _ = FS_CALLBACK_MANAGER.lock().unwrap().reject(callback_id, message);
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
        let (callback_id, rx) = register_promise_callback();
        
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
            Ok(PromiseResult::Success { data }) => {
                let content = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
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
            let (callback_id, rx) = register_promise_callback();
            
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
        let (callback_id, rx) = register_promise_callback();
        
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
        let (callback_id, rx) = register_promise_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_exists_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Ok(false);
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                // data 为空表示文件存在，非空表示文件不存在（错误）
                Ok(data.is_empty())
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
        let (callback_id, rx) = register_promise_callback();
        
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
        let (callback_id, rx) = register_promise_callback();
        
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
        let (callback_id, rx) = register_promise_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_stat_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async operation"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                // data 是 JSON 格式的 stat 信息
                let json_str = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                
                // 解析 JSON 并转换为 Lua table
                let stat_table = lua.create_table()?;
                
                // 使用 serde_json 解析
                let stat: serde_json::Value = serde_json::from_str(&json_str)
                    .map_err(|e| LuaError::external(format!("Invalid JSON: {}", e)))?;
                
                if let serde_json::Value::Object(obj) = stat {
                    for (key, value) in obj {
                        match value {
                            serde_json::Value::Number(n) => {
                                if let Some(i) = n.as_i64() {
                                    stat_table.set(key.as_str(), i)?;
                                } else if let Some(f) = n.as_f64() {
                                    stat_table.set(key.as_str(), f)?;
                                }
                            }
                            serde_json::Value::Bool(b) => {
                                stat_table.set(key.as_str(), b)?;
                            }
                            serde_json::Value::String(s) => {
                                stat_table.set(key.as_str(), s)?;
                            }
                            _ => {}
                        }
                    }
                }
                
                Ok((Some(stat_table), None::<String>))
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
        let (callback_id, rx) = register_promise_callback();
        
        let path_c = CString::new(resolved_path)
            .map_err(|e| LuaError::external(e))?;
        
        let promise_id = unsafe {
            js_fs_readdir_async(context_id, path_c.as_ptr(), callback_id)
        };
        
        if promise_id == 0 {
            return Err(LuaError::external("Failed to start async operation"));
        }
        
        match rx.recv().await {
            Ok(PromiseResult::Success { data }) => {
                // data 是 JSON 数组，每个元素包含 name 和 stat 信息
                let json_str = String::from_utf8(data)
                    .map_err(|e| LuaError::external(format!("Invalid UTF-8: {}", e)))?;
                
                let entries: serde_json::Value = serde_json::from_str(&json_str)
                    .map_err(|e| LuaError::external(format!("Invalid JSON: {}", e)))?;
                
                let result_table = lua.create_table()?;
                
                if let serde_json::Value::Array(arr) = entries {
                    for (idx, entry) in arr.into_iter().enumerate() {
                        if let serde_json::Value::Object(obj) = entry {
                            let entry_table = lua.create_table()?;
                            
                            for (key, value) in obj {
                                match value {
                                    serde_json::Value::Number(n) => {
                                        if let Some(i) = n.as_i64() {
                                            entry_table.set(key.as_str(), i)?;
                                        } else if let Some(f) = n.as_f64() {
                                            entry_table.set(key.as_str(), f)?;
                                        }
                                    }
                                    serde_json::Value::Bool(b) => {
                                        entry_table.set(key.as_str(), b)?;
                                    }
                                    serde_json::Value::String(s) => {
                                        entry_table.set(key.as_str(), s)?;
                                    }
                                    _ => {}
                                }
                            }
                            
                            // Lua 数组从 1 开始
                            result_table.set(idx + 1, entry_table)?;
                        }
                    }
                }
                
                Ok((Some(result_table), None::<String>))
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
