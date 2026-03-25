-- loader.lua
-- 新版模块加载器 - 简化设计
--
-- 设计原则：
--   - 无依赖树：依赖处理交给调用方，调用方自己解析依赖并放入 assets
--   - 两种类型：module（库）和 app（应用）
--   - 按需加载：module 通过 loadModule() 按需加载
--   - 自动执行：app 在 load() 时自动执行入口文件
--
-- API：
--   Loader.load(assets_path) - 加载 assets 目录下所有模块和应用
--   Loader.loadModule(module_id) - 按需加载指定模块


local Loader = {}

----------------------------------------------------------------
-- 内部状态
----------------------------------------------------------------

-- 已注册的模块 { [moduleId] = { path, pkg, entryPath } }
local registeredModules = {}

-- 已加载的模块 { [moduleId] = loaded_result }
local loadedModules = {}

-- 已注册的应用 { [appId] = { path, pkg, entryPath } }
local registeredApps = {}

-- 加载错误收集
local loadErrors = {}

----------------------------------------------------------------
-- 工具函数
----------------------------------------------------------------

--- 读取文件内容
--- @param path string 文件路径
--- @return string|nil content, string|nil error
local function readFile(path)
  local ok, content = pcall(function()
    return fs.read(path)
  end)
  if ok and content then
    return content
  end
  return nil, "Cannot read file: " .. path
end

--- 读取目录内容（使用新 API）
--- @param path string 目录路径
--- @return table|nil entries, string|nil error
local function readDir(path)
  local entries, err = fs.readdir(path)
  if err then
    return nil, err
  end
  return entries
end

--- 拼接路径
--- @param base string 基础路径
--- @param name string 文件/目录名
--- @return string
local function joinPath(base, name)
  if base == "" or base == "." then
    return name
  end
  -- 统一使用 / 作为分隔符
  if base:sub(-1) == "/" then
    return base .. name
  end
  return base .. "/" .. name
end

--- 构建模块 ID
--- @param name string 模块名
--- @param publisher string 发布者
--- @return string
local function buildModuleId(name, publisher)
  return name .. "@" .. publisher
end

--- 将文件路径转换为 require 路径
--- 移除 .lua 扩展名，因为 require 不需要它
--- @param path string 文件路径
--- @return string require 路径
local function toRequirePath(path)
  -- 移除 .lua 扩展名
  if path:sub(-4) == ".lua" then
    return path:sub(1, -5)
  end
  return path
end

----------------------------------------------------------------
-- 核心 API
----------------------------------------------------------------

--- 加载 assets 目录
--- 遍历目录，发现所有 module 和 app，先注册 module，再执行 app
--- @param assets_path string assets 目录路径
--- @return boolean success
--- @return table|nil errors 错误数组
function Loader.load(assets_path)
  -- 重置状态
  registeredModules = {}
  loadedModules = {}
  registeredApps = {}
  loadErrors = {}
  
  print("[Loader] Loading assets from:", assets_path)
  
  -- 读取 assets 目录
  local entries, err = readDir(assets_path)
  if not entries then
    return false, { "Cannot read assets directory: " .. (err or "unknown error") }
  end
  
  -- 第一遍：遍历所有子目录，读取 pkg.json，分类注册
  for _, entry in ipairs(entries) do
    if entry.isDirectory then
      local dirPath = joinPath(assets_path, entry.name)
      local pkgPath = joinPath(dirPath, "pkg.json")
      
      local pkgContent = readFile(pkgPath)
      if pkgContent then
        local pkg = json.decode(pkgContent)
        if pkg and pkg.name and pkg.publisher then
          local moduleId = buildModuleId(pkg.name, pkg.publisher)
          local entryFile = pkg.entry or "init.lua"
          local entryPath = joinPath(dirPath, entryFile)
          
          local moduleType = pkg.type or "module"  -- 默认为 module
          
          local info = {
            path = dirPath,
            pkg = pkg,
            entryPath = entryPath,
          }
          
          if moduleType == "module" then
            registeredModules[moduleId] = info
            print("[Loader] Registered module:", moduleId)
          elseif moduleType == "app" then
            registeredApps[moduleId] = info
            print("[Loader] Registered app:", moduleId)
          else
            table.insert(loadErrors, string.format(
              "Unknown type '%s' in %s", moduleType, pkgPath
            ))
          end
        else
          print("[Loader] WARNING: Invalid pkg.json at", pkgPath)
        end
      else
        -- 没有 pkg.json 的目录，跳过
        print("[Loader] Skipping directory without pkg.json:", dirPath)
      end
    end
  end
  
  -- 第二遍：执行所有 app 的入口文件
  for appId, info in pairs(registeredApps) do
    print("[Loader] Loading app:", appId)
    local ok, appErr = pcall(function()
      -- 使用 toRequirePath 移除 .lua 扩展名
      require(toRequirePath(info.entryPath))
    end)
    
    if not ok then
      local errMsg = string.format("Failed to load app '%s': %s", appId, tostring(appErr))
      table.insert(loadErrors, errMsg)
      print("[Loader] ERROR:", errMsg)
    else
      print("[Loader] Successfully loaded app:", appId)
    end
  end
  
  if #loadErrors > 0 then
    return false, loadErrors
  end
  
  return true
