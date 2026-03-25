-- systems_new.lua
-- 基于新组件设计的系统实现
-- 
-- 设计原则：
-- - 使用 creature_id 而非 entity_id 进行操作
-- - 自动维护 Registry 注册表的一致性
-- - 所有 ECS 操作通过 Service.call 完成

local ComponentTypes = require("./components")

-- ============ 辅助工具 ============

-- 注册系统的辅助函数
local function registerSystem(spec)
    -- inputs 和 outputs 应该是 Type.Object
    assert(Type.isType(spec.inputs), "inputs must be a Type")
    assert(Type.isType(spec.outputs), "outputs must be a Type")
    assert(spec.inputs.kind == "object", "inputs must be Type.Object")
    assert(spec.outputs.kind == "object", "outputs must be Type.Object")

    print("[ecs:RegisterSystem] 注册系统: " .. spec.name)
    
    -- 直接序列化完整的 Type.Object
    local inputs_typedef = Type.serialize(spec.inputs)
    local outputs_typedef = Type.serialize(spec.outputs)
    
    local exposeToService = spec.expose_to_service ~= false
    
    local result = Service.call("ecs:RegisterSystem", {
        category = spec.category,
        name = spec.name,
        usage = spec.usage or "",
        description = spec.description,
        inputs_typedef = inputs_typedef,
        outputs_typedef = outputs_typedef,
        tags = spec.tags or {},
        execute = spec.execute,
        expose_to_service = exposeToService,
        trace_info = spec.trace_info or nil,
    })
    
    if not result.success then
        error("Failed to register system: " .. (result.error or result._error or "unknown error"))
    end
end

-- 获取世界实体ID（假设只有一个世界实体，拥有 Registry 组件）
local function getWorldEntityId()
    local result = Service.call("ecs:GetEntitiesByComponent", {
        component_keys = {"Registry"}
    })
    
    if result.count > 0 then
        return result.entity_ids[1]
    end
    return nil
end

-- 通过 creature_id 查找实体ID
local function getEntityIdByCreatureId(creatureId)
    local result = Service.call("ecs:GetEntitiesByComponent", {
        component_keys = {"Creature"}
    })
    
    for _, entityId in ipairs(result.entity_ids) do
        local compResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if compResult.found and compResult.data.creature_id == creatureId then
            return entityId
        end
    end
    
    return nil
end

-- 通过 region_id 查找地域实体ID
local function getRegionEntityId(regionId)
    local result = Service.call("ecs:GetEntitiesByComponent", {
        component_keys = {"Region"}
    })
    
    for _, entityId in ipairs(result.entity_ids) do
        local compResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Region"
        })
        
        if compResult.found and compResult.data.region_id == regionId then
            return entityId
        end
    end
    
    return nil
end

-- 通过 organization_id 查找组织实体ID
local function getEntityIdByOrganizationId(organizationId)
    local result = Service.call("ecs:GetEntitiesByComponent", {
        component_keys = {"Organization"}
    })
    
    for _, entityId in ipairs(result.entity_ids) do
        local compResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Organization"
        })
        
        if compResult.found and compResult.data.organization_id == organizationId then
            return entityId
        end
    end
    
    return nil
end




-- 向 lines 中追加 creature_attr_fields 属性字段列表
local function appendAttrFieldsList(lines)
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then return end
    local registryResult = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "Registry"
    })
    if registryResult.found and registryResult.data.creature_attr_fields and #registryResult.data.creature_attr_fields > 0 then
        table.insert(lines, "-- 当前定义的属性字段 (creature_attr_fields):")
        for _, field in ipairs(registryResult.data.creature_attr_fields) do
            table.insert(lines, "--   " .. field.field_name .. ": " .. field.hint)
        end
    end
end


-- 向 lines 中追加已注册的自定义组件列表
local function appendCustomComponentRegistryList(lines)
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then return end
    local registryResult = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "CustomComponentRegistry"
    })
    if registryResult.found and registryResult.data.custom_components and #registryResult.data.custom_components > 0 then
        table.insert(lines, "-- 当前已注册的自定义组件:")
        for _, def in ipairs(registryResult.data.custom_components) do
            local info = "--   " .. def.component_key .. ": " .. def.component_name
            if def.is_array then
                info = info .. " [数组型]"
            else
                info = info .. " [对象型]"
            end
            table.insert(lines, info)
            if def.data_registry and #def.data_registry > 0 then
                table.insert(lines, "--     可用注册项:")
                for _, item in ipairs(def.data_registry) do
                    table.insert(lines, "--       " .. item.item_id)
                end
            end
        end
    end
end

-- ============ 创建类服务 ============

