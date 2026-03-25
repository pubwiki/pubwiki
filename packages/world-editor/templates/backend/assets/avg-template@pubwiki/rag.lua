Loader.loadModule("ecs@pubwiki")
require("./components")
require("./systems")
require("./state")
local ServiceRegistry = require("core/service")

local PromptTemplateWithSettingDocs = require("./prompt_update_gamestate_and_setting")
local PartialJson = require("partial-json")
local STATE_SUBJECT = "game:state"

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

local function is_indexable(obj)
    local t = type(obj)
    if t == "table" then return true end
    local mt = getmetatable(obj)
    return mt ~= nil and mt.__index ~= nil
end


-- 辅助函数：从 Registry 读取 creature_attr_fields，生成描述文本
local function getCreatureAttrFieldsDesc()
    local worldEntityId = getWorldEntityId()
    if not worldEntityId then
        return "(No world entity found, attribute fields unknown)"
    end
    local registryResult = Service.call("ecs:GetComponentData", {
        entity_id = worldEntityId,
        component_key = "Registry"
    })
    if not registryResult.found or not registryResult.data.creature_attr_fields or #registryResult.data.creature_attr_fields == 0 then
        return "(No creature_attr_fields defined in Registry)"
    end
    local parts = {}
    for _, field in ipairs(registryResult.data.creature_attr_fields) do
        table.insert(parts, string.format("  - %s: %s", field.field_name, field.hint))
    end
    return "Attribute names defined by Registry.creature_attr_fields:\n" .. table.concat(parts, "\n")
end

Service:define()
    :namespace("GameTemplate")
    :name("GetGameEntityStatusEffectsOverview")
    :desc("获取当前游戏中所有实体的状态效果简略概览文本，以伪XML格式输出")
    :usage("无需参数。返回文本，每个实体以伪 XML 格式描述其状态效果。是一个简略概览，主要包含状态效果名称、持续时间、以及简要描述。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        overview_text = Type.String:desc("游戏实体状态效果概览文本")
    }))
    :impl(function(inputs)
        local result = ServiceRegistry.call("ecs:GetSnapshot", {
            includeMetadata = true
        })
        local overview_text = ""
        for i, entity in ipairs(result.entities) do
            local text = ""
            local entity_type = "Unknown"
            local comps = entity.components
            -- 判断实体类型
            if comps["Registry"] then
                entity_type = "World"
            elseif comps["Creature"] then
                entity_type = "Creature"
            elseif comps["Region"] then
                entity_type = "Region"
            elseif comps["Organization"] then
                entity_type = "Organization"
            end
            
            local entity_name = comps["Metadata"] and comps["Metadata"].name or "无名"
            text = text .. string.format("<Entity type=\"%s\" name=\"%s\">\n", entity_type, entity_name)
            
            if comps["StatusEffects"] then
                local effects = comps["StatusEffects"].status_effects
                if effects and #effects > 0 then
                    text = text .. "  <StatusEffects hint=\"Current status effects list\">\n"
                    for _, effect in ipairs(effects) do
                        text = text .. string.format("    <StatusEffect instance_id=\"%s\"",
                            effect.instance_id or "")
                        if effect.remark then
                            text = text .. string.format(" remark=\"%s\"", effect.remark)
                        end
                        text = text .. ">\n"
                        if effect.data then
                            text = text .. string.format("      <Data>%s</Data>\n", json.encode(effect.data))
                        end
                        text = text .. "    </StatusEffect>\n"
                    end
                    text = text .. "  </StatusEffects>\n"
                end
            end
            text = text .. "</Entity>"
            
            overview_text = overview_text .. text .. "\n"
        end
        
        return {overview_text = overview_text}
    end)


