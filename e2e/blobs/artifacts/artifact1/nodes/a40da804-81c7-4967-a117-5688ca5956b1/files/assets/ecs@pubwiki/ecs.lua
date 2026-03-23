-- 引入类型系统
local Type = require("core/types")

-- ============================================================================
-- 函数序列化/反序列化支持
-- ============================================================================

local FUNCTION_MARKER = "__lua_function__"
local BYTECODE_KEY = "__bytecode__"

-- 检查一个 table 是否是序列化的函数标记
local function isSerializedFunction(t)
    return type(t) == "table" and t[FUNCTION_MARKER] == true and type(t[BYTECODE_KEY]) == "string"
end

-- 序列化值（递归处理 table 和 function）
local function serializeValue(value)
    local valueType = type(value)
    
    if valueType == "function" then
        -- 将函数转换为 bytecode
        local success, bytecode = pcall(string.dump, value)
        if success then
            return {
                [FUNCTION_MARKER] = true,
                [BYTECODE_KEY] = bytecode
            }
        else
            -- 无法 dump 的函数（如 C 函数），返回 nil
            warn("[ECS] Cannot serialize function: " .. tostring(bytecode))
            return nil
        end
    elseif valueType == "table" then
        -- 检查是否已经是序列化的函数标记（避免重复序列化）
        if isSerializedFunction(value) then
            return value
        end
        
        local serialized = {}
        for k, v in pairs(value) do
            serialized[k] = serializeValue(v)
        end
        return serialized
    else
        -- 基本类型直接返回
        return value
    end
end

-- 反序列化值（递归处理 table，还原 function）
local function deserializeValue(value)
    if type(value) ~= "table" then
        return value
    end
    
    -- 检查是否是序列化的函数
    if isSerializedFunction(value) then
        local bytecode = value[BYTECODE_KEY]
        local success, func = pcall(load, bytecode)
        if success and type(func) == "function" then
            return func
        else
            warn("[ECS] Cannot deserialize function: " .. tostring(func))
            return nil
        end
    end
    
    -- 普通 table，递归反序列化
    local deserialized = {}
    for k, v in pairs(value) do
        deserialized[k] = deserializeValue(v)
    end
    return deserialized
end

-- ============================================================================
-- 基础工具函数
-- ============================================================================

local function deepCopy(t)
    if type(t) == "function" then
        -- 函数通过 dump/load 复制
        local success, bytecode = pcall(string.dump, t)
        if success then
            local loaded = load(bytecode)
            return loaded
        else
            return t  -- 无法 dump 则返回原函数引用
        end
    end
    
    if type(t) ~= "table" then
        return t
    end
    
    local copy = {}
    for k, v in pairs(t) do
        copy[k] = deepCopy(v)
    end
    return copy
end

-- 从类型定义生成默认值
local function getDefaultValue(typeSpec)
    if not typeSpec or not typeSpec.kind then
        return nil
    end
    
    local kind = typeSpec.kind
    
    if kind == "string" then return "" end
    if kind == "bool" then return false end
    if kind == "int" then return 0 end
    if kind == "float" then return 0.0 end
    if kind == "any" then return nil end
    if kind == "nil" then return nil end
    
    if kind == "optional" then
        return nil  -- 可选类型默认为 nil
    end
    
    if kind == "array" then
        return {}  -- 空数组
    end
    
    if kind == "object" then
        local obj = {}
        for fieldName, fieldType in pairs(typeSpec.fields or {}) do
            obj[fieldName] = getDefaultValue(fieldType)
        end
        return obj
    end
    
    if kind == "union" then
        -- 联合类型：使用第一个类型的默认值
        if typeSpec.types and typeSpec.types[1] then
            return getDefaultValue(typeSpec.types[1])
        end
        return nil
    end
    
    if kind == "map" then
        return {}  -- 空 map
    end
    
    return nil
end

-- 检查值是否是类型定义（有 kind 字段）
local function isTypeSpec(value)
    return type(value) == "table" and value.kind ~= nil
end

local function declareProperties(initialData)
    local data = initialData or {}
    return setmetatable({}, {
        __call = function()
            return deepCopy(data)
        end,
        __index = function(t, key)
            return data[key]
        end,
        __newindex = function(t, key, value)
            error("Cannot set property on decl")
        end,
    })
end