registerSystem({
    category = "Spawn",
    name = "spawnWorld",
    description = "创建世界状态实体，直接传入各组件数据",
    usage = "创建唯一的世界状态实体，包含 GameTime、Registry、DirectorNotes 等组件。所有组件均可选，未传入则使用默认值。世界实体已存在时会返回错误。",
    inputs = Type.Object({
        GameTime = Type.Optional(ComponentTypes.GameTime):desc("游戏时间"),
        Registry = Type.Optional(ComponentTypes.Registry):desc("世界注册表"),
        DirectorNotes = Type.Optional(ComponentTypes.DirectorNotes):desc("导演笔记"),
        CustomComponentRegistry = Type.Optional(ComponentTypes.CustomComponentRegistry):desc("自定义组件注册表"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("绑定设定"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "world"},
    execute = function(params)
        -- 检查是否已存在世界实体
        local existing = getWorldEntityId()
        if existing then
            return {success = false, error = "世界实体已存在"}
        end
        
        -- 默认值
        local gameTime = params.GameTime or { year = 1, month = 1, day = 1, hour = 0, minute = 0 }
        local registry = params.Registry or {
            creature_attr_fields = {},
        }
        local directorNotes = params.DirectorNotes or { notes = {}, flags = {} }
        local customComponentRegistry = params.CustomComponentRegistry or { custom_components = {} }
        local bindSetting = params.BindSetting or { documents = {} }
        
        local result = Service.call("ecs:SpawnEntity", {
            name = "世界",
            desc = "游戏世界状态",
            components = {
                { key = "Metadata", data = { name = "TheWorld", desc = "游戏世界状态实体，存储注册表等信息" } },
                { key = "GameTime", data = gameTime },
                { key = "Registry", data = registry },
                { key = "DirectorNotes", data = directorNotes },
                { key = "CustomComponentRegistry", data = customComponentRegistry },
                { key = "Log", data = { } },
                { key = "BindSetting", data = bindSetting }
            }
        })
        
        return {
            success = result.success,
            entity_id = result.entity_id,
            error = result.error
        }
    end
})

registerSystem({
    category = "Spawn",
    name = "spawnCharacter",
    description = "创建角色实体（NPC或玩家），直接传入组件数据",
    usage = function()
        local lines = {
            "创建角色实体（NPC或玩家）。必须传入 Creature，其余组件可选。",
            "is_player=true 时标记为玩家角色（添加 IsPlayer 组件）。",
            "creature_id 重复时返回错误。attrs 的键应与下方 creature_attr_fields 一致，值可以是数字或字符串。",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        is_player = Type.Optional(Type.Bool):desc("是否为玩家角色"),
        Creature = ComponentTypes.Creature:desc("生物属性"),
        LocationRef = Type.Optional(ComponentTypes.LocationRef):desc("位置引用"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("状态效果列表"),
        Inventory = Type.Optional(ComponentTypes.Inventory):desc("背包"),
        CustomComponents = Type.Optional(ComponentTypes.CustomComponents):desc("自定义组件"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("绑定设定文档"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "character"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在，请先创建世界"}
        end
        
        local creatureAttrs = params.Creature
        local creatureId = creatureAttrs.creature_id
        
        -- 检查 creature_id 是否已存在
        local existing = getEntityIdByCreatureId(creatureId)
        if existing then
            return {success = false, error = "creature_id 已存在: " .. creatureId}
        end
        
        local isPlayer = params.is_player or false
        
        local initialStatusEffects = params.StatusEffects or { status_effects = {} }
        local initialCustomComponents = params.CustomComponents or { custom_components = {} }
        
        -- 构建组件列表
        local components = {
            {
                key = "Metadata",
                data = {
                    name = "Creature:" .. creatureAttrs.name,
                    desc = (isPlayer and "玩家角色" or "NPC角色") .. "Creature ID:" .. creatureId .. "，包含基本属性、状态、位置等信息"
                }
            },
            { key = "Creature", data = creatureAttrs },
            { key = "LocationRef", data = params.LocationRef or { region_id = "", location_id = "" } },
            { key = "StatusEffects", data = initialStatusEffects },
            { key = "Inventory", data = params.Inventory or { items = {} } },
            { key = "Log", data = { entries = {} } },
            { key = "Relationship", data = { relationships = {} } },
            { key = "BindSetting", data = params.BindSetting or { documents = {} } },
            { key = "CustomComponents", data = initialCustomComponents },
        }
        
        if isPlayer then
            table.insert(components, { key = "IsPlayer", data = {} })
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = creatureAttrs.name,
            desc = isPlayer and "玩家角色" or "NPC角色",
            components = components
        })
        
        if not result.success then
            return {success = false, error = result.error}
        end
        
        return { success = true, entity_id = result.entity_id }
    end
})

registerSystem({
    category = "Spawn",
    name = "spawnRegion",
    description = "创建地域实体，直接传入组件数据",
    usage = "创建地域实体。必须传入 Region（含 region_id、locations、paths）。region_id 重复时返回错误。",
    inputs = Type.Object({
        Region = ComponentTypes.Region:desc("地点和路径数据"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("状态效果列表"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("绑定设定"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "region"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在，请先创建世界"}
        end
        
        local locData = params.Region
        local regionId = locData.region_id
        
        -- 检查 region_id 是否已存在
        local existing = getRegionEntityId(regionId)
        if existing then
            return {success = false, error = "region_id 已存在: " .. regionId}
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = regionId,
            desc = "地域实体",
            components = {
                { key = "Metadata", data = { name = locData.region_name, desc = regionId } },
                { key = "Region", data = locData },
                { key = "Log", data = { entries = {} } },
                { key = "StatusEffects", data = params.StatusEffects or { status_effects = {} } },
                { key = "BindSetting", data = params.BindSetting or { documents = {} } }
            }
        })
        
        if not result.success then
            return {success = false, error = result.error}
        end
        
        return { success = true, entity_id = result.entity_id }
    end
})

registerSystem({
    category = "Spawn",
    name = "spawnOrganization",
    description = "创建组织实体，直接传入组件数据",
    usage = "创建组织实体。必须传入 Organization（含 organization_id、name、territories）。organization_id 重复时返回错误。",
    inputs = Type.Object({
        Organization = ComponentTypes.Organization:desc("组织数据"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("状态效果列表"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("绑定设定"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "organization"},
    execute = function(params)
        local orgData = params.Organization
        local organizationId = orgData.organization_id
        
        -- 检查 organization_id 是否已存在
        local existing = getEntityIdByOrganizationId(organizationId)
        if existing then
            return {success = false, error = "organization_id 已存在: " .. organizationId}
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = orgData.name,
            desc = "组织实体",
            components = {
                { key = "Metadata", data = { name = "Organization:" .. orgData.name, desc = "组织实体ID:" .. organizationId .. ", 包含组织信息、状态、库存"} },
                { key = "Organization", data = orgData },
                { key = "StatusEffects", data = params.StatusEffects or { status_effects = {} } },
                { key = "Log", data = { entries = {} } },
                { key = "BindSetting", data = params.BindSetting or { documents = {} } }
            }
        })
        
        if not result.success then
            return {success = false, error = result.error}
        end
        
        return { success = true, entity_id = result.entity_id }
    end
})

-- ============ 查询服务（使用 creature_id） ============

registerSystem({
    category = "Query",
    name = "getCreatureInfo",
    description = "获取生物的基本信息",
    usage = "查询角色的完整 Creature 数据（姓名、外貌、属性、技艺等）。角色不存在时返回 exists=false。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
    }),
    outputs = ComponentTypes.ExistsOutput,
    tags = {"query", "character"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = true, exists = false}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        return {
            success = true,
            exists = true,
            data = result.data
        }
    end
})

registerSystem({
    category = "Query",
    name = "hasItem",
    description = "查询生物是否拥有指定物品",
    usage = "检查角色背包中是否持有指定物品及数量。返回 has_item 和 count。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        item_id = Type.String:desc("物品ID"),
    }),
    outputs = ComponentTypes.ItemQueryOutput,
    tags = {"query", "inventory"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })
        
        if not result.found then
            return {success = true, has_item = false, count = 0}
        end
        
        for _, item in ipairs(result.data.items) do
            if item.id == params.item_id then
                return {success = true, has_item = true, count = item.count}
            end
        end
        
        return {success = true, has_item = false, count = 0}
    end
})


registerSystem({
    category = "Query",
    name = "getAttributeValue",
    description = "查询生物的属性值",
    usage = function()
        local lines = {
            "查询角色的属性值。attr_name 应与 Registry.creature_attr_fields 中定义的 field_name 一致。",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        attr_name = Type.String:desc("属性名，应与 Registry.creature_attr_fields 中定义的 field_name 一致"),
    }),
    outputs = ComponentTypes.AttrValueOutput,
    tags = {"query", "attribute"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not result.found then
            return {success = false, error = "Creature 组件不存在"}
        end
        
        local value = result.data.attrs[params.attr_name]
        if value == nil then
            return {success = true, value = 0}
        end
        
        return {success = true, value = value}
    end
})

registerSystem({
    category = "Query",
    name = "getRelationship",
    description = "查询两个生物之间的关系",
    usage = "查询 source 对 target 的单向关系。返回 has_relationship、name、value。",
    inputs = Type.Object({
        source_creature_id = Type.String:desc("源生物ID"),
        target_creature_id = Type.String:desc("目标生物ID"),
    }),
    outputs = ComponentTypes.RelationshipQueryOutput,
    tags = {"query", "relationship"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.source_creature_id)
        if not entityId then
            return {success = false, error = "源生物不存在: " .. params.source_creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Relationship"
        })
        
        if not result.found then
            return {success = true, has_relationship = false}
        end
        
        for _, rel in ipairs(result.data.relationships) do
            if rel.target_creature_id == params.target_creature_id then
                return {
                    success = true,
                    has_relationship = true,
                    name = rel.name,
                    value = rel.value
                }
            end
        end
        
        return {success = true, has_relationship = false}
    end
})

registerSystem({
    category = "Query",
    name = "getCreatureLocation",
    description = "查询生物的当前位置",
    usage = "查询生物当前所在的 region_id 和 location_id。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
    }),
    outputs = ComponentTypes.LocationQueryOutput,
    tags = {"query", "location"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "LocationRef"
        })
        
        if not result.found then
            return {success = false, error = "LocationRef 组件不存在"}
        end
        
        return {
            success = true,
            region_id = result.data.region_id,
            location_id = result.data.location_id
        }
    end
})

registerSystem({
    category = "Query",
    name = "getPlayerEntity",
    description = "获取玩家实体的完整数据",
    usage = "无需参数，自动查找拥有 IsPlayer 组件的实体，返回其所有组件数据的完整快照。",
    inputs = Type.Object({}),
    outputs = ComponentTypes.PlayerEntityOutput,
    tags = {"query", "player"},
    execute = function(params)
        local result = Service.call("ecs:GetEntitiesByComponent", {
            component_keys = {"IsPlayer"}
        })
        
        if result.count == 0 then
            return {success = true, found = false}
        end
        
        local entityId = result.entity_ids[1]
        local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
        
        if not snapshot.found then
            return {success = true, found = false}
        end
        
        local components = snapshot.components
        return {
            success = true,
            found = true,
            entity_id = entityId,
            Creature = components.Creature,
            IsPlayer = components.IsPlayer,
            LocationRef = components.LocationRef,
            Inventory = components.Inventory,
            StatusEffects = components.StatusEffects,
            Relationship = components.Relationship,
            Log = components.Log,
            CustomComponents = components.CustomComponents,
            BindSetting = components.BindSetting,
        }
    end
})

registerSystem({
    category = "Query",
    name = "getNPCEntities",
    description = "获取所有NPC实体的完整数据",
    usage = "无需参数，返回所有NPC（非 IsPlayer）角色实体的完整组件快照列表。",
    inputs = Type.Object({}),
    outputs = ComponentTypes.NPCEntitiesOutput,
    tags = {"query", "npc"},
    execute = function(params)
        local result = Service.call("ecs:GetEntitiesByComponent", {
            component_keys = {"Creature"}
        })
        
        local npcs = {}
        
        for _, entityId in ipairs(result.entity_ids) do
            local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
            
            if snapshot.found and not snapshot.components.IsPlayer then
                local components = snapshot.components
                table.insert(npcs, {
                    entity_id = entityId,
                    Creature = components.Creature,
                    LocationRef = components.LocationRef,
                    Inventory = components.Inventory,
                    StatusEffects = components.StatusEffects,
                    Relationship = components.Relationship,
                    Log = components.Log,
                    CustomComponents = components.CustomComponents,
                    BindSetting = components.BindSetting,
                })
            end
        end
        
        return {
            success = true,
            entities = npcs,
            count = #npcs
        }
    end
})

registerSystem({
    category = "Query",
    name = "getWorldEntity",
    description = "获取世界状态实体的完整数据",
    usage = "无需参数，返回世界实体的完整快照（GameTime、Registry、DirectorNotes、CustomComponentRegistry、Log）。",
    inputs = Type.Object({}),
    outputs = ComponentTypes.WorldEntityOutput,
    tags = {"query", "world"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        
        if not worldEntityId then
            return { success = true, found = false }
        end
        
        local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = worldEntityId })
        
        if not snapshot.found then
            return { success = true, found = false }
        end
        
        local components = snapshot.components
        return {
            success = true,
            found = true,
            entity_id = worldEntityId,
            GameTime = components.GameTime,
            Registry = components.Registry,
            DirectorNotes = components.DirectorNotes,
            Log = components.Log,
            BindSetting = components.BindSetting,
            CustomComponentRegistry = components.CustomComponentRegistry,
        }
    end
})