Service:define()
    :namespace("GameTemplate")
    :name("GetGameEntityOverview")
    :desc("获取当前游戏中所有实体及其状态的简略概览文本，以伪XML格式输出")
    :usage("无需参数。返回字典 {entity_id: xml_text}，每个实体以伪 XML 格式描述其所有组件（属性、背包、关系、位置、自定义组件等）。是最底层的实体信息序列化服务。mode='updater' 时省略 DirectorNotes 和 Log 以节省 token。")
    :inputs(Type.Object({
        mode = Type.Optional(Type.String):desc("概览模式，默认为完整模式。'updater' 模式省略 DirectorNotes 和 Log 组件以节省 token"),
    }))
    :outputs(Type.Object({
        overviews = Type.Record(Type.String):desc("游戏实体ID到其概览文本的映射表")
    }))
    :impl(function(inputs)
        local is_updater = inputs.mode == "updater"
        local result = ServiceRegistry.call("ecs:GetSnapshot", {
            includeMetadata = true
        })

        local overviews = {}
        
        -- 缓存 CustomComponentRegistry 定义，按 component_key 索引
        local customComponentDefs = {}
        for _, entity in ipairs(result.entities) do
            if entity.components["CustomComponentRegistry"] then
                local registry = entity.components["CustomComponentRegistry"].custom_components
                if registry then
                    for _, def in ipairs(registry) do
                        customComponentDefs[def.component_key] = def
                    end
                end
                break  -- 只有一个 World 实体有 CustomComponentRegistry
            end
        end
        
        for i, entity in ipairs(result.entities) do
            local text = ""
            local entity_type = "Unknown"
            local comps = entity.components
            
            -- 判断实体类型
            if comps["Registry"] then
                entity_type = "World"
            elseif comps["Creature"] then
                entity_type = "Creature"
            elseif comps["Region"] then
                entity_type = "Region"
            elseif comps["Organization"] then
                entity_type = "Organization"
            end
            
            local entity_name = comps["Metadata"] and comps["Metadata"].name or "Unknown"
            text = text .. string.format("<Entity type=\"%s\" name=\"%s\">\n", entity_type, entity_name)

            -- ============ 世界实体组件 ============
            if comps["GameTime"] then
                local gt = comps["GameTime"]
                text = text .. string.format("  <GameTime hint=\"Current date and time in the virtual world\" year=\"%d\" month=\"%d\" day=\"%d\" hour=\"%d\" minute=\"%d\"/>\n", 
                    gt.year, gt.month, gt.day, gt.hour, gt.minute)
            end
            
            if comps["Registry"] then
                -- Registry 仅存储 creature_attr_fields，ID 列表已通过 ECS 查询获取
            end
            
            if comps["CustomComponentRegistry"] then
                local registry = comps["CustomComponentRegistry"].custom_components
                if registry and #registry > 0 then
                    text = text .. "  <CustomComponentRegistry hint=\"Custom component registry\">\n"
                    for _, def in ipairs(registry) do
                        text = text .. string.format("    <ComponentDef component_key=\"%s\" is_array=%s>\n", def.component_key, tostring(def.is_array or false))
                        if def.type_schema and type(def.type_schema) == "table" then
                            text = text .. string.format("      <TypeSchema>%s</TypeSchema>\n", json.encode(def.type_schema))
                        elseif def.type_schema and def.type_schema ~= "" then
                            text = text .. string.format("      <TypeSchema>%s</TypeSchema>\n", tostring(def.type_schema))
                        end
                        if def.data_registry then
                            text = text .. "      <DataRegistry>\n"
                            for _, item in ipairs(def.data_registry) do
                                text = text .. string.format("        <Item id=\"%s\">%s</Item>\n", item.item_id, json.encode(item.data) or "{}")
                            end
                            text = text .. "      </DataRegistry>\n"
                        end
                        text = text .. "    </ComponentDef>\n"
                    end
                    text = text .. "  </CustomComponentRegistry>\n"
                end
            end
            
            
            if comps["DirectorNotes"] and not is_updater then
                local dn = comps["DirectorNotes"]
                local has_notes = dn.notes and #dn.notes > 0
                local has_flags = dn.flags
                local has_stage_goal = dn.stage_goal and dn.stage_goal ~= ""
                if has_notes or has_flags or has_stage_goal then
                    text = text .. "  <DirectorNotes hint=\"Director notes and flags: plot summaries, direction suggestions, and key event switches\">\n"
                    if has_stage_goal then
                        text = text .. string.format("    <StageGoal hint=\"⚠️Current stage narrative goal — you MUST design the plot following this goal's pace and direction\">%s</StageGoal>\n", dn.stage_goal)
                    end
                    if has_notes then
                        local total = #dn.notes
                        local start_idx = math.max(1, total - 9) -- only last 10 notes
                        local recent_start = math.max(start_idx, total - 2) -- last 3 are "recent"
                        for i = start_idx, total do
                            local note = dn.notes[i]
                            local tag
                            if i < recent_start then
                                tag = "Outdated note, for reference only"
                            else
                                tag = "Recent note, review carefully"
                            end
                            text = text .. string.format("    <Note index=\"%d\" hint=\"%s\">%s</Note>\n", i, tag, note)
                        end
                    end
                    if has_flags then
                        for key, flag in pairs(dn.flags) do
                            local remark_attr = flag.remark and string.format(" remark=\"%s\"", flag.remark) or ""
                            text = text .. string.format("    <Flag id=\"%s\" value=\"%s\"%s />\n", key, tostring(flag.value), remark_attr)
                        end
                    end
                    text = text .. "  </DirectorNotes>\n"
                end
            end
            
            
            -- ============ 角色实体组件 ============
            if comps["Creature"] then
                local ca = comps["Creature"]
                text = text .. string.format("  <Creature hint=\"Creature attributes\" creature_id=\"%s\" name=\"%s\"", ca.creature_id, ca.name)
                if ca.organization_id then
                    text = text .. string.format(" organization_id=\"%s\"", ca.organization_id)
                end
                text = text .. ">\n"

                -- 性别与种族
                if ca.gender then
                    text = text .. string.format("    <Gender mark=\"%s\">%s</Gender>\n", "Note: follow the gender to generate content", ca.gender)
                end
                if ca.race then
                    text = text .. string.format("    <Race>%s</Race>\n", ca.race)
                end

                -- 外貌和服饰
                if ca.appearance and ca.appearance.body then
                    text = text .. string.format("    <Body hint=\"Appearance description\">%s</Body>\n", ca.appearance.body)
                end

                if ca.appearance and ca.appearance.clothing then
                    text = text .. string.format("    <Clothing hint=\"Clothing description\">%s</Clothing>\n", ca.appearance.clothing)
                end

                -- 情绪状态（自由文本）
                if ca.emotion then
                    text = text .. string.format("    <Emotion hint=\"Current emotional state\">%s</Emotion>\n", ca.emotion)
                end
                
                -- 称号
                if ca.titles and #ca.titles > 0 then
                    text = text .. "    <Titles hint=\"Title list\">" .. table.concat(ca.titles, ", ") .. "</Titles>\n"
                end
                
                -- 生物属性（动态遍历 Record）
                if ca.attrs then
                    local attr_parts = {}
                    local attrs = ca.attrs or {}
                    for k, v in pairs(attrs) do
                        table.insert(attr_parts, string.format('%s="%s"', k, tostring(v)))
                    end
                    text = text .. string.format('    <Attrs hint="Creature stats" %s/>\n', table.concat(attr_parts, " "))
                end

                if ca.known_infos and #ca.known_infos > 0 then
                    text = text .. "    <KnownInfos hint=\"Known information about this creature\">\n"
                    for _, info in ipairs(ca.known_infos) do
                        text = text .. string.format("      <Info>%s</Info>\n", info)
                    end
                    text = text .. "    </KnownInfos>\n"
                end

                if ca.goal then
                    text = text .. string.format("    <Goal hint=\"Current goal or motivation\">%s</Goal>\n", ca.goal)
                end

                text = text .. "  </Creature>\n"
            end
            
            if comps["LocationRef"] then
                local loc = comps["LocationRef"]
                text = text .. string.format("  <LocationRef hint=\"Entity's current region and location\" region_id=\"%s\" location_id=\"%s\"/>\n", 
                    loc.region_id or "", loc.location_id or "")
            end
            
            if comps["Inventory"] then
                local inv = comps["Inventory"]
                if inv.items and #inv.items > 0 then
                    text = text .. "  <Inventory hint=\"Carried items list\">\n"
                    for _, item in ipairs(inv.items) do
                        local equipped_attr = item.equipped and " equipped=\"true\"" or ""
                        text = text .. string.format("    <Item id=\"%s\" count=\"%d\"%s>\n", item.id, item.count, equipped_attr)
                        text = text .. string.format("      <Description>%s</Description>\n", item.description or "")
                        if item.details and #item.details > 0 then
                            for _, detail in ipairs(item.details) do
                                text = text .. string.format("      <Detail>%s</Detail>\n", detail)
                            end
                        end
                        text = text .. "    </Item>\n"
                    end
                    text = text .. "  </Inventory>\n"
                end
            end
            
            if comps["Relationship"] then
                local rel = comps["Relationship"]
                if rel.relationships and #rel.relationships > 0 then
                    text = text .. "  <Relationships hint=\"Relationship list, value is affinity 10-100\">\n"
                    for _, r in ipairs(rel.relationships) do
                        text = text .. string.format("    <Relationship target=\"%s\" name=\"%s\" value=\"%d\"/>\n",
                            r.target_creature_id, r.name, r.value)
                    end
                    text = text .. "  </Relationships>\n"
                end
            end
            
            if comps["IsPlayer"] then
                text = text .. "  <IsPlayer hint=\"Marks this entity as the player character\"/>\n"
            end
            
            -- 自定义组件数据
            if comps["CustomComponents"] then
                local cc = comps["CustomComponents"]
                if cc.custom_components and #cc.custom_components > 0 then
                    text = text .. "  <CustomComponents hint=\"Custom component data\">\n"
                    for _, comp in ipairs(cc.custom_components) do
                        local def = customComponentDefs[comp.component_key]
                        local schema_props = nil
                        if def and def.type_schema and type(def.type_schema) == "table" and def.type_schema.properties then
                            schema_props = def.type_schema.properties
                        end
                        
                        text = text .. string.format("    <Component key=\"%s\">\n", comp.component_key)
                        
                        if type(comp.data) == "table" then
                            -- 检查是否是数组（有连续整数key）
                            local isArray = #comp.data > 0 or next(comp.data) == nil
                            if isArray and #comp.data > 0 then
                                -- 数组型：每个元素独立渲染
                                for idx, item in ipairs(comp.data) do
                                    if type(item) == "table" then
                                        text = text .. string.format("      [%d] ", idx)
                                        local parts = {}
                                        for k, v in pairs(item) do
                                            local desc = ""
                                            if schema_props and is_indexable(schema_props) and schema_props[k] and is_indexable(schema_props[k]) and schema_props[k].description then
                                                desc = " //" .. schema_props[k].description
                                            end
                                            table.insert(parts, string.format("%s: %s%s", k, tostring(v), desc))
                                        end
                                        text = text .. table.concat(parts, ", ") .. "\n"
                                    else
                                        text = text .. string.format("      [%d] %s\n", idx, tostring(item))
                                    end
                                end
                            else
                                -- 对象型：逐字段渲染，附带描述注释
                                for k, v in pairs(comp.data) do
                                    local desc = ""
                                    if schema_props and is_indexable(schema_props) and schema_props[k] and is_indexable(schema_props[k]) and schema_props[k].description then
                                        desc = " //" .. schema_props[k].description
                                    end
                                    text = text .. string.format("      %s: %s%s\n", k, tostring(v), desc)
                                end
                            end
                        else
                            text = text .. string.format("      %s\n", tostring(comp.data))
                        end
                        text = text .. "    </Component>\n"
                    end
                    text = text .. "  </CustomComponents>\n"
                end
            end
            
            -- ============ 地域实体组件 ============
            if comps["Region"] then
                local lap = comps["Region"]
                text = text .. string.format("  <Region hint=\"Region entity with location list and available paths\" region_id=\"%s\" region_name=\"%s\">\n", 
                    lap.region_id, lap.region_name)
                text = text .. string.format("    <Description>%s</Description>\n", lap.description or "")
                
                if lap.locations and #lap.locations > 0 then
                    text = text .. "    <Locations hint=\"Location list\">\n"
                    for _, loc in ipairs(lap.locations) do
                        text = text .. string.format("      <Location id=\"%s\" name=\"%s\">%s</Location>\n",
                            loc.id, loc.name, loc.description or "")
                    end
                    text = text .. "    </Locations>\n"
                end
                
                if lap.paths and #lap.paths > 0 then
                    text = text .. "    <Paths hint=\"Available paths, discovered indicates whether found\">\n"
                    for _, path in ipairs(lap.paths) do
                        text = text .. string.format("      <Path discovered=\"%s\" to_region=\"%s\" to_location=\"%s\">%s</Path>\n",
                            tostring(path.discovered), path.to_region, path.to_location, path.description or "")
                    end
                    text = text .. "    </Paths>\n"
                end
                
                text = text .. "  </Region>\n"
            end
            
            -- ============ 组织实体组件 ============
            if comps["Organization"] then
                local org = comps["Organization"]
                text = text .. string.format("  <Organization hint=\"Organization entity info\" organization_id=\"%s\" name=\"%s\">\n", 
                    org.organization_id, org.name)
                text = text .. string.format("    <Description>%s</Description>\n", org.description or "")
                
                if org.territories and #org.territories > 0 then
                    text = text .. "    <Territories hint=\"Territory list owned by the organization\">\n"
                    for _, terr in ipairs(org.territories) do
                        text = text .. string.format("      <Territory region_id=\"%s\" location_id=\"%s\"/>\n",
                            terr.region_id, terr.location_id)
                    end
                    text = text .. "    </Territories>\n"
                end
                
                text = text .. "  </Organization>\n"
            end
            
            -- ============ 通用组件 ============
            if comps["StatusEffects"] then
                local effects = comps["StatusEffects"].status_effects
                if effects and #effects > 0 then
                    text = text .. "  <StatusEffects hint=\"Current status effects list\">\n"
                    for _, effect in ipairs(effects) do
                        text = text .. string.format("    <StatusEffect instance_id=\"%s\"",
                            effect.instance_id or "")
                        if effect.remark then
                            text = text .. string.format(" remark=\"%s\"", effect.remark)
                        end
                        text = text .. ">\n"
                        if effect.data then
                            text = text .. string.format("      <Data>%s</Data>\n", json.encode(effect.data))
                        end
                        if effect.add_at then
                            text = text .. string.format("      <AddedAt>%s</AddedAt>\n", effect.add_at)
                        end
                        if effect.last_updated_at then
                            text = text .. string.format("      <LastUpdatedAt>%s</LastUpdatedAt>\n", effect.last_updated_at)
                        end
                        text = text .. "    </StatusEffect>\n"
                    end
                    text = text .. "  </StatusEffects>\n"
                end
            end
            
            if comps["Log"] and not is_updater then
                local log = comps["Log"]
                if log.entries and #log.entries > 0 then
                    text = text .. "  <Log hint=\"Log entries recording events that occurred\">\n"
                    for _, entry in ipairs(log.entries) do
                        text = text .. string.format("    <Entry>%s, addAt:%s</Entry>\n", entry.content, entry.add_at)
                    end
                    text = text .. "  </Log>\n"
                end
            end
            
            text = text .. "</Entity>"
            
            overviews[tostring(entity.entity_id)] = text
        end
        
        return {overviews = overviews}
    end)

