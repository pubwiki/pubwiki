/// 共享的回调管理器模块
/// 用于管理 Promise 回调的 ID 分配和状态

use std::collections::HashMap;
use async_channel::{Sender, Receiver, bounded};

#[derive(Debug)]
pub enum PromiseResult {
    Success { data: Vec<u8> },
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
    pub fn resolve(&mut self, id: u32, data: Vec<u8>) -> bool {
        if let Some(tx) = self.callbacks.remove(&id) {
            let _ = tx.try_send(PromiseResult::Success { data });
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