registerSystem({
    category = "Query",
    name = "getRegionEntities",
    description = "获取所有地域实体的完整数据",
    usage = "无需参数，返回所有地域实体的快照列表（Metadata、Region、Log）。",
    inputs = Type.Object({}),
    outputs = ComponentTypes.RegionEntitiesOutput,
    tags = {"query", "region"},
    execute = function(params)
        local result = Service.call("ecs:GetEntitiesByComponent", {
            component_keys = {"Region"}
        })
        
        local regions = {}
        
        for _, entityId in ipairs(result.entity_ids) do
            local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
            
            if snapshot.found then
                local components = snapshot.components
                table.insert(regions, {
                    entity_id = entityId,
                    Metadata = components.Metadata,
                    Region = components.Region,
                    Log = components.Log,
                    BindSetting = components.BindSetting,
                })
            end
        end
        
        return {
            success = true,
            regions = regions,
            count = #regions
        }
    end
})

registerSystem({
    category = "Query",
    name = "getOrganizationEntities",
    description = "获取所有组织实体的完整数据",
    usage = "无需参数，返回所有组织实体的快照列表（Organization、Inventory、Log）。",
    inputs = Type.Object({}),
    outputs = ComponentTypes.OrganizationEntitiesOutput,
    tags = {"query", "organization"},
    execute = function(params)
        local result = Service.call("ecs:GetEntitiesByComponent", {
            component_keys = {"Organization"}
        })
        
        local organizations = {}
        
        for _, entityId in ipairs(result.entity_ids) do
            local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
            
            if snapshot.found then
                local components = snapshot.components
                table.insert(organizations, {
                    entity_id = entityId,
                    Organization = components.Organization,
                    Inventory = components.Inventory,
                    Log = components.Log,
                    BindSetting = components.BindSetting,
                })
            end
        end
        
        return {
            success = true,
            organizations = organizations,
            count = #organizations
        }
    end
})

-- ============ 修改服务（自动维护 Registry） ============

registerSystem({
    category = "Modify",
    name = "addItemToCreature",
    description = "给生物添加物品",
    usage = "向角色背包添加物品。必须提供 item_id、item_name、item_description。已有同 ID 物品时增加数量。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        item_id = Type.String:desc("物品ID"),
        count = Type.Optional(Type.Int):desc("数量（默认1）"),
        item_name = Type.String:desc("物品名称"),
        item_description = Type.String:desc("物品描述"),
        item_details = Type.Optional(Type.Array(Type.String)):desc("物品详细说明（可选）"),
        equipped = Type.Optional(Type.Bool):desc("是否已装备（可选）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        new_count = Type.Int,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "inventory"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id, new_count = 0}
        end

        local count = params.count or 1

        -- 添加物品到背包
        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })

        if not invResult.found then
            return {success = false, error = "Inventory 组件不存在", new_count = 0}
        end

        local inventory = invResult.data
        local found = false
        local newCount = 0

        for _, item in ipairs(inventory.items) do
            if item.id == params.item_id then
                item.count = item.count + count
                -- 更新名称、描述和详情（如果提供了新的）
                item.name = params.item_name
                item.description = params.item_description
                if params.item_details then
                    item.details = params.item_details
                end
                if params.equipped ~= nil then
                    item.equipped = params.equipped
                end
                newCount = item.count
                found = true
                break
            end
        end

        if not found then
            table.insert(inventory.items, {
                id = params.item_id,
                count = count,
                name = params.item_name,
                description = params.item_description,
                details = params.item_details or {},
                equipped = params.equipped,
            })
            newCount = count
        end

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Inventory",
            data = inventory,
            merge = false
        })

        return {success = true, new_count = newCount}
    end
})

registerSystem({
    category = "Modify",
    name = "removeItemFromCreature",
    description = "从生物背包移除物品",
    usage = "从角色背包移除指定数量的物品。数量不足时失败。物品数量归零时自动从背包移除。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        item_id = Type.String:desc("物品ID"),
        count = Type.Optional(Type.Int):desc("数量（默认1）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        remaining = Type.Int,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "inventory"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id, remaining = 0}
        end
        
        local count = params.count or 1
        
        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })
        
        if not invResult.found then
            return {success = false, error = "Inventory 组件不存在", remaining = 0}
        end
        
        local inventory = invResult.data
        
        for i, item in ipairs(inventory.items) do
            if item.id == params.item_id then
                if item.count < count then
                    return {success = false, error = "物品数量不足", remaining = item.count}
                end
                
                item.count = item.count - count
                local remaining = item.count
                
                if item.count == 0 then
                    table.remove(inventory.items, i)
                end
                
                Service.call("ecs:SetComponentData", {
                    entity_id = entityId,
                    component_key = "Inventory",
                    data = inventory,
                    merge = false
                })
                
                return {success = true, remaining = remaining}
            end
        end
        
        return {success = false, error = "未持有该物品", remaining = 0}
    end
})