Service:define()
    :namespace("GameTemplate")
    :name("GetGameEntitySpecificIds")
    :desc("获取当前游戏中所有实体的各自的ID")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        org_entity_ids = Type.Array(Type.String):desc("组织实体ID列表"),
        region_entity_ids = Type.Array(Type.String):desc("地域实体ID列表"),
        creature_entity_ids = Type.Array(Type.String):desc("角色实体ID列表"),
        player_entity_id = Type.Optional(Type.String):desc("玩家角色实体ID"),
    }))
    :impl(function(inputs)
        local result = ServiceRegistry.call("ecs:GetSnapshot", {
            includeMetadata = true
        })

        local org_entity_ids = {}
        local region_entity_ids = {}
        local creature_entity_ids = {}
        local player_entity_id = nil
        
        for i, entity in ipairs(result.entities) do
            local text = ""
            local entity_type = "Unknown"
            local comps = entity.components
            
            -- 判断实体类型
            if comps["Registry"] then
                entity_type = "World"
            elseif comps["Creature"] then
                entity_type = "Creature"
                table.insert(creature_entity_ids,  comps["Creature"].creature_id)
                if comps["IsPlayer"] then
                    player_entity_id = comps["Creature"].creature_id
                end
            elseif comps["Region"] then
                entity_type = "Region"
                table.insert(region_entity_ids, comps["Region"].region_id)
            elseif comps["Organization"] then
                entity_type = "Organization"
                table.insert(org_entity_ids, comps["Organization"].organization_id)
            end
        end
        
        return {
            org_entity_ids = org_entity_ids,
            region_entity_ids = region_entity_ids,
            creature_entity_ids = creature_entity_ids,
            player_entity_id = player_entity_id
        }
    end)


