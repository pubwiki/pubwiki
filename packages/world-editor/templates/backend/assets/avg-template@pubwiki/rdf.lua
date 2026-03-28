-- rdf.lua
-- RDF vocabulary constants and helpers for direct triple store access.
-- Mirrors packages/world-editor/src/rdf/vocabulary.ts
--
-- All Lua services use this module to read/write game state via the State API,
-- removing the need for the ECS layer.

local RDF = {}

-- ============================================================================
-- Subject prefixes
-- ============================================================================

RDF.SUBJECT = {
    world = "world:",
    creature = "creature:",
    region = "region:",
    organization = "org:",
    inventory = "inv:",
    status_effect = "se:",
    setting_doc = "doc:",
    story = "story:",
    wiki = "wiki:",
    registry_field = "regfield:",
    custom_schema = "cschema:",
}

-- ============================================================================
-- Graph prefixes (informational — Lua State API doesn't use graphs)
-- ============================================================================

RDF.GRAPH = {
    world = "graph:world",
    creature = "graph:creature",
    region = "graph:region",
    organization = "graph:org",
    setting = "graph:setting",
    story = "graph:story",
    app = "graph:app",
}

-- ============================================================================
-- Core predicates (pw:)
-- ============================================================================

RDF.PW = {
    type = "pw:type",
    name = "pw:name",
    description = "pw:description",
    target = "pw:target",
    value = "pw:value",
    order = "pw:order",
}

-- ============================================================================
-- World predicates
-- ============================================================================

RDF.PW_WORLD = {
    game_time = "pw:gameTime",
    director_notes = "pw:directorNotes",
    registry_field = "pw:registryField",
    custom_schema = "pw:customSchema",
    log_entry = "pw:logEntry",
    setting_doc = "pw:settingDoc",
    events = "pw:events",
    interaction = "pw:interaction",
    base_interaction = "pw:baseInteraction",
}

-- ============================================================================
-- Creature predicates (pwc:)
-- ============================================================================

RDF.PWC = {
    gender = "pwc:gender",
    race = "pwc:race",
    titles = "pwc:titles",
    emotion = "pwc:emotion",
    appearance_body = "pwc:appearanceBody",
    appearance_clothing = "pwc:appearanceClothing",
    attrs = "pwc:attrs",
    known_infos = "pwc:knownInfos",
    goal = "pwc:goal",
    personality = "pwc:personality",
    is_player = "pwc:isPlayer",
    organization = "pwc:organization",
    location_region = "pwc:locationRegion",
    location_point = "pwc:locationPoint",
    inventory_item = "pwc:inventoryItem",
    status_effect = "pwc:statusEffect",
    custom_component_prefix = "pwc:comp:",
    setting_doc = "pwc:settingDoc",
    log_entry = "pwc:logEntry",
}

-- ============================================================================
-- Region predicates (pwr:)
-- ============================================================================

RDF.PWR = {
    locations = "pwr:locations",
    paths = "pwr:paths",
    metadata_name = "pwr:metadataName",
    metadata_desc = "pwr:metadataDesc",
    status_effect = "pwr:statusEffect",
    setting_doc = "pwr:settingDoc",
    log_entry = "pwr:logEntry",
}

-- ============================================================================
-- Organization predicates (pwo:)
-- ============================================================================

RDF.PWO = {
    territories = "pwo:territories",
    status_effect = "pwo:statusEffect",
    setting_doc = "pwo:settingDoc",
    log_entry = "pwo:logEntry",
}

-- ============================================================================
-- Item predicates (pwi:)
-- ============================================================================

RDF.PWI = {
    item_id = "pwi:id",
    count = "pwi:count",
    equipped = "pwi:equipped",
    details = "pwi:details",
}

-- ============================================================================
-- Status effect predicates
-- ============================================================================

RDF.PW_STATUS = {
    display_name = "pw:statusDisplayName",
    remark = "pw:statusRemark",
    data = "pw:statusData",
    add_at = "pw:statusAddAt",
    last_update_at = "pw:statusLastUpdateAt",
}

-- ============================================================================
-- Registry field predicates
-- ============================================================================

RDF.PW_REGISTRY = {
    field_name = "pw:fieldName",
    hint = "pw:fieldHint",
    field_display_name = "pw:fieldDisplayName",
}

-- ============================================================================
-- Custom schema predicates
-- ============================================================================

RDF.PW_SCHEMA = {
    field = "pw:schemaField",
    component_key = "pw:componentKey",
    is_array = "pw:isArray",
    type_schema = "pw:typeSchema",
    data_registry = "pw:dataRegistry",
    component_data = "pw:componentData",
}

-- ============================================================================
-- Setting doc predicates (pws:)
-- ============================================================================

RDF.PWS = {
    content = "pws:content",
    priority = "pws:priority",
    condition = "pws:condition",
    disable = "pws:disable",
}

-- ============================================================================
-- Story predicates
-- ============================================================================

RDF.PW_STORY = {
    content = "pw:storyContent",
    timestamp = "pw:storyTimestamp",
    checkpoint_id = "pw:storyCheckpointId",
    initial_background = "pw:initialBackground",
    initial_start_story = "pw:initialStartStory",
    game_init_choice = "pw:gameInitChoice",
}

-- ============================================================================
-- Wiki predicates
-- ============================================================================

RDF.PW_WIKI = {
    title = "pw:wikiTitle",
    content = "pw:wikiContent",
    category = "pw:wikiCategory",
    entry = "pw:wikiEntry",
}

-- ============================================================================
-- App predicates
-- ============================================================================

RDF.PW_APP = {
    publish_type = "pw:publishType",
}

-- ============================================================================
-- Subject construction helpers
-- ============================================================================

function RDF.worldSubject()
    return "world:default"
end

function RDF.creatureSubject(creature_id)
    return RDF.SUBJECT.creature .. creature_id
end

function RDF.regionSubject(region_id)
    return RDF.SUBJECT.region .. region_id
end

function RDF.orgSubject(organization_id)
    return RDF.SUBJECT.organization .. organization_id
end

function RDF.inventorySubject(owner_id, item_id)
    return RDF.SUBJECT.inventory .. owner_id .. "_" .. item_id
end

function RDF.statusEffectSubject(owner_id, effect_id)
    return RDF.SUBJECT.status_effect .. owner_id .. "_" .. effect_id
end

function RDF.settingDocSubject(owner_id, doc_name)
    local safe = doc_name:gsub("[^a-zA-Z0-9_%-]", "_"):lower()
    return RDF.SUBJECT.setting_doc .. owner_id .. "_" .. safe
end

function RDF.registryFieldSubject(world_id, field_name)
    local safe = field_name:gsub("[^a-zA-Z0-9_%-]", "_"):lower()
    return RDF.SUBJECT.registry_field .. world_id .. "_" .. safe
end

function RDF.customSchemaSubject(world_id, schema_name)
    local safe = schema_name:gsub("[^a-zA-Z0-9_%-]", "_"):lower()
    return RDF.SUBJECT.custom_schema .. world_id .. "_" .. safe
end

function RDF.settingGraph(entity_type, entity_id)
    return RDF.GRAPH.setting .. ":" .. entity_type .. ":" .. entity_id
end

-- ============================================================================
-- Entity existence checks
-- ============================================================================

function RDF.creatureExists(creature_id)
    local t = State:get(RDF.creatureSubject(creature_id), RDF.PW.type)
    return t == "Creature"
end

function RDF.regionExists(region_id)
    local t = State:get(RDF.regionSubject(region_id), RDF.PW.type)
    return t == "Region"
end

function RDF.orgExists(organization_id)
    local t = State:get(RDF.orgSubject(organization_id), RDF.PW.type)
    return t == "Organization"
end

function RDF.worldExists()
    local t = State:get(RDF.worldSubject(), RDF.PW.type)
    return t == "World"
end

-- ============================================================================
-- Entity ID listing
-- ============================================================================

function RDF.getAllCreatureIds()
    local triples = State:match({ predicate = RDF.PW.type, object = "Creature" })
    local ids = {}
    local prefix_len = #RDF.SUBJECT.creature
    for _, t in ipairs(triples) do
        local id = t.subject:sub(prefix_len + 1)
        if id ~= "" then
            ids[#ids + 1] = id
        end
    end
    return ids
end

function RDF.getAllRegionIds()
    local triples = State:match({ predicate = RDF.PW.type, object = "Region" })
    local ids = {}
    local prefix_len = #RDF.SUBJECT.region
    for _, t in ipairs(triples) do
        local id = t.subject:sub(prefix_len + 1)
        if id ~= "" then
            ids[#ids + 1] = id
        end
    end
    return ids
end

function RDF.getAllOrganizationIds()
    local triples = State:match({ predicate = RDF.PW.type, object = "Organization" })
    local ids = {}
    local prefix_len = #RDF.SUBJECT.organization
    for _, t in ipairs(triples) do
        local id = t.subject:sub(prefix_len + 1)
        if id ~= "" then
            ids[#ids + 1] = id
        end
    end
    return ids
end

--- Find the player creature_id (the one with pwc:isPlayer = true)
function RDF.getPlayerCreatureId()
    local triples = State:match({ predicate = RDF.PWC.is_player, object = true })
    if #triples > 0 then
        local prefix_len = #RDF.SUBJECT.creature
        return triples[1].subject:sub(prefix_len + 1)
    end
    return nil
end

-- ============================================================================
-- JSON helper: safe parse (returns nil on error)
-- ============================================================================

local json = require("json")

function RDF.jsonGet(subject, predicate)
    local raw = State:get(subject, predicate)
    if raw == nil then return nil end
    if type(raw) == "table" then return raw end
    if type(raw) == "string" then
        local ok, result = pcall(json.decode, raw)
        if ok then return result end
    end
    return raw
end

function RDF.jsonSet(subject, predicate, value)
    if value == nil then
        State:delete(subject, predicate)
    elseif type(value) == "table" then
        State:set(subject, predicate, json.encode(value))
    else
        State:set(subject, predicate, value)
    end
end

-- ============================================================================
-- Creature materialization (full snapshot from triples)
-- ============================================================================

function RDF.getCreatureSnapshot(creature_id)
    local s = RDF.creatureSubject(creature_id)
    local name = State:get(s, RDF.PW.name)
    if name == nil then return nil end

    local snapshot = {
        Metadata = {
            name = tostring(name),
            desc = State:get(s, RDF.PW.description) or "",
        },
        Creature = {
            creature_id = creature_id,
            name = name,
            appearance = {
                body = State:get(s, RDF.PWC.appearance_body) or "",
                clothing = State:get(s, RDF.PWC.appearance_clothing) or "",
            },
            gender = State:get(s, RDF.PWC.gender),
            race = State:get(s, RDF.PWC.race),
            emotion = State:get(s, RDF.PWC.emotion),
            organization_id = State:get(s, RDF.PWC.organization),
            titles = RDF.jsonGet(s, RDF.PWC.titles) or {},
            attrs = RDF.jsonGet(s, RDF.PWC.attrs) or {},
            known_infos = RDF.jsonGet(s, RDF.PWC.known_infos) or {},
            goal = State:get(s, RDF.PWC.goal),
        },
        LocationRef = {
            region_id = State:get(s, RDF.PWC.location_region) or "",
            location_id = State:get(s, RDF.PWC.location_point) or "",
        },
        Inventory = { items = RDF.getInventoryItems(creature_id) },
        StatusEffects = { status_effects = RDF.getStatusEffects(s, RDF.PWC.status_effect) },
        Log = { entries = RDF.getLogEntries(s, RDF.PWC.log_entry) },
        IsPlayer = State:get(s, RDF.PWC.is_player) == true and {} or nil,
        BindSetting = { documents = RDF.getSettingDocs(s, RDF.PW_WORLD.setting_doc) },
        CustomComponents = RDF.getCustomComponents(s),
        Interaction = RDF.jsonGet(s, RDF.PW_WORLD.interaction),
    }
    return snapshot
end

-- ============================================================================
-- Region materialization
-- ============================================================================

function RDF.getRegionSnapshot(region_id)
    local s = RDF.regionSubject(region_id)
    local name = State:get(s, RDF.PW.name)
    if name == nil then return nil end

    return {
        Metadata = {
            name = name,
            desc = State:get(s, RDF.PW.description) or "",
        },
        Region = {
            region_id = region_id,
            region_name = name,
            description = State:get(s, RDF.PW.description) or "",
            locations = RDF.jsonGet(s, RDF.PWR.locations) or {},
            paths = RDF.jsonGet(s, RDF.PWR.paths) or {},
        },
        StatusEffects = { status_effects = RDF.getStatusEffects(s, RDF.PWR.status_effect) },
        Log = { entries = RDF.getLogEntries(s, RDF.PWR.log_entry) },
        BindSetting = { documents = RDF.getSettingDocs(s, RDF.PW_WORLD.setting_doc) },
        Interaction = RDF.jsonGet(s, RDF.PW_WORLD.interaction),
    }
end

-- ============================================================================
-- Organization materialization
-- ============================================================================

function RDF.getOrganizationSnapshot(organization_id)
    local s = RDF.orgSubject(organization_id)
    local name = State:get(s, RDF.PW.name)
    if name == nil then return nil end

    return {
        Metadata = {
            name = tostring(name),
            desc = State:get(s, RDF.PW.description) or "",
        },
        Organization = {
            organization_id = organization_id,
            name = name,
            description = State:get(s, RDF.PW.description) or "",
            territories = RDF.jsonGet(s, RDF.PWO.territories) or {},
        },
        Inventory = { items = RDF.getInventoryItems(organization_id) },
        StatusEffects = { status_effects = RDF.getStatusEffects(s, RDF.PWO.status_effect) },
        Log = { entries = RDF.getLogEntries(s, RDF.PWO.log_entry) },
        BindSetting = { documents = RDF.getSettingDocs(s, RDF.PW_WORLD.setting_doc) },
        Interaction = RDF.jsonGet(s, RDF.PW_WORLD.interaction),
    }
end

-- ============================================================================
-- World materialization
-- ============================================================================

function RDF.getWorldSnapshot()
    local s = RDF.worldSubject()

    return {
        Metadata = {
            name = State:get(s, RDF.PW.name) or "World",
            desc = State:get(s, RDF.PW.description) or "",
        },
        GameTime = RDF.jsonGet(s, RDF.PW_WORLD.game_time),
        Registry = RDF.getRegistry(s),
        DirectorNotes = RDF.jsonGet(s, RDF.PW_WORLD.director_notes),
        CustomComponentRegistry = RDF.getCustomComponentRegistry(s),
        Log = { entries = RDF.getLogEntries(s, RDF.PW_WORLD.log_entry) },
        BindSetting = { documents = RDF.getSettingDocs(s, RDF.PW_WORLD.setting_doc) },
        Events = RDF.jsonGet(s, RDF.PW_WORLD.events),
        Interaction = RDF.jsonGet(s, RDF.PW_WORLD.interaction),
        BaseInteraction = RDF.jsonGet(s, RDF.PW_WORLD.base_interaction),
    }
end

-- ============================================================================
-- Sub-resource helpers
-- ============================================================================

--- Get all inventory items for an entity (by owner_id)
function RDF.getInventoryItems(owner_id)
    local prefix = RDF.SUBJECT.inventory .. owner_id .. "_"
    local items = {}
    -- Query all triples for this owner's inventory items
    local triples = State:match({ predicate = RDF.PWI.item_id })
    for _, t in ipairs(triples) do
        if t.subject:sub(1, #prefix) == prefix then
            local item_id = tostring(t.object)
            table.insert(items, {
                id = item_id,
                name = State:get(t.subject, RDF.PW.name) or "",
                description = State:get(t.subject, RDF.PW.description) or "",
                count = State:get(t.subject, RDF.PWI.count) or 0,
                equipped = State:get(t.subject, RDF.PWI.equipped) or false,
                details = RDF.jsonGet(t.subject, RDF.PWI.details) or {},
            })
        end
    end
    return items
end

--- Get status effects from link triples
function RDF.getStatusEffects(entity_subject, link_predicate)
    local effects = {}
    local links = State:match({ subject = entity_subject, predicate = link_predicate })
    for _, link in ipairs(links) do
        local se_subject = link.object
        if type(se_subject) == "string" then
            -- Extract instance_id from subject: se:owner_id
            local prefix_len = #RDF.SUBJECT.status_effect
            local full_id = se_subject:sub(prefix_len + 1)
            -- instance_id is after the owner_id_ prefix
            local instance_id = full_id:match("_(.+)$") or full_id

            table.insert(effects, {
                instance_id = instance_id,
                display_name = State:get(se_subject, RDF.PW_STATUS.display_name),
                remark = State:get(se_subject, RDF.PW_STATUS.remark),
                data = RDF.jsonGet(se_subject, RDF.PW_STATUS.data) or {},
                add_at = State:get(se_subject, RDF.PW_STATUS.add_at),
                last_update_at = State:get(se_subject, RDF.PW_STATUS.last_update_at),
            })
        end
    end
    return effects
end

--- Get log entries from link triples
function RDF.getLogEntries(entity_subject, link_predicate)
    local raw = {}
    local links = State:match({ subject = entity_subject, predicate = link_predicate })
    for _, link in ipairs(links) do
        local log_subject = link.object
        if type(log_subject) == "string" then
            local content = State:get(log_subject, RDF.PW_STORY.content)
            local timestamp = State:get(log_subject, RDF.PW_STORY.timestamp)
            local order = State:get(log_subject, RDF.PW.order) or 0
            if content then
                table.insert(raw, {
                    order = tonumber(order) or 0,
                    entry = {
                        content = tostring(content),
                        add_at = tostring(timestamp or ""),
                    },
                })
            end
        end
    end
    -- Sort by order
    table.sort(raw, function(a, b) return a.order < b.order end)
    local entries = {}
    for _, r in ipairs(raw) do
        table.insert(entries, r.entry)
    end
    return entries
end

--- Get setting documents from link triples
function RDF.getSettingDocs(entity_subject, link_predicate)
    local docs = {}
    local links = State:match({ subject = entity_subject, predicate = link_predicate })
    for _, link in ipairs(links) do
        local doc_subject = link.object
        if type(doc_subject) == "string" then
            local name = State:get(doc_subject, RDF.PW.name)
            local content = State:get(doc_subject, RDF.PWS.content)
            if name then
                table.insert(docs, {
                    name = tostring(name),
                    content = tostring(content or ""),
                    condition = State:get(doc_subject, RDF.PWS.condition),
                    static_priority = State:get(doc_subject, RDF.PWS.priority),
                    disable = State:get(doc_subject, RDF.PWS.disable),
                })
            end
        end
    end
    return docs
end

--- Get registry fields from world entity
function RDF.getRegistry(world_subject)
    local registry = { creature_attr_fields = {} }
    local links = State:match({ subject = world_subject, predicate = RDF.PW_WORLD.registry_field })
    for _, link in ipairs(links) do
        local field_subject = link.object
        if type(field_subject) == "string" then
            local field_name = State:get(field_subject, RDF.PW_REGISTRY.field_name)
            if field_name then
                table.insert(registry.creature_attr_fields, {
                    field_name = tostring(field_name),
                    hint = State:get(field_subject, RDF.PW_REGISTRY.hint) or "",
                    field_display_name = State:get(field_subject, RDF.PW_REGISTRY.field_display_name),
                })
            end
        end
    end
    return registry
end

--- Get custom component registry from world entity
function RDF.getCustomComponentRegistry(world_subject)
    local registry = { custom_components = {} }
    local links = State:match({ subject = world_subject, predicate = RDF.PW_WORLD.custom_schema })
    for _, link in ipairs(links) do
        local schema_subject = link.object
        if type(schema_subject) == "string" then
            local comp_key = State:get(schema_subject, RDF.PW_SCHEMA.component_key)
            if comp_key then
                table.insert(registry.custom_components, {
                    component_key = tostring(comp_key),
                    component_name = State:get(schema_subject, RDF.PW.name) or tostring(comp_key),
                    is_array = State:get(schema_subject, RDF.PW_SCHEMA.is_array) == true,
                    type_schema = RDF.jsonGet(schema_subject, RDF.PW_SCHEMA.type_schema),
                    data_registry = RDF.jsonGet(schema_subject, RDF.PW_SCHEMA.data_registry),
                })
            end
        end
    end
    return registry
end

--- Get custom component data from creature subject
function RDF.getCustomComponents(creature_subject)
    local result = { custom_components = {} }
    -- Query all triples for this creature and filter by custom component prefix
    local triples = State:match({ subject = creature_subject })
    local prefix = RDF.PWC.custom_component_prefix
    for _, t in ipairs(triples) do
        if type(t.predicate) == "string" and t.predicate:sub(1, #prefix) == prefix then
            local comp_key = t.predicate:sub(#prefix + 1)
            local data = t.object
            if type(data) == "string" then
                local ok, parsed = pcall(json.decode, data)
                if ok then data = parsed end
            end
            table.insert(result.custom_components, {
                component_key = comp_key,
                data = data,
            })
        end
    end
    return result
end

-- ============================================================================
-- Entity creation helpers (write full entity as triples)
-- ============================================================================

function RDF.createWorld(data)
    local s = RDF.worldSubject()
    State:set(s, RDF.PW.type, "World")
    State:set(s, RDF.PW.name, "World")

    if data.GameTime then
        RDF.jsonSet(s, RDF.PW_WORLD.game_time, data.GameTime)
    end
    if data.DirectorNotes then
        RDF.jsonSet(s, RDF.PW_WORLD.director_notes, data.DirectorNotes)
    end
    if data.Events then
        RDF.jsonSet(s, RDF.PW_WORLD.events, data.Events)
    end
    if data.Interaction then
        RDF.jsonSet(s, RDF.PW_WORLD.interaction, data.Interaction)
    end
    if data.BaseInteraction then
        RDF.jsonSet(s, RDF.PW_WORLD.base_interaction, data.BaseInteraction)
    end

    -- Registry fields
    if data.Registry and data.Registry.creature_attr_fields then
        for _, field in ipairs(data.Registry.creature_attr_fields) do
            RDF.addRegistryField(s, field)
        end
    end

    -- Custom component registry
    if data.CustomComponentRegistry and data.CustomComponentRegistry.custom_components then
        for _, def in ipairs(data.CustomComponentRegistry.custom_components) do
            RDF.addCustomSchemaDef(s, def)
        end
    end

    -- Log
    if data.Log and data.Log.entries then
        RDF.writeLogEntries(s, RDF.PW_WORLD.log_entry, data.Log.entries)
    end

    -- Setting docs
    if data.BindSetting and data.BindSetting.documents then
        RDF.writeSettingDocs(s, "world", "default", RDF.PW_WORLD.setting_doc, data.BindSetting.documents)
    end
end

function RDF.createCreature(creature_data, opts)
    opts = opts or {}
    local c = creature_data.Creature or creature_data
    local creature_id = c.creature_id
    local s = RDF.creatureSubject(creature_id)

    State:set(s, RDF.PW.type, "Creature")
    State:set(s, RDF.PW.name, c.name or "")

    if c.gender then State:set(s, RDF.PWC.gender, c.gender) end
    if c.race then State:set(s, RDF.PWC.race, c.race) end
    if c.emotion then State:set(s, RDF.PWC.emotion, c.emotion) end
    if c.goal then State:set(s, RDF.PWC.goal, c.goal) end
    if c.organization_id then State:set(s, RDF.PWC.organization, c.organization_id) end

    if c.appearance then
        if c.appearance.body then State:set(s, RDF.PWC.appearance_body, c.appearance.body) end
        if c.appearance.clothing then State:set(s, RDF.PWC.appearance_clothing, c.appearance.clothing) end
    end

    if c.titles and #c.titles > 0 then
        RDF.jsonSet(s, RDF.PWC.titles, c.titles)
    end
    if c.attrs and next(c.attrs) then
        RDF.jsonSet(s, RDF.PWC.attrs, c.attrs)
    end
    if c.known_infos and #c.known_infos > 0 then
        RDF.jsonSet(s, RDF.PWC.known_infos, c.known_infos)
    end

    -- IsPlayer
    if opts.is_player or (creature_data.IsPlayer ~= nil) then
        State:set(s, RDF.PWC.is_player, true)
    end

    -- LocationRef
    local loc = creature_data.LocationRef or {}
    if loc.region_id then State:set(s, RDF.PWC.location_region, loc.region_id) end
    if loc.location_id then State:set(s, RDF.PWC.location_point, loc.location_id) end

    -- Inventory
    if creature_data.Inventory and creature_data.Inventory.items then
        for _, item in ipairs(creature_data.Inventory.items) do
            RDF.writeInventoryItem(creature_id, item)
        end
    end

    -- Status effects
    if creature_data.StatusEffects and creature_data.StatusEffects.status_effects then
        for _, se in ipairs(creature_data.StatusEffects.status_effects) do
            RDF.writeStatusEffect(s, creature_id, RDF.PWC.status_effect, se)
        end
    end

    -- Custom components
    if creature_data.CustomComponents and creature_data.CustomComponents.custom_components then
        for _, comp in ipairs(creature_data.CustomComponents.custom_components) do
            RDF.jsonSet(s, RDF.PWC.custom_component_prefix .. comp.component_key, comp.data)
        end
    end

    -- Log
    if creature_data.Log and creature_data.Log.entries then
        RDF.writeLogEntries(s, RDF.PWC.log_entry, creature_data.Log.entries)
    end

    -- Setting docs
    if creature_data.BindSetting and creature_data.BindSetting.documents then
        RDF.writeSettingDocs(s, "creature", creature_id, RDF.PW_WORLD.setting_doc, creature_data.BindSetting.documents)
    end

    -- Interaction
    if creature_data.Interaction then
        RDF.jsonSet(s, RDF.PW_WORLD.interaction, creature_data.Interaction)
    end
end

function RDF.createRegion(region_data)
    local r = region_data.Region or region_data
    local region_id = r.region_id
    local s = RDF.regionSubject(region_id)

    State:set(s, RDF.PW.type, "Region")
    State:set(s, RDF.PW.name, r.region_name or r.name or "")
    if r.description then State:set(s, RDF.PW.description, r.description) end

    if r.locations then RDF.jsonSet(s, RDF.PWR.locations, r.locations) end
    if r.paths then RDF.jsonSet(s, RDF.PWR.paths, r.paths) end

    -- Status effects
    if region_data.StatusEffects and region_data.StatusEffects.status_effects then
        for _, se in ipairs(region_data.StatusEffects.status_effects) do
            RDF.writeStatusEffect(s, region_id, RDF.PWR.status_effect, se)
        end
    end

    -- Log
    if region_data.Log and region_data.Log.entries then
        RDF.writeLogEntries(s, RDF.PWR.log_entry, region_data.Log.entries)
    end

    -- Setting docs
    if region_data.BindSetting and region_data.BindSetting.documents then
        RDF.writeSettingDocs(s, "region", region_id, RDF.PW_WORLD.setting_doc, region_data.BindSetting.documents)
    end

    -- Interaction
    if region_data.Interaction then
        RDF.jsonSet(s, RDF.PW_WORLD.interaction, region_data.Interaction)
    end
end

function RDF.createOrganization(org_data)
    local o = org_data.Organization or org_data
    local org_id = o.organization_id
    local s = RDF.orgSubject(org_id)

    State:set(s, RDF.PW.type, "Organization")
    State:set(s, RDF.PW.name, o.name or "")
    if o.description then State:set(s, RDF.PW.description, o.description) end

    if o.territories then RDF.jsonSet(s, RDF.PWO.territories, o.territories) end

    -- Inventory
    if org_data.Inventory and org_data.Inventory.items then
        for _, item in ipairs(org_data.Inventory.items) do
            RDF.writeInventoryItem(org_id, item)
        end
    end

    -- Status effects
    if org_data.StatusEffects and org_data.StatusEffects.status_effects then
        for _, se in ipairs(org_data.StatusEffects.status_effects) do
            RDF.writeStatusEffect(s, org_id, RDF.PWO.status_effect, se)
        end
    end

    -- Log
    if org_data.Log and org_data.Log.entries then
        RDF.writeLogEntries(s, RDF.PWO.log_entry, org_data.Log.entries)
    end

    -- Setting docs
    if org_data.BindSetting and org_data.BindSetting.documents then
        RDF.writeSettingDocs(s, "org", org_id, RDF.PW_WORLD.setting_doc, org_data.BindSetting.documents)
    end

    -- Interaction
    if org_data.Interaction then
        RDF.jsonSet(s, RDF.PW_WORLD.interaction, org_data.Interaction)
    end
end

-- ============================================================================
-- Entity deletion helpers
-- ============================================================================

function RDF.deleteCreature(creature_id)
    local s = RDF.creatureSubject(creature_id)
    -- Delete all inventory items
    local inv_links = State:match({ subject = s, predicate = RDF.PWC.inventory_item })
    for _, link in ipairs(inv_links) do
        RDF.deleteSubject(link.object)
    end
    -- Delete all status effects
    local se_links = State:match({ subject = s, predicate = RDF.PWC.status_effect })
    for _, link in ipairs(se_links) do
        RDF.deleteSubject(link.object)
    end
    -- Delete all log entries
    local log_links = State:match({ subject = s, predicate = RDF.PWC.log_entry })
    for _, link in ipairs(log_links) do
        RDF.deleteSubject(link.object)
    end
    -- Delete all setting docs (all entity types use pw:settingDoc)
    local doc_links = State:match({ subject = s, predicate = RDF.PW_WORLD.setting_doc })
    for _, link in ipairs(doc_links) do
        RDF.deleteSubject(link.object)
    end
    -- Delete creature subject itself
    RDF.deleteSubject(s)
end

function RDF.deleteRegion(region_id)
    local s = RDF.regionSubject(region_id)
    local se_links = State:match({ subject = s, predicate = RDF.PWR.status_effect })
    for _, link in ipairs(se_links) do RDF.deleteSubject(link.object) end
    local log_links = State:match({ subject = s, predicate = RDF.PWR.log_entry })
    for _, link in ipairs(log_links) do RDF.deleteSubject(link.object) end
    local doc_links = State:match({ subject = s, predicate = RDF.PW_WORLD.setting_doc })
    for _, link in ipairs(doc_links) do RDF.deleteSubject(link.object) end
    RDF.deleteSubject(s)
end

function RDF.deleteOrganization(organization_id)
    local s = RDF.orgSubject(organization_id)
    local doc_links = State:match({ subject = s, predicate = RDF.PW_WORLD.setting_doc })
    for _, link in ipairs(doc_links) do RDF.deleteSubject(link.object) end
    local se_links = State:match({ subject = s, predicate = RDF.PWO.status_effect })
    for _, link in ipairs(se_links) do RDF.deleteSubject(link.object) end
    local log_links = State:match({ subject = s, predicate = RDF.PWO.log_entry })
    for _, link in ipairs(log_links) do RDF.deleteSubject(link.object) end
    RDF.deleteSubject(s)
end

function RDF.deleteWorld()
    local s = RDF.worldSubject()
    local rf_links = State:match({ subject = s, predicate = RDF.PW_WORLD.registry_field })
    for _, link in ipairs(rf_links) do RDF.deleteSubject(link.object) end
    local cs_links = State:match({ subject = s, predicate = RDF.PW_WORLD.custom_schema })
    for _, link in ipairs(cs_links) do RDF.deleteSubject(link.object) end
    local log_links = State:match({ subject = s, predicate = RDF.PW_WORLD.log_entry })
    for _, link in ipairs(log_links) do RDF.deleteSubject(link.object) end
    local doc_links = State:match({ subject = s, predicate = RDF.PW_WORLD.setting_doc })
    for _, link in ipairs(doc_links) do RDF.deleteSubject(link.object) end
    RDF.deleteSubject(s)
end

--- Delete all triples for a given subject
function RDF.deleteSubject(subject)
    if type(subject) ~= "string" then return end
    local triples = State:match({ subject = subject })
    for _, t in ipairs(triples) do
        State:delete(subject, t.predicate, t.object)
    end
end

--- Clear all game entities
function RDF.clearAll()
    -- Delete all creatures
    for _, id in ipairs(RDF.getAllCreatureIds()) do
        RDF.deleteCreature(id)
    end
    -- Delete all regions
    for _, id in ipairs(RDF.getAllRegionIds()) do
        RDF.deleteRegion(id)
    end
    -- Delete all organizations
    for _, id in ipairs(RDF.getAllOrganizationIds()) do
        RDF.deleteOrganization(id)
    end
    -- Delete world
    if RDF.worldExists() then
        RDF.deleteWorld()
    end
end

-- ============================================================================
-- Write helpers (for sub-resources)
-- ============================================================================

function RDF.writeInventoryItem(owner_id, item)
    local item_subject = RDF.inventorySubject(owner_id, item.id)
    local owner_subject_prefix = nil
    -- Determine owner subject and link predicate
    if RDF.creatureExists(owner_id) then
        State:insert(RDF.creatureSubject(owner_id), RDF.PWC.inventory_item, item_subject)
    elseif RDF.orgExists(owner_id) then
        -- Organizations can have inventory too
        State:insert(RDF.orgSubject(owner_id), RDF.PWC.inventory_item, item_subject)
    end

    State:set(item_subject, RDF.PWI.item_id, item.id)
    State:set(item_subject, RDF.PW.name, item.name or "")
    State:set(item_subject, RDF.PW.description, item.description or "")
    State:set(item_subject, RDF.PWI.count, item.count or 1)
    if item.equipped then State:set(item_subject, RDF.PWI.equipped, true) end
    if item.details and #item.details > 0 then
        RDF.jsonSet(item_subject, RDF.PWI.details, item.details)
    end
end

function RDF.writeStatusEffect(entity_subject, owner_id, link_predicate, se)
    local se_subject = RDF.statusEffectSubject(owner_id, se.instance_id)
    State:insert(entity_subject, link_predicate, se_subject)
    if se.display_name then State:set(se_subject, RDF.PW_STATUS.display_name, se.display_name) end
    if se.remark then State:set(se_subject, RDF.PW_STATUS.remark, se.remark) end
    if se.data then RDF.jsonSet(se_subject, RDF.PW_STATUS.data, se.data) end
    if se.add_at then State:set(se_subject, RDF.PW_STATUS.add_at, se.add_at) end
    if se.last_update_at then State:set(se_subject, RDF.PW_STATUS.last_update_at, se.last_update_at) end
end

function RDF.writeLogEntries(entity_subject, link_predicate, entries)
    for i, entry in ipairs(entries) do
        local log_subject = entity_subject .. ":log:" .. (i - 1)
        State:insert(entity_subject, link_predicate, log_subject)
        State:set(log_subject, RDF.PW.order, i - 1)
        State:set(log_subject, RDF.PW_STORY.timestamp, entry.add_at or "")
        State:set(log_subject, RDF.PW_STORY.content, entry.content or "")
    end
end

function RDF.writeSettingDocs(entity_subject, entity_type, entity_id, link_predicate, docs)
    for _, doc in ipairs(docs) do
        local doc_subject = RDF.settingDocSubject(entity_id, doc.name)
        State:insert(entity_subject, link_predicate, doc_subject)
        State:set(doc_subject, RDF.PW.name, doc.name)
        State:set(doc_subject, RDF.PWS.content, doc.content or "")
        if doc.condition then State:set(doc_subject, RDF.PWS.condition, doc.condition) end
        if doc.static_priority then State:set(doc_subject, RDF.PWS.priority, doc.static_priority) end
        if doc.disable then State:set(doc_subject, RDF.PWS.disable, doc.disable) end
    end
end

function RDF.addRegistryField(world_subject, field)
    local world_id = world_subject:sub(#RDF.SUBJECT.world + 1)
    local field_subject = RDF.registryFieldSubject(world_id, field.field_name)
    State:insert(world_subject, RDF.PW_WORLD.registry_field, field_subject)
    State:set(field_subject, RDF.PW_REGISTRY.field_name, field.field_name)
    State:set(field_subject, RDF.PW_REGISTRY.hint, field.hint or "")
    if field.field_display_name then
        State:set(field_subject, RDF.PW_REGISTRY.field_display_name, field.field_display_name)
    end
end

function RDF.addCustomSchemaDef(world_subject, def)
    local world_id = world_subject:sub(#RDF.SUBJECT.world + 1)
    local schema_subject = RDF.customSchemaSubject(world_id, def.component_key)
    State:insert(world_subject, RDF.PW_WORLD.custom_schema, schema_subject)
    State:set(schema_subject, RDF.PW_SCHEMA.component_key, def.component_key)
    State:set(schema_subject, RDF.PW.name, def.component_name or def.component_key)
    State:set(schema_subject, RDF.PW_SCHEMA.is_array, def.is_array == true)
    if def.type_schema then RDF.jsonSet(schema_subject, RDF.PW_SCHEMA.type_schema, def.type_schema) end
    if def.data_registry then RDF.jsonSet(schema_subject, RDF.PW_SCHEMA.data_registry, def.data_registry) end
end

-- ============================================================================
-- Formatted game time helper
-- ============================================================================

function RDF.getFormattedGameTime()
    local gt = RDF.jsonGet(RDF.worldSubject(), RDF.PW_WORLD.game_time)
    if not gt then return nil end
    return string.format("Y%d-M%02d-D%02d %02d:%02d",
        gt.year or 0, gt.month or 0, gt.day or 0, gt.hour or 0, gt.minute or 0)
end

return RDF