registerSystem({
    category = "Modify",
    name = "updateItemForCreature",
    description = "更新生物背包中已有物品的描述信息",
    usage = "更新角色背包中指定物品的描述、详情或装备状态。只传入需要更新的字段即可，未传入的字段保持不变。物品不存在时返回错误。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        item_id = Type.String:desc("物品ID"),
        item_name = Type.Optional(Type.String):desc("新的物品名称"),
        item_description = Type.Optional(Type.String):desc("新的物品描述"),
        item_details = Type.Optional(Type.Array(Type.String)):desc("新的物品详细说明列表"),
        equipped = Type.Optional(Type.Bool):desc("是否已装备"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        updated = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "inventory"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, updated = false, error = "生物不存在: " .. params.creature_id}
        end

        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })

        if not invResult.found then
            return {success = false, updated = false, error = "Inventory 组件不存在"}
        end

        local inventory = invResult.data

        for _, item in ipairs(inventory.items) do
            if item.id == params.item_id then
                if params.item_name then item.name = params.item_name end
                if params.item_description then item.description = params.item_description end
                if params.item_details then item.details = params.item_details end
                if params.equipped ~= nil then item.equipped = params.equipped end

                Service.call("ecs:SetComponentData", {
                    entity_id = entityId,
                    component_key = "Inventory",
                    data = inventory,
                    merge = false
                })

                return {success = true, updated = true}
            end
        end

        return {success = false, updated = false, error = "未持有该物品: " .. params.item_id}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureAttribute",
    description = "设置生物的属性值",
    usage = function()
        local lines = {
            "直接设置角色的属性值（覆盖）。attribute 应与 Registry.creature_attr_fields 中的 field_name 一致，value 可以是数字或字符串。",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        attribute = Type.String:desc("属性名，应与 Registry.creature_attr_fields 中定义的 field_name 一致"),
        value = Type.Or(Type.Int, Type.String):desc("新的属性值（可以为数字或字符串）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "attribute"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        local attrResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not attrResult.found then
            return {success = false, error = "Creature 组件不存在"}
        end
        
        local attrs = attrResult.data
        
        -- Record 类型允许任意键，直接设置
        attrs.attrs[params.attribute] = params.value
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Creature",
            data = attrs,
            merge = false
        })
        
        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureAppearance",
    description = "设置角色的身体外貌描述",
    usage = "直接覆盖角色的身体/脸部外貌描述文本。用于角色创建、外观变化、剧情需要等场景。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        body = Type.String:desc("身体、脸部等外貌描述"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "未找到生物: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "生物缺少 Creature 组件"}
        end

        local attrs = comp_result.data

        if not attrs.appearance then
            attrs.appearance = {body = "", clothing = ""}
        end

        attrs.appearance.body = params.body

        local update_result = Service.call("ecs:SetComponentData", {
            entity_id = entity_id,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        if not update_result.success then
            return {success = false, error = "更新组件失败: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureClothing",
    description = "设置角色的服装描述",
    usage = "直接覆盖角色的服装描述文本。用于换装、装备外观变化、剧情需要等场景。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        clothing = Type.String:desc("服装描述"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "未找到生物: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "生物缺少 Creature 组件"}
        end

        local attrs = comp_result.data

        if not attrs.appearance then
            attrs.appearance = {body = "", clothing = ""}
        end

        attrs.appearance.clothing = params.clothing

        local update_result = Service.call("ecs:SetComponentData", {
            entity_id = entity_id,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        if not update_result.success then
            return {success = false, error = "更新组件失败: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureProfile",
    description = "设置角色的基础档案信息（性别、种族、情绪状态）",
    usage = "更新角色的基础档案字段。所有参数均为可选，只传入需修改的字段即可。emotion 为自由文本描述当前情绪状态。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        gender = Type.Optional(Type.String):desc("性别描述，如男、女、其他"),
        race = Type.Optional(Type.String):desc("种族描述，如 智人-大和民族，精灵-森林族"),
        emotion = Type.Optional(Type.String):desc("当前情绪状态的描述"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "未找到生物: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "生物缺少 Creature 组件"}
        end

        local attrs = comp_result.data

        if params.gender then attrs.gender = params.gender end
        if params.race then attrs.race = params.race end
        if params.emotion then attrs.emotion = params.emotion end

        local update_result = Service.call("ecs:SetComponentData", {
            entity_id = entity_id,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        if not update_result.success then
            return {success = false, error = "更新组件失败: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setRelationship",
    description = "设置或更新两个生物之间的关系",
    usage = "设置 source 对 target 的关系名称和值。默认单向；is_mutual=true 时双方同时设置。已有关系会被覆盖。",
    inputs = Type.Object({
        source_creature_id = Type.String:desc("源生物ID"),
        target_creature_id = Type.String:desc("目标生物ID"),
        relationship_name = Type.String:desc("关系名称"),
        value = Type.Int:desc("关系值"),
        is_mutual = Type.Optional(Type.Bool):desc("是否设置双向关系（默认false，即单向）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "relationship"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.source_creature_id)
        if not entityId then
            return {success = false, error = "源生物不存在: " .. params.source_creature_id}
        end
        
        -- 设置 source -> target 的关系
        local relResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Relationship"
        })
        
        if not relResult.found then
            return {success = false, error = "Relationship 组件不存在"}
        end
        
        local relationship = relResult.data
        local found = false
        
        for _, rel in ipairs(relationship.relationships) do
            if rel.target_creature_id == params.target_creature_id then
                rel.name = params.relationship_name
                rel.value = params.value
                found = true
                break
            end
        end
        
        if not found then
            table.insert(relationship.relationships, {
                target_creature_id = params.target_creature_id,
                name = params.relationship_name,
                value = params.value
            })
        end
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Relationship",
            data = relationship,
            merge = false
        })
        
        -- 如果是双向关系，同时设置 target -> source 的关系
        if params.is_mutual then
            local targetEntityId = getEntityIdByCreatureId(params.target_creature_id)
            if not targetEntityId then
                return {success = false, error = "目标生物不存在: " .. params.target_creature_id}
            end
            
            local targetRelResult = Service.call("ecs:GetComponentData", {
                entity_id = targetEntityId,
                component_key = "Relationship"
            })
            
            if not targetRelResult.found then
                return {success = false, error = "目标生物的Relationship组件不存在"}
            end
            
            local targetRelationship = targetRelResult.data
            local targetFound = false
            
            for _, rel in ipairs(targetRelationship.relationships) do
                if rel.target_creature_id == params.source_creature_id then
                    rel.name = params.relationship_name
                    rel.value = params.value
                    targetFound = true
                    break
                end
            end
            
            if not targetFound then
                table.insert(targetRelationship.relationships, {
                    target_creature_id = params.source_creature_id,
                    name = params.relationship_name,
                    value = params.value
                })
            end
            
            Service.call("ecs:SetComponentData", {
                entity_id = targetEntityId,
                component_key = "Relationship",
                data = targetRelationship,
                merge = false
            })
        end
        
        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "moveCreature",
    description = "移动生物到新位置",
    usage = "将生物的 LocationRef 更新为指定的 region_id 和 location_id。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        region_id = Type.String:desc("目标地域ID"),
        location_id = Type.String:desc("目标地点ID"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "location"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        -- 验证目标地域和地点存在
        local regionEntityId = getRegionEntityId(params.region_id)
        if not regionEntityId then
            return {success = false, error = "目标地域不存在: " .. params.region_id}
        end

        local locResult = Service.call("ecs:GetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region"
        })

        if locResult.found then
            local locationExists = false
            for _, location in ipairs(locResult.data.locations) do
                if location.id == params.location_id then
                    locationExists = true
                    break
                end
            end
            if not locationExists then
                return {success = false, error = "目标地点不存在: " .. params.location_id .. " (地域: " .. params.region_id .. ")"}
            end
        end

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "LocationRef",
            data = {
                region_id = params.region_id,
                location_id = params.location_id
            },
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureOrganization",
    description = "设置生物所属的组织",
    usage = "设置生物所属的组织。organization_id 为空或不传表示脱离组织。会验证组织是否存在。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        organization_id = Type.Optional(Type.String):desc("组织ID（为空则脱离组织）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "organization"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        -- 如果提供了 organization_id，验证组织是否存在
        if params.organization_id and params.organization_id ~= "" then
            local orgEntityId = getEntityIdByOrganizationId(params.organization_id)
            if not orgEntityId then
                return {success = false, error = "组织不存在: " .. params.organization_id}
            end
        end
        
        local attrResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not attrResult.found then
            return {success = false, error = "Creature 组件不存在"}
        end
        
        local attrs = attrResult.data
        
        -- 设置组织ID（空字符串或nil表示无组织）
        if params.organization_id and params.organization_id ~= "" then
            attrs.organization_id = params.organization_id
        else
            attrs.organization_id = nil
        end
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Creature",
            data = attrs,
            merge = false
        })
        
        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setOrganizationTerritories",
    description = "设置组织拥有的地块",
    usage = "完全替换组织的领土列表（注意是整体替换，不是追加）。",
    inputs = Type.Object({
        organization_id = Type.String:desc("组织ID"),
        territories = Type.Array(Type.Object({
            region_id = Type.String:desc("区域ID"),
            location_id = Type.String:desc("地点ID"),
        })):desc("新的地块列表"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "organization"},
    execute = function(params)
        local entityId = getEntityIdByOrganizationId(params.organization_id)
        if not entityId then
            return {success = false, error = "组织不存在: " .. params.organization_id}
        end
        
        local orgResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Organization"
        })
        
        if not orgResult.found then
            return {success = false, error = "Organization 组件不存在"}
        end
        
        local org = orgResult.data
        org.territories = params.territories
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Organization",
            data = org,
            merge = false
        })
        
        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "addLog",
    description = "为实体添加日志",
    usage = "为实体添加日志条目，自动附加当前世界时间。支持四种目标：creature_id、region_id、organization_id、is_world（四选一）。",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("生物ID（可选，和 region_id 二选一）"),
        region_id = Type.Optional(Type.String):desc("地域ID（可选，和 creature_id 二选一）"),
        organization_id = Type.Optional(Type.String):desc("组织ID（可选）"),
        is_world = Type.Optional(Type.Bool):desc("是否添加到世界实体（可选）"),
        entry = Type.String:desc("日志内容"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        add_at = Type.Optional(Type.String):desc("添加时间"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "log"},
    execute = function(params)
        local entityId = nil
        
        if params.is_world then
            entityId = getWorldEntityId()
            if not entityId then
                return {success = false, error = "世界实体不存在"}
            end
        elseif params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "生物不存在: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "地域不存在: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "组织不存在: " .. params.organization_id}
            end
        else
            return {success = false, error = "必须提供 creature_id、region_id、organization_id 或 is_world"}
        end
        
        local logResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Log"
        })
        
        if not logResult.found then
            return {success = false, error = "Log 组件不存在"}
        end
        
        -- 获取当前世界时间
        local worldEntityId = getWorldEntityId()
        local timeText = "未知时间"
        
        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("%d年%d月%d日 %02d:%02d", 
                    time.year, time.month, time.day, time.hour, time.minute)
            end
        end
        
        local log = logResult.data
        table.insert(log.entries, {
            content = params.entry,
            add_at = timeText
        })
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Log",
            data = log,
            merge = false
        })
        
        return {success = true, add_at = timeText}
    end
})

