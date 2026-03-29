-- state.lua
-- 存档/读档系统

local ComponentTypes = require("./components")

-- 从 ComponentTypes 导出存档数据类型
local StateDataType = ComponentTypes.StateDataType

-- State 三元组存储的 subject 常量
local STATE_SUBJECT = "game://state"

-- ============ 存档服务：GetGameState ============


Service:definePure():namespace("state"):name("GetStateFromGame")
    :desc("获取当前游戏状态的完整快照")
    :usage("获取当前游戏的完整状态快照（Pure 服务，不修改状态）。返回 StateDataType 包含 World、Creatures、Regions、Organizations、StoryHistory、GameInitialStory、GameWikiEntry、AppInfo。设定文档存储在各实体的 BindSetting.documents 组件中。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        success = Type.Bool,
        data = Type.Optional(StateDataType),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)


        -- 获取 ECS 快照
        local snapshot = Service.call("ecs:GetSnapshot", {})
        
        if not snapshot or not snapshot.entities then
            return { success = false, error = "Failed to get ECS snapshot" }
        end
        
        -- 初始化结果结构
        local result = {
            World = nil,
            Creatures = {},
            Regions = {},
            Organizations = {},
            StoryHistory = nil,
            GameInitialStory = nil,
            GameWikiEntry = nil,
            SystemPrompts = nil,
        }

        local world_found = false
        
        -- 遍历所有实体，按组件分类
        for _, entity in ipairs(snapshot.entities) do
            local components = entity.components
            local entityId = entity.entity_id
            
            if components.GameTime then
                -- 世界实体（有 GameTime 组件）
                result.World = {
                    entity_id = entityId,
                    GameTime = components.GameTime,
                    Registry = components.Registry,
                    DirectorNotes = components.DirectorNotes,
                    CustomComponentRegistry = components.CustomComponentRegistry,
                    Log = components.Log,
                    BindSetting = components.BindSetting,
                    Events = components.Events,
                    Interaction = components.Interaction,
                    BaseInteraction = components.BaseInteraction,
                }
                world_found = true
            elseif components.Creature then
                -- 生物实体（有 Creature 组件）
                table.insert(result.Creatures, {
                    entity_id = entityId,
                    Creature = components.Creature,
                    LocationRef = components.LocationRef,
                    Inventory = components.Inventory,
                    Equipment = components.Equipment,
                    StatusEffects = components.StatusEffects,
                    Moves = components.Moves,
                    Log = components.Log,
                    IsPlayer = components.IsPlayer,  -- 可能为 nil
                    CustomComponents = components.CustomComponents,
                    BindSetting = components.BindSetting,
                    Interaction = components.Interaction,
                })
            elseif components.Region then
                -- 地域实体（有 Region 组件）
                table.insert(result.Regions, {
                    entity_id = entityId,
                    Metadata = components.Metadata,
                    Region = components.Region,
                    StatusEffects = components.StatusEffects,
                    Log = components.Log,
                    BindSetting = components.BindSetting,
                    Interaction = components.Interaction,
                })
            elseif components.Organization then
                -- 组织实体（有 Organization 组件）
                table.insert(result.Organizations, {
                    entity_id = entityId,
                    Organization = components.Organization,
                    Inventory = components.Inventory,
                    StatusEffects = components.StatusEffects,
                    Log = components.Log,
                    BindSetting = components.BindSetting,
                    Interaction = components.Interaction,
                })
            end
        end

        if not world_found then
            return { success = false, error = "World entity not found in ECS snapshot" }
        end
        

        
        -- 先调用我们下面的服务：GetStoryHistory
        local storyHistoryResults = Service.call("state:GetStoryHistory", {})
    
        if storyHistoryResults.success then
            local storyData = storyHistoryResults.data
            local compiledHistory = {}
            for _, turn_id in ipairs(storyData.turn_ids) do
                table.insert(compiledHistory, {
                    turn_id = turn_id,
                    story = storyData.story[turn_id],
                })
            end
            result.StoryHistory = compiledHistory
        end


        local bg = State:get("story:initial", "pw:initialBackground")
        local ss = State:get("story:initial", "pw:initialStartStory")
        if bg or ss then
            result.GameInitialStory = { background = bg, start_story = ss }
        end

        local wikiEntryResults = State:get(STATE_SUBJECT,"game://state/game_wiki_entry")
        
        result.GameWikiEntry = wikiEntryResults or nil

        local appInfoResults = State:get(STATE_SUBJECT,"game://state/app_info")
        result.AppInfo = appInfoResults or nil

        local gameInitChoiceResults = State:get(STATE_SUBJECT,"game://state/game_init_choice")
        result.GameInitChoice = gameInitChoiceResults or nil

        return {
            success = true,
            data = result,
        }

    end)
