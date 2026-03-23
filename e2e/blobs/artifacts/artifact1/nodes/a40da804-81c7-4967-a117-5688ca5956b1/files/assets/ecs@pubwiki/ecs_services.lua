-- ecs_services.lua
-- ECS 内置服务定义
-- 服务实现使用 (self, inputs) 签名，直接返回输出表

local Type = require("core/types")
local Service = require("core/service")

-- 导入 ECS 核心模块
local ECS = require("./ecs")
local World = ECS.World
local Component = ECS.Component
local System = ECS.System

-- ECS 服务节点表
local ECS_Services = {}

-- ============================================================================
-- Entity 操作服务
-- ============================================================================

Service:define():namespace("ecs"):name("SpawnEntity")
    :desc("生成新实体。通过 components 数组指定初始组件，每个组件包含 key（组件类型标识）和 data（初始数据）。")
    :inputs(Type.Object({
        components = Type.Optional(Type.Array(Type.Object({
            key = Type.String,          -- 组件类型 key
            data = Type.Optional(Type.Any)  -- 组件初始数据
        })))
    }))
    :outputs(Type.Object({
        entity_id = Type.Int,
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local componentsSpec = inputs.components or {}
        
        -- 准备组件实例数组
        local componentInstances = {}
        
        -- 添加所有组件
        for _, compSpec in ipairs(componentsSpec) do
            local compType = World:getComponentTypeByKey(compSpec.key)
            if compType then
                local instance = compType:new(compSpec.data or {})
                table.insert(componentInstances, instance)
            else
                return {
                    entity_id = 0,
                    success = false,
                    error = "Unknown component type: " .. compSpec.key,
                }
            end
        end
        
        -- 生成实体
        local success, result = pcall(function()
            return World:spawn(componentInstances)
        end)
        
        if not success then
            return {
                entity_id = 0,
                success = false,
                error = tostring(result),
            }
        end
        
        return {
            entity_id = result.id,
            success = true,
        }
    end)

Service:define():namespace("ecs"):name("DespawnEntity")
    :desc("销毁指定 entity_id 的实体，同时移除该实体的所有组件。如果实体不存在，success 返回 false。")
    :inputs(Type.Object({
        entity_id = Type.Int,
    }))
    :outputs(Type.Object({
        success = Type.Bool,
    }))
    :impl(function(inputs)
        local entityId = inputs.entity_id
        
        if World:entityExists(entityId) then
            World:despawn(entityId)
            return { success = true }
        else
            return { success = false }
        end
    end)

Service:definePure():namespace("ecs"):name("GetEntity")
    :desc("检查实体是否存在。如果实体不存在，exists 返回 false。")
    :inputs(Type.Object({
        entity_id = Type.Int,
    }))
    :outputs(Type.Object({
        exists = Type.Bool,
    }))
    :impl(function(inputs)
        return { exists = World:entityExists(inputs.entity_id) }
    end)

Service:definePure():namespace("ecs"):name("GetAllEntityIds")
    :desc("获取世界中所有实体的 ID 列表。返回的 entity_ids 数组按 ID 升序排序，count 为实体总数。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        entity_ids = Type.Array(Type.Int),
        count = Type.Int,
    }))
    :impl(function(inputs)
        local ids = World:getAllEntityIds()
        return {
            entity_ids = ids,
            count = #ids,
        }
    end)

Service:define():namespace("ecs"):name("ClearWorld")
    :desc("清空世界中的所有实体。此操作会销毁所有实体及其组件数据，不可撤销。返回被删除的实体数量。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        success = Type.Bool,
        cleared_count = Type.Int:desc("被删除的实体数量"),
    }))
    :impl(function(inputs)
        -- 先统计数量
        local ids = World:getAllEntityIds()
        local count = #ids
        
        -- 清空所有实体
        World:clear()
        
        return {
            success = true,
            cleared_count = count,
        }
    end)

