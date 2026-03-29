-- systems_new.lua
-- System implementation based on new component design
--
-- Design principles:
-- - Use creature_id instead of entity_id for operations
-- - Auto-maintain Registry consistency
-- - All ECS operations done via Service.call

local ComponentTypes = require("./components")
local RDF = require("./rdf")

-- ============ Utilities ============

-- Helper function for registering systems
local function registerSystem(spec)
    -- inputs and outputs must be Type.Object
    assert(Type.isType(spec.inputs), "inputs must be a Type")
    assert(Type.isType(spec.outputs), "outputs must be a Type")
    assert(spec.inputs.kind == "object", "inputs must be Type.Object")
    assert(spec.outputs.kind == "object", "outputs must be Type.Object")

    print("[ecs:RegisterSystem] Registering system: " .. spec.name)
    
    -- Directly serialize the complete Type.Object
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

-- Get world entity ID (returns subject string "world:default" or nil)
local function getWorldEntityId()
    if RDF.worldExists() then return RDF.worldSubject() end
    return nil
end

--- Get world entity ID, auto-creating a minimal world if it doesn't exist.
--- Use this in services that need a world entity to operate (spawn, modify, etc.)
local function ensureWorldEntityId()
    if RDF.worldExists() then return RDF.worldSubject() end
    -- Auto-create minimal world entity
    RDF.createWorld({
        GameTime = { year = 1, month = 1, day = 1, hour = 8, minute = 0 },
        DirectorNotes = { notes = {}, flags = {} },
        Events = { events = {} },
    })
    return RDF.worldSubject()
end

-- Find entity by creature_id (returns subject string "creature:{id}" or nil)
local function getEntityIdByCreatureId(creatureId)
    if RDF.creatureExists(creatureId) then return RDF.creatureSubject(creatureId) end
    return nil
end

-- Find entity by region_id (returns subject string "region:{id}" or nil)
local function getRegionEntityId(regionId)
    if RDF.regionExists(regionId) then return RDF.regionSubject(regionId) end
    return nil
end

-- Find entity by organization_id (returns subject string "org:{id}" or nil)
local function getEntityIdByOrganizationId(organizationId)
    if RDF.orgExists(organizationId) then return RDF.orgSubject(organizationId) end
    return nil
end




-- Append creature_attr_fields list to lines
local function appendAttrFieldsList(lines)
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then return end
    local registryResult = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "Registry"
    })
    if registryResult.found and registryResult.data.creature_attr_fields and #registryResult.data.creature_attr_fields > 0 then
        table.insert(lines, "-- Currently defined attribute fields (creature_attr_fields):")
        for _, field in ipairs(registryResult.data.creature_attr_fields) do
            table.insert(lines, "--   " .. field.field_name .. ": " .. field.hint)
        end
    end
end


-- Append registered custom components list to lines
local function appendCustomComponentRegistryList(lines)
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then return end
    local registryResult = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "CustomComponentRegistry"
    })
    if registryResult.found and registryResult.data.custom_components and #registryResult.data.custom_components > 0 then
        table.insert(lines, "-- Currently registered custom components:")
        for _, def in ipairs(registryResult.data.custom_components) do
            local info = "--   " .. def.component_key .. ": " .. def.component_name
            if def.is_array then
                info = info .. " [array]"
            else
                info = info .. " [object]"
            end
            table.insert(lines, info)
            if def.data_registry and #def.data_registry > 0 then
                table.insert(lines, "--     Available registry items:")
                for _, item in ipairs(def.data_registry) do
                    table.insert(lines, "--       " .. item.item_id)
                end
            end
        end
    end
end

-- ============ Spawn Services ============