Service:define()
    :namespace("GameTemplate")
    :name("UpdateGameStateAndDocs")
    :desc("根据新剧情内容和状态变化列表，生成 Lua 代码在沙箱中执行来更新游戏状态和设定文档")
    :usage("根据新剧情内容和状态/设定变化列表，使用 LLM 生成 ServiceRegistry.call() Lua 代码并在沙箱中执行来更新游戏状态。通常与 CreativeWritingStream 配合使用，在生成剧情后自动更新。")
    :inputs(Type.Object({
        new_event = Type.String:desc("新剧情内容"),
        state_changes = Type.Array(Type.String):desc("状态变化列表"),
        setting_changes = Type.Array(Type.String):desc("设定变化列表"),
        director_notes = Type.Optional(Type.Object({
            notes = Type.Optional(Type.Array(Type.String)):desc("导演笔记列表"),
            flags = Type.Optional(Type.Array(Type.Object({
                id = Type.String:desc("标记名称"),
                value = Type.Bool:desc("标记状态"),
                remark = Type.Optional(Type.String):desc("标记备注"),
            }))):desc("导演标记列表"),
            stage_goal = Type.Optional(Type.String):desc("阶段叙事目标，设置后指导后续创作的整体方向和节奏"),
        })):desc("导演笔记与标记，由创意写作 STEP5 输出，直接执行无需 LLM 转换"),
    }))
    :outputs(Type.Object({
        success = Type.Bool:desc("是否成功"),
        audit = Type.Optional(Type.String):desc("LLM的审计文本（检查过期状态、遗漏变更、物品消耗等）"),
        outline = Type.Optional(Type.String):desc("LLM的简短概要（1-2句）"),
        calls = Type.Optional(Type.Array(Type.Object({}))):desc("原始调用数组"),
        results = Type.Optional(Type.Array(Type.Object({}))):desc("每条调用的执行结果"),
        error = Type.Optional(Type.String):desc("错误信息"),
        raw_text = Type.Optional(Type.String):desc("LLM返回的原始文本输出"),
    }))
    :impl(function(inputs)
        local new_event = inputs.new_event
        local state_changes = inputs.state_changes or {}

        if not new_event or new_event == "" then
            return {
                success = false,
                error = "新剧情内容不能为空"
            }
        end

        -- 格式化状态变化列表
        local state_changes_text = ""
        for i, change in ipairs(state_changes) do
            state_changes_text = state_changes_text .. i .. ". " .. change .. "\n"
        end

        local setting_changes_text = ""
        for i, change in ipairs(inputs.setting_changes or {}) do
            setting_changes_text = setting_changes_text .. i .. ". " .. change .. "\n"
        end

        local final_prompt = PromptTemplateWithSettingDocs.GENERATION_PROMPT
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_NEW_EVENT>", new_event)
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_STATE_CHANGES>", state_changes_text)
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_SETTING_CHANGES>", setting_changes_text)

        local docs = ServiceRegistry.call("state:GetSettingDocsResource", {}).data
        local path_overview = ""
        for _, doc in ipairs(docs) do
            path_overview = path_overview .. string.format("- %s (长度: %d 字) ", table.concat(doc.path, "/"), #doc.content)
        end
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_SETTING_DOCUMENTS_OVERVIEW>", path_overview)

        local entity_ids = ServiceRegistry.call("GameTemplate:GetGameEntitySpecificIds", {})

        local entity_ids_overview = string.format("Creature IDs: %s (Player ID: %s)\nRegion Entity IDs: %s\nOrganization Entity IDs: %s",
            table.concat(entity_ids.creature_entity_ids, ", "),
            entity_ids.player_creature_id,
            table.concat(entity_ids.region_entity_ids, ", "),
            table.concat(entity_ids.org_entity_ids, ", "))

        final_prompt = Regex.replaceLiteral(final_prompt, "<OVERVIEW_OF_ENTITY_IDS>", entity_ids_overview)

        -- 替换 creature_attr_fields 描述
        final_prompt = Regex.replaceLiteral(final_prompt, "<CREATURE_ATTR_FIELDS_DESC>", getCreatureAttrFieldsDesc())

        local status_effects_overview = ServiceRegistry.call("GameTemplate:GetGameEntityStatusEffectsOverview", {}).overview_text

        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_STATUS_EFFECTS_OVERVIEW>", status_effects_overview)


        -- 定义 JSON Schema 约束输出格式
        local output_schema = {
            type = "object",
            properties = {
                audit = {
                    type = "string",
                    description = "审计文本：LLM 在生成 calls 之前必须先填写此字段，检查过期状态、遗漏变更、物品消耗、细节补充、前置条件等"
                },
                outline = { type = "string" },
                calls = {
                    type = "array",
                    items = {
                        type = "object",
                        properties = {
                            service = { type = "string" },
                            args = {
                                type = "object",
                                description = "必须包含调用该 service 所需的所有具体参数键值对。绝对不能留空。请参考提示词中提供的 Service API 字典来生成对应的键名和值。",
                                additionalProperties = true
                            }
                        },
                        required = { "service", "args" }
                    }
                }
            },
            required = { "audit", "outline", "calls" }
        }

        -- 调用 GenerateContent（JSON 结构化输出模式）
        print("[UpdateGameStateAndDocs] 调用 GenerateContent (JSON 模式)...")
        local gen_result = Service.call("GameTemplate:GenerateContent", {
            prompt = final_prompt,
            with_setting_docs = false,
            with_system_docs = true,
            model_preset = "updateModel",
            output_json = true,
            additional_system_prompt = PromptTemplateWithSettingDocs.SYSTEM_PROMPT,
            overview_mode = "updater",
            --output_schema = output_schema
        })

        if not gen_result.success then
            return {
                success = false,
                error = "GenerateContent 调用失败: " .. (gen_result.error or (gen_result._error or "未知错误"))
            }
        end

        local llm_output = gen_result.text
        print("[UpdateGameStateAndDocs] LLM 输出长度: " .. #llm_output .. " 字符")

        -- 解析 JSON 输出
        local parse_ok, parsed = pcall(function() return PartialJson.parse(llm_output) end)
        if not parse_ok or not parsed then
            return {
                success = false,
                error = "JSON 解析失败: " .. tostring(parsed),
                raw_text = llm_output
            }
        end

        if not parsed.calls then
            return {
                success = false,
                error = "JSON 输出缺少 calls 数组",
                raw_text = llm_output
            }
        end

        local audit = parsed.audit
        local outline = parsed.outline or ""
        local calls = parsed.calls

        -- 打印审计文本
        if audit and audit ~= "" then
            print("[UpdateGameStateAndDocs] audit: " .. tostring(audit))
        end
        print("[UpdateGameStateAndDocs] outline: " .. outline)
        print("[UpdateGameStateAndDocs] 共 " .. #calls .. " 条调用")

        -- 执行调用列表的通用函数
        local function executeCalls(call_list)
            local tracked_calls = {}
            local tracked_results = {}
            local failCount = 0
            local failDetails = ""

            for i, call in ipairs(call_list) do
                local service_name = call.service
                local args = call.args or {}

                table.insert(tracked_calls, { service = service_name, args = args })

                local ok, result = pcall(ServiceRegistry.call, service_name, args)
                if not ok then
                    failCount = failCount + 1
                    print(string.format("[UpdateGameStateAndDocs] ❌ #%d %s: %s", i, service_name, tostring(result)))
                    table.insert(tracked_results, {
                        service = service_name,
                        success = false,
                        error = tostring(result)
                    })
                    failDetails = failDetails .. string.format("#%d %s: %s\n", i, service_name, tostring(result))
                else
                    local call_success = true
                    local call_error = nil
                    if type(result) == "table" and result.success == false then
                        call_success = false
                        call_error = result.error or result._error
                        failCount = failCount + 1
                        print(string.format("[UpdateGameStateAndDocs] ❌ #%d %s: %s", i, service_name, call_error or "service returned success=false"))
                        failDetails = failDetails .. string.format("#%d %s: %s\n", i, service_name, call_error or "service returned success=false")
                    else
                        print(string.format("[UpdateGameStateAndDocs] ✅ #%d %s", i, service_name))
                    end
                    table.insert(tracked_results, {
                        service = service_name,
                        success = call_success,
                        error = call_error
                    })
                end
            end

            return tracked_calls, tracked_results, failCount, failDetails
        end

        -- 创建检查点并执行首次调用
        local state_ckpt_id = State:checkpoint("Update-State-" .. os.time(), "")
        local tracked_calls, tracked_results, failCount, failDetails = executeCalls(calls)

        print(string.format("[UpdateGameStateAndDocs] 执行完成: %d 成功, %d 失败", #tracked_calls - failCount, failCount))

        -- 首次执行有失败调用，尝试带错误反馈的重试（仅重试一次）
        if failCount > 0 then
            State:checkout(state_ckpt_id)  -- 回滚状态到执行前的检查点

            print(string.format("[UpdateGameStateAndDocs] 首次执行有 %d 条失败，正在构建重试...", failCount))

            -- 构建失败调用的详情
            local failed_calls_detail = ""
            for i, result in ipairs(tracked_results) do
                if not result.success then
                    local original_call = calls[i]
                    failed_calls_detail = failed_calls_detail .. string.format(
                        "#%d service: %s, args: %s, error: %s\n",
                        i, result.service,
                        json.encode(original_call and original_call.args or {}),
                        result.error or "unknown"
                    )
                end
            end

            local retry_prompt = final_prompt
                .. "There are last attempt you outputted JSON and executed the calls: " .. json.encode({
                    outline = outline,
                    calls = tracked_calls
                })
                .. "\n\n# 🛠️ FIX AND RETRY INSTRUCTIONS\n"
                .. "\n\n# ⚠️ RETRY — Previous Attempt Had " .. failCount .. " Failures\n"
                .. "Your previous JSON output was:\n```json\n" .. llm_output .. "\n```\n\n"
                .. "The following calls FAILED (with their original args and error messages):\n" .. failed_calls_detail .. "\n"
                .. "Common causes and fixes:\n"
                .. "- 'location not found' → You forgot to add `ecs.system:Region.addLocationToRegion` BEFORE `ecs.system:Modify.moveCreature`. Create the missing location first.\n"
                .. "- 'instance_id not found' → The status instance_id doesn't exist. Check the entity's actual StatusEffects in World State and use the correct instance_id, or use `addStatusEffect` if it doesn't exist.\n"
                .. "- 'entity not found' → The creature/region/organization doesn't exist yet. Spawn it first.\n"
                .. "- 'item not found' → Provide item_name and item_description when adding a new item.\n\n"
                .. "Please regenerate the COMPLETE JSON with all issues fixed. Do NOT omit the successful calls — include everything.\n"

            local retry_gen_result = Service.call("GameTemplate:GenerateContent", {
                prompt = retry_prompt,
                with_setting_docs = false,
                with_system_docs = true,
                model_preset = "updateModel",
                output_json = true
                -- output_schema = output_schema
            })

            if retry_gen_result.success then
                local retry_parse_ok, retry_parsed = pcall(function() return PartialJson.parse(retry_gen_result.text) end)

                if retry_parse_ok and retry_parsed and retry_parsed.calls then
                    print("[UpdateGameStateAndDocs] 重试 JSON 解析成功，共 " .. #retry_parsed.calls .. " 条调用")

                    -- 重置并重新执行
                    outline = retry_parsed.outline or outline
                    llm_output = retry_gen_result.text

                    state_ckpt_id = State:checkpoint("Update-State-Retry-" .. os.time(), "")
                    tracked_calls, tracked_results, failCount, failDetails = executeCalls(retry_parsed.calls)

                    print(string.format("[UpdateGameStateAndDocs] 重试执行完成: %d 成功, %d 失败", #tracked_calls - failCount, failCount))
                    if failCount > 0 then
                        State:checkout(state_ckpt_id)
                    end
                    if failCount == 0 then
                        print("[UpdateGameStateAndDocs] 重试后所有调用成功，正在删除检查点...")
                        State:deleteCheckpoint(state_ckpt_id)
                    end
                else
                    print("[UpdateGameStateAndDocs] 重试 JSON 解析失败")
                end
            else
                print("[UpdateGameStateAndDocs] 重试 GenerateContent 调用失败")
            end
        end

        if failCount == 0 then
            print("[UpdateGameStateAndDocs] 所有调用成功，正在删除检查点...")
            State:deleteCheckpoint(state_ckpt_id)  -- 删除检查点，保留当前状态
        end

        -- 执行导演笔记（STEP5 结构化数据，直接调用服务，无需 LLM）
        if inputs.director_notes then
            local dn = inputs.director_notes
            if dn.notes and #dn.notes > 0 then
                local ok, result = pcall(function()
                    return ServiceRegistry.call("ecs.system:DirectorNotes.addDirectorNote", { note = table.concat(dn.notes, "\n") })
                end)
            end
            if dn.flags then
                for _, flag in ipairs(dn.flags) do
                    local ok, result = pcall(function()
                        return ServiceRegistry.call("ecs.system:DirectorNotes.setDirectorFlag", {
                            flag_id = flag.id,
                            value = flag.value,
                            remark = flag.remark,
                        })
                    end)
                end
            end
            -- 执行阶段目标更新（仅当 LLM 显式输出了 stage_goal 时）
            if dn.stage_goal ~= nil then
                local ok, result = pcall(function()
                    return ServiceRegistry.call("ecs.system:DirectorNotes.setStageGoal", {
                        stage_goal = dn.stage_goal ~= "" and dn.stage_goal or nil,
                    })
                end)
                if ok then
                    print("[UpdateGameStateAndDocs] 阶段目标已更新: " .. tostring(dn.stage_goal))
                end
            end
        end

        return {
            success = failCount == 0,
            outline = outline,
            audit = audit,
            calls = tracked_calls,
            results = tracked_results,
            error = failCount > 0 and string.format("%d/%d 条调用失败：%s", failCount, #tracked_calls, failDetails) or nil,
            raw_text = llm_output
        }
    end)