-- ============ 获取AppInfo服务：GetAppInfo ============
Service:define():namespace("state"):name("GetAppInfo")
    :desc("获取当前独立应用信息")
    :usage("获取应用元信息（publish_type 等）。未初始化时返回 success=false。")
    :inputs(Type.Object({

    }))
    :outputs(Type.Object({
        success = Type.Bool,
        data = Type.Optional(ComponentTypes.AppInfo),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local appInfo = State:get(STATE_SUBJECT,"game://state/app_info")
        if appInfo then
            return {
                success = true,
                data = appInfo,
            }
        else
            return {
                success = true,
                data = {
                    publish_type = "EDITOR",
                }
            }
        end
    end)


Service:define():namespace("state"):name("SetAppInfo")
    :desc("设置当前独立应用信息")
    :usage("设置应用元信息（name、slug、version、visibility、tags、homepage、publish_type 等）。")
    :inputs(Type.Object({
        data = Type.Optional(ComponentTypes.AppInfo),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
       State:set(STATE_SUBJECT,"game://state/app_info", inputs.data)
       return {
        success = true,
       }
    end)

-- ============ 读档服务：LoadGameState ============

Service:define():namespace("state"):name("LoadStateToGame")
    :desc("从游戏数据快照恢复游戏状态")
    :usage("从 StateDataType 快照恢复游戏状态（破坏性操作：先清空当前世界再重建所有实体）。数据通常来自 GetStateFromGame。会自动清除并重建剧情历史。")
    :inputs(Type.Object({
        data = StateDataType:desc("游戏数据快照"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local stateData = inputs.data
        
        if not stateData then
            return { success = false, error = "Save data is empty" }
        end
        
        -- 1. 清空当前世界
        local clearResult = Service.call("ecs:ClearWorld", {})
        if not clearResult.success then
            return { success = false, error = "Failed to clear world" }
        end

        -- 设定文档现在存储在各实体的 BindSetting.documents 组件中
        -- 不再使用 State 三元组存储
        Service.call("state:ClearStoryHistory", {})
        if stateData.StoryHistory and #stateData.StoryHistory > 0 then
            for _, entry in ipairs(stateData.StoryHistory) do
                Service.call("state:SetNewStoryHistory", {
                    turn_id = entry.turn_id,
                    data = entry.story,
                })
            end
        end

        State:delete(STATE_SUBJECT, "game://state/app_info")

        if stateData.AppInfo then
            -- 设置应用信息
            State:set(STATE_SUBJECT, "game://state/app_info", stateData.AppInfo)
        end

        -- Write GameInitialStory as RDF triples on story:initial
        State:delete("story:initial", "pw:initialBackground")
        State:delete("story:initial", "pw:initialStartStory")
        if stateData.GameInitialStory then
            if stateData.GameInitialStory.background then
                State:set("story:initial", "pw:initialBackground", stateData.GameInitialStory.background)
            end
            if stateData.GameInitialStory.start_story then
                State:set("story:initial", "pw:initialStartStory", stateData.GameInitialStory.start_story)
            end
        end

        State:delete(STATE_SUBJECT, "game://state/game_wiki_entry")

        if stateData.GameWikiEntry then
            State:set(STATE_SUBJECT, "game://state/game_wiki_entry", stateData.GameWikiEntry)
        end

        State:delete(STATE_SUBJECT, "game://state/game_init_choice")

        if stateData.GameInitChoice then
            State:set(STATE_SUBJECT, "game://state/game_init_choice", stateData.GameInitChoice)
        end

        -- 4. 创建世界实体
        if stateData.World then
            local world = stateData.World

            local spawnResult = Service.call("ecs.system:Spawn.spawnWorld", {
                GameTime = world.GameTime,
                Registry = world.Registry,
                DirectorNotes = world.DirectorNotes,
                CustomComponentRegistry = world.CustomComponentRegistry,
                BaseInteraction = world.BaseInteraction,
            })
            
            if not spawnResult.success then
                return { success = false, error = "Failed to create world: " .. (spawnResult.error or (spawnResult._error or "")) }
            end
            
            -- 如果有日志，需要单独设置（因为 spawnWorld 会创建默认日志）
            if world.Log and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Log",
                    data = world.Log,
                    merge = false,
                })
            end
            -- 设置设定文档
            if world.BindSetting and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "BindSetting",
                    data = world.BindSetting,
                    merge = false,
                })
            end
            -- 设置事件
            if world.Events and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Events",
                    data = world.Events,
                    merge = false,
                })
            end
            -- 设置交互选项
            if world.Interaction and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Interaction",
                    data = world.Interaction,
                    merge = false,
                })
            end

            if world.BaseInteraction and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "BaseInteraction",
                    data = world.BaseInteraction,
                    merge = false,
                })
            end
        end
        
        -- 5. 创建地域实体（先创建地域，因为角色可能引用位置）
        for _, region in ipairs(stateData.Regions or {}) do
            local spawnResult = Service.call("ecs.system:Spawn.spawnRegion", {
                Region = region.Region,
                StatusEffects = region.StatusEffects,
            })
            
            if not spawnResult.success then
                return { success = false, error = "Failed to create region: " .. (spawnResult.error or "") }
            end
            
            -- 设置日志
            if region.Log and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Log",
                    data = region.Log,
                    merge = false,
                })
            end
            -- 设置设定文档
            if region.BindSetting and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "BindSetting",
                    data = region.BindSetting,
                    merge = false,
                })
            end
            -- 设置交互选项
            if region.Interaction and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Interaction",
                    data = region.Interaction,
                    merge = false,
                })
            end
        end

        -- 6. 创建组织实体
        for _, org in ipairs(stateData.Organizations or {}) do
            local spawnResult = Service.call("ecs.system:Spawn.spawnOrganization", {
                Organization = org.Organization,
                StatusEffects = org.StatusEffects,
                Inventory = org.Inventory,
            })
            
            if not spawnResult.success then
                return { success = false, error = "Failed to create organization: " .. (spawnResult.error or "") }
            end
            
            -- 设置日志
            if org.Log and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Log",
                    data = org.Log,
                    merge = false,
                })
            end
            -- 设置设定文档
            if org.BindSetting and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "BindSetting",
                    data = org.BindSetting,
                    merge = false,
                })
            end
            -- 设置交互选项
            if org.Interaction and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Interaction",
                    data = org.Interaction,
                    merge = false,
                })
            end
        end

        -- 7. 创建角色实体
        for _, creature in ipairs(stateData.Creatures or {}) do
            local isPlayer = creature.IsPlayer ~= nil
            
            local spawnResult = Service.call("ecs.system:Spawn.spawnCharacter", {
                is_player = isPlayer,
                Creature = creature.Creature,
                LocationRef = creature.LocationRef,
                Equipment = creature.Equipment,
                StatusEffects = creature.StatusEffects,
                Moves = creature.Moves,
                Inventory = creature.Inventory,
                CustomComponents = creature.CustomComponents,
            })
            
            if not spawnResult.success then
                return { success = false, error = "Failed to create character: " .. (spawnResult.error or "") }
            end
            
            -- 设置日志
            if creature.Log and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Log",
                    data = creature.Log,
                    merge = false,
                })
            end
            -- 设置设定文档
            if creature.BindSetting and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "BindSetting",
                    data = creature.BindSetting,
                    merge = false,
                })
            end
            -- 设置交互选项
            if creature.Interaction and spawnResult.entity_id then
                Service.call("ecs:SetComponentData", {
                    entity_id = spawnResult.entity_id,
                    component_key = "Interaction",
                    data = creature.Interaction,
                    merge = false,
                })
            end
        end
        
        return { success = true }
    end)

