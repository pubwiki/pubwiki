-- service.lua
-- Service System - 服务定义与调用
--
-- 核心理念:
--   - ServiceRegistry:define() / ServiceRegistry:definePure() - 定义并注册服务
--   - ServiceRegistry.call() - 统一的服务调用入口
--   - namespace: 服务命名空间（避免命名冲突）
--
-- 服务类型:
--   - ACTION (默认): 有副作用的服务
--   - PURE: 纯计算，无副作用

local Type = require("core/types")

----------------------------------------------------------------
-- ServiceRegistry
----------------------------------------------------------------

local ServiceRegistry = {
    _services = {},  -- identifier -> service spec
    Type = Type,     -- 导出 Type 供外部使用
}

----------------------------------------------------------------
-- ServiceBuilder - 链式构建器
----------------------------------------------------------------

local function createBuilder(registry, kind)
    local builder = {
        _registry = registry,
        _kind = kind,
        _inputs = {},
        _outputs = {},
    }
    
    function builder:namespace(ns)
        self._namespace = ns
        return self
    end
    
    function builder:name(n)
        self._name = n
        return self
    end
    
    function builder:desc(description)
        self._description = description
        return self
    end
    
    function builder:inputs(typeOrObject)
        assert(Type.isType(typeOrObject), "inputs must be a Type")
        self._inputs = typeOrObject
        return self
    end
    
    function builder:outputs(typeOrObject)
        assert(Type.isType(typeOrObject), "outputs must be a Type")
        self._outputs = typeOrObject
        return self
    end
    
    function builder:staticData(data)
        self._staticData = data
        return self
    end
    
    function builder:usage(the_usage)
        self._usage = the_usage
        return self
    end

    function builder:impl(fn)
        self._impl = fn
        -- impl 是最后一步，自动注册
        return self:_register()
    end
    
    function builder:_register()
        assert(self._name, "Service must have a name")
        assert(self._namespace, "Service must have a namespace")
        assert(self._impl, "Service must have an impl")
        
        local name = self._name
        local namespace = self._namespace
        local identifier = namespace .. ":" .. name
        
        -- 克隆 inputs/outputs Type（如果存在）
        local inputs = self._inputs and Type.clone(self._inputs) or Type.Nil
        local outputs = self._outputs and Type.clone(self._outputs) or Type.Nil
        
        local spec = {
            name = name,
            namespace = namespace,
            identifier = identifier,
            kind = self._kind,
            description = self._description,
            inputs = inputs,
            usage = self._usage,
            outputs = outputs,
            staticData = self._staticData,
            impl = self._impl,
        }
        
        if self._registry._services[identifier] then
            error("Service already exists: " .. identifier)
        end
        
        self._registry._services[identifier] = spec
        return spec
    end
    
    return builder
end

----------------------------------------------------------------
-- ServiceRegistry:define() / ServiceRegistry:definePure()
----------------------------------------------------------------

-- 定义 ACTION 服务（默认，有副作用）
function ServiceRegistry:define()
    return createBuilder(self, "ACTION")
end

-- 定义 PURE 服务（纯计算，无副作用）
function ServiceRegistry:definePure()
    return createBuilder(self, "PURE")
end

----------------------------------------------------------------
-- 服务查询
----------------------------------------------------------------

function ServiceRegistry.get(identifier)
    return ServiceRegistry._services[identifier]
end

function ServiceRegistry.has(identifier)
    return ServiceRegistry._services[identifier] ~= nil
end

function ServiceRegistry.unregister(identifier)
    ServiceRegistry._services[identifier] = nil
end

function ServiceRegistry.isPure(identifier)
    local spec = ServiceRegistry.get(identifier)
    return spec and spec.kind == "PURE"
end

function ServiceRegistry.isAction(identifier)
    local spec = ServiceRegistry.get(identifier)
    return spec and spec.kind == "ACTION"
end

function ServiceRegistry.listServices()
    local services = {}
    for identifier in pairs(ServiceRegistry._services) do
        table.insert(services, identifier)
    end
    table.sort(services)
    return services
end

function ServiceRegistry.listByNamespace(namespace)
    local services = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        if spec.namespace == namespace then
            table.insert(services, identifier)
        end
    end
    table.sort(services)
    return services
end

function ServiceRegistry.getNamespaces()
    local nsSet = {}
    for _, spec in pairs(ServiceRegistry._services) do
        nsSet[spec.namespace] = true
    end
    local namespaces = {}
    for ns in pairs(nsSet) do
        table.insert(namespaces, ns)
    end
    table.sort(namespaces)
    return namespaces
end

----------------------------------------------------------------
-- 服务执行
----------------------------------------------------------------

