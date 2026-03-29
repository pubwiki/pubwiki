-- watch.lua — Structured game state watch services
--
-- Subscribes to TripleStore changes and pushes fully materialized entity
-- snapshots via callbacks. Each watch service filters by graph, detects
-- which entities were added/modified/deleted, and pushes granular change info
-- along with the current snapshot.
--
-- Callback data format:
--   First call:  { type = "snapshot", data = ... }
--   After that:  { type = "changes", added = {id,...}, deleted = {id,...},
--                   modified = {id,...}, data = ... }


-- ============================================================================
-- Constants
-- ============================================================================

local GRAPH = {
    world    = "graph:world",
    creature = "graph:creature",
    region   = "graph:region",
    org      = "graph:org",
    setting  = "graph:setting",
    story    = "graph:story",
}

local SUBJECT_PREFIX = {
    creature = "creature:",
    region   = "region:",
    org      = "org:",
    world    = "world:",
    inv      = "inv:",
    se       = "se:",
    doc      = "doc:",
    rel      = "rel:",
}

local TYPE_PRED = "pw:type"

-- ============================================================================
-- Helpers
-- ============================================================================

--- Safely call a service, returning nil on error.
local function safeCall(name, inputs)
    local ok, result = pcall(Service.call, name, inputs or {})
    if ok then return result end
    return nil
end