registerSystem({
    category = "Modify",
    name = "addStatusEffect",
    description = "为实体添加新的状态效果（支持生物、地域、组织）",
    usage = "为实体添加新状态效果。支持生物、地域、组织三种目标（三选一）。instance_id 可手动指定或自动生成。data 为任意对象。只负责添加，更新/删除请用 updateStatusEffect。",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("生物ID（与 region_id、organization_id 三选一）"),
        region_id = Type.Optional(Type.String):desc("地域ID（与 creature_id、organization_id 三选一）"),
        organization_id = Type.Optional(Type.String):desc("组织ID（与 creature_id、region_id 三选一）"),
        instance_id = Type.Optional(Type.String):desc("状态效果实例ID（可选，不提供则自动生成）"),
        display_name = Type.Optional(Type.String):desc("状态效果显示名称，用于在UI中展示"),
        remark = Type.Optional(Type.String):desc("状态备注，描述来源、效果、持续条件等"),
        data = Type.Object({}):desc("状态效果数据，任意对象"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        instance_id = Type.Optional(Type.String):desc("新创建的状态效果实例ID"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- 确定目标实体
        local entityId = nil
        
        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "生物不存在: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "地域不存在: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "组织不存在: " .. params.organization_id}
            end
        else
            return {success = false, error = "必须提供 creature_id、region_id 或 organization_id 之一"}
        end
        
        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })
        
        if not statusResult.found then
            return {success = false, error = "StatusEffects 组件不存在"}
        end
        
        local statusEffects = statusResult.data
        
        -- 生成或使用提供的实例ID
        local finalInstanceId = params.instance_id or ("status_" .. tostring(os.time()) .. tostring(math.random(1000, 9999)))
        
        -- 检查 instance_id 是否已存在
        for _, effect in ipairs(statusEffects.status_effects) do
            if effect.instance_id == finalInstanceId then
                return {success = false, error = "instance_id 已存在: " .. finalInstanceId}
            end
        end
        
        -- 获取当前世界时间
        local timeText = "未知时间"
        local worldEntityId = getWorldEntityId()
        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("%d年%d月%d日 %02d:%02d",
                    time.year, time.month, time.day, time.hour, time.minute)
            end
        end

        -- 添加新实例
        table.insert(statusEffects.status_effects, {
            instance_id = finalInstanceId,
            display_name = params.display_name,
            remark = params.remark,
            data = params.data or {},
            add_at = timeText,
            last_update_at = timeText,
        })
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects",
            data = statusEffects,
            merge = false
        })
        
        return {
            success = true,
            instance_id = finalInstanceId
        }
    end
})