local function createProperties(initialData)
    local data = initialData or {}
    local proxy = setmetatable({}, {
        __index = function(t, key)
            return data[key]
        end,
        __newindex = function(t, key, value)
            data[key] = value
        end,
        __call = function()
            return deepCopy(data)
        end,
        __pairs = function(t)
            return pairs(data)
        end,
    })
    
    return proxy
end

local function validateComponent(t)
    assert(t, "nil value is not a component type")
    assert(t.key, "Component must have a key")
    assert(t.name, "Component must have a name")
    assert(t.properties, "Component must have properties (Type.Object or default values table)")
end

-- 递归合并函数（假设 result 已经是拷贝）
local function mergeInto(result, overrides)
    for k, v in pairs(overrides) do
        if type(v) == "table" and type(result[k]) == "table" then
            -- 检查是否是数组：如果 override 是数组（#v >= 0），直接替换而不是递归合并
            -- 这样可以正确处理空数组 {} 的情况
            local isOverrideArray = #v >= 0 and next(v) == nil or type(next(v)) == "number"
            if isOverrideArray then
                -- 数组类型：直接替换（包括空数组）
                result[k] = deepCopy(v)
            else
                -- 对象类型：递归合并
                mergeInto(result[k], v)
            end
        else
            -- 直接覆盖（可能是新字段或替换原有值）
            result[k] = v
        end
    end
end

local function mergeProperties(defaults, overrides)
    -- 阶段1：深拷贝 defaults（只做一次）
    local result = deepCopy(defaults)
    
    -- 阶段2：用 overrides 覆盖（纯粹的合并，不涉及拷贝）
    if overrides then
        mergeInto(result, overrides)
    end
    
    return result
end

local componentDecls = {}
Component = {
    -- this acts as a backward index to the entity that contains this component,
    -- -1 means a orphan component
    entity = -1,

    register = function(self, comp)
        validateComponent(comp)
        
        -- 支持两种 properties 格式：
        -- 1. Type.Object({...}) - 新格式，类型定义
        -- 2. { key = value, ... } - 旧格式，默认值表
        local propsSpec = comp.properties
        local defaultValues
        local typeSpec
        
        if isTypeSpec(propsSpec) then
            -- 新格式：Type.Object({...})
            if propsSpec.kind ~= "object" then
                error("Component properties must be Type.Object, got: " .. tostring(propsSpec.kind))
            end
            typeSpec = propsSpec
            defaultValues = getDefaultValue(propsSpec)
        else
            -- 旧格式：直接的默认值表（兼容）
            defaultValues = propsSpec
            typeSpec = nil
        end
        
        comp._typeSpec = typeSpec  -- 保存类型定义供验证和文档生成使用
        comp.properties = declareProperties(defaultValues)

        -- inset into RDF store
        State:insert("ecs://component", "ecs://component/contains", "ecs://component/type/" .. comp.key)
        componentDecls[comp.key] = comp

        return setmetatable(comp, {
            __index = Component
        })
    end,

    -- 获取组件的类型定义（如果有）
    getTypeSpec = function(self)
        return self._typeSpec
    end,

    new = function(self, init)
        validateComponent(self)

        -- 合并默认属性和初始值
        local defaults = self.properties()
        local merged = mergeProperties(defaults, init)

        local instance = {
            properties = createProperties(merged),
        }

        return setmetatable(instance, {
            __index = self,
        })
    end
}

EntityType = {
    id = -1,
    components = {}
}

-- 简化的组件类型验证：检查是否是有效的组件类型定义
local function isValidComponentType(compType)
    if type(compType) ~= "table" then return false end
    -- 组件类型应该有 key 字段
    return compType.key ~= nil
end

-- 简化的组件实例验证：只检查基本结构
local function isValidComponent(comp)
    if type(comp) ~= "table" then return false end
    local mt = getmetatable(comp)
    if not mt then return false end
    -- 只要有 __index 指向组件类型即可
    return mt.__index ~= nil
end

local function getComponentType(comp)
    return getmetatable(comp).__index
end

local function fetchEntityId()
    local id = State:get("ecs://entity/id", "<counter>")
    if id == nil then
        -- start entity id from 2 to avoid some maps that uses entity id as key from incorrectly
        -- being recognized as arrays when crossing FFI boundary
        State:set("ecs://entity/id", "<counter>", 2)
        id = 2
    end
    State:set("ecs://entity/id", "<counter>", id + 1)
    return id