-- ============ 获取设定文档服务：GetSettingDocsResource ============

Service:definePure():namespace("state"):name("GetSettingDocsResource")
    :desc("从所有实体的 BindSetting 组件中获取设定文档集合")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        success = Type.Bool,
        data = Type.Optional(Type.Array(Type.Object({
            path = Type.Array(Type.String),
            content = Type.String,
            condition = Type.Optional(Type.String),
            static_priority = Type.Optional(Type.Int),
            entity_id = Type.Optional(Type.String),
            specific_id = Type.Optional(Type.String), -- 返回时会根据实体类型自动填充 creature_id / organization_id / region_id / "world"
        }))),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        -- 获取所有实体快照
        local snapshot = Service.call("ecs:GetSnapshot", {})
        if not snapshot or not snapshot.entities then
            return { success = true, data = {} }
        end
        
        local resources = {}
        
        for _, entity in ipairs(snapshot.entities) do
            local comps = entity.components
            if not comps["BindSetting"] or not comps["BindSetting"].documents then
                goto continue_entity
            end
            
            -- 确定实体类型和名称，用于构建 Resource path
            local entity_type = "Unknown"
            local entity_name = "unknown"
            local specific_id = nil

            if comps["Registry"] then
                entity_type = "WorldSetting"
                entity_name = "World"
                specific_id = "world"

            elseif comps["Creature"] then
                entity_type = "CreatureSetting"
                entity_name = comps["Creature"].name or "unknown"
                specific_id = comps["Creature"].creature_id or nil
            elseif comps["Region"] then
                entity_type = "RegionSetting"
                entity_name = comps["Region"].region_name or "unknown"
                specific_id = comps["Region"].region_id or nil
            elseif comps["Organization"] then
                entity_type = "OrganizationSetting"
                entity_name = comps["Organization"].name or "unknown"
                specific_id = comps["Organization"].organization_id or nil
            end
            
            for _, doc in ipairs(comps["BindSetting"].documents) do
                if doc.disable then
                    goto continue_doc
                end
                if not doc.content or doc.content == "" then
                    goto continue_doc
                end
                
                table.insert(resources, {
                    path = { entity_type, entity_name, doc.name },
                    content = doc.content,
                    condition = doc.condition or nil,
                    static_priority = doc.static_priority or nil,
                    entity_id = entity.entity_id,
                    specific_id = specific_id,
                })
                
                ::continue_doc::
            end
            
            ::continue_entity::
        end
        
        return {
            success = true,
            data = resources,
        }
    end)

