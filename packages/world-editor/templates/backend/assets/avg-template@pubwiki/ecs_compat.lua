-- ecs_compat.lua
-- ECS compatibility layer: provides ecs:* services using direct pw:/pwc:/pwr:/pwo: RDF operations.
-- Drop-in replacement for ecs@pubwiki module. All existing systems.lua, state.lua, rag.lua
-- code continues to work unchanged via Service.call("ecs:*", ...).

local Type = require("core/types")
local Service = require("core/service")
local RDF = require("./rdf")
local json = require("json")

-- ============================================================================
-- Entity ID = RDF Subject string (no integer mapping needed)
-- entity_id is the subject itself: "creature:npc_01", "region:forest", "world:default"
-- ============================================================================

local function getSubject(entity_id)
    return entity_id  -- identity: entity_id IS the subject
end

local function getAllEntitySubjects()
    local subjects = {}
    if RDF.worldExists() then
        subjects[#subjects + 1] = RDF.worldSubject()
    end
    for _, cid in ipairs(RDF.getAllCreatureIds()) do
        subjects[#subjects + 1] = RDF.creatureSubject(cid)
    end
    for _, rid in ipairs(RDF.getAllRegionIds()) do
        subjects[#subjects + 1] = RDF.regionSubject(rid)
    end
    for _, oid in ipairs(RDF.getAllOrganizationIds()) do
        subjects[#subjects + 1] = RDF.orgSubject(oid)
    end
    return subjects
end

-- ============================================================================
-- Entity type detection from subject
-- ============================================================================

local function getEntityType(subject)
    if not subject then return nil end
    if subject:sub(1, #RDF.SUBJECT.world) == RDF.SUBJECT.world then return "world" end
    if subject:sub(1, #RDF.SUBJECT.creature) == RDF.SUBJECT.creature then return "creature" end
    if subject:sub(1, #RDF.SUBJECT.region) == RDF.SUBJECT.region then return "region" end
    if subject:sub(1, #RDF.SUBJECT.organization) == RDF.SUBJECT.organization then return "organization" end
    return nil
end

local function getOwnerId(subject)
    if not subject then return nil end
    for _, prefix in pairs({RDF.SUBJECT.world, RDF.SUBJECT.creature, RDF.SUBJECT.region, RDF.SUBJECT.organization}) do
        if subject:sub(1, #prefix) == prefix then
            return subject:sub(#prefix + 1)
        end
    end
    return nil
end

-- Predicate maps by entity type
local STATUS_EFFECT_PRED = {
    creature = RDF.PWC.status_effect,
    region = RDF.PWR.status_effect,
    organization = RDF.PWO.status_effect,
}
local LOG_PRED = {
    creature = RDF.PWC.log_entry,
    region = RDF.PWR.log_entry,
    organization = RDF.PWO.log_entry,
    world = RDF.PW_WORLD.log_entry,
}
-- translator.ts uses pw:settingDoc for ALL entity types (not pwc/pwr/pwo variants)
local SETTING_DOC_PRED = {
    creature = RDF.PW_WORLD.setting_doc,
    region = RDF.PW_WORLD.setting_doc,
    organization = RDF.PW_WORLD.setting_doc,
    world = RDF.PW_WORLD.setting_doc,
}
local INVENTORY_PRED = {
    creature = RDF.PWC.inventory_item,
}

-- ============================================================================
-- Component READ adapters: subject → component data
-- ============================================================================

local function readComponent(subject, component_key)
    local etype = getEntityType(subject)
    local oid = getOwnerId(subject)

    if component_key == "Metadata" then
        local name = State:get(subject, RDF.PW.name)
        if not name then return nil end
        return { name = tostring(name), desc = State:get(subject, RDF.PW.description) or "" }

    elseif component_key == "Creature" then
        local typeVal = State:get(subject, RDF.PW.type)
        if typeVal ~= "Creature" then return nil end
        local name = State:get(subject, RDF.PW.name)
        if not name then return nil end
        return {
            creature_id = oid,
            name = tostring(name),
            appearance = {
                body = State:get(subject, RDF.PWC.appearance_body) or "",
                clothing = State:get(subject, RDF.PWC.appearance_clothing) or "",
            },
            gender = State:get(subject, RDF.PWC.gender),
            race = State:get(subject, RDF.PWC.race),
            emotion = State:get(subject, RDF.PWC.emotion),
            organization_id = State:get(subject, RDF.PWC.organization),
            titles = RDF.jsonGet(subject, RDF.PWC.titles) or {},
            attrs = RDF.jsonGet(subject, RDF.PWC.attrs) or {},
            known_infos = RDF.jsonGet(subject, RDF.PWC.known_infos) or {},
            goal = State:get(subject, RDF.PWC.goal),
        }

    elseif component_key == "LocationRef" then
        return {
            region_id = State:get(subject, RDF.PWC.location_region) or "",
            location_id = State:get(subject, RDF.PWC.location_point) or "",
        }

    elseif component_key == "GameTime" then
        return RDF.jsonGet(subject, RDF.PW_WORLD.game_time)

    elseif component_key == "DirectorNotes" then
        return RDF.jsonGet(subject, RDF.PW_WORLD.director_notes)

    elseif component_key == "Events" then
        return RDF.jsonGet(subject, RDF.PW_WORLD.events)

    elseif component_key == "Interaction" then
        return RDF.jsonGet(subject, RDF.PW_WORLD.interaction)

    elseif component_key == "BaseInteraction" then
        return RDF.jsonGet(subject, RDF.PW_WORLD.base_interaction)

    elseif component_key == "Registry" then
        return RDF.getRegistry(subject)

    elseif component_key == "CustomComponentRegistry" then
        return RDF.getCustomComponentRegistry(subject)

    elseif component_key == "Inventory" then
        return { items = RDF.getInventoryItems(oid) }

    elseif component_key == "StatusEffects" then
        local pred = STATUS_EFFECT_PRED[etype]
        if not pred then return { status_effects = {} } end
        return { status_effects = RDF.getStatusEffects(subject, pred) }

    elseif component_key == "Log" then
        local pred = LOG_PRED[etype]
        if not pred then return { entries = {} } end
        return { entries = RDF.getLogEntries(subject, pred) }

    elseif component_key == "BindSetting" then
        local pred = SETTING_DOC_PRED[etype]
        if not pred then return { documents = {} } end
        return { documents = RDF.getSettingDocs(subject, pred) }

    elseif component_key == "IsPlayer" then
        local val = State:get(subject, RDF.PWC.is_player)
        if val == true then return {} end
        return nil

    elseif component_key == "CustomComponents" then
        return RDF.getCustomComponents(subject)

    elseif component_key == "Region" then
        local typeVal = State:get(subject, RDF.PW.type)
        if typeVal ~= "Region" then return nil end
        local name = State:get(subject, RDF.PW.name)
        return {
            region_id = oid,
            region_name = tostring(name),
            description = State:get(subject, RDF.PW.description) or "",
            locations = RDF.jsonGet(subject, RDF.PWR.locations) or {},
            paths = RDF.jsonGet(subject, RDF.PWR.paths) or {},
        }

    elseif component_key == "Organization" then
        local typeVal = State:get(subject, RDF.PW.type)
        if typeVal ~= "Organization" then return nil end
        local name = State:get(subject, RDF.PW.name)
        return {
            organization_id = oid,
            name = tostring(name),
            description = State:get(subject, RDF.PW.description) or "",
            territories = RDF.jsonGet(subject, RDF.PWO.territories) or {},
        }
    end

    return nil
end

-- ============================================================================
-- Component WRITE adapters: subject, data → write triples
-- ============================================================================

local function clearSubResources(subject, link_predicate)
    local links = State:match({ subject = subject, predicate = link_predicate })
    for _, link in ipairs(links) do
        if type(link.object) == "string" then
            RDF.deleteSubject(link.object)
        end
    end
    State:delete(subject, link_predicate)
end

local function writeComponent(subject, component_key, data, merge)
    local etype = getEntityType(subject)
    local oid = getOwnerId(subject)
    if merge == nil then merge = true end

    if component_key == "Metadata" then
        if data.name ~= nil then State:set(subject, RDF.PW.name, data.name) end
        if data.desc ~= nil then State:set(subject, RDF.PW.description, data.desc) end

    elseif component_key == "Creature" then
        if not merge then
            -- Clear all creature predicates
            State:delete(subject, RDF.PWC.gender)
            State:delete(subject, RDF.PWC.race)
            State:delete(subject, RDF.PWC.emotion)
            State:delete(subject, RDF.PWC.goal)
            State:delete(subject, RDF.PWC.organization)
            State:delete(subject, RDF.PWC.appearance_body)
            State:delete(subject, RDF.PWC.appearance_clothing)
            State:delete(subject, RDF.PWC.titles)
            State:delete(subject, RDF.PWC.attrs)
            State:delete(subject, RDF.PWC.known_infos)
        end
        if data.name ~= nil then State:set(subject, RDF.PW.name, data.name) end
        if data.creature_id ~= nil then -- creature_id is part of subject, no-op
        end
        if data.gender ~= nil then State:set(subject, RDF.PWC.gender, data.gender) end
        if data.race ~= nil then State:set(subject, RDF.PWC.race, data.race) end
        if data.emotion ~= nil then State:set(subject, RDF.PWC.emotion, data.emotion) end
        if data.goal ~= nil then State:set(subject, RDF.PWC.goal, data.goal)
        elseif not merge then State:delete(subject, RDF.PWC.goal) end
        if data.organization_id ~= nil then State:set(subject, RDF.PWC.organization, data.organization_id) end
        if data.appearance then
            if data.appearance.body ~= nil then State:set(subject, RDF.PWC.appearance_body, data.appearance.body) end
            if data.appearance.clothing ~= nil then State:set(subject, RDF.PWC.appearance_clothing, data.appearance.clothing) end
        end
        if data.titles ~= nil then RDF.jsonSet(subject, RDF.PWC.titles, data.titles) end
        if data.attrs ~= nil then RDF.jsonSet(subject, RDF.PWC.attrs, data.attrs) end
        if data.known_infos ~= nil then RDF.jsonSet(subject, RDF.PWC.known_infos, data.known_infos) end

    elseif component_key == "LocationRef" then
        if data.region_id ~= nil then State:set(subject, RDF.PWC.location_region, data.region_id) end
        if data.location_id ~= nil then State:set(subject, RDF.PWC.location_point, data.location_id) end

    elseif component_key == "GameTime" then
        RDF.jsonSet(subject, RDF.PW_WORLD.game_time, data)

    elseif component_key == "DirectorNotes" then
        RDF.jsonSet(subject, RDF.PW_WORLD.director_notes, data)

    elseif component_key == "Events" then
        RDF.jsonSet(subject, RDF.PW_WORLD.events, data)

    elseif component_key == "Interaction" then
        RDF.jsonSet(subject, RDF.PW_WORLD.interaction, data)

    elseif component_key == "BaseInteraction" then
        RDF.jsonSet(subject, RDF.PW_WORLD.base_interaction, data)

    elseif component_key == "Registry" then
        -- Clear and re-write registry fields
        clearSubResources(subject, RDF.PW_WORLD.registry_field)
        if data.creature_attr_fields then
            for _, field in ipairs(data.creature_attr_fields) do
                RDF.addRegistryField(subject, field)
            end
        end

    elseif component_key == "CustomComponentRegistry" then
        clearSubResources(subject, RDF.PW_WORLD.custom_schema)
        if data.custom_components then
            for _, def in ipairs(data.custom_components) do
                RDF.addCustomSchemaDef(subject, def)
            end
        end

    elseif component_key == "Inventory" then
        -- Clear old inventory items
        local inv_pred = INVENTORY_PRED[etype] or RDF.PWC.inventory_item
        clearSubResources(subject, inv_pred)
        -- Write new items
        if data.items then
            for _, item in ipairs(data.items) do
                RDF.writeInventoryItem(oid, item)
            end
        end

    elseif component_key == "StatusEffects" then
        local pred = STATUS_EFFECT_PRED[etype]
        if pred then
            clearSubResources(subject, pred)
            if data.status_effects then
                for _, se in ipairs(data.status_effects) do
                    RDF.writeStatusEffect(subject, oid, pred, se)
                end
            end
        end

    elseif component_key == "Log" then
        local pred = LOG_PRED[etype]
        if pred then
            clearSubResources(subject, pred)
            if data.entries then
                RDF.writeLogEntries(subject, pred, data.entries)
            end
        end

    elseif component_key == "BindSetting" then
        local pred = SETTING_DOC_PRED[etype]
        if pred then
            clearSubResources(subject, pred)
            if data.documents then
                RDF.writeSettingDocs(subject, etype, oid, pred, data.documents)
            end
        end

    elseif component_key == "IsPlayer" then
        State:set(subject, RDF.PWC.is_player, true)

    elseif component_key == "CustomComponents" then
        if not merge then
            -- Clear all custom component predicates
            local triples = State:match({ subject = subject })
            local prefix = RDF.PWC.custom_component_prefix
            for _, t in ipairs(triples) do
                if type(t.predicate) == "string" and t.predicate:sub(1, #prefix) == prefix then
                    State:delete(subject, t.predicate)
                end
            end
        end
        if data.custom_components then
            for _, comp in ipairs(data.custom_components) do
                RDF.jsonSet(subject, RDF.PWC.custom_component_prefix .. comp.component_key, comp.data)
            end
        end

    elseif component_key == "Region" then
        if data.region_name ~= nil or data.name ~= nil then
            State:set(subject, RDF.PW.name, data.region_name or data.name)
        end
        if data.description ~= nil then State:set(subject, RDF.PW.description, data.description) end
        if data.locations ~= nil then RDF.jsonSet(subject, RDF.PWR.locations, data.locations) end
        if data.paths ~= nil then RDF.jsonSet(subject, RDF.PWR.paths, data.paths) end

    elseif component_key == "Organization" then
        if data.name ~= nil then State:set(subject, RDF.PW.name, data.name) end
        if data.description ~= nil then State:set(subject, RDF.PW.description, data.description) end
        if data.territories ~= nil then RDF.jsonSet(subject, RDF.PWO.territories, data.territories) end
    end
end

-- ============================================================================
-- Determine which components an entity has (for snapshot/query)
-- ============================================================================

local WORLD_COMPONENTS = {"Metadata", "GameTime", "Registry", "DirectorNotes", "CustomComponentRegistry", "Log", "BindSetting", "Events", "Interaction", "BaseInteraction"}
local CREATURE_COMPONENTS = {"Metadata", "Creature", "LocationRef", "Inventory", "StatusEffects", "Log", "BindSetting", "CustomComponents", "Interaction", "IsPlayer"}
local REGION_COMPONENTS = {"Metadata", "Region", "StatusEffects", "Log", "BindSetting", "Interaction"}
local ORG_COMPONENTS = {"Metadata", "Organization", "Inventory", "StatusEffects", "Log", "BindSetting", "Interaction"}

local function getComponentKeys(etype)
    if etype == "world" then return WORLD_COMPONENTS end
    if etype == "creature" then return CREATURE_COMPONENTS end
    if etype == "region" then return REGION_COMPONENTS end
    if etype == "organization" then return ORG_COMPONENTS end
    return {}
end

local function getEntityComponents(subject)
    local etype = getEntityType(subject)
    local components = {}
    for _, key in ipairs(getComponentKeys(etype)) do
        local data = readComponent(subject, key)
        if data ~= nil then
            components[key] = data
        end
    end
    return components
end

-- ============================================================================
-- System registry (replaces System global from ecs.lua)
-- ============================================================================

local systemRegistry = {}

-- ============================================================================
-- Register ECS services
-- ============================================================================

-- ecs:RegisterComponent (no-op, types defined in components.lua)
Service:define():namespace("ecs"):name("RegisterComponent")
    :desc("Register component type (no-op compatibility)")
    :inputs(Type.Object({
        key = Type.String,
        name = Type.String,
        description = Type.Optional(Type.String),
        properties_typedef = Type.Optional(Type.Any),
        expose_to_blueprint = Type.Optional(Type.Bool),
        priority = Type.Optional(Type.Int),
        trace_info = Type.Optional(Type.String),
    }))
    :outputs(Type.Object({ success = Type.Bool, error = Type.Optional(Type.String) }))
    :impl(function(inputs)
        return { success = true }
    end)

-- ecs:RegisterSystem
Service:define():namespace("ecs"):name("RegisterSystem")
    :desc("Register system and expose as ecs.system:* service")
    :inputs(Type.Object({
        category = Type.String,
        name = Type.String,
        description = Type.String,
        inputs_typedef = Type.Any,
        outputs_typedef = Type.Any,
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
        local systemId = inputs.category .. "." .. inputs.name
        local inputsSpec = Type.deserialize(inputs.inputs_typedef)
        local outputsSpec = Type.deserialize(inputs.outputs_typedef)
        if not inputsSpec or inputsSpec.kind ~= "object" then
            return { success = false, error = "Invalid inputs_typedef" }
        end
        if not outputsSpec or outputsSpec.kind ~= "object" then
            return { success = false, error = "Invalid outputs_typedef" }
        end

        -- Determine PURE or ACTION
        local isPure = false
        for _, tag in ipairs(inputs.tags or {}) do
            if tag == "query" then isPure = true; break end
        end

        -- Store system metadata for RAG
        systemRegistry[systemId] = {
            id = systemId,
            category = inputs.category,
            name = inputs.name,
            description = inputs.description,
            usage = inputs.usage or "",
            inputs = inputsSpec,
            outputs = outputsSpec,
            execute = inputs.execute,
            tags = inputs.tags or {},
            kind = isPure and "PURE" or "ACTION",
            expose_to_service = inputs.expose_to_service ~= false,
            trace_info = inputs.trace_info,
        }

        -- Register as ecs.system:Category.Name service
        local exposeToService = inputs.expose_to_service
        if exposeToService == nil then exposeToService = true end -- default: expose

        if exposeToService then
            local defineFunc = isPure and Service.definePure or Service.define
            defineFunc(Service):namespace("ecs.system"):name(systemId)
                :desc(inputs.description)
                :usage(inputs.usage or "")
                :inputs(inputsSpec)
                :outputs(outputsSpec)
                :impl(inputs.execute)
        end

        return { success = true, system_id = systemId }
    end)

-- ecs:SpawnEntity
Service:define():namespace("ecs"):name("SpawnEntity")
    :desc("Create entity from component specs, write as RDF triples")
    :inputs(Type.Object({
        components = Type.Optional(Type.Array(Type.Object({
            key = Type.String,
            data = Type.Optional(Type.Any),
        }))),
    }))
    :outputs(Type.Object({
        entity_id = Type.String,
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local comps = inputs.components or {}

        -- Determine entity type and subject from components
        local subject, etype
        for _, c in ipairs(comps) do
            if c.key == "Creature" and c.data and c.data.creature_id then
                subject = RDF.creatureSubject(c.data.creature_id)
                etype = "creature"
                break
            elseif c.key == "Region" and c.data and c.data.region_id then
                subject = RDF.regionSubject(c.data.region_id)
                etype = "region"
                break
            elseif c.key == "Organization" and c.data and c.data.organization_id then
                subject = RDF.orgSubject(c.data.organization_id)
                etype = "organization"
                break
            elseif c.key == "GameTime" or c.key == "Registry" then
                subject = RDF.worldSubject()
                etype = "world"
                break
            end
        end

        if not subject then
            -- Fallback: check for Metadata with name containing hints
            subject = RDF.worldSubject()
            etype = "world"
        end

        -- Set entity type marker
        local typeValue = "World"
        if etype == "creature" then typeValue = "Creature"
        elseif etype == "region" then typeValue = "Region"
        elseif etype == "organization" then typeValue = "Organization" end

        State:set(subject, RDF.PW.type, typeValue)

        -- Write all components
        for _, c in ipairs(comps) do
            writeComponent(subject, c.key, c.data or {}, false)
        end

        return { entity_id = subject, success = true }
    end)

-- ecs:DespawnEntity
Service:define():namespace("ecs"):name("DespawnEntity")
    :desc("Destroy entity")
    :inputs(Type.Object({ entity_id = Type.String }))
    :outputs(Type.Object({ success = Type.Bool }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { success = false } end
        local etype = getEntityType(subject)
        local oid = getOwnerId(subject)
        if etype == "creature" then RDF.deleteCreature(oid)
        elseif etype == "region" then RDF.deleteRegion(oid)
        elseif etype == "organization" then RDF.deleteOrganization(oid)
        elseif etype == "world" then RDF.deleteWorld()
        else RDF.deleteSubject(subject) end
        return { success = true }
    end)

-- ecs:GetEntity
Service:definePure():namespace("ecs"):name("GetEntity")
    :desc("Check if entity exists")
    :inputs(Type.Object({ entity_id = Type.String }))
    :outputs(Type.Object({ exists = Type.Bool }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { exists = false } end
        local t = State:get(subject, RDF.PW.type)
        return { exists = t ~= nil }
    end)

-- ecs:GetAllEntityIds
Service:definePure():namespace("ecs"):name("GetAllEntityIds")
    :desc("Get all entity IDs")
    :inputs(Type.Object({}))
    :outputs(Type.Object({ entity_ids = Type.Array(Type.String), count = Type.Int }))
    :impl(function(inputs)
        local ids = getAllEntitySubjects()
        table.sort(ids)
        return { entity_ids = ids, count = #ids }
    end)

-- ecs:ClearWorld
Service:define():namespace("ecs"):name("ClearWorld")
    :desc("Clear all entities")
    :inputs(Type.Object({}))
    :outputs(Type.Object({ success = Type.Bool, cleared_count = Type.Int }))
    :impl(function(inputs)
        local subjects = getAllEntitySubjects()
        RDF.clearAll()
        return { success = true, cleared_count = #subjects }
    end)

-- ecs:GetEntitiesByComponent
Service:definePure():namespace("ecs"):name("GetEntitiesByComponent")
    :desc("Query entities by component keys (AND)")
    :inputs(Type.Object({ component_keys = Type.Array(Type.String) }))
    :outputs(Type.Object({ entity_ids = Type.Array(Type.String), count = Type.Int }))
    :impl(function(inputs)
        local keys = inputs.component_keys or {}
        if #keys == 0 then return { entity_ids = {}, count = 0 } end

        local allSubjects = getAllEntitySubjects()
        local ids = {}

        for _, subject in ipairs(allSubjects) do
            local hasAll = true
            for _, key in ipairs(keys) do
                local data = readComponent(subject, key)
                if data == nil then
                    hasAll = false
                    break
                end
            end
            if hasAll then
                ids[#ids + 1] = subject
            end
        end

        table.sort(ids)
        return { entity_ids = ids, count = #ids }
    end)

-- ecs:GetSnapshot
Service:definePure():namespace("ecs"):name("GetSnapshot")
    :desc("Full world state snapshot")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        entities = Type.Array(Type.Object({
            entity_id = Type.String,
            components = Type.Any,
        })),
        count = Type.Int,
    }))
    :impl(function(inputs)
        local subjects = getAllEntitySubjects()
        table.sort(subjects)
        local snapshot = {}

        for _, subject in ipairs(subjects) do
            table.insert(snapshot, {
                entity_id = subject,
                components = getEntityComponents(subject),
            })
        end
        return { entities = snapshot, count = #snapshot }
    end)

-- ecs:GetEntitySnapshot
Service:definePure():namespace("ecs"):name("GetEntitySnapshot")
    :desc("Single entity snapshot")
    :inputs(Type.Object({ entity_id = Type.String }))
    :outputs(Type.Object({
        found = Type.Bool,
        entity_id = Type.Optional(Type.String),
        components = Type.Optional(Type.Any),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { found = false } end
        local t = State:get(subject, RDF.PW.type)
        if not t then return { found = false } end
        return {
            found = true,
            entity_id = inputs.entity_id,
            components = getEntityComponents(subject),
        }
    end)

-- ecs:GetComponentData
Service:definePure():namespace("ecs"):name("GetComponentData")
    :desc("Get component data from entity")
    :inputs(Type.Object({ entity_id = Type.String, component_key = Type.String }))
    :outputs(Type.Object({
        found = Type.Bool,
        data = Type.Optional(Type.Any),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { found = false, error = "Entity not found" } end
        local data = readComponent(subject, inputs.component_key)
        if data == nil then return { found = false } end
        return { found = true, data = data }
    end)

-- ecs:SetComponentData
Service:define():namespace("ecs"):name("SetComponentData")
    :desc("Set component data on entity")
    :inputs(Type.Object({
        entity_id = Type.String,
        component_key = Type.String,
        data = Type.Any,
        merge = Type.Optional(Type.Bool),
    }))
    :outputs(Type.Object({ success = Type.Bool, error = Type.Optional(Type.String) }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { success = false, error = "Entity not found" } end
        local merge = inputs.merge
        if merge == nil then merge = true end
        writeComponent(subject, inputs.component_key, inputs.data, merge)
        return { success = true }
    end)

-- ecs:AddComponent
Service:define():namespace("ecs"):name("AddComponent")
    :desc("Add component to entity")
    :inputs(Type.Object({
        entity_id = Type.String,
        component_key = Type.String,
        data = Type.Optional(Type.Any),
    }))
    :outputs(Type.Object({ success = Type.Bool, error = Type.Optional(Type.String) }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { success = false, error = "Entity not found" } end
        writeComponent(subject, inputs.component_key, inputs.data or {}, false)
        return { success = true }
    end)

-- ecs:RemoveComponent
Service:define():namespace("ecs"):name("RemoveComponent")
    :desc("Remove component from entity")
    :inputs(Type.Object({
        entity_id = Type.String,
        component_key = Type.String,
    }))
    :outputs(Type.Object({ success = Type.Bool, error = Type.Optional(Type.String) }))
    :impl(function(inputs)
        local subject = getSubject(inputs.entity_id)
        if not subject then return { success = false, error = "Entity not found" } end
        local key = inputs.component_key
        if key == "IsPlayer" then
            State:delete(subject, RDF.PWC.is_player)
        end
        -- Other components: delete relevant predicates
        return { success = true }
    end)

-- ============================================================================
-- RAG services (replaces ecs_rag.lua)
-- ============================================================================

-- ecs:SystemServices
Service:definePure():namespace("ecs"):name("SystemServices")
    :desc("Get system service documentation")
    :inputs(Type.Object({
        service_names = Type.Optional(Type.Array(Type.String)),
    }))
    :outputs(Type.Object({
        resources = Type.Array(Type.Any),
    }))
    :impl(function(inputs)
        local docs = Service.exportDocByNamespace("ecs.system")
        if not docs then return { resources = {} } end

        local resources = {}
        local filterSet = nil
        if inputs.service_names and #inputs.service_names > 0 then
            filterSet = {}
            for _, name in ipairs(inputs.service_names) do
                filterSet[name] = true
            end
        end

        for _, doc in ipairs(docs) do
            local include = true
            if filterSet then
                include = filterSet[doc.identifier or ""] ~= nil
            else
                -- Exclude query services by default
                if doc.kind == "PURE" then include = false end
            end
            if include then
                table.insert(resources, {
                    kind = "system_service",
                    name = doc.identifier or doc.name or "",
                    description = doc.description or "",
                    usage = doc.usage or "",
                    inputs = doc.inputs and Type.serialize(doc.inputs) or nil,
                    outputs = doc.outputs and Type.serialize(doc.outputs) or nil,
                })
            end
        end
        return { resources = resources }
    end)

print("[ecs_compat] ECS compatibility layer loaded (pw: RDF backend)")

return {
    systemRegistry = systemRegistry,
}