end

--- 按需加载模块
--- 从已注册的模块中查找并执行，利用 require 缓存机制保证只执行一次
--- @param module_id string 模块 ID (如 "ecs@pubwiki")
--- @return any 模块导出的内容
function Loader.loadModule(module_id)
  -- 检查是否已加载（利用我们的缓存）
  if loadedModules[module_id] then
    return loadedModules[module_id]
  end
  
  -- 查找模块
  local info = registeredModules[module_id]
  if not info then
    error("Module not found: " .. module_id)
  end
  
  print("[Loader] Loading module:", module_id, "from", info.entryPath)
  
  -- 执行模块入口文件（require 自带缓存）
  -- 使用 toRequirePath 移除 .lua 扩展名
  local result = require(toRequirePath(info.entryPath))
  
  -- 记录到我们的缓存
  loadedModules[module_id] = result
  
  return result
end

----------------------------------------------------------------
-- 查询 API
----------------------------------------------------------------

--- 获取所有已注册的模块信息
--- @return table { [moduleId] = { name, publisher, version, description, ... } }
function Loader.getRegisteredModules()
  local result = {}
  
  for moduleId, info in pairs(registeredModules) do
    result[moduleId] = {
      name = info.pkg.name,
      publisher = info.pkg.publisher,
      version = info.pkg.version,
      description = info.pkg.description,
      path = info.path,
      tags = info.pkg.tags,
      dependencies = info.pkg.dependencies,
    }
  end
  
  return result
end

--- 获取所有已注册的应用信息
--- @return table { [appId] = { name, publisher, version, description, ... } }
function Loader.getRegisteredApps()
  local result = {}
  
  for appId, info in pairs(registeredApps) do
    result[appId] = {
      name = info.pkg.name,
      publisher = info.pkg.publisher,
      version = info.pkg.version,
      description = info.pkg.description,
      path = info.path,
      tags = info.pkg.tags,
      dependencies = info.pkg.dependencies,
    }
  end
  
  return result
end

--- 获取指定模块信息
--- @param module_id string 模块 ID
--- @return table|nil 模块信息
function Loader.getModuleInfo(module_id)
  local info = registeredModules[module_id]
  if not info then
    return nil
  end
  
  return {
    name = info.pkg.name,
    publisher = info.pkg.publisher,
    version = info.pkg.version,
    description = info.pkg.description,
    path = info.path,
    entryPath = info.entryPath,
    tags = info.pkg.tags,
    dependencies = info.pkg.dependencies,
    documentation = info.pkg.documentation,
  }
end

--- 检查模块是否已注册
--- @param module_id string 模块 ID
--- @return boolean
function Loader.isRegistered(module_id)
  return registeredModules[module_id] ~= nil
end

--- 检查模块是否已加载
--- @param module_id string 模块 ID
--- @return boolean
function Loader.isLoaded(module_id)
  return loadedModules[module_id] ~= nil
end

--- 列出所有已注册的模块 ID
--- @return table 模块 ID 数组
function Loader.listModules()
  local result = {}
  for moduleId, _ in pairs(registeredModules) do
    table.insert(result, moduleId)
  end
  return result
end

--- 列出所有已注册的应用 ID
--- @return table 应用 ID 数组
function Loader.listApps()
  local result = {}
  for appId, _ in pairs(registeredApps) do
    table.insert(result, appId)
  end
  return result
end

----------------------------------------------------------------
-- 重置（用于测试）
----------------------------------------------------------------

--- 重置加载器状态
function Loader.reset()
  registeredModules = {}
  loadedModules = {}
  registeredApps = {}
  loadErrors = {}
end

----------------------------------------------------------------

return Loader