registerSystem({
    category = "Spawn",
    name = "spawnWorld",
    description = "Create world state entity with component data",
    usage = "Create the unique world state entity containing GameTime, Registry, DirectorNotes, etc. All components are optional with defaults. Returns error if world entity already exists.",
    inputs = Type.Object({
        GameTime = Type.Optional(ComponentTypes.GameTime):desc("game time"),
        Registry = Type.Optional(ComponentTypes.Registry):desc("world registry"),
        DirectorNotes = Type.Optional(ComponentTypes.DirectorNotes):desc("director notes"),
        CustomComponentRegistry = Type.Optional(ComponentTypes.CustomComponentRegistry):desc("custom component registry"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("bind settings"),
        Events = Type.Optional(ComponentTypes.Events):desc("plot event data"),
        Interaction = Type.Optional(ComponentTypes.Interaction):desc("interaction options"),
        BaseInteraction = Type.Optional(ComponentTypes.BaseInteraction):desc("base interaction options shared by all entities of each type"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "world"},
    execute = function(params)
        -- Check if world entity already exists
        local existing = getWorldEntityId()
        if existing then
            return {success = false, error = "World entity already exists"}
        end

        -- Default values
        local gameTime = params.GameTime or { year = 1, month = 1, day = 1, hour = 0, minute = 0 }
        local registry = params.Registry or {
            creature_attr_fields = {},
        }
        local directorNotes = params.DirectorNotes or { notes = {}, flags = {} }
        local customComponentRegistry = params.CustomComponentRegistry or { custom_components = {} }
        local bindSetting = params.BindSetting or { documents = {} }

        local result = Service.call("ecs:SpawnEntity", {
            name = "World",
            desc = "Game world state",
            components = {
                { key = "Metadata", data = { name = "TheWorld", desc = "Game world state entity storing registry and other info" } },
                { key = "GameTime", data = gameTime },
                { key = "Registry", data = registry },
                { key = "DirectorNotes", data = directorNotes },
                { key = "CustomComponentRegistry", data = customComponentRegistry },
                { key = "Log", data = { } },
                { key = "BindSetting", data = bindSetting },
                { key = "Events", data = params.Events or { events = {} } },
                { key = "Interaction", data = params.Interaction or { options = {} } },
                { key = "BaseInteraction", data = params.BaseInteraction or { creature_options = {}, region_options = {}, organization_options = {} } }
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
    description = "Create character entity (NPC or player) with component data",
    usage = function()
        local lines = {
            "Create character entity (NPC or player). Creature is required, other components are optional.",
            "Set is_player=true to mark as player character (adds IsPlayer component).",
            "Returns error if creature_id is duplicate. attrs keys should match creature_attr_fields below, values can be numbers or strings.",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        is_player = Type.Optional(Type.Bool):desc("whether this is a player character"),
        Creature = ComponentTypes.Creature:desc("creature attributes"),
        LocationRef = Type.Optional(ComponentTypes.LocationRef):desc("location reference"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("status effects list"),
        Inventory = Type.Optional(ComponentTypes.Inventory):desc("inventory"),
        CustomComponents = Type.Optional(ComponentTypes.CustomComponents):desc("custom components"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("bind settings document"),
        Interaction = Type.Optional(ComponentTypes.Interaction):desc("interaction options"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "character"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()
        
        local creatureAttrs = params.Creature
        local creatureId = creatureAttrs.creature_id
        
        -- Check if creature_id already exists
        local existing = getEntityIdByCreatureId(creatureId)
        if existing then
            return {success = false, error = "creature_id already exists: " .. creatureId}
        end
        
        local isPlayer = params.is_player or false
        
        local initialStatusEffects = params.StatusEffects or { status_effects = {} }
        local initialCustomComponents = params.CustomComponents or { custom_components = {} }
        
        -- Build component list
        local components = {
            {
                key = "Metadata",
                data = {
                    name = "Creature:" .. creatureAttrs.name,
                    desc = (isPlayer and "Player character" or "NPC character") .. " Creature ID:" .. creatureId .. ", contains basic attributes, status, location info"
                }
            },
            { key = "Creature", data = creatureAttrs },
            { key = "LocationRef", data = params.LocationRef or { region_id = "", location_id = "" } },
            { key = "StatusEffects", data = initialStatusEffects },
            { key = "Inventory", data = params.Inventory or { items = {} } },
            { key = "Log", data = { entries = {} } },
            { key = "BindSetting", data = params.BindSetting or { documents = {} } },
            { key = "CustomComponents", data = initialCustomComponents },
            { key = "Interaction", data = params.Interaction or { options = {} } },
        }

        if isPlayer then
            table.insert(components, { key = "IsPlayer", data = {} })
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = creatureAttrs.name,
            desc = isPlayer and "Player character" or "NPC character",
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
    description = "Create region entity with component data",
    usage = "Create region entity. Region (with region_id, locations, paths) is required. Returns error if region_id is duplicate.",
    inputs = Type.Object({
        Region = ComponentTypes.Region:desc("location and path data"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("status effects list"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("bind settings"),
        Interaction = Type.Optional(ComponentTypes.Interaction):desc("interaction options"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "region"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()
        
        local locData = params.Region
        local regionId = locData.region_id
        
        -- Check if region_id already exists
        local existing = getRegionEntityId(regionId)
        if existing then
            return {success = false, error = "region_id already exists: " .. regionId}
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = regionId,
            desc = "Region entity",
            components = {
                { key = "Metadata", data = { name = locData.region_name, desc = regionId } },
                { key = "Region", data = locData },
                { key = "Log", data = { entries = {} } },
                { key = "StatusEffects", data = params.StatusEffects or { status_effects = {} } },
                { key = "BindSetting", data = params.BindSetting or { documents = {} } },
                { key = "Interaction", data = params.Interaction or { options = {} } }
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
    description = "Create organization entity with component data",
    usage = "Create organization entity. Organization (with organization_id, name, territories) is required. Returns error if organization_id is duplicate.",
    inputs = Type.Object({
        Organization = ComponentTypes.Organization:desc("organization data"),
        StatusEffects = Type.Optional(ComponentTypes.StatusEffects):desc("status effects list"),
        BindSetting = Type.Optional(ComponentTypes.BindSetting):desc("bind settings"),
        Interaction = Type.Optional(ComponentTypes.Interaction):desc("interaction options"),
    }),
    outputs = ComponentTypes.BasicOutput,
    tags = {"create", "organization"},
    execute = function(params)
        local orgData = params.Organization
        local organizationId = orgData.organization_id
        
        -- Check if organization_id already exists
        local existing = getEntityIdByOrganizationId(organizationId)
        if existing then
            return {success = false, error = "organization_id already exists: " .. organizationId}
        end
        
        local result = Service.call("ecs:SpawnEntity", {
            name = orgData.name,
            desc = "Organization entity",
            components = {
                { key = "Metadata", data = { name = "Organization:" .. orgData.name, desc = "Organization entity ID:" .. organizationId .. ", contains organization info, status, inventory"} },
                { key = "Organization", data = orgData },
                { key = "StatusEffects", data = params.StatusEffects or { status_effects = {} } },
                { key = "Log", data = { entries = {} } },
                { key = "BindSetting", data = params.BindSetting or { documents = {} } },
                { key = "Interaction", data = params.Interaction or { options = {} } }
            }
        })

        if not result.success then
            return {success = false, error = result.error}
        end

        return { success = true, entity_id = result.entity_id }
    end
})

-- ============ Query Services (using creature_id) ============

registerSystem({
    category = "Query",
    name = "getCreatureInfo",
    description = "Get creature basic info",
    usage = "Query creature's full Creature data (name, appearance, attributes, skills, etc.). Returns exists=false if creature not found.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
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
    description = "Query whether creature has a specific item",
    usage = "Check if creature inventory contains specified item and quantity. Returns has_item and count.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        item_id = Type.String:desc("item ID"),
    }),
    outputs = ComponentTypes.ItemQueryOutput,
    tags = {"query", "inventory"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
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
    description = "Query creature attribute value",
    usage = function()
        local lines = {
            "Query creature attribute value. attr_name should match field_name defined in Registry.creature_attr_fields.",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        attr_name = Type.String:desc("attribute name, should match field_name defined in Registry.creature_attr_fields"),
    }),
    outputs = ComponentTypes.AttrValueOutput,
    tags = {"query", "attribute"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not result.found then
            return {success = false, error = "Creature component not found"}
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
    name = "getCreatureLocation",
    description = "Query creature current location",
    usage = "Query creature's current region_id and location_id.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
    }),
    outputs = ComponentTypes.LocationQueryOutput,
    tags = {"query", "location"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end
        
        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "LocationRef"
        })
        
        if not result.found then
            return {success = false, error = "LocationRef component not found"}
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
    description = "Get player entity full data",
    usage = "No parameters needed. Auto-finds entity with IsPlayer component and returns full component snapshot.",
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
            Log = components.Log,
            CustomComponents = components.CustomComponents,
            BindSetting = components.BindSetting,
            Interaction = components.Interaction,
        }
    end
})

registerSystem({
    category = "Query",
    name = "getNPCEntities",
    description = "Get all NPC entities full data",
    usage = "No parameters needed. Returns full component snapshots of all NPC (non-IsPlayer) character entities.",
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
                    Log = components.Log,
                    CustomComponents = components.CustomComponents,
                    BindSetting = components.BindSetting,
                    Interaction = components.Interaction,
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
    description = "Get world state entity full data",
    usage = "No parameters needed. Returns world entity full snapshot (GameTime, Registry, DirectorNotes, CustomComponentRegistry, Log).",
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
            Events = components.Events,
            Interaction = components.Interaction,
        }
    end
})

registerSystem({
    category = "Query",
    name = "getRegionEntities",
    description = "Get all region entities full data",
    usage = "No parameters needed. Returns snapshot list of all region entities (Metadata, Region, Log).",
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
                    Interaction = components.Interaction,
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
    description = "Get all organization entities full data",
    usage = "No parameters needed. Returns snapshot list of all organization entities (Organization, Inventory, Log).",
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
                    Interaction = components.Interaction,
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

-- ============ Single-Entity Query Services ============

registerSystem({
    category = "Query",
    name = "getCreatureById",
    description = "Get a single creature entity by creature_id",
    usage = "Pass creature_id. Returns full component snapshot of that creature.",
    inputs = Type.Object({ creature_id = Type.String:desc("Creature ID") }),
    outputs = Type.Object({
        success = Type.Bool,
        found = Type.Bool,
        entity = Type.Optional(ComponentTypes.CreatureSnapshot),
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "creature"},
    execute = function(params)
        local entityId = "creature:" .. params.creature_id
        local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
        if not snapshot.found then
            return { success = true, found = false }
        end
        local c = snapshot.components
        return {
            success = true,
            found = true,
            entity = {
                entity_id = entityId,
                Creature = c.Creature,
                IsPlayer = c.IsPlayer,
                LocationRef = c.LocationRef,
                Inventory = c.Inventory,
                StatusEffects = c.StatusEffects,
                Log = c.Log,
                CustomComponents = c.CustomComponents,
                BindSetting = c.BindSetting,
                Interaction = c.Interaction,
            },
        }
    end
})

registerSystem({
    category = "Query",
    name = "getRegionById",
    description = "Get a single region entity by region_id",
    usage = "Pass region_id. Returns full component snapshot of that region.",
    inputs = Type.Object({ region_id = Type.String:desc("Region ID") }),
    outputs = Type.Object({
        success = Type.Bool,
        found = Type.Bool,
        entity = Type.Optional(ComponentTypes.RegionSnapshot),
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "region"},
    execute = function(params)
        local entityId = "region:" .. params.region_id
        local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
        if not snapshot.found then
            return { success = true, found = false }
        end
        local c = snapshot.components
        return {
            success = true,
            found = true,
            entity = {
                entity_id = entityId,
                Metadata = c.Metadata,
                Region = c.Region,
                Log = c.Log,
                BindSetting = c.BindSetting,
                Interaction = c.Interaction,
            },
        }
    end
})

registerSystem({
    category = "Query",
    name = "getOrganizationById",
    description = "Get a single organization entity by organization_id",
    usage = "Pass organization_id. Returns full component snapshot of that organization.",
    inputs = Type.Object({ organization_id = Type.String:desc("Organization ID") }),
    outputs = Type.Object({
        success = Type.Bool,
        found = Type.Bool,
        entity = Type.Optional(ComponentTypes.OrganizationSnapshot),
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "organization"},
    execute = function(params)
        local entityId = "org:" .. params.organization_id
        local snapshot = Service.call("ecs:GetEntitySnapshot", { entity_id = entityId })
        if not snapshot.found then
            return { success = true, found = false }
        end
        local c = snapshot.components
        return {
            success = true,
            found = true,
            entity = {
                entity_id = entityId,
                Organization = c.Organization,
                Inventory = c.Inventory,
                Log = c.Log,
                BindSetting = c.BindSetting,
                Interaction = c.Interaction,
            },
        }
    end
})

-- ============ Interaction Services ============

-- Helper: resolve entity_id from flexible target params
local function resolveInteractionEntityId(params)
    if params.entity_id then
        return params.entity_id
    elseif params.creature_id then
        return getEntityIdByCreatureId(params.creature_id)
    elseif params.region_id then
        return getRegionEntityId(params.region_id)
    elseif params.organization_id then
        return getEntityIdByOrganizationId(params.organization_id)
    elseif params.is_world then
        return ensureWorldEntityId()
    end
    return nil
end

local InteractionTargetInputs = {
    entity_id = Type.Optional(Type.String):desc("直接指定实体ID（如 creature:xxx, region:xxx）"),
    creature_id = Type.Optional(Type.String):desc("通过 creature_id 定位角色实体"),
    region_id = Type.Optional(Type.String):desc("通过 region_id 定位地域实体"),
    organization_id = Type.Optional(Type.String):desc("通过 organization_id 定位组织实体"),
    is_world = Type.Optional(Type.Bool):desc("设为 true 定位世界实体"),
}

registerSystem({
    category = "Modify",
    name = "addInteractionOption",
    description = "Add or update an interaction option on any entity",
    usage = "Add a new interaction option to the entity's Interaction component. If an option with the same id already exists, it will be updated. Provide exactly one target identifier (entity_id, creature_id, region_id, organization_id, or is_world=true). Use memo for mutable data (e.g. shop inventory, prices, state); instruction is static and should not change.",
    inputs = Type.Object({
        entity_id = InteractionTargetInputs.entity_id,
        creature_id = InteractionTargetInputs.creature_id,
        region_id = InteractionTargetInputs.region_id,
        organization_id = InteractionTargetInputs.organization_id,
        is_world = InteractionTargetInputs.is_world,
        option = ComponentTypes.InteractionOption:desc("要添加或更新的交互选项"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "interaction"},
    execute = function(params)
        local entityId = resolveInteractionEntityId(params)
        if not entityId then
            return { success = false, error = "Target entity not found" }
        end

        local compResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Interaction"
        })

        local interaction = (compResult.found and compResult.data) or { options = {} }

        -- Update existing or append
        local found = false
        for i, opt in ipairs(interaction.options) do
            if opt.id == params.option.id then
                interaction.options[i] = params.option
                found = true
                break
            end
        end
        if not found then
            table.insert(interaction.options, params.option)
        end

        local setResult = Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Interaction",
            data = interaction,
            merge = false,
        })

        if not setResult.success then
            return { success = false, error = "Failed to set Interaction: " .. (setResult.error or "") }
        end

        return { success = true }
    end
})

registerSystem({
    category = "Modify",
    name = "removeInteractionOption",
    description = "Remove an interaction option from any entity by option id",
    usage = "Remove the interaction option with the given option_id from the entity's Interaction component. Provide exactly one target identifier (entity_id, creature_id, region_id, organization_id, or is_world=true).",
    inputs = Type.Object({
        entity_id = InteractionTargetInputs.entity_id,
        creature_id = InteractionTargetInputs.creature_id,
        region_id = InteractionTargetInputs.region_id,
        organization_id = InteractionTargetInputs.organization_id,
        is_world = InteractionTargetInputs.is_world,
        option_id = Type.String:desc("要删除的交互选项ID"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "interaction"},
    execute = function(params)
        local entityId = resolveInteractionEntityId(params)
        if not entityId then
            return { success = false, error = "Target entity not found" }
        end

        local compResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Interaction"
        })

        if not compResult.found then
            return { success = false, error = "Entity has no Interaction component" }
        end

        local interaction = compResult.data
        local newOptions = {}
        local removed = false
        for _, opt in ipairs(interaction.options) do
            if opt.id == params.option_id then
                removed = true
            else
                table.insert(newOptions, opt)
            end
        end

        if not removed then
            return { success = false, error = "Option not found: " .. params.option_id }
        end

        interaction.options = newOptions

        local setResult = Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Interaction",
            data = interaction,
            merge = false,
        })

        if not setResult.success then
            return { success = false, error = "Failed to set Interaction: " .. (setResult.error or "") }
        end

        return { success = true }
    end
})

-- ============ Modify Services (auto-maintaining Registry) ============

registerSystem({
    category = "Modify",
    name = "addItemToCreature",
    description = "Add item to creature",
    usage = "Add item to creature inventory. item_id, item_name, item_description are required. Increases count if item with same ID exists.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        item_id = Type.String:desc("item ID"),
        count = Type.Optional(Type.Int):desc("quantity (default 1)"),
        item_name = Type.String:desc("item name"),
        item_description = Type.String:desc("item description"),
        item_details = Type.Optional(Type.Array(Type.String)):desc("item details (optional)"),
        equipped = Type.Optional(Type.Bool):desc("whether equipped (optional)"),
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
            return {success = false, error = "Creature not found: " .. params.creature_id, new_count = 0}
        end

        local count = params.count or 1

        -- Add item to inventory
        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })

        if not invResult.found then
            return {success = false, error = "Inventory component not found", new_count = 0}
        end

        local inventory = invResult.data
        local found = false
        local newCount = 0

        for _, item in ipairs(inventory.items) do
            if item.id == params.item_id then
                item.count = item.count + count
                -- Update name, description and details (if new ones provided)
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
    description = "Remove item from creature inventory",
    usage = "Remove specified quantity of item from creature inventory. Fails if insufficient quantity. Auto-removes item when count reaches zero.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        item_id = Type.String:desc("item ID"),
        count = Type.Optional(Type.Int):desc("quantity (default 1)"),
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
            return {success = false, error = "Creature not found: " .. params.creature_id, remaining = 0}
        end
        
        local count = params.count or 1
        
        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })
        
        if not invResult.found then
            return {success = false, error = "Inventory component not found", remaining = 0}
        end
        
        local inventory = invResult.data
        
        for i, item in ipairs(inventory.items) do
            if item.id == params.item_id then
                if item.count < count then
                    return {success = false, error = "Insufficient item quantity", remaining = item.count}
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
        
        return {success = false, error = "Item not held", remaining = 0}
    end
})

registerSystem({
    category = "Modify",
    name = "updateItemForCreature",
    description = "Update description of existing item in creature inventory",
    usage = "Update description, details or equipped status of item in creature inventory. Only pass fields to update, others remain unchanged. Returns error if item not found.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        item_id = Type.String:desc("item ID"),
        item_name = Type.Optional(Type.String):desc("new item name"),
        item_description = Type.Optional(Type.String):desc("new item description"),
        item_details = Type.Optional(Type.Array(Type.String)):desc("new item details list"),
        equipped = Type.Optional(Type.Bool):desc("whether equipped"),
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
            return {success = false, updated = false, error = "Creature not found: " .. params.creature_id}
        end

        local invResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Inventory"
        })

        if not invResult.found then
            return {success = false, updated = false, error = "Inventory component not found"}
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

        return {success = false, updated = false, error = "Item not held: " .. params.item_id}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureAttribute",
    description = "Set creature attribute value",
    usage = function()
        local lines = {
            "Directly set creature attribute value (overwrite). attribute should match field_name in Registry.creature_attr_fields, value can be number or string.",
        }
        appendAttrFieldsList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        attribute = Type.String:desc("attribute name, should match field_name defined in Registry.creature_attr_fields"),
        value = Type.Or(Type.Int, Type.String):desc("new attribute value (can be number or string)"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "attribute"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end
        
        local attrResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not attrResult.found then
            return {success = false, error = "Creature component not found"}
        end
        
        local attrs = attrResult.data
        
        -- Record type allows arbitrary keys, set directly
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
    description = "Set creature body appearance description",
    usage = "Directly overwrite creature's body/face appearance text. Used for character creation, appearance changes, story needs, etc.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        body = Type.String:desc("body, face appearance description"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "Creature missing Creature component"}
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
            return {success = false, error = "Failed to update component: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureClothing",
    description = "Set creature clothing description",
    usage = "Directly overwrite creature's clothing description text. Used for outfit changes, equipment appearance, story needs, etc.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        clothing = Type.String:desc("clothing description"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "Creature missing Creature component"}
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
            return {success = false, error = "Failed to update component: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "setCreatureProfile",
    description = "Set creature profile info (gender, race, emotion)",
    usage = "Update creature profile fields. All params are optional, only pass fields to modify. emotion is free-text describing current emotional state.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        gender = Type.Optional(Type.String):desc("gender description, e.g. male, female, other"),
        race = Type.Optional(Type.String):desc("race description, e.g. Homo sapiens-Yamato, Elf-Forest"),
        emotion = Type.Optional(Type.String):desc("description of current emotional state"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    execute = function(params)
        local entity_id = getEntityIdByCreatureId(params.creature_id)
        if not entity_id then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local comp_result = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "Creature"
        })

        if not comp_result.found then
            return {success = false, error = "Creature missing Creature component"}
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
            return {success = false, error = "Failed to update component: " .. (update_result.error or update_result._error or "unknown")}
        end

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "moveCreature",
    description = "Move creature to new location",
    usage = "Update creature's LocationRef to specified region_id and location_id.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        region_id = Type.String:desc("target region ID"),
        location_id = Type.String:desc("target location ID"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "location"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        -- Validate target region and location exist
        local regionEntityId = getRegionEntityId(params.region_id)
        if not regionEntityId then
            return {success = false, error = "Target region not found: " .. params.region_id}
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
                return {success = false, error = "Target location not found: " .. params.location_id .. " (region: " .. params.region_id .. ")"}
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
    description = "Set creature's organization",
    usage = "Set creature's organization. Empty or omitted organization_id means leaving organization. Validates organization exists.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        organization_id = Type.Optional(Type.String):desc("organization ID (empty to leave organization)"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "organization"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end
        
        -- If organization_id provided, validate organization exists
        if params.organization_id and params.organization_id ~= "" then
            local orgEntityId = getEntityIdByOrganizationId(params.organization_id)
            if not orgEntityId then
                return {success = false, error = "Organization not found: " .. params.organization_id}
            end
        end
        
        local attrResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })
        
        if not attrResult.found then
            return {success = false, error = "Creature component not found"}
        end
        
        local attrs = attrResult.data
        
        -- Set organization ID (empty string or nil means no organization)
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
    description = "Set organization territories",
    usage = "Fully replace organization's territory list (note: full replacement, not append).",
    inputs = Type.Object({
        organization_id = Type.String:desc("organization ID"),
        territories = Type.Array(Type.Object({
            region_id = Type.String:desc("region ID"),
            location_id = Type.String:desc("location ID"),
        })):desc("new territory list"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "organization"},
    execute = function(params)
        local entityId = getEntityIdByOrganizationId(params.organization_id)
        if not entityId then
            return {success = false, error = "Organization not found: " .. params.organization_id}
        end
        
        local orgResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Organization"
        })
        
        if not orgResult.found then
            return {success = false, error = "Organization component not found"}
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
    description = "Add log entry to entity",
    usage = "Add log entry to entity, auto-appends current world time. Supports four targets: creature_id, region_id, organization_id, is_world (pick one).",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("creature ID (optional, pick one with region_id)"),
        region_id = Type.Optional(Type.String):desc("region ID (optional, pick one with creature_id)"),
        organization_id = Type.Optional(Type.String):desc("organization ID (optional)"),
        is_world = Type.Optional(Type.Bool):desc("whether to add to world entity (optional)"),
        entry = Type.String:desc("log content"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        add_at = Type.Optional(Type.String):desc("add time"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "log"},
    execute = function(params)
        local entityId = nil
        
        if params.is_world then
            entityId = ensureWorldEntityId()
        elseif params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "Creature not found: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "Region not found: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "Organization not found: " .. params.organization_id}
            end
        else
            return {success = false, error = "Must provide one of creature_id, region_id, organization_id, or is_world"}
        end
        
        local logResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Log"
        })
        
        if not logResult.found then
            return {success = false, error = "Log component not found"}
        end
        
        -- Get current world time
        local worldEntityId = getWorldEntityId()
        local timeText = "Unknown time"

        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("Y%d-M%d-D%d %02d:%02d", 
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
    name = "deleteLog",
    description = "Soft-delete entity log entry (mark as [deleted] without removal to avoid index shift)",
    usage = "Mark entity log entry at specified index as [deleted]. Index starts from 1, corresponds to [IDX=N] in GetGameEntityOverview [Log].",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("creature ID (optional, pick one of four)"),
        region_id = Type.Optional(Type.String):desc("region ID (optional, pick one of four)"),
        organization_id = Type.Optional(Type.String):desc("organization ID (optional, pick one of four)"),
        is_world = Type.Optional(Type.Bool):desc("whether world entity (optional, pick one of four)"),
        index = Type.Int:desc("log entry index (1-based, corresponds to [IDX=N])"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "log"},
    execute = function(params)
        local entityId = nil

        if params.is_world then
            entityId = ensureWorldEntityId()
        elseif params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then return {success = false, error = "Creature not found: " .. params.creature_id} end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then return {success = false, error = "Region not found: " .. params.region_id} end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then return {success = false, error = "Organization not found: " .. params.organization_id} end
        else
            return {success = false, error = "Must provide one of creature_id, region_id, organization_id, or is_world"}
        end

        local logResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Log"
        })

        if not logResult.found then
            return {success = false, error = "Log component not found"}
        end

        local log = logResult.data
        if not log.entries or params.index < 1 or params.index > #log.entries then
            return {success = false, error = string.format("Index %d out of range (total %d entries)", params.index, log.entries and #log.entries or 0)}
        end

        log.entries[params.index].content = "[deleted]"

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "Log",
            data = log,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "Modify",
    name = "addStatusEffect",
    description = "Add new status effect to entity (supports creature, region, organization)",
    usage = "Add new status effect to entity. Supports creature, region, organization (pick one). instance_id can be specified or auto-generated. data is any object. Only adds; use updateStatusEffect for update/delete.",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("creature ID (pick one of creature_id, region_id, organization_id)"),
        region_id = Type.Optional(Type.String):desc("region ID (pick one of creature_id, region_id, organization_id)"),
        organization_id = Type.Optional(Type.String):desc("organization ID (pick one of creature_id, region_id, organization_id)"),
        instance_id = Type.Optional(Type.String):desc("status effect instance ID (optional, auto-generated if omitted)"),
        display_name = Type.Optional(Type.String):desc("status effect display name for UI"),
        remark = Type.Optional(Type.String):desc("status remark describing source, effect, duration conditions, etc."),
        data = Type.Object({}):desc("status effect data, any object"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        instance_id = Type.Optional(Type.String):desc("newly created status effect instance ID"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- Determine target entity
        local entityId = nil

        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "Creature not found: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "Region not found: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "Organization not found: " .. params.organization_id}
            end
        else
            return {success = false, error = "Must provide one of creature_id, region_id, or organization_id"}
        end
        
        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })
        
        if not statusResult.found then
            return {success = false, error = "StatusEffects component not found"}
        end
        
        local statusEffects = statusResult.data
        
        -- Generate or use provided instance ID
        local finalInstanceId = params.instance_id or ("status_" .. tostring(os.time()) .. tostring(math.random(1000, 9999)))
        
        -- Check if instance_id already exists
        for _, effect in ipairs(statusEffects.status_effects) do
            if effect.instance_id == finalInstanceId then
                return {success = false, error = "instance_id already exists: " .. finalInstanceId}
            end
        end
        
        -- Get current world time
        local timeText = "Unknown time"
        local worldEntityId = getWorldEntityId()
        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("Y%d-M%d-D%d %02d:%02d",
                    time.year, time.month, time.day, time.hour, time.minute)
            end
        end

        -- Add new instance
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
    description = "Update entity status effect (supports creature, region, organization). Auto-creates if instance_id not found.",
    usage = "Update status effect data (shallow merge), display_name and remark by instance_id. Auto-creates if instance_id not found (upsert). Target supports creature, region, organization (pick one). Use removeStatusEffect to delete.",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("creature ID (pick one of creature_id, region_id, organization_id)"),
        region_id = Type.Optional(Type.String):desc("region ID (pick one of creature_id, region_id, organization_id)"),
        organization_id = Type.Optional(Type.String):desc("organization ID (pick one of creature_id, region_id, organization_id)"),
        instance_id = Type.String:desc("status effect instance ID to update"),
        data = Type.Optional(Type.Object({})):desc("fields to shallow merge into effect.data"),
        display_name = Type.Optional(Type.String):desc("update effect.display_name"),
        remark = Type.Optional(Type.String):desc("update effect.remark"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        updated_count = Type.Optional(Type.Int):desc("actual number of statuses updated"),
        instance_id = Type.Optional(Type.String):desc("instance ID returned on auto-creation"),
        created = Type.Optional(Type.Bool):desc("whether auto-created (fallback when instance_id not found)"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- Determine target entity
        local entityId = nil

        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "Creature not found: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "Region not found: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "Organization not found: " .. params.organization_id}
            end
        else
            return {success = false, error = "Must provide one of creature_id, region_id, or organization_id"}
        end

        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })

        if not statusResult.found then
            return {success = false, error = "StatusEffects component not found"}
        end

        local statusEffects = statusResult.data

        -- Must provide at least one update field
        if not params.data and not params.display_name and not params.remark then
            return {success = false, error = "Must provide at least one of data, display_name, or remark"}
        end

        -- Get current world time
        local timeText = "Unknown time"
        local worldEntityId = getWorldEntityId()
        if worldEntityId then
            local timeResult = Service.call("ecs:GetComponentData", {
                entity_id = worldEntityId,
                component_key = "GameTime"
            })
            if timeResult.found then
                local time = timeResult.data
                timeText = string.format("Y%d-M%d-D%d %02d:%02d",
                    time.year, time.month, time.day, time.hour, time.minute)
            end
        end

        local updatedCount = 0
        for i, effect in ipairs(statusEffects.status_effects) do
            if effect.instance_id == params.instance_id then
                -- Shallow merge data
                if params.data then
                    if not effect.data then effect.data = {} end
                    for k, v in pairs(params.data) do
                        effect.data[k] = v
                    end
                end
                -- Update display_name
                if params.display_name then
                    effect.display_name = params.display_name
                end
                -- Update remark
                if params.remark then
                    effect.remark = params.remark
                end
                -- Auto update last_update_at
                effect.last_update_at = timeText
                statusEffects.status_effects[i] = effect
                updatedCount = updatedCount + 1
                break
            end
        end

        if updatedCount == 0 then
            -- Fallback: auto-create new status effect when instance_id not found
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
    description = "Remove entity status effect (supports creature, region, organization)",
    usage = "Delete status effect. Two modes: 1) provide instance_id to delete specific instance; 2) remove_all=true to clear all. Target supports creature, region, organization (pick one).",
    inputs = Type.Object({
        creature_id = Type.Optional(Type.String):desc("creature ID (pick one of creature_id, region_id, organization_id)"),
        region_id = Type.Optional(Type.String):desc("region ID (pick one of creature_id, region_id, organization_id)"),
        organization_id = Type.Optional(Type.String):desc("organization ID (pick one of creature_id, region_id, organization_id)"),
        instance_id = Type.Optional(Type.String):desc("status effect instance ID to delete (pick one with remove_all)"),
        remove_all = Type.Optional(Type.Bool):desc("whether to delete all status effects (pick one with instance_id)"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        removed_count = Type.Optional(Type.Int):desc("actual number of statuses removed"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "status"},
    execute = function(params)
        -- Determine target entity
        local entityId = nil

        if params.creature_id then
            entityId = getEntityIdByCreatureId(params.creature_id)
            if not entityId then
                return {success = false, error = "Creature not found: " .. params.creature_id}
            end
        elseif params.region_id then
            entityId = getRegionEntityId(params.region_id)
            if not entityId then
                return {success = false, error = "Region not found: " .. params.region_id}
            end
        elseif params.organization_id then
            entityId = getEntityIdByOrganizationId(params.organization_id)
            if not entityId then
                return {success = false, error = "Organization not found: " .. params.organization_id}
            end
        else
            return {success = false, error = "Must provide one of creature_id, region_id, or organization_id"}
        end

        local statusResult = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "StatusEffects"
        })

        if not statusResult.found then
            return {success = false, error = "StatusEffects component not found"}
        end

        local statusEffects = statusResult.data

        -- Mode 1: Remove all
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

        -- Mode 2: Remove by instance_id
        if not params.instance_id then
            return {success = false, error = "Must provide instance_id or remove_all=true"}
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
            return {success = false, removed_count = 0, error = "instance_id not found: " .. params.instance_id}
        end
    end
})

-- ============ Custom Component System ============

-- Helper: get creature's CustomComponents data
local function getCustomComponents(entityId)
    local result = Service.call("ecs:GetComponentData", {
        entity_id = entityId,
        component_key = "CustomComponents"
    })
    if not result.found then
        return nil, "CustomComponents component not found"
    end
    return result.data
end

-- Helper: get component definition from world's CustomComponentRegistry
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

-- Helper: find template data from data_registry
local function getRegistryItemData(def, registryItemId)
    if not def or not def.data_registry then return nil end
    for _, item in ipairs(def.data_registry) do
        if item.item_id == registryItemId then
            return item.data
        end
    end
    return nil
end

-- Helper: merge two tables (shallow merge)
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
    description = "Set custom component data for creature (auto-detects array/object type from CustomComponentRegistry: object overwrites, array appends)",
    usage = function()
        local lines = {
            "Set custom component data for creature. Auto-detects behavior based on is_array in CustomComponentRegistry:",
            "  Object type (is_array=false): overwrites entire data",
            "  Array type (is_array=true): appends data to end of array",
            "Optional registry_item_id to fetch base data from data_registry and merge with data.",
        }
        appendCustomComponentRegistryList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        component_key = Type.String:desc("custom component key"),
        registry_item_id = Type.Optional(Type.String):desc("optional registry item ID for fetching base data from data_registry"),
        data = Type.Optional(Type.Object({})):desc("data to set or append (merged with template if registry_item_id provided)"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "custom_component"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: '" .. params.creature_id .. "'. Spawn the creature first via ecs.system:Spawn.spawnCharacter."}
        end

        local customComponents, err = getCustomComponents(entityId)
        if not customComponents then
            return {success = false, error = err}
        end

        -- Look up whether this component is array or object type from registry
        local def = getCustomComponentDef(params.component_key)
        if not def then
            return {success = false, error = "component_key '" .. params.component_key .. "' not found in CustomComponentRegistry. Check the World entity's CustomComponentRegistry for available keys."}
        end
        local isArray = def.is_array or false

        -- Build data (supports registry_item_id template merging)
        local newData = params.data or {}
        if params.registry_item_id then
            local templateData = getRegistryItemData(def, params.registry_item_id)
            if templateData then
                newData = shallowMerge(templateData, params.data)
            else
                return {success = false, error = "registry_item_id '" .. params.registry_item_id .. "' not found in data_registry of component '" .. params.component_key .. "'."}
            end
        end

        if isArray then
            -- Array type: append to end
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
            -- Object type: set/overwrite directly
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
    description = "Declaratively update creature custom component data (object: shallow merge, array: update/delete by index)",
    usage = function()
        local lines = {
            "Declaratively update custom component data:",
            "  Object type: pass data to shallow merge into existing data (only overwrites specified fields)",
            "  Array type: array_index + array_data to update element (1-based, shallow merge), or array_remove_index to delete element, or pass data only to append new element",
        }
        appendCustomComponentRegistryList(lines)
        return table.concat(lines, "\n")
    end,
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        component_key = Type.String:desc("custom component key"),
        data = Type.Optional(Type.Object({})):desc("object component: fields to shallow merge"),
        array_index = Type.Optional(Type.Int):desc("array component: element index to update (1-based)"),
        array_data = Type.Optional(Type.Object({})):desc("array component: data to shallow merge into element"),
        array_remove_index = Type.Optional(Type.Int):desc("array component: element index to delete (1-based)"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "custom_component"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: '" .. params.creature_id .. "'. Spawn the creature first via ecs.system:Spawn.spawnCharacter."}
        end

        local customComponents, err = getCustomComponents(entityId)
        if not customComponents then
            return {success = false, error = err}
        end

        -- Pre-query registry definition
        local def = getCustomComponentDef(params.component_key)
        if not def then
            return {success = false, error = "component_key '" .. params.component_key .. "' not found in CustomComponentRegistry. Check the World entity's CustomComponentRegistry for available keys."}
        end
        local isArray = def.is_array or false

        -- Find existing component
        local found = false
        local foundIndex = nil
        for i, comp in ipairs(customComponents.custom_components) do
            if comp.component_key == params.component_key then
                found = true
                foundIndex = i
                break
            end
        end

        -- Auto-create when component doesn't exist (upsert semantics)
        if not found then
            if isArray then
                if params.data then
                    -- Array type + data: create component and append first element
                    table.insert(customComponents.custom_components, {
                        component_key = params.component_key,
                        data = { params.data }
                    })
                elseif params.array_remove_index then
                    -- Attempting to delete from non-existent component, silent success
                    return {success = true, created = false}
                else
                    return {success = false, error = "Array component '" .. params.component_key .. "' does not exist on creature '" .. params.creature_id .. "' yet. Use data={...} to create it with the first element, or use setCustomComponent."}
                end
            else
                if params.data then
                    -- Object type + data: create component
                    table.insert(customComponents.custom_components, {
                        component_key = params.component_key,
                        data = params.data
                    })
                else
                    return {success = false, error = "Object component '" .. params.component_key .. "' does not exist on creature '" .. params.creature_id .. "'. Provide data={...} to create it, or use setCustomComponent."}
                end
            end

            Service.call("ecs:SetComponentData", {
                entity_id = entityId,
                component_key = "CustomComponents",
                data = customComponents,
                merge = false
            })
            return {success = true, created = true}
        end

        -- Component exists, perform update
        local comp = customComponents.custom_components[foundIndex]

        if isArray then
            local arrLen = type(comp.data) == "table" and #comp.data or 0
            -- Array type: operate by index, or append
            if params.array_remove_index then
                local idx = params.array_remove_index
                if type(comp.data) == "table" and idx >= 1 and idx <= #comp.data then
                    table.remove(comp.data, idx)
                else
                    return {success = false, error = "Array index out of bounds: index=" .. tostring(idx) .. ", but array '" .. params.component_key .. "' has " .. arrLen .. " elements (valid: 1-" .. arrLen .. "). Use a valid index or check the array contents in ECS data."}
                end
            elseif params.array_index and params.array_data then
                local idx = params.array_index
                if type(comp.data) == "table" and idx >= 1 and idx <= #comp.data then
                    -- Shallow merge to specified element
                    if type(comp.data[idx]) == "table" then
                        for k, v in pairs(params.array_data) do
                            comp.data[idx][k] = v
                        end
                    else
                        comp.data[idx] = params.array_data
                    end
                else
                    return {success = false, error = "Array index out of bounds: index=" .. tostring(idx) .. ", but array '" .. params.component_key .. "' has " .. arrLen .. " elements (valid: 1-" .. arrLen .. "). To append a new element, use data={...} without array_index."}
                end
            elseif params.data then
                -- Only data passed (no array_index): append to array end
                if type(comp.data) ~= "table" then comp.data = {} end
                table.insert(comp.data, params.data)
            else
                return {success = false, error = "Array component '" .. params.component_key .. "' requires one of: (1) data={...} to append, (2) array_index+array_data to update element, (3) array_remove_index to delete element."}
            end
        else
            -- Object type: shallow merge
            if params.data then
                if type(comp.data) ~= "table" then comp.data = {} end
                for k, v in pairs(params.data) do
                    comp.data[k] = v
                end
            else
                return {success = false, error = "Object component '" .. params.component_key .. "' requires data={...} for shallow merge."}
            end
        end

        customComponents.custom_components[foundIndex] = comp

        Service.call("ecs:SetComponentData", {
            entity_id = entityId,
            component_key = "CustomComponents",
            data = customComponents,
            merge = false
        })

        return {success = true}
    end
})
-- ============ Title System ============

registerSystem({
    category = "Modify",
    name = "addTitleToCreature",
    description = "Add title to creature",
    usage = "Add a title to creature. Won't duplicate if title already exists.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        title = Type.String:desc("title name"),
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
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature component not found"}
        end

        local attrs = result.data

        -- Check if title already exists
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
    description = "Remove title from creature",
    usage = "Remove specified title from creature. Returns error if title not found.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        title = Type.String:desc("title name"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "title"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature component not found"}
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

        return {success = false, error = "Title not held: " .. params.title}
    end
})

-- ============ Known Info & Goals ============

registerSystem({
    category = "Modify",
    name = "addKnownInfo",
    description = "Add known info to creature",
    usage = "Add known info to creature. Won't duplicate if same info already exists.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        info = Type.String:desc("known info content"),
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
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature component not found"}
        end

        local attrs = result.data

        if not attrs.known_infos then
            attrs.known_infos = {}
        end

        -- Check if already exists
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
    name = "deleteKnownInfo",
    description = "Soft-delete creature known info (mark as [deleted] without removal to avoid index shift)",
    usage = "Mark creature known info at specified index as [deleted]. Index starts from 1, corresponds to [IDX=N] in GetGameEntityOverview known_infos.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        index = Type.Int:desc("known info index (1-based, corresponds to [IDX=N])"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "known_info"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature component not found"}
        end

        local attrs = result.data
        if not attrs.known_infos or params.index < 1 or params.index > #attrs.known_infos then
            return {success = false, error = string.format("Index %d out of range (total %d entries)", params.index, attrs.known_infos and #attrs.known_infos or 0)}
        end

        attrs.known_infos[params.index] = "[deleted]"

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
    name = "setCreatureGoal",
    description = "Set creature current goal",
    usage = "Set creature's current goal or intent. Pass empty string or omit to clear goal.",
    inputs = Type.Object({
        creature_id = Type.String:desc("creature ID"),
        goal = Type.Optional(Type.String):desc("goal description, empty or omit to clear"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "goal"},
    execute = function(params)
        local entityId = getEntityIdByCreatureId(params.creature_id)
        if not entityId then
            return {success = false, error = "Creature not found: " .. params.creature_id}
        end

        local result = Service.call("ecs:GetComponentData", {
            entity_id = entityId,
            component_key = "Creature"
        })

        if not result.found then
            return {success = false, error = "Creature component not found"}
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

-- ============ Time System ============

registerSystem({
    category = "Time",
    name = "advanceTime",
    description = "Advance game time",
    usage = "Advance game time by specified minutes, auto-handles hour/day/month/year carry (30 days per month). Returns formatted time text.",
    inputs = Type.Object({
        minutes = Type.Int:desc("minutes to advance"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        time_text = Type.String,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "time"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()
        
        local timeResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime"
        })
        
        if not timeResult.found then
            return {success = false, error = "GameTime component not found", time_text = ""}
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
        
        -- Simple month handling (assuming 30 days per month)
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
        
        local timeText = string.format("Y%d-M%d-D%d %02d:%02d", 
            time.year, time.month, time.day, time.hour, time.minute)
        
        return {success = true, time_text = timeText}
    end
})

registerSystem({
    category = "Query",
    name = "getGameTime",
    description = "Get current game time",
    usage = "Get current game world year/month/day/hour/minute and weekday. Can be used to determine day/night, season, etc.",
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
        local worldEntityId = ensureWorldEntityId()
        
        local timeResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "GameTime"
        })
        
        if not timeResult.found then
            return {success = false, error = "GameTime component not found"}
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

-- ============ Director Notes System ============

registerSystem({
    category = "DirectorNotes",
    name = "addDirectorNote",
    description = "Add director note",
    usage = "Add a brief summary or plot direction suggestion to the end of director notes.",
    inputs = Type.Object({
        note = Type.String:desc("note content, brief plot summary or direction suggestion"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes component not found"}
        end

        local data = result.data
        table.insert(data.notes, params.note)

        -- Keep only the latest 10 notes
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
    description = "Remove director note",
    usage = "Remove a director note by index (1-based).",
    inputs = Type.Object({
        index = Type.Int:desc("note index to remove (1-based)"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes component not found"}
        end

        local data = result.data
        if params.index < 1 or params.index > #data.notes then
            return {success = false, error = "Index out of range, current note count: " .. #data.notes}
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
    description = "Set director flag",
    usage = "Set or update a director flag (boolean toggle), used to record whether key events occurred, important transitions achieved, etc.",
    inputs = Type.Object({
        flag_id = Type.String:desc("flag name"),
        value = Type.Bool:desc("flag state"),
        remark = Type.Optional(Type.String):desc("flag remark describing meaning or trigger conditions"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes component not found"}
        end

        local data = result.data

        -- Auto-append world time to remark
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
    description = "Get director flag",
    usage = "Query director flag status. Returns exists=false for unset flags.",
    inputs = Type.Object({
        flag_id = Type.String:desc("flag name"),
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
        local worldEntityId = ensureWorldEntityId()

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes component not found", exists = false}
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
    description = "Set or clear current stage narrative goal",
    usage = "Set narrative goal and pacing control for current game stage. Pass stage_goal string to set, empty string or omit to clear.",
    inputs = Type.Object({
        stage_goal = Type.Optional(Type.String):desc("stage narrative goal description, empty or omit to clear"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "director"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local result = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "DirectorNotes"
        })

        if not result.found then
            return {success = false, error = "DirectorNotes component not found"}
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

-- ============ Region Management System ============

registerSystem({
    category = "Region",
    name = "addLocationToRegion",
    description = "Add new location to region entity",
    usage = "Add a new location to specified region. Returns error if location ID already exists.",
    inputs = Type.Object({
        region_id = Type.String:desc("region ID"),
        location_id = Type.String:desc("new location ID"),
        location_name = Type.String:desc("new location name"),
        location_description = Type.String:desc("new location description"),
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
            return {success = false, added = false, error = "Region not found: " .. params.region_id}
        end
        
        local locationsResult = Service.call("ecs:GetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region"
        })
        
        if not locationsResult.found then
            return {success = false, added = false, error = "Region component not found"}
        end
        
        local locationsAndPaths = locationsResult.data
        
        -- Check if location already exists
        for _, location in ipairs(locationsAndPaths.locations) do
            if location.id == params.location_id then
                return {success = false, added = false, error = "Location already exists: " .. params.location_id}
            end
        end
        
        -- Build new location
        local newLocation = {
            id = params.location_id,
            name = params.location_name,
            description = params.location_description
        }
        
        -- Add to location list
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
    description = "Discover a path in region (set discovered to true)",
    usage = "Mark specified path in region as discovered (discovered=true). Located by to_region + to_location. Returns error if path not found.",
    inputs = Type.Object({
        region_id = Type.String:desc("region ID"),
        to_region = Type.String:desc("path target region ID"),
        to_location = Type.String:desc("path target location ID"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        discovered = Type.Bool,
        already_discovered = Type.Optional(Type.Bool):desc("whether path is already discovered"),
        error = Type.Optional(Type.String),
    }),
    tags = {"modify", "region", "path"},
    execute = function(params)
        local regionEntityId = getRegionEntityId(params.region_id)
        if not regionEntityId then
            return {success = false, discovered = false, error = "Region not found: " .. params.region_id}
        end

        local locationsResult = Service.call("ecs:GetComponentData", {
            entity_id = regionEntityId,
            component_key = "Region"
        })

        if not locationsResult.found then
            return {success = false, discovered = false, error = "Region component not found"}
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

        -- If no matching path found, add a new path directly

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

-- ============ Plot Events System ============

-- Helper: get formatted string of current game time
local function getFormattedGameTime()
    return RDF.getFormattedGameTime()
end

registerSystem({
    category = "Events",
    name = "createEvent",
    description = "Create a new plot event",
    usage = "Add a new plot event to world entity's Events component. event_id must be unique. Auto-uses current game time if created_at not provided.",
    inputs = Type.Object({
        event_id = Type.String:desc("event unique ID, naming convention: YYYY_MM_DD_ShortDesc"),
        title = Type.String:desc("event title"),
        summary = Type.String:desc("event summary"),
        content = Type.String:desc("event detailed content"),
        related_entities = Type.Optional(Type.Array(Type.String)):desc("related entity ID list"),
        created_at = Type.Optional(Type.String):desc("creation time, auto-filled with game time if omitted"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"create", "events"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local eventsResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events"
        })

        local eventsData
        if eventsResult.found then
            eventsData = eventsResult.data
        else
            eventsData = { events = {} }
        end

        -- Check if event_id is duplicate
        for _, ev in ipairs(eventsData.events) do
            if ev.event_id == params.event_id then
                return {success = false, error = "event_id already exists: " .. params.event_id}
            end
        end

        local now = params.created_at or getFormattedGameTime() or ""

        -- Auto-prepend world timestamp to content
        local timestamped_content = params.content
        if now ~= "" then
            timestamped_content = "<!-- " .. now .. " -->\n" .. params.content
        end

        local newEvent = {
            event_id = params.event_id,
            title = params.title,
            summary = params.summary,
            content = timestamped_content,
            related_entities = params.related_entities,
            created_at = now,
            updated_at = now,
        }

        table.insert(eventsData.events, newEvent)

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events",
            data = eventsData,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "Events",
    name = "appendEvent",
    description = "Append content to existing plot event",
    usage = "Find existing event by event_id, append new content to content field with newline, optionally replace summary. Auto-updates updated_at.",
    inputs = Type.Object({
        event_id = Type.String:desc("event ID to append to"),
        content = Type.String:desc("content to append, joined to existing content with newline"),
        summary = Type.Optional(Type.String):desc("optional, replace event summary"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "events"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local eventsResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events"
        })

        if not eventsResult.found then
            return {success = false, error = "Events component not found"}
        end

        local eventsData = eventsResult.data
        local found = false

        for _, ev in ipairs(eventsData.events) do
            if ev.event_id == params.event_id then
                local now = getFormattedGameTime() or ""
                -- Auto-insert time separator before appending content
                local separator = "\n"
                if now ~= "" then
                    separator = "\n<!-- " .. now .. " -->\n"
                end
                ev.content = ev.content .. separator .. params.content
                if params.summary then
                    ev.summary = params.summary
                end
                ev.updated_at = now
                found = true
                break
            end
        end

        if not found then
            return {success = false, error = "Event not found: " .. params.event_id}
        end

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events",
            data = eventsData,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "Events",
    name = "updateEvent",
    description = "Update fields of existing plot event",
    usage = "Find event by event_id, merge provided fields (title, summary, content, related_entities). Auto-updates updated_at.",
    inputs = Type.Object({
        event_id = Type.String:desc("event ID to update"),
        title = Type.Optional(Type.String):desc("new title"),
        summary = Type.Optional(Type.String):desc("new summary"),
        content = Type.Optional(Type.String):desc("new content (full replacement)"),
        related_entities = Type.Optional(Type.Array(Type.String)):desc("new related entity ID list"),
    }),
    outputs = ComponentTypes.SuccessOutput,
    tags = {"modify", "events"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local eventsResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events"
        })

        if not eventsResult.found then
            return {success = false, error = "Events component not found"}
        end

        local eventsData = eventsResult.data
        local found = false

        for _, ev in ipairs(eventsData.events) do
            if ev.event_id == params.event_id then
                if params.title then ev.title = params.title end
                if params.summary then ev.summary = params.summary end
                if params.content then ev.content = params.content end
                if params.related_entities then ev.related_entities = params.related_entities end
                ev.updated_at = getFormattedGameTime() or ""
                found = true
                break
            end
        end

        if not found then
            return {success = false, error = "Event not found: " .. params.event_id}
        end

        Service.call("ecs:SetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events",
            data = eventsData,
            merge = false
        })

        return {success = true}
    end
})

registerSystem({
    category = "Events",
    name = "getEvents",
    description = "Query plot events",
    usage = "Get plot events list from world entity. Filter by event_ids, or omit to return all events.",
    inputs = Type.Object({
        event_ids = Type.Optional(Type.Array(Type.String)):desc("optional, event ID list to query, returns all if omitted"),
    }),
    outputs = Type.Object({
        success = Type.Bool,
        events = Type.Array(ComponentTypes.EventEntry),
        error = Type.Optional(Type.String),
    }),
    tags = {"query", "events"},
    execute = function(params)
        local worldEntityId = ensureWorldEntityId()

        local eventsResult = Service.call("ecs:GetComponentData", {
            entity_id = worldEntityId,
            component_key = "Events"
        })

        if not eventsResult.found then
            return {success = true, events = {}}
        end

        local eventsData = eventsResult.data
        local resultEvents = {}

        if params.event_ids and #params.event_ids > 0 then
            -- Build query set
            local idSet = {}
            for _, id in ipairs(params.event_ids) do
                idSet[id] = true
            end
            for _, ev in ipairs(eventsData.events) do
                if idSet[ev.event_id] then
                    table.insert(resultEvents, ev)
                end
            end
        else
            resultEvents = eventsData.events
        end

        return {success = true, events = resultEvents}
    end
})

return {}