Service:definePure():namespace("ecs"):name("GetEntitiesByComponent")
    :desc("按组件过滤实体，支持多组件 AND 查询。component_keys 数组中的所有组件必须同时存在于实体上才会被返回。返回的 entity_ids 按升序排序。如果未提供组件 key，返回空数组。")
    :inputs(Type.Object({
        component_keys = Type.Array(Type.String),  -- 支持多个组件key
    }))
    :outputs(Type.Object({
        entity_ids = Type.Array(Type.Int),
        count = Type.Int,
    }))
    :impl(function(inputs)
        local componentKeys = inputs.component_keys or {}
        
        -- 如果没有提供组件key，返回空
        if #componentKeys == 0 then
            return {
                entity_ids = {},
                count = 0,
            }
        end
        
        -- 构建组件类型数组
        local compTypes = {}
        for _, key in ipairs(componentKeys) do
            local success, compType = pcall(function()
                return World:getComponentTypeByKey(key)
            end)
            
            if not success or not compType then
                return {
                    entity_ids = {},
                    count = 0,
                }
            end
            
            table.insert(compTypes, compType)
        end
        
        -- 使用 World:getEntities 支持单个或多个组件查询
        local query = compTypes
        
        print("[ecs:GetEntitiesByComponent] 查询组件 keys:", table.concat(componentKeys, ", "))

        local entities = World:getEntities(query)
        
        local ids = {}
        if entities then
            for id, _ in pairs(entities) do
                table.insert(ids, id)
            end
        end
        table.sort(ids)
        return {
            entity_ids = ids,
            count = #ids,
        }
    end)

Service:definePure():namespace("ecs"):name("GetSnapshot")
    :desc("获取世界中所有实体和组件的完整数据快照。返回每个实体的 entity_id 和 components 对象（key 为组件类型，value 为组件数据）。实体按 entity_id 升序排序。适用于保存/加载、调试、数据导出等场景。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        entities = Type.Array(Type.Object({
            entity_id = Type.Int,
            components = Type.Any,  -- 组件key到数据的映射
        })),
        count = Type.Int,
    }))
    :impl(function(inputs)
        local snapshot = {}
        
        -- 从 RDF Store 获取所有实体ID并遍历
        local entityIds = World:getAllEntityIds()
        for _, entityId in ipairs(entityIds) do
            local entity = World:getEntity(entityId)
            if entity then
                local entityData = {
                    entity_id = entityId,
                    components = {}
                }
                
                -- 获取所有组件数据
                for componentTypeOrKey, component in pairs(entity.components) do
                    -- componentKey 可能是字符串或组件类型对象
                    local keyStr
                    if type(componentTypeOrKey) == "string" then
                        keyStr = componentTypeOrKey
                    elseif type(componentTypeOrKey) == "table" and componentTypeOrKey.key then
                        keyStr = componentTypeOrKey.key
                    else
                        keyStr = tostring(componentTypeOrKey)
                    end
                    entityData.components[keyStr] = component:properties()
                end
                
                table.insert(snapshot, entityData)
            end
        end
        
        return {
            entities = snapshot,
            count = #snapshot,
        }
    end)

