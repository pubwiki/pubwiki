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
    local self_ctx = spec.staticData or {}
    local status, result = pcall(spec.impl, self_ctx, inputs)
    if not status then
        return { _error = tostring(result) }
    end
    
    return result
end

-- 别名
ServiceRegistry.call = ServiceRegistry.execute

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

----------------------------------------------------------------
-- 清空（用于测试）
----------------------------------------------------------------

function ServiceRegistry.clear()
    ServiceRegistry._services = {}
end


Service = ServiceRegistry  -- 全局别名
ServiceRegistry = ServiceRegistry  -- 全局别名

return ServiceRegistry
