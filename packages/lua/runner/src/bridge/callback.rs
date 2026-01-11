/// 共享的回调管理器模块
/// 用于管理 Promise 回调的 ID 分配和状态
/// 
/// 这是一个全局单例，供所有模块（fs, rdf, js_module, js_proxy）共享使用

use std::collections::HashMap;
use std::sync::Mutex;
use async_channel::{Sender, Receiver, bounded};
use once_cell::sync::Lazy;

#[derive(Debug)]
pub enum PromiseResult {
    /// 成功结果，包含 EM_VAL handle 的数值（0 表示 undefined/void）
    /// 存储为 u32 以满足 Send trait，使用时转换为 EM_VAL
    Success { handle: u32 },
    Error { message: String },
}

/// CallbackManager - 统一管理 Promise 回调的 ID 分配和 sender 存储
pub struct CallbackManager {
    next_id: u32,
    callbacks: HashMap<u32, Sender<PromiseResult>>,
}

impl CallbackManager {
    pub fn new() -> Self {
        CallbackManager {
            next_id: 1,
            callbacks: HashMap::new(),
        }
    }

    /// 注册新的回调并返回 (id, receiver)
    pub fn register(&mut self) -> (u32, Receiver<PromiseResult>) {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        let (tx, rx) = bounded(1);
        self.callbacks.insert(id, tx);
        (id, rx)
    }

    /// 移除 sender 并发送成功结果。返回 true 如果 sender 存在
    /// handle: EM_VAL handle 的数值，0 表示 undefined/void
    pub fn resolve(&mut self, id: u32, handle: u32) -> bool {
        if let Some(tx) = self.callbacks.remove(&id) {
            let _ = tx.try_send(PromiseResult::Success { handle });
            true
        } else {
            false
        }
    }

    /// 移除 sender 并发送错误结果。返回 true 如果 sender 存在
    pub fn reject(&mut self, id: u32, message: String) -> bool {
        if let Some(tx) = self.callbacks.remove(&id) {
            let _ = tx.try_send(PromiseResult::Error { message });
            true
        } else {
            false
        }
    }
}

// ==================== 全局单例 ====================

/// 全局 CallbackManager 单例
/// 所有模块（fs, rdf, js_module, js_proxy）共享同一个 callback ID 空间
static GLOBAL_CALLBACK_MANAGER: Lazy<Mutex<CallbackManager>> =
    Lazy::new(|| Mutex::new(CallbackManager::new()));

/// 注册一个全局回调，返回 (callback_id, receiver)
pub fn register_callback() -> (u32, Receiver<PromiseResult>) {
    let mut manager = GLOBAL_CALLBACK_MANAGER.lock().unwrap();
    manager.register()
}

/// 解析回调（成功），handle 为 EM_VAL handle 的数值（0 表示 undefined/void）
pub fn resolve_callback(id: u32, handle: u32) -> bool {
    let mut manager = GLOBAL_CALLBACK_MANAGER.lock().unwrap();
    manager.resolve(id, handle)
}

/// 拒绝回调（失败）
pub fn reject_callback(id: u32, message: String) -> bool {
    let mut manager = GLOBAL_CALLBACK_MANAGER.lock().unwrap();
    manager.reject(id, message)
}

// ==================== FFI 入口点 ====================
// 统一的 C FFI 入口，由 JavaScript 调用

use std::ffi::CStr;
use std::os::raw::c_char;

/// 统一的 Promise resolve 入口（由 JavaScript 调用）
/// handle: EM_VAL handle 的数值，0 表示 undefined/void
#[unsafe(no_mangle)]
pub extern "C" fn lua_callback_resolve(
    callback_id: u32,
    handle: u32,
) {
    resolve_callback(callback_id, handle);
}

/// 统一的 Promise reject 入口（由 JavaScript 调用）
#[unsafe(no_mangle)]
pub extern "C" fn lua_callback_reject(callback_id: u32, error_ptr: *const c_char) {
    let message = if error_ptr.is_null() {
        "Unknown error".to_string()
    } else {
        unsafe {
            CStr::from_ptr(error_ptr)
                .to_string_lossy()
                .into_owned()
        }
    };
    reject_callback(callback_id, message);
}