--- Check whether a change batch touches any of the given graphs.
local function touchesGraphs(events, graphs)
    for _, e in ipairs(events) do
        local g = e.triple and e.triple.graph
        if g then
            if graphs[g] then return true end
            -- Setting docs use "graph:setting:entityType:entityId"
            for prefix in pairs(graphs) do
                if g:sub(1, #prefix) == prefix then return true end
            end
        end
    end
    return false
end

--- Extract the entity prefix type from a subject string.
--- Returns prefix key ("creature", "region", "org", "world", "inv", "se", ...)
--- and the ID portion after the prefix, or nil if unknown.
local function parseSubject(subject)
    for key, prefix in pairs(SUBJECT_PREFIX) do
        if subject:sub(1, #prefix) == prefix then
            return key, subject:sub(#prefix + 1)
        end
    end
    return nil, nil
end

--- Analyze a change batch and return which primary entity IDs were affected,
--- plus which were explicitly added or deleted (via pw:type triple).
---
--- @param events table[] Array of change events
--- @param primaryPrefix string The primary subject prefix to track (e.g. "creature")
--- @param relevantGraphs table Set of graphs that are relevant
--- @return table affected  Set of entity IDs that were touched { [id] = true }
--- @return table added     Set of entity IDs where pw:type was inserted
--- @return table deleted   Set of entity IDs where pw:type was deleted
local function analyzeChanges(events, primaryPrefix, relevantGraphs)
    local affected = {}  -- all touched entity IDs
    local typeInserted = {}
    local typeDeleted = {}

    for _, e in ipairs(events) do
        local triple = e.triple
        if not triple then goto continue end

        local g = triple.graph
        -- Only process events in relevant graphs
        local relevant = false
        if g then
            if relevantGraphs[g] then
                relevant = true
            else
                for prefix in pairs(relevantGraphs) do
                    if g:sub(1, #prefix) == prefix then relevant = true; break end
                end
            end
        end
        if not relevant then goto continue end

        local subjType, subjId = parseSubject(triple.subject)

        if subjType == primaryPrefix then
            -- Direct entity change
            affected[subjId] = true
            if triple.predicate == TYPE_PRED then
                if e.type == "insert" then
                    typeInserted[subjId] = true
                elseif e.type == "delete" then
                    typeDeleted[subjId] = true
                end
            end
        elseif subjType == "inv" or subjType == "se" or subjType == "doc" or subjType == "rel" then
            -- Auxiliary subject changed — affects the owner entity.
            -- Compound IDs follow the pattern: prefix:ownerId_auxId
            -- We extract ownerId by taking everything before the last underscore segment.
            -- This is a heuristic; since ownerId may also contain underscores,
            -- we rely on the graph to confirm relevance rather than the exact owner.
            -- Mark all as "some entity in this graph changed" — the diff will
            -- figure out exactly which entity's snapshot changed.
            affected["__aux_changed__"] = true
        end

        ::continue::
    end

    return affected, typeInserted, typeDeleted
end

--- Build the ID set from an array of entity snapshots.
--- @param entities table[] Array of entity objects
--- @param idField string The field name containing the ID (e.g. "creature_id")
--- @return table idSet  { [id] = true }
local function buildIdSet(entities, idField)
    local set = {}
    for _, ent in ipairs(entities or {}) do
        local id = ent[idField]
        if id then set[id] = true end
    end
    return set
end

--- Compute diff between previous and current ID sets,
--- incorporating change analysis for more precise classification.
--- @return table added     Array of added IDs
--- @return table deleted   Array of deleted IDs
--- @return table modified  Array of modified IDs
local function computeDiff(prevIds, currentIds, affected, typeInserted, typeDeleted)
    local added = {}
    local deleted = {}
    local modified = {}

    -- Detect added: in current but not in prev, or pw:type was inserted
    for id in pairs(currentIds) do
        if not prevIds[id] or typeInserted[id] then
            added[#added + 1] = id
        elseif affected[id] or affected["__aux_changed__"] then
            modified[#modified + 1] = id
        end
    end

    -- Detect deleted: in prev but not in current, or pw:type was deleted
    for id in pairs(prevIds) do
        if not currentIds[id] or typeDeleted[id] then
            deleted[#deleted + 1] = id
        end
    end

    return added, deleted, modified
end

-- ============================================================================
-- watch:Creatures
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Creatures")
    :desc("Watch creature changes. Pushes { player, npcs } with granular change info.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event with added/deleted/modified IDs"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.creature] = true,
            [GRAPH.setting] = true,
        }

        local prevCreatureIds = {}
        local prevPlayerId = nil

        local function queryCreatures()
            local player = safeCall("ecs.system:Query.getPlayerEntity", {})
            local npcsResult = safeCall("ecs.system:Query.getNPCEntities", {})
            local playerData = player and player.success and player.found and player or nil
            local npcs = npcsResult and npcsResult.success and npcsResult.entities or {}
            return playerData, npcs
        end

        local function buildCreatureIdSet(playerData, npcs)
            local ids = {}
            if playerData then
                local pid = playerData.Creature and playerData.Creature.creature_id
                if pid then ids[pid] = true end
            end
            for _, npc in ipairs(npcs) do
                local nid = npc.Creature and npc.Creature.creature_id
                if nid then ids[nid] = true end
            end
            return ids
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                local playerData, npcs = queryCreatures()
                prevCreatureIds = buildCreatureIdSet(playerData, npcs)
                inputs.callback({
                    type = "snapshot",
                    data = { player = playerData, npcs = npcs },
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local affected, typeIns, typeDel = analyzeChanges(
                    event.events, "creature", relevantGraphs
                )
                local playerData, npcs = queryCreatures()
                local currentIds = buildCreatureIdSet(playerData, npcs)
                local added, deleted, modified = computeDiff(
                    prevCreatureIds, currentIds, affected, typeIns, typeDel
                )
                prevCreatureIds = currentIds

                inputs.callback({
                    type = "changes",
                    added = added,
                    deleted = deleted,
                    modified = modified,
                    data = { player = playerData, npcs = npcs },
                })
            end
        end
    end)

-- ============================================================================
-- watch:Player
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Player")
    :desc("Watch player creature changes. Pushes player snapshot with change detail.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.creature] = true,
            [GRAPH.setting] = true,
        }

        local function queryPlayer()
            local result = safeCall("ecs.system:Query.getPlayerEntity", {})
            if result and result.success and result.found then
                return result
            end
            return nil
        end

        local prevExists = false
        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                local playerData = queryPlayer()
                prevExists = playerData ~= nil
                inputs.callback({
                    type = "snapshot",
                    data = playerData,
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local affected, typeIns, typeDel = analyzeChanges(
                    event.events, "creature", relevantGraphs
                )
                local playerData = queryPlayer()
                local currentExists = playerData ~= nil
                local pid = playerData and playerData.Creature and playerData.Creature.creature_id

                local change = "modified"
                if currentExists and not prevExists then
                    change = "added"
                elseif not currentExists and prevExists then
                    change = "deleted"
                elseif pid and typeIns[pid] then
                    change = "added"
                elseif pid and typeDel[pid] then
                    change = "deleted"
                end
                prevExists = currentExists

                -- Only push if the player or related data actually changed
                if pid and (affected[pid] or affected["__aux_changed__"]) or change ~= "modified" then
                    inputs.callback({
                        type = "changes",
                        change = change,
                        data = playerData,
                    })
                end
            end
        end
    end)

-- ============================================================================
-- watch:Regions
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Regions")
    :desc("Watch region changes. Pushes region list with granular add/delete/modify info.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.region] = true,
            [GRAPH.setting] = true,
        }

        local prevIds = {}

        local function queryRegions()
            local state = safeCall("state:GetStateFromGame", {})
            return state and state.success and state.data and state.data.Regions or {}
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                local regions = queryRegions()
                prevIds = buildIdSet(regions, "region_id")
                inputs.callback({
                    type = "snapshot",
                    data = { regions = regions },
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local affected, typeIns, typeDel = analyzeChanges(
                    event.events, "region", relevantGraphs
                )
                local regions = queryRegions()
                local currentIds = buildIdSet(regions, "region_id")
                local added, deleted, modified = computeDiff(
                    prevIds, currentIds, affected, typeIns, typeDel
                )
                prevIds = currentIds

                inputs.callback({
                    type = "changes",
                    added = added,
                    deleted = deleted,
                    modified = modified,
                    data = { regions = regions },
                })
            end
        end
    end)

-- ============================================================================
-- watch:Organizations
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Organizations")
    :desc("Watch organization changes. Pushes org list with granular change info.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.org] = true,
            [GRAPH.setting] = true,
        }

        local prevIds = {}

        local function queryOrgs()
            local state = safeCall("state:GetStateFromGame", {})
            return state and state.success and state.data and state.data.Organizations or {}
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                local orgs = queryOrgs()
                prevIds = buildIdSet(orgs, "organization_id")
                inputs.callback({
                    type = "snapshot",
                    data = { organizations = orgs },
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local affected, typeIns, typeDel = analyzeChanges(
                    event.events, "org", relevantGraphs
                )
                local orgs = queryOrgs()
                local currentIds = buildIdSet(orgs, "organization_id")
                local added, deleted, modified = computeDiff(
                    prevIds, currentIds, affected, typeIns, typeDel
                )
                prevIds = currentIds

                inputs.callback({
                    type = "changes",
                    added = added,
                    deleted = deleted,
                    modified = modified,
                    data = { organizations = orgs },
                })
            end
        end
    end)

-- ============================================================================
-- watch:World
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("World")
    :desc("Watch world-level changes (game time, events, registry, etc.).")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.world] = true,
            [GRAPH.setting] = true,
            [GRAPH.story] = true,
        }

        local function queryWorld()
            local state = safeCall("state:GetStateFromGame", {})
            if not (state and state.success and state.data) then return nil end
            return {
                World = state.data.World or {},
                StoryHistory = state.data.StoryHistory or {},
                GameInitialStory = state.data.GameInitialStory,
                GameWikiEntry = state.data.GameWikiEntry,
                AppInfo = state.data.AppInfo,
                GameInitChoice = state.data.GameInitChoice,
            }
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                inputs.callback({
                    type = "snapshot",
                    data = queryWorld(),
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                -- Determine what changed within the world
                local changedAspects = {}
                for _, e in ipairs(event.events) do
                    local g = e.triple and e.triple.graph
                    if g == GRAPH.world then
                        changedAspects["world"] = true
                    elseif g == GRAPH.story then
                        changedAspects["story"] = true
                    elseif g and g:sub(1, #GRAPH.setting) == GRAPH.setting then
                        changedAspects["settings"] = true
                    end
                end

                -- Convert to array
                local aspects = {}
                for k in pairs(changedAspects) do
                    aspects[#aspects + 1] = k
                end

                inputs.callback({
                    type = "changes",
                    changed_aspects = aspects,
                    data = queryWorld(),
                })
            end
        end
    end)

-- ============================================================================
-- watch:State (full state, any change)
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("State")
    :desc("Watch all game state. Pushes full StateData with a summary of which entity types changed.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(data) — snapshot or change event with full StateData"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local function queryState()
            local state = safeCall("state:GetStateFromGame", {})
            return state and state.success and state.data or nil
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                inputs.callback({
                    type = "snapshot",
                    data = queryState(),
                })
            elseif event.type == "changes" then
                -- Summarize which categories changed
                local changedGraphs = {}
                for _, e in ipairs(event.events) do
                    local g = e.triple and e.triple.graph
                    if g == GRAPH.creature then changedGraphs["creatures"] = true
                    elseif g == GRAPH.region then changedGraphs["regions"] = true
                    elseif g == GRAPH.org then changedGraphs["organizations"] = true
                    elseif g == GRAPH.world then changedGraphs["world"] = true
                    elseif g == GRAPH.story then changedGraphs["story"] = true
                    elseif g and g:sub(1, #GRAPH.setting) == GRAPH.setting then
                        changedGraphs["settings"] = true
                    end
                end

                local categories = {}
                for k in pairs(changedGraphs) do
                    categories[#categories + 1] = k
                end

                inputs.callback({
                    type = "changes",
                    changed_categories = categories,
                    data = queryState(),
                })
            end
        end
    end)