Service:definePure():namespace("ecs"):name("GetEntitySnapshot")
    :desc("获取单个实体的完整数据快照。返回 entity_id 和 components 对象（key 为组件类型，value 为组件数据）。如果实体不存在，found 返回 false。")
    :inputs(Type.Object({
        entity_id = Type.Int,
    }))
    :outputs(Type.Object({
        found = Type.Bool,
        entity_id = Type.Optional(Type.Int),
        components = Type.Optional(Type.Any),  -- 组件key到数据的映射
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local entityId = inputs.entity_id
        local entity = World:getEntity(entityId)
        
        if not entity then
            return { found = false }
        end
        
        local components = {}
        
        -- 获取所有组件数据
        for componentTypeOrKey, component in pairs(entity.components) do
            local keyStr
            if type(componentTypeOrKey) == "string" then
                keyStr = componentTypeOrKey
            elseif type(componentTypeOrKey) == "table" and componentTypeOrKey.key then
                keyStr = componentTypeOrKey.key
            else
                keyStr = tostring(componentTypeOrKey)
            end
            components[keyStr] = component:properties()
        end
        
        return {
            found = true,
            entity_id = entityId,
            components = components,
        }
    end)

-- ============================================================================
-- Component 操作服务
-- ============================================================================
Service:definePure():namespace("ecs"):name("GetComponentData")
    :desc("获取实体指定组件的数据。如果实体或组件不存在，found 返回 false。")
    :inputs(Type.Object({
        entity_id = Type.Int,
        component_key = Type.String,
    }))
    :outputs(Type.Object({
        found = Type.Bool,
        data = Type.Optional(Type.Any),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local entityId = inputs.entity_id
        local componentKey = inputs.component_key
        
        local entity = World:getEntity(entityId)
        if not entity then
            return { found = false, error = "Entity not found" }
        end
        
        local component = entity.components[componentKey]
        if not component then
            return { found = false }
        end
        
        return {
            found = true,
            data = component:properties()
        }
    end)

Service:define():namespace("ecs"):name("SetComponentData")
    :desc("设置实体指定组件的数据。merge 为 true 时合并更新（只更新提供的字段），为 false 时完全替换所有字段。")
    :inputs(Type.Object({
        entity_id = Type.Int,
        component_key = Type.String,
        data = Type.Any,
        merge = Type.Optional(Type.Bool),  -- true: 合并更新, false: 完全替换
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local entityId = inputs.entity_id
        local componentKey = inputs.component_key
        local data = inputs.data
        local merge = inputs.merge
        if merge == nil then merge = true end  -- 默认合并更新
        
        local entity = World:getEntity(entityId)
        if not entity then
            return { success = false, error = "Entity not found" }
        end
        
        local component = entity.components[componentKey]
        if not component then
            return { success = false, error = "Component not found" }
        end
        
        if merge then
            -- 合并更新：只更新提供的字段
            local props = component.properties
            for k, v in pairs(data) do
                props[k] = v
            end
        else
            -- 完全替换：先清空再设置
            local props = component.properties
            -- 清空现有属性
            for k in pairs(props) do
                props[k] = nil
            end
            -- 设置新属性
            for k, v in pairs(data) do
                props[k] = v
            end
        end
        
        return { success = true }
    end)

-- ============================================================================
-- Component Type 元编程服务
-- ============================================================================

Service:define():namespace("ecs"):name("RegisterComponent")
    :desc("动态注册新的组件类型。需提供 key（唯一标识）、name（显示名称）、properties_typedef（Type.serialize() 序列化后的类型定义）。可选参数：description（描述）、expose_to_blueprint（是否暴露给蓝图，默认 false）、priority（优先级）、trace_info（追踪信息）。如果 key 已注册，返回错误。")
    :inputs(Type.Object({
        key = Type.String,
        name = Type.String,
        description = Type.Optional(Type.String),
        properties_typedef = Type.Any,  -- Type.serialize() 序列化后的类型定义
        expose_to_blueprint = Type.Optional(Type.Bool),
        priority = Type.Optional(Type.Int),
        trace_info = Type.Optional(Type.String),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local key = inputs.key
        local name = inputs.name
        local description = inputs.description or ""
        local propertiesTypeDef = inputs.properties_typedef
        local exposeToBp = inputs.expose_to_blueprint
        local priority = inputs.priority
        local traceInfo = inputs.trace_info
        if exposeToBp == nil then exposeToBp = false end
        
        -- 检查是否已注册
        local alreadyExists = pcall(function()
            return World:getComponentTypeByKey(key)
        end)
        if alreadyExists then
            return { success = false, error = "Component already registered: " .. key }
        end
        
        -- 从序列化数据还原 Type 对象
        local propertiesType = Type.deserialize(propertiesTypeDef)
        if not propertiesType then
            return { success = false, error = "Invalid properties_typedef" }
        end
    
        local success, result = pcall(function()
            local compSpec = {
                key = key,
                name = name,
                description = description,
                properties = propertiesType,
                expose_to_blueprint = exposeToBp,
            }
            
            if priority then
                compSpec.priority = priority
            end

            if traceInfo then
                compSpec.trace_info = traceInfo
            end
            
            return Component:register(compSpec)
        end)
        
        if not success then
            return { success = false, error = tostring(result) }
        end
        
        return { success = true }
    end)

-- ============================================================================
-- System 注册服务
-- ============================================================================

Service:define():namespace("ecs"):name("RegisterSystem")
    :desc("动态注册新的 System（业务逻辑函数）。需提供 category、name（组合成 system_id）、description、inputs_typedef（Type.serialize(Type.Object({...})) 序列化后的完整类型定义）、outputs_typedef（同上）、execute（执行函数）。可选参数：tags（标签数组）、expose_to_service（是否自动暴露为服务，默认 false）、trace_info。如果 system_id 已注册，返回错误。")
    :inputs(Type.Object({
        category = Type.String,
        name = Type.String,
        description = Type.String,
        inputs_typedef = Type.Any,   -- Type.serialize(Type.Object({...})) 的完整序列化结果
        outputs_typedef = Type.Any,  -- Type.serialize(Type.Object({...})) 的完整序列化结果
        execute = Type.Function({}),
        tags = Type.Optional(Type.Array(Type.String)),
        expose_to_service = Type.Optional(Type.Bool),
        trace_info = Type.Optional(Type.String),
        usage = Type.Optional(Type.String),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        system_id = Type.Optional(Type.String),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local category = inputs.category
        local name = inputs.name
        local description = inputs.description
        local inputsTypeDef = inputs.inputs_typedef
        local outputsTypeDef = inputs.outputs_typedef
        local executeProxy = inputs.execute
        local tags = inputs.tags or {}
        local exposeToService = inputs.expose_to_service
        if exposeToService == nil then exposeToService = false end
        local traceInfo = inputs.trace_info
        
        local systemId = category .. "." .. name
        
        -- 检查是否已注册
        if System.systems[systemId] then
            return { success = false, error = "System already registered: " .. systemId }
        end
        
        -- 从序列化数据还原 inputs 类型（完整的 Type.Object）
        local inputsSpec = Type.deserialize(inputsTypeDef)
        if not inputsSpec then
            return { success = false, error = "Invalid inputs_typedef: cannot deserialize" }
        end
        if inputsSpec.kind ~= "object" then
            return { success = false, error = "Invalid inputs_typedef: must be Type.Object" }
        end
        
        -- 从序列化数据还原 outputs 类型（完整的 Type.Object）
        local outputsSpec = Type.deserialize(outputsTypeDef)
        if not outputsSpec then
            return { success = false, error = "Invalid outputs_typedef: cannot deserialize" }
        end
        if outputsSpec.kind ~= "object" then
            return { success = false, error = "Invalid outputs_typedef: must be Type.Object" }
        end
        
        -- 创建执行函数包装器（直接调用函数）
        local function executeWrapper(params)
            return executeProxy(params)
        end
        
        local success, result = pcall(function()
            return System:register({
                category = category,
                name = name,
                description = description,
                inputs = inputsSpec,
                outputs = outputsSpec,
                execute = executeWrapper,
                tags = tags,
                expose_to_service = exposeToService,
                trace_info = traceInfo,
            })
        end)
        
        if not success then
            return { success = false, error = tostring(result) }
        end
        
        -- 如果需要暴露为服务，直接注册到 ServiceRegistry
        if exposeToService then
            local serviceName = systemId  -- 使用 systemId 作为服务名
            local system = System.systems[systemId]
            
            -- 收集输入键 (从 Type.Object 的 fields 中获取)
            local inputKeys = {}
            local inputFields = system.inputs and system.inputs.fields or {}
            for key in pairs(inputFields) do
                table.insert(inputKeys, key)
            end
            table.sort(inputKeys)
            
            -- 收集输出键 (从 Type.Object 的 fields 中获取)
            local outputKeys = {}
            local outputFields = system.outputs and system.outputs.fields or {}
            for key in pairs(outputFields) do
                table.insert(outputKeys, key)
            end
            table.sort(outputKeys)
            
            -- 确定服务类型（PURE 或 ACTION）
            local defineFunc = system.kind == "PURE" and Service.definePure or Service.define
            print("[ecs:RegisterSystem] 注册系统为服务: " .. serviceName)
            -- 注册服务（system.inputs/outputs 已经是 Type.Object）
            defineFunc(Service):namespace("ecs.system"):name(serviceName)
                :desc(system.description)
                :usage(inputs.usage or "")
                :inputs(system.inputs)
                :outputs(system.outputs)
                :impl(function(svcInputs)
                    local params = {}
                    for _, key in ipairs(inputKeys) do
                        local value = svcInputs[key]
                        if value ~= nil then
                            params[key] = value
                        end
                    end
                    
                    -- 调用 System 并获取结果
                    local sysResult = System:call(systemId, params)
                    print("[ecs:RegisterSystem] 调用系统 '" .. systemId .. "' 返回结果:", sysResult)
                    if not sysResult then
                        sysResult = { success = false, error = "System returned nil" }
                    end
                    
                    -- 将结果复制到 Service 的 outputs
                    local svcOutputs = {}
                    for _, key in ipairs(outputKeys) do
                        svcOutputs[key] = sysResult[key]
                    end
                    return svcOutputs
                end)
        end
        
        return {
            success = true,
            system_id = systemId,
        }
    end)


    
-- ============================================================================
-- 模块导出
-- ============================================================================

return {
    services = ECS_Services,
}