registerSystem({
    category = "Modify",
    name = "updateStatusEffect",
    description = "更新实体的状态效果（支持生物、地域、组织）。若 instance_id 不存在则自动创建。",
    usage = "按 instance_id 更新状态效果的 data（浅合并）、display_name 和 remark。若 instance_id 不存在则自动创建新状态效果（upsert 语义）。目标实体支持生物、地域、组织三选一。删除操作请使用 removeStatusEffect。",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("生物ID（与 region_id、organization_id 三选一）"),
        region_id = Type.Optional(Type.String):desc("地域ID（与 creature_id、organization_id 三选一）"),
        organization_id = Type.Optional(Type.String):desc("组织ID（与 creature_id、region_id 三选一）"),
        instance_id = Type.String:desc("要更新的状态效果实例ID"),
        data = Type.Optional(Type.Object({})):desc("要浅合并到 effect.data 的字段"),
        display_name = Type.Optional(Type.String):desc("更新 effect.display_name"),
        remark = Type.Optional(Type.String):desc("更新 effect.remark"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        updated_count = Type.Optional(Type.Int):desc("实际更新的状态数量"),
        instance_id = Type.Optional(Type.String):desc("自动创建时返回的实例ID"),
        created = Type.Optional(Type.Bool):desc("是否为自动创建（instance_id不存在时兜底创建）"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- 确定目标实体
        local entityId = nil

        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "生物不存在: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "地域不存在: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "组织不存在: " .. params.organization_id}
            end
        else
            return {success = false, error = "必须提供 creature_id、region_id 或 organization_id 之一"}
        end

        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })

        if not statusResult.found then
            return {success = false, error = "StatusEffects 组件不存在"}
        end

        local statusEffects = statusResult.data

        -- 必须提供至少一个更新字段
        if not params.data and not params.display_name and not params.remark then
            return {success = false, error = "必须提供 data、display_name 或 remark 中的至少一个"}
        end

        -- 获取当前世界时间
        local timeText = "未知时间"
        local worldEntityId = getWorldEntityId()
        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("%d年%d月%d日 %02d:%02d",
                    time.year, time.month, time.day, time.hour, time.minute)
            end
        end

        local updatedCount = 0
        for i, effect in ipairs(statusEffects.status_effects) do
            if effect.instance_id == params.instance_id then
                -- 浅合并 data
                if params.data then
                    if not effect.data then effect.data = {} end
                    for k, v in pairs(params.data) do
                        effect.data[k] = v
                    end
                end
                -- 更新 display_name
                if params.display_name then
                    effect.display_name = params.display_name
                end
                -- 更新 remark
                if params.remark then
                    effect.remark = params.remark
                end
                -- 自动更新 last_update_at
                effect.last_update_at = timeText
                statusEffects.status_effects[i] = effect
                updatedCount = updatedCount + 1
                break
            end
        end

        if updatedCount == 0 then
            -- 兜底：instance_id 不存在时自动创建新状态效果
            table.insert(statusEffects.status_effects, {
                instance_id = params.instance_id,
                display_name = params.display_name,
                remark = params.remark,
                data = params.data or {},
                add_at = timeText,
                last_update_at = timeText,
            })
        end

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects",
            data = statusEffects,
            merge = false
        })

        if updatedCount > 0 then
            return {success = true, updated_count = updatedCount}
        else
            return {success = true, updated_count = 0, instance_id = params.instance_id, created = true}
        end
    end
})

registerSystem({
    category = "Modify",
    name = "removeStatusEffect",
    description = "删除实体的状态效果（支持生物、地域、组织）",
    usage = "删除状态效果。支持两种模式：1) 提供 instance_id 删除指定实例；2) remove_all=true 清除所有状态。目标实体支持生物、地域、组织三选一。",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("生物ID（与 region_id、organization_id 三选一）"),
        region_id = Type.Optional(Type.String):desc("地域ID（与 creature_id、organization_id 三选一）"),
        organization_id = Type.Optional(Type.String):desc("组织ID（与 creature_id、region_id 三选一）"),
        instance_id = Type.Optional(Type.String):desc("要删除的状态效果实例ID（与 remove_all 二选一）"),
        remove_all = Type.Optional(Type.Bool):desc("是否删除所有状态效果（与 instance_id 二选一）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        removed_count = Type.Optional(Type.Int):desc("实际移除的状态数量"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- 确定目标实体
        local entityId = nil

        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "生物不存在: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "地域不存在: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "组织不存在: " .. params.organization_id}
            end
        else
            return {success = false, error = "必须提供 creature_id、region_id 或 organization_id 之一"}
        end

        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })

        if not statusResult.found then
            return {success = false, error = "StatusEffects 组件不存在"}
        end

        local statusEffects = statusResult.data

        -- 模式1: 删除所有
        if params.remove_all then
            local removedCount = #statusEffects.status_effects
            statusEffects.status_effects = {}
            if removedCount > 0 then
                Service.call("ecs:SetComponentData", {
                    entity_id = entityId,
                    component_key = "StatusEffects",
                    data = statusEffects,
                    merge = false
                })
            end
            return {success = true, removed_count = removedCount}
        end

        -- 模式2: 按 instance_id 删除
        if not params.instance_id then
            return {success = false, error = "必须提供 instance_id 或 remove_all=true"}
        end

        local removedCount = 0
        for i = #statusEffects.status_effects, 1, -1 do
            if statusEffects.status_effects[i].instance_id == params.instance_id then
                table.remove(statusEffects.status_effects, i)
                removedCount = removedCount + 1
                break
            end
        end

        if removedCount > 0 then
            Service.call("ecs:SetComponentData", {
                entity_id = entityId,
                component_key = "StatusEffects",
                data = statusEffects,
                merge = false
            })
            return {success = true, removed_count = removedCount}
        else
            return {success = false, removed_count = 0, error = "未找到 instance_id: " .. params.instance_id}
        end
    end
})

-- ============ 自定义组件系统 ============

-- 辅助函数：获取角色的 CustomComponents 数据
local function getCustomComponents(entityId)
    local result = Service.call("ecs:GetComponentData", {
        entity_id = entityId,
        component_key = "CustomComponents"
    })
    if not result.found then
        return nil, "CustomComponents 组件不存在"
    end
    return result.data
end

-- 辅助函数：获取世界的 CustomComponentRegistry 中某个组件的定义
local function getCustomComponentDef(componentKey)
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then return nil end
    local result = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "CustomComponentRegistry"
    })
    if not result.found then return nil end
    for _, def in ipairs(result.data.custom_components) do
        if def.component_key == componentKey then
            return def
        end
    end
    return nil
end

-- 辅助函数：从 data_registry 中查找模板数据
local function getRegistryItemData(def, registryItemId)
    if not def or not def.data_registry then return nil end
    for _, item in ipairs(def.data_registry) do
        if item.item_id == registryItemId then
            return item.data
        end
    end
    return nil
end

-- 辅助函数：合并两个表（浅合并）
local function shallowMerge(base, override)
    local merged = {}
    if base then
        for k, v in pairs(base) do merged[k] = v end
    end
    if override then
        for k, v in pairs(override) do merged[k] = v end
    end
    return merged
end

