//! Lua API 扩展模块
//!
//! 为 Lua 提供额外的内置功能：
//! - fs: 文件系统 API
//! - rdf: RDF 三元组存储 API
//! - print: print/io.write 输出捕获
//! - require: 模块加载和路径解析
//! - utf8_string: UTF-8 字符串支持
//! - async_table: 异步表工具
//! - json: JSON 序列化/反序列化（仅供 Lua 脚本使用）

pub mod fs;
pub mod rdf;
pub mod print;
pub mod require;
pub mod utf8_string;
pub mod async_table;
pub mod json;

pub use fs::*;
pub use rdf::*;
pub use print::*;
pub use require::*;
pub use utf8_string::*;
pub use async_table::*;
// json 模块只导出 install_json_api，不再导出内部转换函数
pub use json::install_json_api;
