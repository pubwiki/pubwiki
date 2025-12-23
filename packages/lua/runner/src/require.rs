use mlua::prelude::*;
use mlua::Table;

// 导入 fs 模块的 resolve_path 函数
use crate::fs::resolve_path;

/// 通用字符串栈，用于追踪各种上下文信息
#[derive(Clone, Default)]
pub struct StringStack(Vec<String>);

impl StringStack {
    pub fn push(&mut self, value: String) {
        self.0.push(value);
    }
    
    pub fn pop(&mut self) {
        self.0.pop();
    }
    
    pub fn top(&self) -> Option<&String> {
        self.0.last()
    }
}

/// 通用栈守卫，在作用域结束时自动弹出栈顶元素
pub struct StackGuard<'lua, T: StackOps> {
    lua: &'lua Lua,
    pushed: bool,
    _marker: std::marker::PhantomData<T>,
}

impl<'lua, T: StackOps> StackGuard<'lua, T> {
    /// 创建守卫并压入值，如果 value 为 None 则不压入
    pub fn new(lua: &'lua Lua, value: Option<String>) -> Self {
        let Some(val) = value else {
            return Self { lua, pushed: false, _marker: std::marker::PhantomData };
        };
        
        let mut stack = lua.app_data_ref::<T>()
            .map(|s| s.clone())
            .unwrap_or_default();
        
        stack.push(val);
        lua.set_app_data(stack);
        
        Self { lua, pushed: true, _marker: std::marker::PhantomData }
    }
}

impl<'lua, T: StackOps> Drop for StackGuard<'lua, T> {
    fn drop(&mut self) {
        if self.pushed {
            if let Some(mut stack) = self.lua.app_data_ref::<T>().map(|s| s.clone()) {
                stack.pop();
                self.lua.set_app_data(stack);
            }
        }
    }
}

/// 栈操作 trait
pub trait StackOps: Clone + Default + 'static {
    fn push(&mut self, value: String);
    fn pop(&mut self);
    fn top(&self) -> Option<&String>;
}

impl StackOps for StringStack {
    fn push(&mut self, value: String) { self.0.push(value); }
    fn pop(&mut self) { self.0.pop(); }
    fn top(&self) -> Option<&String> { self.0.last() }
}

/// 源文件目录栈（用于解析相对于当前文件的路径）
#[derive(Clone, Default)]
pub struct SourceFileStack(StringStack);

impl StackOps for SourceFileStack {
    fn push(&mut self, value: String) { self.0.push(value); }
    fn pop(&mut self) { self.0.pop(); }
    fn top(&self) -> Option<&String> { self.0.top() }
}

/// 工作目录（用于解析相对路径）
#[derive(Clone, Default)]
pub struct WorkingDirectory(pub String);

pub struct ResolvedModuleSource {
    pub name: String,
    pub source: String,
}

/// 源文件目录栈守卫
#[allow(dead_code)]
pub struct SourceFileGuard<'lua>(StackGuard<'lua, SourceFileStack>);

impl<'lua> SourceFileGuard<'lua> {
    /// 创建守卫，自动从文件路径提取目录
    pub fn new(lua: &'lua Lua, file_path: &str) -> Self {
        let dir = get_parent_dir(file_path);
        Self(StackGuard::new(lua, Some(dir)))
    }
}

/// 获取文件路径的父目录
/// 
/// # Examples
/// - "/folder/a.lua" -> "/folder"
/// - "/a.lua" -> "/"
/// - "a.lua" -> ""
fn get_parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(idx) if idx == 0 => "/".to_string(),
        Some(idx) => path[..idx].to_string(),
        None => String::new(),
    }
}

/// 检查模块名是否是相对路径（以 "./" 或 "../" 开头）
fn is_relative_path(name: &str) -> bool {
    name.starts_with("./") || name.starts_with("../")
}

/// 获取当前源文件的目录（栈顶）
fn get_current_source_dir(lua: &Lua) -> Option<String> {
    lua.app_data_ref::<SourceFileStack>()
        .and_then(|s| s.top().cloned())
}

/// 解析相对路径模块名为实际文件路径
/// 
/// # Arguments
/// * `lua` - Lua 实例
/// * `module_name` - 模块名（如 "./a" 或 "../b"）
/// 
/// # Returns
/// 解析后的绝对路径
fn resolve_relative_module_path(lua: &Lua, module_name: &str) -> String {
    let current_dir = get_current_source_dir(lua)
        .unwrap_or_else(|| {
            // 如果没有源文件栈，使用工作目录
            lua.app_data_ref::<WorkingDirectory>()
                .map(|wd| wd.0.clone())
                .unwrap_or_else(|| "/".to_string())
        });
    
    // 构建相对于当前目录的路径
    let full_path = if current_dir.is_empty() {
        module_name.to_string()
    } else if current_dir.ends_with('/') {
        format!("{}{}", current_dir, module_name)
    } else {
        format!("{}/{}", current_dir, module_name)
    };
    
    // 使用 fs::resolve_path 规范化路径（处理 . 和 ..）
    resolve_path(lua, &full_path)
}