registerSystem({
    category = "Modify",
    name = "setCustomComponent",
    description = "为角色设置自定义组件数据（自动根据 CustomComponentRegistry 中的 is_array 判断：对象型直接覆盖，数组型追加到末尾）",
    usage = function()
        local lines = {
            "为角色设置自定义组件数据。根据 CustomComponentRegistry 中 is_array 自动判断行为：",
            "  对象型(is_array=false): 直接覆盖整个 data",
            "  数组型(is_array=true): 将 data 追加到数组末尾",
            "可选 registry_item_id 从 data_registry 获取基础数据再与 data 合并。",
        }
        appendCustomComponentRegistryList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        component_key = Type.String:desc("自定义组件的key"),
        registry_item_id = Type.Optional(Type.String):desc("可选的注册项ID，用于从 data_registry 获取基础数据"),
        data = Type.Optional(Type.Object({})):desc("要设置或追加的数据（如果有 registry_item_id 则与模板合并）"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "custom_component"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end
        
        local customComponents, err = getCustomComponents(entityId)
        if not customComponents then
            return {success = false, error = err}
        end
        
        -- 从注册表查找该组件是数组型还是对象型
        local def = getCustomComponentDef(params.component_key)
        local isArray = def and def.is_array or false
        
        -- 构建数据（支持 registry_item_id 模板合并）
        local newData = params.data or {}
        if params.registry_item_id and def then
            local templateData = getRegistryItemData(def, params.registry_item_id)
            if templateData then
                newData = shallowMerge(templateData, params.data)
            end
        end
        
        if isArray then
            -- 数组型：追加到末尾
            local targetComp = nil
            local targetIndex = nil
            for i, comp in ipairs(customComponents.custom_components) do
                if comp.component_key == params.component_key then
                    targetComp = comp
                    targetIndex = i
                    break
                end
            end
            
            if not targetComp then
                targetComp = { component_key = params.component_key, data = {} }
                table.insert(customComponents.custom_components, targetComp)
                targetIndex = #customComponents.custom_components
            end
            
            if type(targetComp.data) ~= "table" then
                targetComp.data = {}
            end
            
            table.insert(targetComp.data, newData)
            customComponents.custom_components[targetIndex] = targetComp
        else
            -- 对象型：直接设置/覆盖
            local found = false
            for i, comp in ipairs(customComponents.custom_components) do
                if comp.component_key == params.component_key then
                    customComponents.custom_components[i].data = newData
                    found = true
                    break
                end
            end
            
            if not found then
                table.insert(customComponents.custom_components, {
                    component_key = params.component_key,
                    data = newData
                })
            end
        end
        
        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "CustomComponents",
            data = customComponents,
            merge = false
        })
        
        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "updateCustomComponent",
    description = "声明式更新角色的自定义组件数据（对象型浅合并，数组型按索引更新/删除）",
    usage = function()
        local lines = {
            "声明式更新自定义组件数据：",
            "  对象型: 传入 data 浅合并到现有数据（仅覆盖指定字段）",
            "  数组型: array_index + array_data 更新指定元素（1-based，浅合并），或 array_remove_index 删除元素",
        }
        appendCustomComponentRegistryList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        component_key = Type.String:desc("自定义组件的key"),
        data = Type.Optional(Type.Object({})):desc("对象型组件：要浅合并的字段"),
        array_index = Type.Optional(Type.Int):desc("数组型组件：要更新的元素索引（1-based）"),
        array_data = Type.Optional(Type.Object({})):desc("数组型组件：要浅合并到该元素的数据"),
        array_remove_index = Type.Optional(Type.Int):desc("数组型组件：要删除的元素索引（1-based）"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "custom_component"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        local customComponents, err = getCustomComponents(entityId)
        if not customComponents then
            return {success = false, error = err}
        end

        local found = false
        for i, comp in ipairs(customComponents.custom_components) do
            if comp.component_key == params.component_key then
                found = true

                -- 判断是对象型还是数组型
                local def = getCustomComponentDef(params.component_key)
                local isArray = def and def.is_array or false

                if isArray then
                    -- 数组型：按索引操作
                    if params.array_remove_index then
                        local idx = params.array_remove_index
                        if type(comp.data) == "table" and idx >= 1 and idx <= #comp.data then
                            table.remove(comp.data, idx)
                        else
                            return {success = false, error = "数组索引越界: " .. tostring(idx)}
                        end
                    elseif params.array_index and params.array_data then
                        local idx = params.array_index
                        if type(comp.data) == "table" and idx >= 1 and idx <= #comp.data then
                            -- 浅合并到指定元素
                            if type(comp.data[idx]) == "table" then
                                for k, v in pairs(params.array_data) do
                                    comp.data[idx][k] = v
                                end
                            else
                                comp.data[idx] = params.array_data
                            end
                        else
                            return {success = false, error = "数组索引越界: " .. tostring(idx)}
                        end
                    else
                        return {success = false, error = "数组型组件需要提供 array_index + array_data 或 array_remove_index"}
                    end
                else
                    -- 对象型：浅合并
                    if params.data then
                        if type(comp.data) ~= "table" then comp.data = {} end
                        for k, v in pairs(params.data) do
                            comp.data[k] = v
                        end
                    else
                        return {success = false, error = "对象型组件需要提供 data 参数"}
                    end
                end

                customComponents.custom_components[i] = comp
                break
            end
        end

        if not found then
            return {success = false, error = "未找到自定义组件: " .. params.component_key}
        end

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "CustomComponents",
            data = customComponents,
            merge = false
        })

        return {success = true}
    end
})
-- ============ 称号系统 ============

registerSystem({
    category = "Modify",
    name = "addTitleToCreature",
    description = "给生物添加称号",
    usage = "给角色添加一个称号。已有相同称号时不会重复添加。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        title = Type.String:desc("称号名称"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        already_exists = Type.Optional(Type.Bool),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "title"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature 组件不存在"}
        end

        local attrs = result.data

        -- 检查是否已有该称号
        for _, t in ipairs(attrs.titles or {}) do
            if t == params.title then
                return {success = true, already_exists = true}
            end
        end

        if not attrs.titles then
            attrs.titles = {}
        end
        table.insert(attrs.titles, params.title)

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        return {success = true, already_exists = false}
    end
})

registerSystem({
    category = "Modify",
    name = "removeTitleFromCreature",
    description = "移除生物的称号",
    usage = "移除角色的指定称号。称号不存在时返回错误。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        title = Type.String:desc("称号名称"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "title"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature 组件不存在"}
        end

        local attrs = result.data
        local titles = attrs.titles or {}

        for i, t in ipairs(titles) do
            if t == params.title then
                table.remove(titles, i)
                attrs.titles = titles

                Service.call("ecs:SetComponentData", {
                    entity_id = entityId,
                    component_key = "Creature",
                    data = attrs,
                    merge = false
                })

                return {success = true}
            end
        end

        return {success = false, error = "未拥有该称号: " .. params.title}
    end
})

-- ============ 已知信息 & 目标 ============

registerSystem({
    category = "Modify",
    name = "addKnownInfo",
    description = "给生物添加一条已知信息",
    usage = "给角色添加一条已知信息。已有相同信息时不会重复添加。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        info = Type.String:desc("已知信息内容"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        already_exists = Type.Optional(Type.Bool),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "known_info"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature 组件不存在"}
        end

        local attrs = result.data

        if not attrs.known_infos then
            attrs.known_infos = {}
        end

        -- 检查是否已存在
        for _, v in ipairs(attrs.known_infos) do
            if v == params.info then
                return {success = true, already_exists = true}
            end
        end

        table.insert(attrs.known_infos, params.info)

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        return {success = true, already_exists = false}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureGoal",
    description = "设置生物的当前目标",
    usage = "设置角色的当前目标或意图。传入空字符串或不传则清除目标。",
    inputs = Type.Object({
        creature_id = Type.String:desc("生物ID"),
        goal = Type.Optional(Type.String):desc("目标描述，为空或不传则清除"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "goal"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "生物不存在: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature 组件不存在"}
        end

        local attrs = result.data

        if params.goal and params.goal ~= "" then
            attrs.goal = params.goal
        else
            attrs.goal = nil
        end

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Creature",
            data = attrs,
            merge = false
        })

        return {success = true}
    end
})

-- ============ 时间系统 ============

registerSystem({
    category = "Time",
    name = "advanceTime",
    description = "推进游戏时间",
    usage = "推进指定分钟数的游戏时间，自动处理时/日/月/年进位（每月30天）。返回格式化的时间文本。",
    inputs = Type.Object({
        minutes = Type.Int:desc("推进的分钟数"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        time_text = Type.String,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "time"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在", time_text = ""}
        end
        
        local timeResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime"
        })
        
        if not timeResult.found then
            return {success = false, error = "GameTime 组件不存在", time_text = ""}
        end
        
        local time = timeResult.data
        time.minute = time.minute + params.minutes
        
        while time.minute >= 60 do
            time.minute = time.minute - 60
            time.hour = time.hour + 1
        end
        
        while time.hour >= 24 do
            time.hour = time.hour - 24
            time.day = time.day + 1
        end
        
        -- 简单的月份处理（假设每月30天）
        while time.day > 30 do
            time.day = time.day - 30
            time.month = time.month + 1
        end
        
        while time.month > 12 do
            time.month = time.month - 12
            time.year = time.year + 1
        end
        
        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime",
            data = time,
            merge = false
        })
        
        local timeText = string.format("%d年%d月%d日 %02d:%02d", 
            time.year, time.month, time.day, time.hour, time.minute)
        
        return {success = true, time_text = timeText}
    end
})

