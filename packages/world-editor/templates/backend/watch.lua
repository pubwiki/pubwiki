-- watch.lua — Incremental game state watch services
--
-- Architecture:
--   1. First event  → full query, build local cache, push snapshot (full data)
--   2. Subsequent   → analyzeChanges to get affected IDs,
--                     re-fetch ONLY those entities by ID,
--                     push ONLY the changed entities (not full list)
--
-- Callback data format:
--   snapshot:  { type = "snapshot", data = { ... full data ... } }
--   changes:   { type = "changes",
--                added    = { entity1, entity2, ... },   -- full entity data
--                deleted  = { "id1", "id2", ... },       -- just IDs
--                modified = { entity1, entity2, ... } }  -- full entity data


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

local function safeCall(name, inputs)
    local ok, result = pcall(Service.call, name, inputs or {})
    if ok then return result end
    return nil
end

--- Infer graph from subject prefix (for triples written without graph by ECS services).
--- Returns nil for auxiliary subjects (inv/se/doc/rel) since their owner is ambiguous.
local function inferGraph(subject)
    if not subject then return nil end
    if subject:sub(1, 9) == "creature:" then return GRAPH.creature end
    if subject:sub(1, 7) == "region:" then return GRAPH.region end
    if subject:sub(1, 4) == "org:" then return GRAPH.org end
    if subject:sub(1, 6) == "world:" then return GRAPH.world end
    if subject:sub(1, 6) == "story:" then return GRAPH.story end
    -- inv:/se:/doc:/rel: are ambiguous — owner could be creature, region, or org.
    -- Return nil to let touchesGraphs treat them as "potentially relevant to any watch".
    return nil
end