--[[
  ServiceRegistry.call() / ServiceRegistry.execute()
  
  参数:
    identifier: string - 服务标识符 (namespace:name)
    inputs: table - 输入值，结构需符合服务定义的 inputs Type
  
  返回值: table - impl 函数的返回值
    若失败返回 { _error = "错误信息" }
  
  impl 函数接口:
    function(self, inputs)
      local a = inputs.a           -- 读取输入
      local x = self.someData      -- 访问 staticData
      return { result = a + x }    -- 返回输出
    end
]]
function ServiceRegistry.execute(identifier, inputs)
    local spec = ServiceRegistry.get(identifier)
    if not spec then
        return { _error = "Service not found: " .. tostring(identifier) }
    end
    
    -- 使用 staticData 作为 self，通过冒号语法调用 impl
    local status, result
    if spec.staticData ~= nil then
        status, result = pcall(spec.impl, spec.staticData, inputs)
    else
        status, result = pcall(spec.impl, inputs)
    end
    
    if not status then
        return { _error = tostring(result) }
    end
    
    return result
end

-- 别名
ServiceRegistry.call = ServiceRegistry.execute

----------------------------------------------------------------
-- Streaming iteration (for streaming services)
----------------------------------------------------------------

--[[
  ServiceRegistry.iterate(identifier, inputs, callback)

  Calls a service and streams its return value:
  - If the return is a function (iterator/generator), iterates
    and calls callback for each yielded value.
  - Otherwise calls callback once with the return value.
]]
function ServiceRegistry.iterate(identifier, inputs, callback)
    local result = ServiceRegistry.execute(identifier, inputs)

    if result and result._error then
        error(result._error)
    end

    if type(result) == "function" then
        for value in result do
            if value == nil then break end
            callback(value)
        end
    else
        if result ~= nil then
            callback(result)
        end
    end
end

----------------------------------------------------------------
-- 序列化导出
----------------------------------------------------------------

local function serializeService(spec)
    return {
        name = spec.name,
        namespace = spec.namespace,
        identifier = spec.identifier,
        kind = spec.kind,
        description = spec.description,
        inputs = Type.serialize(spec.inputs),
        outputs = Type.serialize(spec.outputs),
        staticData = spec.staticData,
    }
end

-- 导出所有服务
function ServiceRegistry.export()
    local result = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        result[identifier] = serializeService(spec)
    end
    return result
end

-- 按 kind 分组导出
function ServiceRegistry.exportByKind()
    local byKind = { PURE = {}, ACTION = {} }
    for identifier, spec in pairs(ServiceRegistry._services) do
        byKind[spec.kind][identifier] = serializeService(spec)
    end
    return byKind
end

-- 按 namespace 分组导出
function ServiceRegistry.exportByNamespace()
    local result = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        local ns = spec.namespace
        if not result[ns] then
            result[ns] = {}
        end
        result[ns][spec.name] = serializeService(spec)
    end
    return result
end

-- 完整导出
function ServiceRegistry.exportDetailed()
    return {
        services = ServiceRegistry.export(),
        byKind = ServiceRegistry.exportByKind(),
        byNamespace = ServiceRegistry.exportByNamespace(),
    }
end

-- 导出指定命名空间的服务文档（人类可读）
-- 返回: Array<{ name: string, doc: string }>
function ServiceRegistry.exportDocByNamespace(namespace)
    local services = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        if spec.namespace == namespace then
            table.insert(services, spec)
        end
    end
    
    if #services == 0 then
        return {}
    end
    
    -- 按名称排序
    table.sort(services, function(a, b)
        return a.name < b.name
    end)
    
    local result = {}
    
    for _, spec in ipairs(services) do
        local lines = {}
        
        table.insert(lines, "## " .. spec.identifier)
        table.insert(lines, "")
        
        -- 服务类型
        table.insert(lines, "**Type**: " .. spec.kind)
        table.insert(lines, "")
        
        -- 描述
        if spec.description then
            table.insert(lines, "**Description**: " .. spec.description)
            table.insert(lines, "")
        end
        
        -- 使用方式
        if spec.usage then
            table.insert(lines, "**Usage**:")
            table.insert(lines, "```lua")
            local the_usage = spec.usage
            if type(spec.usage) == "function" then
                the_usage = spec:usage()
            end
            table.insert(lines, the_usage)
            table.insert(lines, "```")
            table.insert(lines, "")
        end
        
        -- 输入参数
        table.insert(lines, "**Inputs**:")
        table.insert(lines, "```")
        table.insert(lines, Type.format(spec.inputs, 0, true))
        table.insert(lines, "```")
        table.insert(lines, "")
        
        -- 输出参数
        table.insert(lines, "**Outputs**:")
        table.insert(lines, "```")
        table.insert(lines, Type.format(spec.outputs, 0, true))
        table.insert(lines, "```")
        table.insert(lines, "")
        
        -- 静态数据（如果有）
        if spec.staticData and next(spec.staticData) ~= nil then
            table.insert(lines, "**Static Data**: Available")
            table.insert(lines, "")
        end
        
        table.insert(result, {
            name = spec.identifier,
            doc = table.concat(lines, "\n")
        })
    end
    
    return result
end

----------------------------------------------------------------
-- 清空（用于测试）
----------------------------------------------------------------

function ServiceRegistry.clear()
    ServiceRegistry._services = {}
end


Service = ServiceRegistry  -- 全局别名
ServiceRegistry = ServiceRegistry  -- 全局别名

return ServiceRegistry