registerSystem({
    category = "Query",
    name = "getGameTime",
    description = "获取当前游戏时间",
    usage = "获取当前游戏世界的年月日时分和星期。可用于判断昼夜、季节等。",
    inputs = Type.Object({}),
    outputs = Type.Object({
        success = Type.Bool,
        year = Type.Optional(Type.Int),
        month = Type.Optional(Type.Int),
        day = Type.Optional(Type.Int),
        hour = Type.Optional(Type.Int),
        minute = Type.Optional(Type.Int),
        weekday = Type.Optional(Type.String),
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "time"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在"}
        end
        
        local timeResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime"
        })
        
        if not timeResult.found then
            return {success = false, error = "GameTime 组件不存在"}
        end
        
        local time = timeResult.data
        return {
            success = true,
            year = time.year,
            month = time.month,
            day = time.day,
            hour = time.hour,
            minute = time.minute,
            weekday = time.weekday
        }
    end
})

-- ============ 导演笔记系统 ============

registerSystem({
    category = "DirectorNotes",
    name = "addDirectorNote",
    description = "添加导演笔记",
    usage = "向导演笔记列表末尾添加一条简短总结或剧情走向建议。",
    inputs = Type.Object({
        note = Type.String:desc("笔记内容，简短描述剧情总结或走向建议"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在"}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes 组件不存在"}
        end

        local data = result.data
        table.insert(data.notes, params.note)

        -- 只保留最新 10 条笔记
        if #data.notes > 10 then
            local trimmed = {}
            for i = #data.notes - 9, #data.notes do
                table.insert(trimmed, data.notes[i])
            end
            data.notes = trimmed
        end

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes",
            data = data,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "DirectorNotes",
    name = "removeDirectorNote",
    description = "移除导演笔记",
    usage = "按索引移除一条导演笔记（从1开始）。",
    inputs = Type.Object({
        index = Type.Int:desc("要移除的笔记索引（从1开始）"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在"}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes 组件不存在"}
        end

        local data = result.data
        if params.index < 1 or params.index > #data.notes then
            return {success = false, error = "索引超出范围，当前笔记数量: " .. #data.notes}
        end

        table.remove(data.notes, params.index)

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes",
            data = data,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "DirectorNotes",
    name = "setDirectorFlag",
    description = "设置导演标记",
    usage = "设置或更新一个导演标记（布尔开关），用于记录关键事件是否发生、重要转变是否达成等。",
    inputs = Type.Object({
        flag_id = Type.String:desc("标记名称"),
        value = Type.Bool:desc("标记状态"),
        remark = Type.Optional(Type.String):desc("标记备注，描述标记的含义或触发条件"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在"}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes 组件不存在"}
        end

        local data = result.data

        -- 自动在 remark 中附加世界时间
        local remark = params.remark or ""
        local timeResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime"
        })
        if timeResult.found then
            local gt = timeResult.data
            local timeStr = string.format("Y%d-M%d-D%d %02d:%02d", gt.year, gt.month, gt.day, gt.hour, gt.minute)
            if remark ~= "" then
                remark = remark .. " [" .. timeStr .. "]"
            else
                remark = "[" .. timeStr .. "]"
            end
        end

        data.flags[params.flag_id] = {
            id = params.flag_id,
            value = params.value,
            remark = remark,
        }

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes",
            data = data,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "DirectorNotes",
    name = "getDirectorFlag",
    description = "获取导演标记",
    usage = "查询导演标记的状态。未设置的标记返回 exists=false。",
    inputs = Type.Object({
        flag_id = Type.String:desc("标记名称"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        value = Type.Optional(Type.Bool),
        remark = Type.Optional(Type.String),
        exists = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "director"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在", exists = false}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes 组件不存在", exists = false}
        end

        local data = result.data
        local flag = data.flags[params.flag_id]

        if flag ~= nil then
            return {success = true, value = flag.value, remark = flag.remark, exists = true}
        else
            return {success = true, exists = false}
        end
    end
})

registerSystem({
    category = "DirectorNotes",
    name = "setStageGoal",
    description = "设置或清除当前阶段叙事目标",
    usage = "设置当前游戏阶段的叙事目标和节奏控制。传入 stage_goal 字符串来设置，传入空字符串或不传来清除。",
    inputs = Type.Object({
        stage_goal = Type.Optional(Type.String):desc("阶段叙事目标描述，为空或不传则清除"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = getWorldEntityId()
        if not worldEntityId then
            return {success = false, error = "世界实体不存在"}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes 组件不存在"}
        end

        local data = result.data
        if params.stage_goal and params.stage_goal ~= "" then
            data.stage_goal = params.stage_goal
        else
            data.stage_goal = nil
        end

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes",
            data = data,
            merge = false
        })

        return {success = true}
    end
})

-- ============ 地域管理系统 ============

registerSystem({
    category = "Region",
    name = "addLocationToRegion",
    description = "向地域实体添加一个新地点",
    usage = "向指定地域添加一个新地点。地点ID已存在时返回错误。",
    inputs = Type.Object({
        region_id = Type.String:desc("地域ID"),
        location_id = Type.String:desc("新地点的ID"),
        location_name = Type.String:desc("新地点的名称"),
        location_description = Type.String:desc("新地点的描述"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        added = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "region", "location"},
    execute = function(params)
        local regionEntityId = getRegionEntityId(params.region_id)
        if not regionEntityId then
            return {success = false, added = false, error = "地域不存在: " .. params.region_id}
        end
        
        local locationsResult = Service.call("ecs:GetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region"
        })
        
        if not locationsResult.found then
            return {success = false, added = false, error = "Region 组件不存在"}
        end
        
        local locationsAndPaths = locationsResult.data
        
        -- 检查地点是否已存在
        for _, location in ipairs(locationsAndPaths.locations) do
            if location.id == params.location_id then
                return {success = false, added = false, error = "地点已存在: " .. params.location_id}
            end
        end
        
        -- 构建新地点
        local newLocation = {
            id = params.location_id,
            name = params.location_name,
            description = params.location_description
        }
        
        -- 添加到地点列表
        table.insert(locationsAndPaths.locations, newLocation)
        
        Service.call("ecs:SetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region",
            data = locationsAndPaths,
            merge = false
        })
        
        return {success = true, added = true}
    end
})

registerSystem({
    category = "Region",
    name = "discoverPath",
    description = "发现地域中的一条路径（将 discovered 设为 true）",
    usage = "将地域中指定路径标记为已发现（discovered=true）。通过 to_region + to_location 定位路径。路径不存在时返回错误。",
    inputs = Type.Object({
        region_id = Type.String:desc("地域ID"),
        to_region = Type.String:desc("路径目标地域ID"),
        to_location = Type.String:desc("路径目标地点ID"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        discovered = Type.Bool,
        already_discovered = Type.Optional(Type.Bool):desc("路径是否已经处于发现状态"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "region", "path"},
    execute = function(params)
        local regionEntityId = getRegionEntityId(params.region_id)
        if not regionEntityId then
            return {success = false, discovered = false, error = "地域不存在: " .. params.region_id}
        end

        local locationsResult = Service.call("ecs:GetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region"
        })

        if not locationsResult.found then
            return {success = false, discovered = false, error = "Region 组件不存在"}
        end

        local locationsAndPaths = locationsResult.data

        for _, path in ipairs(locationsAndPaths.paths) do
            if path.to_region == params.to_region and path.to_location == params.to_location then
                if path.discovered then
                    return {success = true, discovered = true, already_discovered = true}
                end

                path.discovered = true

                Service.call("ecs:SetComponentData", {
                    entity_id = regionEntityId,
                    component_key = "Region",
                    data = locationsAndPaths,
                    merge = false
                })

                return {success = true, discovered = true, already_discovered = false}
            end
        end

        -- 如果没有找到匹配的路径, 直接添加一个新路径

        table.insert(locationsAndPaths.paths, {
            to_region = params.to_region,
            to_location = params.to_location,
            discovered = true
        })

        Service.call("ecs:SetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region",
            data = locationsAndPaths,
            merge = false
        })

        return {
            success = true,
            discovered = true,
        }
    end
})

return {}