/// 将模块名转换为文件路径（foo.bar -> foo/bar）
fn module_name_to_path(name: &str) -> String {
    name.replace('.', "/")
}

/// 获取 package.path 搜索路径列表
fn get_package_paths(lua: &Lua) -> LuaResult<Vec<String>> {
    let package: Table = lua.globals().get("package")?;
    let path: String = package.get("path")?;
    
    // 按分号分割路径
    let paths: Vec<String> = path
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    
    Ok(paths)
}

/// 尝试从指定路径加载文件
async fn try_load_file(
    exists_fn: &LuaFunction,
    read_fn: &LuaFunction,
    file_path: &str,
) -> LuaResult<Option<ResolvedModuleSource>> {
    if !exists_fn.call_async::<bool>(file_path.to_string()).await? {
        return Ok(None);
    }
    
    let (content, error): (Option<String>, Option<String>) = 
        read_fn.call_async(file_path.to_string()).await?;
    
    match (content, error) {
        (Some(content), _) => Ok(Some(ResolvedModuleSource {
            name: file_path.to_string(),
            source: content,
        })),
        (None, Some(err)) => Err(LuaError::external(format!("Failed to read {}: {}", file_path, err))),
        (None, None) => Ok(None),
    }
}

/// 生成候选文件路径列表
fn generate_candidate_paths(lua: &Lua, module_name: &str) -> LuaResult<Vec<String>> {
    if is_relative_path(module_name) {
        // 相对路径：基于当前源文件目录
        let base_path = resolve_relative_module_path(lua, module_name);
        Ok(vec![
            format!("{}.lua", base_path),
            format!("{}/init.lua", base_path),
            base_path,
        ])
    } else {
        // 非相对路径：使用 package.path
        let paths = get_package_paths(lua)?;
        let module_path = module_name_to_path(module_name);
        Ok(paths
            .into_iter()
            .map(|pattern| resolve_path(lua, &pattern.replace("?", &module_path)))
            .collect())
    }
}

/// 从文件系统加载模块
async fn load_module_from_fs(
    lua: &Lua, 
    module_name: &str
) -> LuaResult<Option<ResolvedModuleSource>> {
    let fs: Table = lua.globals().get("fs")?;
    let exists_fn: LuaFunction = fs.get("exists")?;
    let read_fn: LuaFunction = fs.get("read")?;
    
    for file_path in generate_candidate_paths(lua, module_name)? {
        if let Some(resolved) = try_load_file(&exists_fn, &read_fn, &file_path).await? {
            return Ok(Some(resolved));
        }
    }
    
    Ok(None)
}

pub fn install_require_loader(lua: &Lua) -> LuaResult<()> {
    // 设置一个简洁的 package.path（只包含当前目录）
    let package: Table = lua.globals().get("package")?;
    package.set("path", "./?.lua;./?/init.lua")?;
    
    // 直接 override require 函数为异步版本
    let require_fn = lua.create_async_function(|lua, module_name: String| async move {
        // 1. 检查 package.loaded 缓存
        let package: Table = lua.globals().get("package")?;
        let loaded: Table = package.get("loaded")?;
        
        if let Ok(cached) = loaded.get::<LuaValue>(module_name.as_str()) {
            if !matches!(cached, LuaValue::Nil) {
                return Ok(cached);
            }
        }

        let cache = |module: &str, val: LuaValue| -> LuaResult<()> {
            if !val.is_nil() {
                loaded.set(module, val.clone())
            } else {
                // This is the official behavour
                loaded.set(module, LuaValue::Boolean(true))
            }
        };
        
        // 2. 检查 package.preload
        let preload: Table = package.get("preload")?;
        if let Ok(loader) = preload.get::<LuaFunction>(module_name.as_str()) {
            let result: LuaValue = loader.call(module_name.clone())?;
            cache(&module_name, result.clone())?;
            return Ok(result);
        }
        
        // 3. 尝试从文件系统加载
        if let Some(resolved) = load_module_from_fs(&lua, &module_name).await? {
            let chunk = lua
                .load(&resolved.source)
                .set_name(&resolved.name)
                .into_function()?;
            
            // 使用 SourceFileGuard 追踪当前源文件目录
            let _source_guard = SourceFileGuard::new(&lua, &resolved.name);
            let result: LuaValue = chunk.call_async(()).await?;
            
            // 缓存模块
            cache(&module_name, result.clone())?;
            
            return Ok(result);
        }
        
        // 模块未找到，生成友好的错误消息
        let attempted: String = generate_candidate_paths(&lua, &module_name)
            .unwrap_or_default()
            .iter()
            .map(|p| format!("\n\tno file '{}'", p))
            .collect::<Vec<_>>()
            .join("");
        
        let error_msg = format!(
            "module '{}' not found:{}",
            module_name,
            attempted
        );
        
        Err(LuaError::RuntimeError(error_msg))
    })?;
    
    // 替换全局 require 函数
    lua.globals().set("require", require_fn)?;
    
    Ok(())
}