end

local resetEntityIdCounter = function()
    State:delete("ecs://entity/id", "<counter>")
end

local function buildEntity(id, comps)
    local components = {}

    -- 单个组件的特殊处理
    if isValidComponent(comps) then
        components[getComponentType(comps)] = comps
        comps.entity = id
    else
        -- 检查是否是数组形式 (spawn 传入) 还是字典形式 (load 传入)
        local isArray = #comps > 0
        
        if isArray then
            -- 数组形式：从 spawn 调用
            for i, comp in ipairs(comps) do
                if not isValidComponent(comp) then
                    error("component is invalid")
                end
                comp.entity = id
                components[getComponentType(comp)] = comp
            end
        else
            -- 字典形式：从 load 调用，comps 已经是 {[ComponentType] = instance}
            for compType, comp in pairs(comps) do
                if not isValidComponent(comp) then
                    error("component is invalid")
                end
                comp.entity = id
                components[compType] = comp
            end
        end
    end
    
    -- 递归地为嵌套 table 添加监听
    local function makeObservable(tbl, compType)
        return setmetatable({}, {
            __index = function(t, key)
                local value = tbl[key]
                -- 如果是 table，也包装成可观察的
                if type(value) == "table" then
                    return makeObservable(value, compType)
                end
                return value
            end,
            __len = function()
                return #tbl
            end,
            __newindex = function(t, key, value)
                if tbl[key] == value then
                    return
                end

                tbl[key] = value
                
                local componentId = "ecs://component/instance/" .. compType.key .. "/" .. id
                -- 触发持久化（序列化函数）
                local propsToSave = serializeValue(components[compType].properties())
                State:set(componentId, "ecs://component/hasProperties", propsToSave)
            end,
            __call = function()
                local mt = getmetatable(tbl)
                if mt == nil then
                    return
                end

                -- this call method will be overrided by what is defined in tbl
                -- for example, the properties accessor
                if type(mt.__call) == "function" then
                    return mt.__call()
                end

                -- According to our design, calling a table returns a deep copy
                return deepCopy(tbl)
            end,

            __pairs = function(t)
                local function iter(_, k)
                    local nextKey, nextValue = next(tbl, k)
                    if nextKey == nil then
                        return nil
                    end

                    -- 如果值是 table，返回包装版本
                    if type(nextValue) == "table" then
                        return nextKey, makeObservable(nextValue, compType)
                    end
                    return nextKey, nextValue
                end
                return iter, t, nil
            end,
        })
    end

    return setmetatable({
        id = id,
        components = setmetatable({}, {
            __index = function(t, k)
                local val = nil
                local kk = k

                if isValidComponentType(k) then
                    val = components[k]
                end

                if type(k) == "string" then
                    if isValidComponentType(componentDecls[k]) then
                        val = components[componentDecls[k]]
                        kk = componentDecls[k]
                    end
                end
                
                if val == nil then
                    return nil
                end
                return makeObservable(val, kk)
            end,
            __newindex = function(t, k, v)
                -- check value
                if not isValidComponent(v) then
                    error("invalid comonent value")
                end

                if not isValidComponentType(k) then
                    error("invalid component key")
                end

                if getComponentType(v) ~= k then
                    error("component is not the provided type")
                end

                v.entity = id
                rawset(t, k, v)
            end,
            __pairs = function (t)
                local function iter(_, k)
                    local nextKey, nextValue = next(components, k)
                    if nextKey == nil then
                        return nil
                    end
                    return nextKey, makeObservable(nextValue, nextKey)
                end
                return iter, t, nil
            end,
        })
    }, {
        __index = EntityType
    })
end


