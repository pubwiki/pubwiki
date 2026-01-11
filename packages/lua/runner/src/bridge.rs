//! JS/WASM 桥接模块
//!
//! 包含与 JavaScript 交互的底层实现：
//! - callback: 异步回调管理 (CallbackManager)
//! - emval_ffi: Emscripten val FFI 封装
//! - js_proxy: JS 对象代理为 Lua UserData
//! - js_module: JS 模块注册和调用

pub mod callback;
pub mod emval_ffi;
pub mod js_proxy;
pub mod js_module;

pub use emval_ffi::JsVal;
pub use js_proxy::*;
pub use js_module::*;