local function touchesGraphs(events, graphs)
    for _, e in ipairs(events) do
        local triple = e.triple
        if triple then
            local g = triple.graph or inferGraph(triple.subject)
            if g then
                if graphs[g] then return true end
                for prefix in pairs(graphs) do
                    if g:sub(1, #prefix) == prefix then return true end
                end
            else
                -- No graph and can't infer → auxiliary or unknown subject.
                -- Conservatively treat as relevant so analyzeChanges can route via findAuxOwner.
                return true
            end
        end
    end
    return false
end

local function parseSubject(subject)
    for key, prefix in pairs(SUBJECT_PREFIX) do
        if subject:sub(1, #prefix) == prefix then
            return key, subject:sub(#prefix + 1)
        end
    end
    return nil, nil
end

--- Try to find which cached entity owns an auxiliary subject.
local function findAuxOwner(auxSuffix, cachedIds)
    for id in pairs(cachedIds) do
        if auxSuffix:sub(1, #id + 1) == id .. "_" then
            return id
        end
    end
    return nil
end

--- Analyze changes, resolving auxiliary entity owners via cachedIds.
--- Returns: affected set, added set, deleted set, auxUnresolved flag
local function analyzeChanges(events, primaryPrefix, relevantGraphs, cachedIds)
    local affected = {}
    local typeInserted = {}
    local typeDeleted = {}
    local auxUnresolved = false

    for _, e in ipairs(events) do
        local triple = e.triple
        if not triple then goto continue end

        local g = triple.graph or inferGraph(triple.subject)
        local subjType, subjId = parseSubject(triple.subject)

        -- Check graph relevance. Auxiliary subjects (inv/se/doc/rel) have nil graph
        -- and are always considered relevant — findAuxOwner handles routing.
        local relevant = false
        if g then
            if relevantGraphs[g] then
                relevant = true
            else
                for prefix in pairs(relevantGraphs) do
                    if g:sub(1, #prefix) == prefix then relevant = true; break end
                end
            end
        elseif subjType == "inv" or subjType == "se" or subjType == "doc" or subjType == "rel" then
            relevant = true  -- auxiliary: let findAuxOwner decide
        end
        if not relevant then goto continue end

        if subjType == primaryPrefix then
            affected[subjId] = true
            if triple.predicate == TYPE_PRED then
                if e.type == "insert" then
                    typeInserted[subjId] = true
                elseif e.type == "delete" then
                    typeDeleted[subjId] = true
                end
            end
        elseif subjType == "inv" or subjType == "se" or subjType == "doc" or subjType == "rel" then
            local owner = findAuxOwner(subjId, cachedIds)
            if owner then
                affected[owner] = true
            else
                auxUnresolved = true
            end
        end

        ::continue::
    end

    return affected, typeInserted, typeDeleted, auxUnresolved
end

local function cacheIdSet(cache)
    local set = {}
    for id in pairs(cache) do set[id] = true end
    return set
end

local function cacheToArray(cache)
    local list = {}
    for _, v in pairs(cache) do list[#list + 1] = v end
    return list
end


-- ============================================================================
-- watch:Creatures — incremental
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Creatures")
    :desc("Watch creature changes. Snapshot pushes full { player, npcs }. Changes push only affected entities.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.creature] = true,
            [GRAPH.setting] = true,
        }

        local cache = {}       -- { [creature_id] = entity }
        local playerId = nil

        local function fullQuery()
            cache = {}
            playerId = nil
            local result = safeCall("ecs.system:Query.getPlayerEntity", {})
            if result and result.success and result.found and result.Creature then
                local pid = result.Creature.creature_id
                playerId = pid
                cache[pid] = result
            end
            local npcResult = safeCall("ecs.system:Query.getNPCEntities", {})
            if npcResult and npcResult.success then
                for _, npc in ipairs(npcResult.entities or {}) do
                    local nid = npc.Creature and npc.Creature.creature_id
                    if nid then cache[nid] = npc end
                end
            end
        end

        local function fetchById(id)
            local r = safeCall("ecs.system:Query.getCreatureById", { creature_id = id })
            return r and r.success and r.found and r.entity or nil
        end

        local function buildSnapshot()
            local player = playerId and cache[playerId] or nil
            local npcs = {}
            for id, ent in pairs(cache) do
                if id ~= playerId then npcs[#npcs + 1] = ent end
            end
            return { player = player, npcs = npcs }
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                fullQuery()
                inputs.callback({
                    type = "snapshot",
                    data = buildSnapshot(),
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local prevIds = cacheIdSet(cache)
                local affected, typeIns, typeDel, auxUnresolved = analyzeChanges(
                    event.events, "creature", relevantGraphs, prevIds
                )

                local addedEntities = {}
                local deletedIds = {}
                local modifiedEntities = {}

                if auxUnresolved then
                    -- Can't determine owner — full refresh, report all as modified
                    local oldIds = cacheIdSet(cache)
                    fullQuery()
                    for id, ent in pairs(cache) do
                        if not oldIds[id] then
                            addedEntities[#addedEntities + 1] = ent
                        else
                            modifiedEntities[#modifiedEntities + 1] = ent
                        end
                    end
                    for id in pairs(oldIds) do
                        if not cache[id] then deletedIds[#deletedIds + 1] = id end
                    end
                else
                    -- Incremental
                    for id in pairs(typeDel) do
                        if id == playerId then playerId = nil end
                        cache[id] = nil
                        deletedIds[#deletedIds + 1] = id
                    end
                    for id in pairs(affected) do
                        if not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                local isNew = not cache[id] or typeIns[id]
                                cache[id] = ent
                                if ent.IsPlayer then playerId = id end
                                if isNew then
                                    addedEntities[#addedEntities + 1] = ent
                                else
                                    modifiedEntities[#modifiedEntities + 1] = ent
                                end
                            end
                        end
                    end
                    -- Check for new entities we didn't know about (typeIns but not in affected)
                    for id in pairs(typeIns) do
                        if not affected[id] and not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                cache[id] = ent
                                if ent.IsPlayer then playerId = id end
                                addedEntities[#addedEntities + 1] = ent
                            end
                        end
                    end
                end

                inputs.callback({
                    type = "changes",
                    added = addedEntities,
                    deleted = deletedIds,
                    modified = modifiedEntities,
                })
            end
        end
    end)


-- ============================================================================
-- watch:Player — single entity
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Player")
    :desc("Watch player creature changes.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.creature] = true,
            [GRAPH.setting] = true,
        }

        local function queryPlayer()
            local result = safeCall("ecs.system:Query.getPlayerEntity", {})
            if result and result.success and result.found then return result end
            return nil
        end

        local prevExists = false
        local prevPid = nil
        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                local playerData = queryPlayer()
                prevExists = playerData ~= nil
                prevPid = playerData and playerData.Creature and playerData.Creature.creature_id
                inputs.callback({
                    type = "snapshot",
                    data = playerData,
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local cachedIds = {}
                if prevPid then cachedIds[prevPid] = true end
                local affected, typeIns, typeDel = analyzeChanges(
                    event.events, "creature", relevantGraphs, cachedIds
                )

                if prevPid and (affected[prevPid] or typeDel[prevPid]) or next(typeIns) then
                    local playerData = queryPlayer()
                    local currentExists = playerData ~= nil
                    local pid = playerData and playerData.Creature and playerData.Creature.creature_id

                    local change = "modified"
                    if currentExists and not prevExists then change = "added"
                    elseif not currentExists and prevExists then change = "deleted"
                    elseif pid and typeIns[pid] then change = "added"
                    elseif prevPid and typeDel[prevPid] then change = "deleted"
                    end
                    prevExists = currentExists
                    prevPid = pid

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
-- watch:Regions — incremental
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Regions")
    :desc("Watch region changes. Snapshot pushes full list. Changes push only affected entities.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.region] = true,
            [GRAPH.setting] = true,
        }

        local cache = {}

        local function fullQuery()
            cache = {}
            local result = safeCall("ecs.system:Query.getRegionEntities", {})
            for _, r in ipairs(result and result.success and result.regions or {}) do
                local rid = r.Region and r.Region.region_id
                if rid then cache[rid] = r end
            end
        end

        local function fetchById(id)
            local r = safeCall("ecs.system:Query.getRegionById", { region_id = id })
            return r and r.success and r.found and r.entity or nil
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                fullQuery()
                inputs.callback({
                    type = "snapshot",
                    data = { regions = cacheToArray(cache) },
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local prevIds = cacheIdSet(cache)
                local affected, typeIns, typeDel, auxUnresolved = analyzeChanges(
                    event.events, "region", relevantGraphs, prevIds
                )

                local addedEntities = {}
                local deletedIds = {}
                local modifiedEntities = {}

                if auxUnresolved then
                    local oldIds = cacheIdSet(cache)
                    fullQuery()
                    for id, ent in pairs(cache) do
                        if not oldIds[id] then
                            addedEntities[#addedEntities + 1] = ent
                        else
                            modifiedEntities[#modifiedEntities + 1] = ent
                        end
                    end
                    for id in pairs(oldIds) do
                        if not cache[id] then deletedIds[#deletedIds + 1] = id end
                    end
                else
                    for id in pairs(typeDel) do
                        cache[id] = nil
                        deletedIds[#deletedIds + 1] = id
                    end
                    for id in pairs(affected) do
                        if not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                local isNew = not cache[id] or typeIns[id]
                                cache[id] = ent
                                if isNew then
                                    addedEntities[#addedEntities + 1] = ent
                                else
                                    modifiedEntities[#modifiedEntities + 1] = ent
                                end
                            end
                        end
                    end
                    for id in pairs(typeIns) do
                        if not affected[id] and not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                cache[id] = ent
                                addedEntities[#addedEntities + 1] = ent
                            end
                        end
                    end
                end

                inputs.callback({
                    type = "changes",
                    added = addedEntities,
                    deleted = deletedIds,
                    modified = modifiedEntities,
                })
            end
        end
    end)


-- ============================================================================
-- watch:Organizations — incremental
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("Organizations")
    :desc("Watch organization changes. Snapshot pushes full list. Changes push only affected entities.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.org] = true,
            [GRAPH.setting] = true,
        }

        local cache = {}

        local function fullQuery()
            cache = {}
            local result = safeCall("ecs.system:Query.getOrganizationEntities", {})
            for _, o in ipairs(result and result.success and result.organizations or {}) do
                local oid = o.Organization and o.Organization.organization_id
                if oid then cache[oid] = o end
            end
        end

        local function fetchById(id)
            local r = safeCall("ecs.system:Query.getOrganizationById", { organization_id = id })
            return r and r.success and r.found and r.entity or nil
        end

        local firstEvent = true
        for event in State:subscribeChanges() do
            if firstEvent then
                firstEvent = false
                fullQuery()
                inputs.callback({
                    type = "snapshot",
                    data = { organizations = cacheToArray(cache) },
                })
            elseif event.type == "changes" and touchesGraphs(event.events, relevantGraphs) then
                local prevIds = cacheIdSet(cache)
                local affected, typeIns, typeDel, auxUnresolved = analyzeChanges(
                    event.events, "org", relevantGraphs, prevIds
                )

                local addedEntities = {}
                local deletedIds = {}
                local modifiedEntities = {}

                if auxUnresolved then
                    local oldIds = cacheIdSet(cache)
                    fullQuery()
                    for id, ent in pairs(cache) do
                        if not oldIds[id] then
                            addedEntities[#addedEntities + 1] = ent
                        else
                            modifiedEntities[#modifiedEntities + 1] = ent
                        end
                    end
                    for id in pairs(oldIds) do
                        if not cache[id] then deletedIds[#deletedIds + 1] = id end
                    end
                else
                    for id in pairs(typeDel) do
                        cache[id] = nil
                        deletedIds[#deletedIds + 1] = id
                    end
                    for id in pairs(affected) do
                        if not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                local isNew = not cache[id] or typeIns[id]
                                cache[id] = ent
                                if isNew then
                                    addedEntities[#addedEntities + 1] = ent
                                else
                                    modifiedEntities[#modifiedEntities + 1] = ent
                                end
                            end
                        end
                    end
                    for id in pairs(typeIns) do
                        if not affected[id] and not typeDel[id] then
                            local ent = fetchById(id)
                            if ent then
                                cache[id] = ent
                                addedEntities[#addedEntities + 1] = ent
                            end
                        end
                    end
                end

                inputs.callback({
                    type = "changes",
                    added = addedEntities,
                    deleted = deletedIds,
                    modified = modifiedEntities,
                })
            end
        end
    end)


-- ============================================================================
-- watch:World — uses getWorldEntity + direct RDF reads
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("World")
    :desc("Watch world-level changes (game time, events, registry, etc.).")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
    }))
    :outputs(Type.Nil)
    :impl(function(inputs)
        local relevantGraphs = {
            [GRAPH.world] = true,
            [GRAPH.setting] = true,
            [GRAPH.story] = true,
        }

        local function queryWorld()
            local worldResult = safeCall("ecs.system:Query.getWorldEntity", {})
            local world = {}
            if worldResult and worldResult.success and worldResult.found then
                world = {
                    entity_id = worldResult.entity_id,
                    GameTime = worldResult.GameTime,
                    Registry = worldResult.Registry,
                    DirectorNotes = worldResult.DirectorNotes,
                    Log = worldResult.Log,
                    BindSetting = worldResult.BindSetting,
                    CustomComponentRegistry = worldResult.CustomComponentRegistry,
                    Events = worldResult.Events,
                    Interaction = worldResult.Interaction,
                    BaseInteraction = worldResult.BaseInteraction,
                }
            end

            local storyResult = safeCall("state:GetGameInitialStory", {})
            local initialStory = nil
            if storyResult and storyResult.found then
                initialStory = { background = storyResult.background, start_story = storyResult.start_story }
            end

            local appInfo = State:get("game://state", "game://state/app_info")
            local wikiEntry = State:get("game://state", "game://state/game_wiki_entry")
            local gameInitChoice = State:get("game://state", "game://state/game_init_choice")

            return {
                World = world,
                GameInitialStory = initialStory,
                GameWikiEntry = wikiEntry,
                AppInfo = appInfo,
                GameInitChoice = gameInitChoice,
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
                local changedAspects = {}
                for _, e in ipairs(event.events) do
                    local g = e.triple and (e.triple.graph or inferGraph(e.triple.subject))
                    if g == GRAPH.world then changedAspects["world"] = true
                    elseif g == GRAPH.story then changedAspects["story"] = true
                    elseif g and g:sub(1, #GRAPH.setting) == GRAPH.setting then
                        changedAspects["settings"] = true
                    end
                end

                local aspects = {}
                for k in pairs(changedAspects) do aspects[#aspects + 1] = k end

                inputs.callback({
                    type = "changes",
                    changed_aspects = aspects,
                    data = queryWorld(),
                })
            end
        end
    end)


-- ============================================================================
-- watch:State (full state, any change) — for debugging
-- ============================================================================

Service:define()
    :namespace("watch")
    :name("State")
    :desc("Watch all game state. Pushes full StateData with change summary.")
    :inputs(Type.Object({
        callback = Type.Any:desc("function(event)"),
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
                local changedGraphs = {}
                for _, e in ipairs(event.events) do
                    local g = e.triple and (e.triple.graph or inferGraph(e.triple.subject))
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
                for k in pairs(changedGraphs) do categories[#categories + 1] = k end

                inputs.callback({
                    type = "changes",
                    changed_categories = categories,
                    data = queryState(),
                })
            end
        end
    end)