-- ============ 辅助：解析设定文档目标实体 ============
-- 接受 creature_id / organization_id / region_id，不填则默认世界实体
local function resolveSettingTarget(inputs)
    if inputs.creature_id then
        -- 通过 creature_id 查找实体
        local result = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Creature"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Creature" })
            if comp.found and comp.data.creature_id == inputs.creature_id then
                return eid, nil
            end
        end
        return nil, "creature_id not found: " .. inputs.creature_id
    elseif inputs.organization_id then
        -- 通过 organization_id 查找实体
        local result = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Organization"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Organization" })
            if comp.found and comp.data.organization_id == inputs.organization_id then
                return eid, nil
            end
        end
        return nil, "organization_id not found: " .. inputs.organization_id
    elseif inputs.region_id then
        -- 通过 region_id 查找实体
        local result = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Region"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Region" })
            if comp.found and comp.data.region_id == inputs.region_id then
                return eid, nil
            end
        end
        return nil, "region_id not found: " .. inputs.region_id
    else
        -- 默认使用世界实体
        local result = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Registry"} })
        if result.count > 0 then
            return result.entity_ids[1], nil
        end
        return nil, "World entity not found"
    end
end

-- ============ 设置实体设定文档服务：SetSettingDocs ============

Service:define():namespace("state"):name("SetSettingDocs")
    :desc("设置指定实体的设定文档列表（替换该实体的全部文档）")
    :inputs(Type.Object({
        creature_id = Type.Optional(Type.String):desc("目标角色ID，与 organization_id/region_id 互斥；都不填则为世界实体"),
        organization_id = Type.Optional(Type.String):desc("目标组织ID"),
        region_id = Type.Optional(Type.String):desc("目标地域ID"),
        documents = Type.Array(ComponentTypes.SettingDoc):desc("新的设定文档列表"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local documents = inputs.documents
        if not documents then
            return { success = false, error = "documents cannot be empty" }
        end
        
        local entity_id, err = resolveSettingTarget(inputs)
        if not entity_id then
            return { success = false, error = err }
        end
        
        local result = Service.call("ecs:SetComponentData", {
            entity_id = entity_id,
            component_key = "BindSetting",
            data = { documents = documents },
            merge = false,
        })
        
        if not result.success then
            return { success = false, error = "Failed to set BindSetting: " .. (result.error or "") }
        end
        
        return { success = true }
    end)


Service:define():namespace("state"):name("AppendSettingDoc")
    :desc("向指定实体追加或创建一个设定文档。通过 creature_id/organization_id/region_id 指定目标，不填则默认世界实体。")
    :usage("向指定实体追加设定文档。同名文档已存在则追加内容，否则创建新文档。通过 creature_id/organization_id/region_id 指定目标实体，都不填则默认世界实体。可选 condition 控制召回条件。")
    :inputs(Type.Object({
        creature_id = Type.Optional(Type.String):desc("目标角色ID，与 organization_id/region_id 互斥；都不填则为世界实体"),
        organization_id = Type.Optional(Type.String):desc("目标组织ID, 注意区分，某些团体NPC其实是以角色形式存在的，这时应该使用 creature_id"),
        region_id = Type.Optional(Type.String):desc("目标地域ID"),
        name = Type.String:desc("文档名称"),
        content = Type.String:desc("要追加的文档内容"),
        condition = Type.Optional(Type.String):desc("召回条件，满足条件才会召回此文档"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local doc_name = inputs.name
        local content = inputs.content
        
        if not doc_name or doc_name == "" then
            return { success = false, error = "name cannot be empty" }
        end
        
        local entity_id, err = resolveSettingTarget(inputs)
        if not entity_id then
            return { success = false, error = err }
        end
        
        -- 获取当前实体的 BindSetting 组件
        local getResult = Service.call("ecs:GetComponentData", {
            entity_id = entity_id,
            component_key = "BindSetting",
        })
        
        local documents = {}
        if getResult.found and getResult.data and getResult.data.documents then
            documents = getResult.data.documents
        end
        
        -- 查找同名文档
        local found = false
        for i, doc in ipairs(documents) do
            if doc.name == doc_name then
                -- 追加内容
                documents[i].content = doc.content .. "\n" .. content
                -- 如果提供了 condition，更新它
                if inputs.condition then
                    documents[i].condition = inputs.condition
                end
                found = true
                break
            end
        end
        
        if not found then
            -- 创建新文档
            table.insert(documents, {
                name = doc_name,
                content = content,
                condition = inputs.condition or nil,
            })
        end
        
        -- 写回 BindSetting 组件
        local setResult = Service.call("ecs:SetComponentData", {
            entity_id = entity_id,
            component_key = "BindSetting",
            data = { documents = documents },
            merge = false,
        })
        
        if not setResult.success then
            return { success = false, error = "Failed to update BindSetting: " .. (setResult.error or "") }
        end
        
        return { success = true }
    end)


-- UpdateSettingDoc 已移至 rag.lua 中通过行号范围批量处理，不再作为独立服务


Service:define():namespace("state"):name("SetNewStoryHistory")
    :desc("设置新的剧情历史数据")
    :usage("记录一个新的剧情回合历史。每个回合通过唯一 turn_id 标识，data 包含任意格式的 content 和关联的 checkpoint_id。使用 RDF 风格存储：subject=story:{turn_id}。")
    :inputs(Type.Object({
        turn_id = Type.String:desc("当前回合ID"),
        data = Type.Object({ content = Type.Any:desc("新的剧情历史数据"), checkpoint_id = Type.Optional(Type.String):desc("存档ID") }):desc("剧情历史数据"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local subject = "story:" .. inputs.turn_id
        State:set(subject, "pw:type", "StoryEntry")
        State:set(subject, "pw:storyContent", inputs.data.content)
        if inputs.data.checkpoint_id then
            State:set(subject, "pw:storyCheckpointId", inputs.data.checkpoint_id)
        end
        return { success = true }
    end)

Service:definePure():namespace("state"):name("GetStoryHistory")
    :desc("获取所有剧情历史数据")
    :usage("获取所有已记录的剧情历史，返回按 turn_id 排序的 turn_ids 列表和对应的 story 字典。RDF 查询：pw:type=StoryEntry。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        data = Type.Object({
            turn_ids = Type.Array(Type.String):desc("所有回合ID列表"),
            story = Type.Record(Type.Object({ content = Type.Any:desc("剧情历史数据"), checkpoint_id = Type.Optional(Type.String):desc("存档ID") })):desc("所有回合对应的剧情历史数据"),
        }),
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local triples = State:match({ predicate = "pw:type", object = "StoryEntry" })

        local all_turn_ids = {}
        local result_data = {}

        if triples then
            for _, triple in ipairs(triples) do
                -- subject is "story:{turn_id}", strip "story:" prefix (6 chars)
                local turn_id = string.sub(triple.subject, 7)
                if turn_id and turn_id ~= "" then
                    table.insert(all_turn_ids, turn_id)
                    local content = State:get(triple.subject, "pw:storyContent")
                    local checkpoint_id = State:get(triple.subject, "pw:storyCheckpointId")
                    result_data[turn_id] = { content = content, checkpoint_id = checkpoint_id }
                end
            end
        end

        table.sort(all_turn_ids)
        return { success = true, data = { turn_ids = all_turn_ids, story = result_data } }
    end)

Service:define():namespace("state"):name("ClearStoryHistory")
    :desc("清除所有剧情历史数据")
    :usage("删除所有剧情历史记录（破坏性操作，不可恢复）。通常用于开始新游戏或清空测试数据。LoadStateToGame 会自动调用此服务。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local triples = State:match({ predicate = "pw:type", object = "StoryEntry" })
        if triples then
            for _, triple in ipairs(triples) do
                State:delete(triple.subject, "pw:type")
                State:delete(triple.subject, "pw:storyContent")
                State:delete(triple.subject, "pw:storyCheckpointId")
            end
        end
        return { success = true }
    end)

-- ============ 开局选择服务：InitialGameFromChoice ============

Service:define():namespace("state"):name("InitialGameFromChoice")
    :desc("根据开局选项ID初始化游戏：设置玩家角色、删除排除实体、覆盖开场故事、禁用选择。")
    :usage("传入 choice_id，服务会：1) 给指定角色添加 IsPlayer 组件，其余角色移除 IsPlayer；2) 删除排除的角色/地域/组织实体；3) 覆盖 GameInitialStory（如有）；4) 将 enable 置为 false。")
    :inputs(Type.Object({
        choice_id = Type.String:desc("选中的开局选项ID"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local choiceId = inputs.choice_id

        -- 1. 读取 GameInitChoice
        local choiceData = State:get(STATE_SUBJECT, "game://state/game_init_choice")
        if not choiceData or not choiceData.enable then
            return { success = false, error = "GameInitChoice is not enabled or not found" }
        end

        -- 2. 查找选项
        local selectedChoice = nil
        for _, choice in ipairs(choiceData.choices or {}) do
            if choice.id == choiceId then
                selectedChoice = choice
                break
            end
        end

        if not selectedChoice then
            return { success = false, error = "Choice not found: " .. choiceId }
        end

        local playerCreatureId = selectedChoice.player_creature_id

        -- 3. 遍历所有 Creature 实体，设置/移除 IsPlayer
        local creatureEntities = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Creature"} })
        for _, eid in ipairs(creatureEntities.entity_ids or {}) do
            local creatureComp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Creature" })
            if creatureComp.found then
                local cid = creatureComp.data.creature_id
                local hasPlayer = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "IsPlayer" })

                if cid == playerCreatureId then
                    -- 需要成为玩家
                    if not hasPlayer.found then
                        Service.call("ecs:AddComponent", { entity_id = eid, component_key = "IsPlayer", data = {} })
                    end
                else
                    -- 需要移除玩家标记
                    if hasPlayer.found then
                        Service.call("ecs:RemoveComponent", { entity_id = eid, component_key = "IsPlayer" })
                    end
                end
            end
        end

        -- 4. 删除排除的角色
        local excludeCreatures = selectedChoice.exclude_creature_ids or {}
        for _, excludeCid in ipairs(excludeCreatures) do
            for _, eid in ipairs(creatureEntities.entity_ids or {}) do
                local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Creature" })
                if comp.found and comp.data.creature_id == excludeCid then
                    Service.call("ecs:DespawnEntity", { entity_id = eid })
                    break
                end
            end
        end

        -- 5. 删除排除的地域
        local excludeRegions = selectedChoice.exclude_region_ids or {}
        if #excludeRegions > 0 then
            local regionEntities = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Region"} })
            for _, excludeRid in ipairs(excludeRegions) do
                for _, eid in ipairs(regionEntities.entity_ids or {}) do
                    local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Region" })
                    if comp.found and comp.data.region_id == excludeRid then
                        Service.call("ecs:DespawnEntity", { entity_id = eid })
                        break
                    end
                end
            end
        end

        -- 6. 删除排除的组织
        local excludeOrgs = selectedChoice.exclude_organization_ids or {}
        if #excludeOrgs > 0 then
            local orgEntities = Service.call("ecs:GetEntitiesByComponent", { component_keys = {"Organization"} })
            for _, excludeOid in ipairs(excludeOrgs) do
                for _, eid in ipairs(orgEntities.entity_ids or {}) do
                    local comp = Service.call("ecs:GetComponentData", { entity_id = eid, component_key = "Organization" })
                    if comp.found and comp.data.organization_id == excludeOid then
                        Service.call("ecs:DespawnEntity", { entity_id = eid })
                        break
                    end
                end
            end
        end

        -- 7. 覆盖 GameInitialStory（如选项指定了）
        if selectedChoice.background_story then
            State:set("story:initial", "pw:initialBackground", selectedChoice.background_story)
        end
        if selectedChoice.start_story then
            State:set("story:initial", "pw:initialStartStory", selectedChoice.start_story)
        end

        -- 8. 将 enable 置为 false
        choiceData.enable = false

        choiceData.choices = { selectedChoice }  -- 只保留选中的选项

        State:set(STATE_SUBJECT, "game://state/game_init_choice", choiceData)

        return { success = true }
    end)

-- ============ 获取开场故事：GetGameInitialStory ============

Service:definePure():namespace("state"):name("GetGameInitialStory")
    :desc("获取游戏的背景故事和开场故事")
    :usage("获取 GameInitialStory（背景故事 background 和开场故事 start_story）。Pure 服务，不修改状态。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        success = Type.Bool,
        found = Type.Bool,
        background = Type.Optional(Type.String):desc("背景故事"),
        start_story = Type.Optional(Type.String):desc("开场故事"),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local background = State:get("story:initial", "pw:initialBackground")
        local start_story = State:get("story:initial", "pw:initialStartStory")
        if not background and not start_story then
            return { success = true, found = false }
        end
        return {
            success = true,
            found = true,
            background = background,
            start_story = start_story,
        }
    end)

return {
    StateDataType = StateDataType,
}