World = {
    -- 通过 key 获取组件类型定义
    getComponentTypeByKey = function(self, key)
        local compType = componentDecls[key]
        if compType == nil then
            error("Component type " .. key .. " is not registered")
        end
        return compType
    end,

    -- 检查实体是否存在（从 RDF Store 即时查询）
    entityExists = function(self, id)
        local entityKey = "ecs://entity/" .. id
        local existence = State:match({
            subject = "ecs://entity",
            predicate = "ecs://entity/contains",
            object = entityKey
        })
        return existence and #existence > 0
    end,

    -- 获取单个实体（从 RDF Store 即时构建）
    getEntity = function(self, id)
        if not self:entityExists(id) then
            return nil
        end
        
        local entityComponents = State:match({ 
            subject = "ecs://entity/" .. id, 
            predicate = "ecs://component/hasComponent" 
        })
        
        local components = {}
        for _, comp in pairs(entityComponents) do
            local componentKey = string.sub(comp.object, 22)
            local subject = "ecs://component/instance/" .. componentKey .. "/" .. id
            local properties = State:get(subject, "ecs://component/hasProperties")
            
            -- 反序列化函数
            local deserializedProps = deserializeValue(properties)
            local componentType = componentDecls[componentKey]
            if componentType then
                components[componentType] = componentType:new(deserializedProps)
            end
        end
        
        return buildEntity(id, components)
    end,

    -- 获取所有实体ID（从 RDF Store 即时查询）
    getAllEntityIds = function(self)
        local rdfEntities = State:match({ 
            subject = "ecs://entity", 
            predicate = "ecs://entity/contains" 
        })
        
        local ids = {}
        for _, v in pairs(rdfEntities) do
            local entityId = tonumber(string.sub(v.object, 14))
            if entityId then
                ids[#ids + 1] = entityId
            end
        end
        
        table.sort(ids)
        return ids
    end,

    -- 获取所有实体（从 RDF Store 即时构建）
    -- 注意：这个方法会构建所有实体对象，性能较低，尽量使用 getEntity 或 getEntities
    getAllEntities = function(self)
        local ids = self:getAllEntityIds()
        local entities = {}
        for _, id in ipairs(ids) do
            entities[id] = self:getEntity(id)
        end
        return entities
    end,

    -- 按组件类型过滤实体（从 RDF Store 即时查询）
    getEntities = function(self, comps)
        if comps == nil then
            return self:getAllEntities()
        end

        -- 转换组件参数为 key 列表
        local list = {}
        for _, comp in pairs(comps) do
            local key
            if isValidComponentType(comp) then
                key = comp.key
            elseif componentDecls[comp] ~= nil then
                key = comp
            else
                warn("[World:getEntities] detected invalid component query", comps)
                return {}
            end
            list[#list + 1] = key
        end

        -- 从 RDF Store 查询所有实体
        local allIds = self:getAllEntityIds()
        local result = {}

        for _, id in ipairs(allIds) do
            -- 检查实体是否拥有所有指定的组件
            local hasAll = true
            for _, key in ipairs(list) do
                local componentTypeKey = "ecs://component/type/" .. key
                local hasComp = State:match({
                    subject = "ecs://entity/" .. id,
                    predicate = "ecs://component/hasComponent",
                    object = componentTypeKey
                })
                if not hasComp or #hasComp == 0 then
                    hasAll = false
                    break
                end
            end
            
            if hasAll then
                result[id] = self:getEntity(id)
            end
        end

        return result
    end,

    -- 销毁实体（直接操作 RDF Store）
    despawn = function(self, id)
        local entityKey = "ecs://entity/" .. id
        
        -- 检查实体是否存在
        local existence = State:match({
            subject = "ecs://entity",
            predicate = "ecs://entity/contains",
            object = entityKey
        })
        
        if not existence or #existence == 0 then 
            -- 幂等操作：实体不存在则直接返回
            return
        end

        -- 获取实体的所有组件
        local entityComponents = State:match({ 
            subject = entityKey, 
            predicate = "ecs://component/hasComponent" 
        })
        
        -- 删除实体引用
        State:delete("ecs://entity", "ecs://entity/contains", entityKey)
        
        -- 删除所有组件数据
        for _, comp in pairs(entityComponents) do
            local componentKey = string.sub(comp.object, 22)
            local componentTypeKey = "ecs://component/type/" .. componentKey
            local componentInstanceKey = "ecs://component/instance/" .. componentKey .. "/" .. id
            State:delete(componentInstanceKey, "ecs://component/hasProperties")
            State:delete(entityKey, "ecs://component/hasComponent", componentTypeKey)
        end
    end,

    -- 生成新实体（直接操作 RDF Store）
    spawn = function(self, comps)
        local id = fetchEntityId()
        local entity = buildEntity(id, comps)

        -- 插入实体到 RDF Store
        local entityKey = "ecs://entity/" .. id
        State:insert("ecs://entity", "ecs://entity/contains", entityKey)
        
        for _, v in ipairs(comps) do
            local componentTypeKey = "ecs://component/type/" .. v.key
            local componentInstanceKey = "ecs://component/instance/" .. v.key .. "/" .. id
            -- 序列化函数后保存
            local propsToSave = serializeValue(v.properties())
            State:set(componentInstanceKey, "ecs://component/hasProperties", propsToSave)
            State:insert(entityKey, "ecs://component/hasComponent", componentTypeKey)
        end

        return entity
    end,

    -- 清空世界中的所有实体（直接操作 RDF Store）
    clear = function(self)
        -- 从 RDF Store 获取所有实体ID
        local ids = self:getAllEntityIds()
        
        -- 逐个删除实体
        for _, id in ipairs(ids) do
            self:despawn(id)
        end

        resetEntityIdCounter()
    end,
}

-- ============================================================================
-- System Registry - System函数管理器
-- 使用类型系统统一定义 inputs/outputs
-- ============================================================================

System = {
    systems = {},  -- 存储所有注册的system {systemId -> systemConfig}
    
    -- 注册一个 system 函数
    -- @param config table 包含以下字段:
    --   - category: string 类别名称
    --   - name: string System名称
    --   - description: string 功能描述
    --   - usage: string (可选) 使用说明/示例
    --   - src_module: string (可选) 源模块名称
    --   - inputs: Type.Object 输入类型定义
    --   - outputs: Type.Object 输出类型定义
    --   - execute: function(params) -> table 执行函数，接收params表，返回结果表
    --   - tags: table (可选) 标签数组，如 {"query"} 表示 PURE 服务
    --   - expose_to_service: boolean (可选) 是否暴露到服务系统
    register = function(self, config)
        assert(config.category, "System must have a category")
        assert(config.name, "System must have a name")
        assert(config.description, "System must have a description")
        assert(config.inputs, "System must have inputs (Type.Object)")
        assert(config.outputs, "System must have outputs (Type.Object)")
        assert(Type.isType(config.inputs) and config.inputs.kind == "object", "System inputs must be Type.Object")
        assert(Type.isType(config.outputs) and config.outputs.kind == "object", "System outputs must be Type.Object")
        assert(config.execute, "System must have an execute function")
        
        local systemId = config.category .. "." .. config.name
        
        -- 检查是否已存在
        if self.systems[systemId] then
            error("System already registered: " .. systemId)
        end
        
        -- 确定节点类型
        local kind = "ACTION"
        for _, tag in ipairs(config.tags or {}) do
            if tag == "query" then
                kind = "PURE"
                break
            end
        end
        
        self.systems[systemId] = {
            id = systemId,
            category = config.category,
            name = config.name,
            description = config.description,
            usage = config.usage or "",
            inputs = config.inputs,
            outputs = config.outputs,
            execute = config.execute,
            tags = config.tags or {},
            kind = kind,
            expose_to_service = config.expose_to_service or false,
            trace_info = config.trace_info or nil,
        }

        return systemId
    end,
    -- 调用system（供JS层调用，不做参数验证）
    -- @param systemId string System的ID
    -- @param params table 参数表
    -- @return table 执行结果
    call = function(self, systemId, params)
        local system = self.systems[systemId]
        if not system then
            print("[Error][System:call] System not found: " .. systemId)
            return {
                success = false,
                error = "System not found: " .. systemId
            }
        end

        -- 直接执行（验证在JS侧完成）
        local success, result = pcall(system.execute, params)

        if not success then
            print("[Error][System:call] Execution error in system: " .. systemId)
            print("[Error][System:call] " .. tostring(result))
            return {
                success = false,
                error = "Execution error: " .. tostring(result)
            }
        end

        -- 确保返回值包含success字段
        if type(result) == "table" and result.success ~= nil then
            if result.success then
                print("[System:call] System " .. systemId .. " executed successfully.")
            else
                print("[Warning][System:call] System " .. systemId .. " execution returned success = false." .. (result.error or "") .. (result.reason or ""))
            end
        end

        return result
    end,
}

-- ============================================================================
-- 模块导出
-- ============================================================================

return {
    World = World,
    Component = Component,
    System = System,
    Type = Type,
}