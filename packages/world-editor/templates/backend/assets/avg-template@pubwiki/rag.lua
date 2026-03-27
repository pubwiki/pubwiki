Loader.loadModule("ecs@pubwiki")
require("./components")
require("./systems")
require("./state")
local ServiceRegistry = require("core/service")

local PromptTemplateWithSettingDocs = require("./prompt_update_gamestate_and_setting")
local PartialJson = require("partial-json")
local Chat = require("./chat")
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

-- ============ UpdateSettingDoc 行编辑辅助 ============

local function splitLines(text)
    if not text or text == "" then return {} end
    local lines = {}
    for _,line in ipairs(Regex.split(text .. "\n", "\n")) do
        table.insert(lines, line)
    end
    if text:sub(-1) == "\n" and #lines > 0 and lines[#lines] == "" then
        table.remove(lines)
    end
    return lines
end

local function resolveDocTarget(args)
    if args.creature_id then
        local result = ServiceRegistry.call("ecs:GetEntitiesByComponent", { component_keys = {"Creature"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = ServiceRegistry.call("ecs:GetComponentData", { entity_id = eid, component_key = "Creature" })
            if comp.found and comp.data.creature_id == args.creature_id then return eid end
        end
        return nil, "creature not found: " .. args.creature_id
    elseif args.organization_id then
        local result = ServiceRegistry.call("ecs:GetEntitiesByComponent", { component_keys = {"Organization"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = ServiceRegistry.call("ecs:GetComponentData", { entity_id = eid, component_key = "Organization" })
            if comp.found and comp.data.organization_id == args.organization_id then return eid end
        end
        return nil, "organization not found: " .. args.organization_id
    elseif args.region_id then
        local result = ServiceRegistry.call("ecs:GetEntitiesByComponent", { component_keys = {"Region"} })
        for _, eid in ipairs(result.entity_ids or {}) do
            local comp = ServiceRegistry.call("ecs:GetComponentData", { entity_id = eid, component_key = "Region" })
            if comp.found and comp.data.region_id == args.region_id then return eid end
        end
        return nil, "region not found: " .. args.region_id
    else
        local result = ServiceRegistry.call("ecs:GetEntitiesByComponent", { component_keys = {"Registry"} })
        if result.count > 0 then return result.entity_ids[1] end
        return nil, "world entity not found"
    end
end

--- 规范化设定文档参数：处理 LLM 把全路径塞进 doc_name、缺失实体 ID 等情况
--- 处理的场景:
---   1. doc_name = "CreatureSetting/葵羽/xxx" (全路径) + 有或无 creature_id → 剥离前缀，提取纯文档名
---   2. doc_name = "xxx" (纯名称) + 无实体 ID → 从 all_docs 反查实体 ID
--- @param args table 原始参数 (name, creature_id?, ...)
--- @param all_docs table|nil GetSettingDocsResource 返回的文档列表
--- @return table 规范化后的参数副本
local SETTING_TYPE_PREFIXES = {
    ["WorldSetting"] = "world",
    ["CreatureSetting"] = "creature",
    ["RegionSetting"] = "region",
    ["OrganizationSetting"] = "organization",
}

local function normalizeUpdateDocArgs(args, all_docs)
    if not args.name then return args end

    local doc_name = args.name
    local new_args = nil  -- 延迟创建副本

    -- 第一步：检测 doc_name 是否以 EntityType/ 开头（全路径）
    for prefix, entity_kind in pairs(SETTING_TYPE_PREFIXES) do
        if doc_name:sub(1, #prefix + 1) == prefix .. "/" then
            -- 解析 "EntityType/EntityName/ActualDocName"（文档名本身可能含 /）
            local rest = doc_name:sub(#prefix + 2)  -- 去掉 "EntityType/"
            local slash_pos = rest:find("/")
            if slash_pos then
                local entity_name = rest:sub(1, slash_pos - 1)
                local actual_doc_name = rest:sub(slash_pos + 1)

                new_args = {}
                for k, v in pairs(args) do new_args[k] = v end
                new_args.name = actual_doc_name

                -- 如果缺实体 ID，从 all_docs 中按 entity_type + entity_name 反查
                if not (args.creature_id or args.organization_id or args.region_id) and entity_kind ~= "world" and all_docs then
                    for _, doc in ipairs(all_docs) do
                        if doc.path[1] == prefix and doc.path[2] == entity_name then
                            if entity_kind == "creature" then
                                new_args.creature_id = doc.specific_id
                            elseif entity_kind == "region" then
                                new_args.region_id = doc.specific_id
                            elseif entity_kind == "organization" then
                                new_args.organization_id = doc.specific_id
                            end
                            break
                        end
                    end
                end

                return new_args
            end
        end
    end

    -- 第二步：doc_name 是纯名称但缺实体 ID → 从 all_docs 反查
    if not (args.creature_id or args.organization_id or args.region_id) and all_docs then
        for _, doc in ipairs(all_docs) do
            if doc.path[3] == doc_name then
                new_args = {}
                for k, v in pairs(args) do new_args[k] = v end

                local entity_type = doc.path[1]
                if entity_type == "CreatureSetting" then
                    new_args.creature_id = doc.specific_id
                elseif entity_type == "RegionSetting" then
                    new_args.region_id = doc.specific_id
                elseif entity_type == "OrganizationSetting" then
                    new_args.organization_id = doc.specific_id
                end
                return new_args
            end
        end
    end

    return args
end

--- 批量处理同一文档的多个行号编辑
--- info = { target_args = {creature_id?, ...name}, edits = [{start_line, end_line, replacement}] }
local function processDocEdits(info)
    local args = info.target_args
    local doc_name = args.name

    local entity_id, resolve_err = resolveDocTarget(args)
    if not entity_id then return false, resolve_err end

    local getResult = ServiceRegistry.call("ecs:GetComponentData", {
        entity_id = entity_id,
        component_key = "BindSetting",
    })
    local documents = (getResult.found and getResult.data and getResult.data.documents) or {}

    local doc_index
    for i, doc in ipairs(documents) do
        if doc.name == doc_name then doc_index = i; break end
    end
    if not doc_index then
        return false, "Document not found: " .. (doc_name or "nil")
    end

    local lines = splitLines(documents[doc_index].content)
    local total = #lines

    -- 标记每行归属哪个 edit（nil = 保留原样）
    local line_tags = {}
    for idx, edit in ipairs(info.edits) do
        if edit.start_line < 1 or edit.end_line < edit.start_line then
            return false, string.format("Invalid line range: %d-%d", edit.start_line, edit.end_line)
        end
        if edit.start_line > total or edit.end_line > total then
            return false, string.format("Line range %d-%d exceeds document length %d", edit.start_line, edit.end_line, total)
        end
        for ln = edit.start_line, edit.end_line do
            if line_tags[ln] then
                return false, string.format("Overlapping edits at line %d", ln)
            end
            line_tags[ln] = idx
        end
    end

    -- 一次遍历构建结果：遇到 edit 首行插入 replacement，后续行跳过
    local result = {}
    local prev_tag = nil
    for ln = 1, total do
        local tag = line_tags[ln]
        if not tag then
            table.insert(result, lines[ln])
            prev_tag = nil
        elseif tag ~= prev_tag then
            local repl = info.edits[tag].replacement
            if repl and repl ~= "" then
                for _, rl in ipairs(splitLines(repl)) do
                    table.insert(result, rl)
                end
            end
            prev_tag = tag
        end
        -- else: 同一 edit 的后续行，跳过
    end

    documents[doc_index].content = table.concat(result, "\n")
    local setResult = ServiceRegistry.call("ecs:SetComponentData", {
        entity_id = entity_id,
        component_key = "BindSetting",
        data = { documents = documents },
        merge = false,
    })
    if not setResult.success then
        return false, "Failed to update BindSetting: " .. (setResult.error or "")
    end

    print(string.format("[UpdateGameStateAndDocs] ✅ UpdateSettingDoc batch [%s]: %d edits applied", doc_name, #info.edits))
    return true
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
        table.insert(parts, string.format("  - %s: display_name: %s, hint: %s", field.field_name, field.display_name or field.field_name, field.hint))
    end
    return "Attribute names defined by Registry.creature_attr_fields:\n" .. table.concat(parts, "\n")
end

Service:define()
    :namespace("GameTemplate")
    :name("GetGameEntityStatusEffectsOverview")
    :desc("获取当前游戏中所有实体的状态效果简略概览文本")
    :usage("无需参数。返回紧凑文本，每个实体列出其状态效果的 instance_id、remark 和 data。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        overview_text = Type.String:desc("游戏实体状态效果概览文本")
    }))
    :impl(function(inputs)
        local result = ServiceRegistry.call("ecs:GetSnapshot", {
            includeMetadata = true
        })
        local lines = {}
        for i, entity in ipairs(result.entities) do
            local comps = entity.components
            if comps["StatusEffects"] then
                local effects = comps["StatusEffects"].status_effects
                if effects and #effects > 0 then
                    local entity_type = "Unknown"
                    if comps["Registry"] then entity_type = "World"
                    elseif comps["Creature"] then entity_type = "Creature"
                    elseif comps["Region"] then entity_type = "Region"
                    elseif comps["Organization"] then entity_type = "Organization"
                    end
                    local entity_name = comps["Metadata"] and comps["Metadata"].name or "Unknown"
                    table.insert(lines, string.format("=== %s \"%s\" ===", entity_type, entity_name))
                    for _, effect in ipairs(effects) do
                        local remark = effect.remark and string.format(" \"%s\"", effect.remark) or ""
                        local data_str = effect.data and " data:" .. json.encode(effect.data) or ""
                        table.insert(lines, string.format("  - #%s%s%s", effect.instance_id or "", remark, data_str))
                    end
                end
            end
        end

        return {overview_text = table.concat(lines, "\n")}
    end)


-- 生成一次性 schema 头部，描述各组件的字段含义
local function buildSchemaHeader(is_updater)
    local lines = {
        "=== SCHEMA (field descriptions, appears once) ===",
        "Entity header: === <Type> \"<Name>\" ===",
        "GameTime: year/month/day hour:minute — current virtual world date and time",
        "Registry: creature_attr_fields: [{field_name, display_name?, hint?}] — defines custom attribute fields for creatures, used in Creature.attrs",
        "Creature: creature_id, name, organization_id?, gender(!follow gender in content), race",
        "  body — appearance description; clothing — clothing description",
        "  emotion — current emotional state; titles — title list",
        "  attrs: {key:value} — creature stats; known_infos[] — known information",
        "  goal — current goal or motivation",
        "LocationRef: region_id/location_id — entity's current location",
        "Inventory: - item_id xCount [equipped] \"description\" > detail lines",
        "IsPlayer — marks this entity as the player character",
        "StatusEffect: #instance_id remark? data:{json} added:timestamp updated:timestamp",
        "Region: region_id, region_name, description",
        "  Locations: id | name | description",
        "  Paths: [discovered?] -> to_region/to_location description",
        "Organization: organization_id, name, description",
        "  Territories: region_id/location_id",
        "CustomComponentRegistry: key(is_array?) schema:{json} registry:[item_id -> data]",
        "CustomComponents: [key] with data entries (schema description annotated with //)",
        "Events: event_id, title, summary, related_entities[] — world-level plot events (title+summary only, full content via selection)",
    }
    if not is_updater then
        table.insert(lines, "Log: - content @timestamp")
    end
    return table.concat(lines, "\n") .. "\n"
end

Service:define()
    :namespace("GameTemplate")
    :name("GetGameEntityOverview")
    :desc("获取当前游戏中所有实体及其状态的紧凑概览文本")
    :usage("无需参数。返回字典 {entity_id: text} 和一次性 schema 头部。每个实体以缩进 KV 格式描述其所有组件。mode='updater' 时省略 DirectorNotes 和 Log 以节省 token。")
    :inputs(Type.Object({
        mode = Type.Optional(Type.String):desc("概览模式，默认为完整模式。'updater' 模式省略 DirectorNotes 和 Log 组件以节省 token"),
    }))
    :outputs(Type.Object({
        overviews = Type.Record(Type.String):desc("游戏实体ID到其概览文本的映射表"),
        schema = Type.String:desc("一次性 schema 头部文本，描述各字段含义"),
        entity_logs = Type.Record(Type.String):desc("游戏实体ID到其Log文本的映射表（仅非updater模式时有值）"),
    }))
    :impl(function(inputs)
        local is_updater = inputs.mode == "updater"
        local result = ServiceRegistry.call("ecs:GetSnapshot", {
            includeMetadata = true
        })

        local overviews = {}
        local entity_logs = {}
        local schema = buildSchemaHeader(is_updater)

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
            local parts = {}
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
            table.insert(parts, string.format("=== %s \"%s\" ===", entity_type, entity_name))

            -- ============ 世界实体组件 ============
            if comps["GameTime"] then
                local gt = comps["GameTime"]
                table.insert(parts, string.format("[GameTime] %d/%d/%d %d:%02d",
                    gt.year, gt.month, gt.day, gt.hour, gt.minute))
            end

            if comps["Registry"] then
                local reg = comps["Registry"]
                if reg.creature_attr_fields and #reg.creature_attr_fields > 0 then
                    table.insert(parts, "[Registry] creature_attr_fields:")
                    for _, f in ipairs(reg.creature_attr_fields) do
                        table.insert(parts, string.format("  - %s: display_name: %s, hint: %s", f.field_name, f.display_name or f.field_name, f.hint))
                    end
                end
            end

            if comps["CustomComponentRegistry"] then
                local registry = comps["CustomComponentRegistry"].custom_components
                if registry and #registry > 0 then
                    table.insert(parts, "[CustomComponentRegistry]")
                    for _, def in ipairs(registry) do
                        local line = string.format("  %s (is_array:%s)", def.component_key, tostring(def.is_array or false))
                        table.insert(parts, line)
                        if def.type_schema and type(def.type_schema) == "table" then
                            table.insert(parts, "    schema: " .. json.encode(def.type_schema))
                        elseif def.type_schema and def.type_schema ~= "" then
                            table.insert(parts, "    schema: " .. tostring(def.type_schema))
                        end
                        if def.data_registry then
                            table.insert(parts, "    registry:")
                            for _, item in ipairs(def.data_registry) do
                                table.insert(parts, string.format("      - %s: %s", item.item_id, json.encode(item.data) or "{}"))
                            end
                        end
                    end
                end
            end

            if comps["Events"] and comps["Events"].events then
                local events = comps["Events"].events
                if #events > 0 then
                    table.insert(parts, "[Events]")
                    for _, evt in ipairs(events) do
                        local related = ""
                        if evt.related_entities and #evt.related_entities > 0 then
                            related = " related:[" .. table.concat(evt.related_entities, ",") .. "]"
                        end
                        table.insert(parts, string.format("  - %s: \"%s\" — %s%s",
                            evt.event_id, evt.title, evt.summary or "", related))
                    end
                end
            end

            -- ============ 角色实体组件 ============
            if comps["Creature"] then
                local ca = comps["Creature"]
                local org_part = ca.organization_id and string.format(" org:%s", ca.organization_id) or ""
                table.insert(parts, string.format("[Creature] id:%s name:%s%s", ca.creature_id, ca.name, org_part))

                -- 性别与种族
                local basic = {}
                if ca.gender then table.insert(basic, "gender:" .. ca.gender) end
                if ca.race then table.insert(basic, "race:" .. ca.race) end
                if #basic > 0 then
                    table.insert(parts, "  " .. table.concat(basic, " "))
                end

                -- 外貌和服饰
                if ca.appearance and ca.appearance.body then
                    table.insert(parts, "  body: " .. ca.appearance.body)
                end
                if ca.appearance and ca.appearance.clothing then
                    table.insert(parts, "  clothing: " .. ca.appearance.clothing)
                end

                -- 情绪状态
                if ca.emotion then
                    table.insert(parts, "  emotion: " .. ca.emotion)
                end

                -- 称号
                if ca.titles and #ca.titles > 0 then
                    table.insert(parts, "  titles: " .. table.concat(ca.titles, ", "))
                end

                -- 生物属性
                if ca.attrs and type(ca.attrs) == "table" then
                    local attr_parts = {}
                    for k, v in pairs(ca.attrs) do
                        table.insert(attr_parts, k .. ":" .. tostring(v))
                    end
                    table.insert(parts, "  attrs: {" .. table.concat(attr_parts, ", ") .. "}")
                end

                if ca.known_infos and #ca.known_infos > 0 then
                    table.insert(parts, "  known_infos:")
                    for idx, info in ipairs(ca.known_infos) do
                        table.insert(parts, "    - " .. string.format("[IDX=%d] %s", idx, info))
                    end
                end

                if ca.goal then
                    table.insert(parts, "  goal: " .. ca.goal)
                end
            end

            if comps["LocationRef"] then
                local loc = comps["LocationRef"]
                table.insert(parts, string.format("[Location] %s/%s", loc.region_id or "", loc.location_id or ""))
            end

            if comps["Inventory"] then
                local inv = comps["Inventory"]
                if inv.items and #inv.items > 0 then
                    table.insert(parts, "[Inventory]")
                    for _, item in ipairs(inv.items) do
                        local equipped = item.equipped and " [equipped]" or ""
                        table.insert(parts, string.format("  - %s x%d%s \"%s\"", item.id, item.count, equipped, item.description or ""))
                        if item.details and #item.details > 0 then
                            for _, detail in ipairs(item.details) do
                                table.insert(parts, "    > " .. detail)
                            end
                        end
                    end
                end
            end

            if comps["IsPlayer"] then
                table.insert(parts, "[Player]")
            end

            -- 自定义组件数据
            if comps["CustomComponents"] then
                local cc = comps["CustomComponents"]
                if cc.custom_components and #cc.custom_components > 0 then
                    table.insert(parts, "[CustomComponents]")
                    for _, comp in ipairs(cc.custom_components) do
                        local def = customComponentDefs[comp.component_key]
                        local schema_props = nil
                        if def and def.type_schema and type(def.type_schema) == "table" and def.type_schema.properties then
                            schema_props = def.type_schema.properties
                        end

                        table.insert(parts, "  [" .. comp.component_key .. "]")

                        if type(comp.data) == "table" then
                            local isArray = #comp.data > 0 or next(comp.data) == nil
                            if isArray and #comp.data > 0 then
                                for idx, item in ipairs(comp.data) do
                                    if type(item) == "table" then
                                        local kv_parts = {}
                                        for k, v in pairs(item) do
                                            local desc = ""
                                            if schema_props and is_indexable(schema_props) and schema_props[k] and is_indexable(schema_props[k]) and schema_props[k].description then
                                                desc = " //" .. schema_props[k].description
                                            end
                                            table.insert(kv_parts, string.format("%s:%s%s", k, tostring(v), desc))
                                        end
                                        table.insert(parts, "    [" .. idx .. "] " .. table.concat(kv_parts, ", "))
                                    else
                                        table.insert(parts, "    [" .. idx .. "] " .. tostring(item))
                                    end
                                end
                            else
                                for k, v in pairs(comp.data) do
                                    local desc = ""
                                    if schema_props and is_indexable(schema_props) and schema_props[k] and is_indexable(schema_props[k]) and schema_props[k].description then
                                        desc = " //" .. schema_props[k].description
                                    end
                                    table.insert(parts, string.format("    %s: %s%s", k, tostring(v), desc))
                                end
                            end
                        else
                            table.insert(parts, "    " .. tostring(comp.data))
                        end
                    end
                end
            end

            -- ============ 地域实体组件 ============
            if comps["Region"] then
                local lap = comps["Region"]
                table.insert(parts, string.format("[Region] id:%s name:%s", lap.region_id, lap.region_name))
                if lap.description and lap.description ~= "" then
                    table.insert(parts, "  " .. lap.description)
                end

                if lap.locations and #lap.locations > 0 then
                    table.insert(parts, "  locations:")
                    for _, loc in ipairs(lap.locations) do
                        table.insert(parts, string.format("    - %s | %s | %s", loc.id, loc.name, loc.description or ""))
                    end
                end

                if lap.paths and #lap.paths > 0 then
                    table.insert(parts, "  paths:")
                    for _, path in ipairs(lap.paths) do
                        local disc = path.discovered and "✓" or "?"
                        table.insert(parts, string.format("    - [%s] -> %s/%s %s", disc, path.to_region, path.to_location, path.description or ""))
                    end
                end
            end

            -- ============ 组织实体组件 ============
            if comps["Organization"] then
                local org = comps["Organization"]
                table.insert(parts, string.format("[Organization] id:%s name:%s", org.organization_id, org.name))
                if org.description and org.description ~= "" then
                    table.insert(parts, "  " .. org.description)
                end

                if org.territories and #org.territories > 0 then
                    table.insert(parts, "  territories:")
                    for _, terr in ipairs(org.territories) do
                        table.insert(parts, string.format("    - %s/%s", terr.region_id, terr.location_id))
                    end
                end
            end

            -- ============ 通用组件 ============
            if comps["StatusEffects"] then
                local effects = comps["StatusEffects"].status_effects
                if effects and #effects > 0 then
                    table.insert(parts, "[StatusEffects]")
                    for _, effect in ipairs(effects) do
                        local remark = effect.remark and string.format(" \"%s\"", effect.remark) or ""
                        local line = string.format("  - #%s%s", effect.instance_id or "", remark)
                        if effect.data then
                            line = line .. " data:" .. json.encode(effect.data)
                        end
                        if effect.add_at then
                            line = line .. " added:" .. effect.add_at
                        end
                        if effect.last_updated_at then
                            line = line .. " updated:" .. effect.last_updated_at
                        end
                        table.insert(parts, line)
                    end
                end
            end

            if comps["Interaction"] then
                local interaction = comps["Interaction"]
                if interaction.options and #interaction.options > 0 then
                    table.insert(parts, "[Interaction]")
                    for _, opt in ipairs(interaction.options) do
                        local line = string.format("  - #%s \"%s\"", opt.id, opt.title or "")
                        if opt.usage and opt.usage ~= "" then
                            line = line .. " usage:" .. opt.usage
                        end
                        line = line .. ": " .. (opt.instruction or "")
                        if opt.memo then
                            line = line .. " memo:[" .. opt.memo .. "]"
                        end
                        table.insert(parts, line)
                    end
                end
            end

            -- Log 数据单独存储到 entity_logs，不再嵌入 overview 文本
            if comps["Log"] and not is_updater then
                local log = comps["Log"]
                if log.entries and #log.entries > 0 then
                    local log_parts = {}
                    table.insert(log_parts, string.format("[Log] === %s \"%s\" ===", entity_type, entity_name))
                    for idx, entry in ipairs(log.entries) do
                        table.insert(log_parts, string.format("  - [IDX=%d] %s @%s", idx, entry.content, entry.add_at))
                    end
                    entity_logs[tostring(entity.entity_id)] = table.concat(log_parts, "\n")
                end
            end

            overviews[tostring(entity.entity_id)] = table.concat(parts, "\n")
        end

        return {overviews = overviews, schema = schema, entity_logs = entity_logs}
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


Service:definePure()
    :namespace("GameTemplate")
    :name("GetCompactEntityIndex")
    :desc("生成所有实体的紧凑索引（~500-1000 token），列出所有实体的关键ID和结构，帮助LLM避免引用不存在的实体/地点/组件")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        index_text = Type.String:desc("紧凑的实体索引文本"),
    }))
    :impl(function(inputs)
        local snapshot = ServiceRegistry.call("ecs:GetSnapshot", {})
        if not snapshot or not snapshot.entities then
            return { index_text = "" }
        end

        local sections = {}

        -- 先提取 CustomComponentRegistry 的 keys
        local cc_registry_keys = {}
        for _, entity in ipairs(snapshot.entities) do
            if entity.components["CustomComponentRegistry"] then
                local registry = entity.components["CustomComponentRegistry"].custom_components
                if registry then
                    for _, def in ipairs(registry) do
                        table.insert(cc_registry_keys, def.component_key)
                    end
                end
                break
            end
        end

        for _, entity in ipairs(snapshot.entities) do
            local c = entity.components
            local lines = {}

            if c["Registry"] then
                -- === 世界实体 ===
                local time_str = "?"
                if c["GameTime"] then
                    time_str = string.format("%d/%d/%d %d:%02d",
                        c["GameTime"].year, c["GameTime"].month, c["GameTime"].day, c["GameTime"].hour, c["GameTime"].minute)
                end
                table.insert(lines, "## World | Time: " .. time_str)

                if c["Registry"].creature_attr_fields and #c["Registry"].creature_attr_fields > 0 then
                    local names = {}
                    for _, f in ipairs(c["Registry"].creature_attr_fields) do
                        table.insert(names, f.field_name)
                    end
                    table.insert(lines, "AttrDefs: " .. table.concat(names, ", "))
                end

                if #cc_registry_keys > 0 then
                    table.insert(lines, "CustomComponentTypes: " .. table.concat(cc_registry_keys, ", "))
                end

                if c["Events"] and c["Events"].events and #c["Events"].events > 0 then
                    local evt_labels = {}
                    for _, evt in ipairs(c["Events"].events) do
                        table.insert(evt_labels, evt.event_id .. ":\"" .. evt.title .. "\"")
                    end
                    table.insert(lines, "Events: " .. table.concat(evt_labels, ", "))
                end

            elseif c["Creature"] then
                -- === 角色实体 ===
                local cr = c["Creature"]
                local loc = c["LocationRef"]
                local loc_str = loc and ((loc.region_id or "?") .. "/" .. (loc.location_id or "?")) or "?"
                local player_tag = c["IsPlayer"] and " [PLAYER]" or ""
                table.insert(lines, string.format("## Creature: %s | id: %s%s | loc: %s",
                    cr.name or "?", cr.creature_id or "?", player_tag, loc_str))

                if cr.attrs then
                    local parts = {}
                    for k, v in pairs(cr.attrs) do
                        table.insert(parts, k .. ":" .. tostring(v))
                    end
                    if #parts > 0 then
                        table.insert(lines, "Attrs: {" .. table.concat(parts, ", ") .. "}")
                    end
                end

                if c["StatusEffects"] and c["StatusEffects"].status_effects then
                    local ids = {}
                    for _, eff in ipairs(c["StatusEffects"].status_effects) do
                        local label = "#" .. (eff.instance_id or "?")
                        if eff.remark and eff.remark ~= "" then
                            label = label .. '("' .. eff.remark .. '")'
                        end
                        table.insert(ids, label)
                    end
                    if #ids > 0 then
                        table.insert(lines, "Effects: " .. table.concat(ids, ", "))
                    end
                end

                if c["Inventory"] and c["Inventory"].items and #c["Inventory"].items > 0 then
                    local items = {}
                    for _, item in ipairs(c["Inventory"].items) do
                        local label = item.id or "?"
                        if item.count and item.count > 1 then label = label .. "x" .. item.count end
                        if item.equipped then label = label .. "[E]" end
                        table.insert(items, label)
                    end
                    table.insert(lines, "Items: " .. table.concat(items, ", "))
                end

                if c["CustomComponents"] and c["CustomComponents"].custom_components then
                    local keys = {}
                    for _, comp in ipairs(c["CustomComponents"].custom_components) do
                        table.insert(keys, comp.component_key)
                    end
                    if #keys > 0 then
                        table.insert(lines, "Components: " .. table.concat(keys, ", "))
                    end
                end

                if cr.organization_id then
                    table.insert(lines, "Org: " .. cr.organization_id)
                end

            elseif c["Region"] then
                -- === 地域实体 ===
                local r = c["Region"]
                table.insert(lines, string.format("## Region: %s | id: %s",
                    r.region_name or "?", r.region_id or "?"))

                if r.locations and #r.locations > 0 then
                    local locs = {}
                    for _, loc in ipairs(r.locations) do
                        table.insert(locs, loc.id or "?")
                    end
                    table.insert(lines, "Locations: " .. table.concat(locs, ", "))
                end

                if r.paths and #r.paths > 0 then
                    local paths = {}
                    for _, p in ipairs(r.paths) do
                        local disc = p.discovered and "" or "?"
                        table.insert(paths, disc .. (p.to_region or "?") .. "/" .. (p.to_location or "?"))
                    end
                    table.insert(lines, "Paths→: " .. table.concat(paths, ", "))
                end

            elseif c["Organization"] then
                -- === 组织实体 ===
                local o = c["Organization"]
                table.insert(lines, string.format("## Org: %s | id: %s",
                    o.name or "?", o.organization_id or "?"))

                if o.territories and #o.territories > 0 then
                    local terrs = {}
                    for _, t in ipairs(o.territories) do
                        table.insert(terrs, (t.region_id or "?") .. "/" .. (t.location_id or "?"))
                    end
                    table.insert(lines, "Territories: " .. table.concat(terrs, ", "))
                end
            end

            -- 所有实体的文档列表
            if c["BindSetting"] and c["BindSetting"].documents then
                local docs = {}
                for _, doc in ipairs(c["BindSetting"].documents) do
                    if not doc.disable and doc.content and doc.content ~= "" then
                        table.insert(docs, doc.name)
                    end
                end
                if #docs > 0 then
                    table.insert(lines, "Docs: " .. table.concat(docs, ", "))
                end
            end

            if #lines > 0 then
                table.insert(sections, table.concat(lines, "\n"))
            end
        end

        return {
            index_text = "# Entity Index (all entities in game)\n" .. table.concat(sections, "\n\n")
        }
    end)

Service:define()
    :namespace("GameTemplate")
    :name("UpdateGameStateAndDocs")
    :desc("根据新剧情内容和状态变化列表，生成 Lua 代码在沙箱中执行来更新游戏状态和设定文档")
    :usage("根据新剧情内容和状态/设定变化列表，使用 LLM 生成 ServiceRegistry.call() Lua 代码并在沙箱中执行来更新游戏状态。通常与 CreativeWriting 配合使用，在生成剧情后自动更新。")
    :inputs(Type.Object({
        new_event = Type.String:desc("新剧情内容"),
        state_changes = Type.Optional(Type.Object({
            related_creature_ids = Type.Optional(Type.Array(Type.String)):desc("相关角色ID列表"),
            related_region_ids = Type.Optional(Type.Array(Type.String)):desc("相关地域ID列表"),
            related_organization_ids = Type.Optional(Type.Array(Type.String)):desc("相关组织ID列表"),
            service_calls = Type.Optional(Type.Array(Type.Object({
                name = Type.String:desc("服务简称"),
                suggestion = Type.String:desc("变更描述"),
            }))):desc("结构化服务调用描述列表（可选，Analyzer 会独立从剧情提取）"),
        })):desc("可选的状态变化提示，如不提供则 Analyzer 完全独立从剧情提取"),
        setting_changes = Type.Optional(Type.Array(Type.Any)):desc("设定变化列表"),
        event_changes = Type.Optional(Type.Array(Type.Any)):desc("事件变化列表"),
        new_entities = Type.Optional(Type.Array(Type.Object({
            type = Type.String:desc("实体类型: creature/region/organization"),
        }))):desc("Writer 提供的新实体定义，包含丰富的描述信息供 Analyzer 创建实体"),
        director_notes = Type.Optional(Type.Object({
            notes = Type.Optional(Type.Array(Type.String)):desc("导演笔记列表"),
            flags = Type.Optional(Type.Array(Type.Object({
                id = Type.String:desc("标记名称"),
                value = Type.Bool:desc("标记状态"),
                remark = Type.Optional(Type.String):desc("标记备注"),
            }))):desc("导演标记列表"),
            stage_goal = Type.Optional(Type.String):desc("阶段叙事目标"),
        })):desc("导演笔记与标记，直接执行无需 LLM 转换"),
        collector_built_messages = Type.Optional(Type.Array(Type.Object({
            role = Type.String:desc("消息角色"),
            content = Type.String:desc("消息内容"),
        }))):desc("Collector 阶段构建的设定文档 premessages，包含游戏规则和设定文档，注入到 Analyzer LLM 上下文中"),
    }))
    :outputs(Type.Object({
        success = Type.Bool:desc("是否成功"),
        audit = Type.Optional(Type.String):desc("LLM的审计文本（检查过期状态、遗漏变更、物品消耗等）"),
        outline = Type.Optional(Type.String):desc("LLM的简短概要（1-2句）"),
        summary = Type.Optional(Type.String):desc("面向用户的状态变更摘要，用剧情语言描述"),
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
                error = "New story content cannot be empty"
            }
        end

        -- === 从结构化 state_changes 中提取信息（可选，可能为 nil） ===
        local service_calls = (state_changes and state_changes.service_calls) or {}
        local related_creature_ids = {}
        local related_region_ids = {}
        local related_org_ids = {}

        -- 收集 state_changes 提供的实体ID（如果有的话）
        if state_changes then
            for _, id in ipairs(state_changes.related_creature_ids or {}) do
                related_creature_ids[id] = true
            end
            for _, id in ipairs(state_changes.related_region_ids or {}) do
                related_region_ids[id] = true
            end
            for _, id in ipairs(state_changes.related_organization_ids or {}) do
                related_org_ids[id] = true
            end
        end

        -- 格式化状态变化列表（从结构化 service_calls）
        local state_changes_text = ""
        for i, call in ipairs(service_calls) do
            state_changes_text = state_changes_text .. i .. ". " .. (call.name or "") .. ": " .. (call.suggestion or "") .. "\n"
        end

        -- 格式化设定变化列表 + 拉取 "update" 类型文档 + 收集 step4 的实体ID
        local setting_changes_text = ""
        local update_docs_context = ""
        local all_docs = nil  -- 延迟加载

        for i, change in ipairs(inputs.setting_changes or {}) do
            if type(change) == "string" then
                setting_changes_text = setting_changes_text .. i .. ". " .. change .. "\n"
            else
                -- 明确标注实体类型，避免 Updater 猜错 creature_id/region_id/organization_id
                local target_label
                if change.creature_id then
                    target_label = string.format("[creature_id: %s]", change.creature_id)
                elseif change.region_id then
                    target_label = string.format("[region_id: %s]", change.region_id)
                elseif change.organization_id then
                    target_label = string.format("[organization_id: %s]", change.organization_id)
                else
                    target_label = "[world]"
                end
                setting_changes_text = setting_changes_text .. string.format(
                    "%d. [%s] %s %s: %s\n", i, change.option or "unknown", target_label, change.doc_name or "", change.suggestion or ""
                )

                -- 收集 step4 涉及的实体ID
                if change.creature_id then related_creature_ids[change.creature_id] = true end
                if change.region_id then related_region_ids[change.region_id] = true end
                if change.organization_id then related_org_ids[change.organization_id] = true end

                -- 对 "update" 类型，拉取目标文档
                if change.option == "update" and change.doc_name then
                    if not all_docs then
                        all_docs = ServiceRegistry.call("state:GetSettingDocsResource", {}).data or {}
                    end

                    local norm = normalizeUpdateDocArgs({
                        creature_id = change.creature_id,
                        organization_id = change.organization_id,
                        region_id = change.region_id,
                        name = change.doc_name,
                    }, all_docs)
                    local norm_target = norm.creature_id or norm.organization_id or norm.region_id or "world"
                    local norm_doc_name = norm.name

                    for _, doc in ipairs(all_docs) do
                        if doc.path[3] == norm_doc_name and doc.specific_id == norm_target then
                            local doc_lines = splitLines(doc.content)
                            local numbered = {}
                            for ln, line in ipairs(doc_lines) do
                                table.insert(numbered, string.format("%d: %s", ln, line))
                            end
                            local numbered_content = table.concat(numbered, "\n")

                            update_docs_context = update_docs_context .. string.format(
                                "\n### Document to Update: %s (entity: %s) [%d lines total]\n```\n%s\n```\nSuggested change: %s\n",
                                table.concat(doc.path, "/"),
                                norm_target,
                                #doc_lines,
                                numbered_content,
                                change.suggestion or ""
                            )
                            print("[UpdateGameStateAndDocs] 拉取 update 文档: " .. table.concat(doc.path, "/") .. " (" .. #doc.content .. " 字)")
                            break
                        end
                    end
                end
            end
        end

        local event_changes_text = ""
        for i, change in ipairs(inputs.event_changes or {}) do
            if type(change) == "string" then
                event_changes_text = event_changes_text .. i .. ". " .. change .. "\n"
            else
                event_changes_text = event_changes_text .. string.format(
                    "%d. [%s] event_id: %s, title: %s, summary: %s, suggestion: %s, related_entities: [%s]\n",
                    i, change.option or "unknown", change.event_id or "", change.title or "",
                    change.summary or "", change.suggestion or "",
                    change.related_entities and table.concat(change.related_entities, ",") or ""
                )
            end
        end

        -- 拉取 "update" 类型事件的现有内容
        local event_update_context = ""
        for _, change in ipairs(inputs.event_changes or {}) do
            if type(change) == "table" and change.option == "update" and change.event_id then
                local evts_result = ServiceRegistry.call("ecs.system:Events.getEvents", { event_ids = { change.event_id } })
                if evts_result.success and evts_result.events and #evts_result.events > 0 then
                    local evt = evts_result.events[1]
                    local lines = splitLines(evt.content or "")
                    local numbered = {}
                    for ln, line in ipairs(lines) do
                        table.insert(numbered, string.format("%d: %s", ln, line))
                    end
                    event_update_context = event_update_context .. string.format(
                        "\n### Event to Update: %s (%s) [%d lines]\n```\n%s\n```\nSuggested change: %s\n",
                        evt.event_id, evt.title or "", #lines,
                        table.concat(numbered, "\n"), change.suggestion or ""
                    )
                end
            end
        end

        -- === 构建过滤后的 ECS 数据（只包含相关实体 + 世界实体） ===
        local overview_result = ServiceRegistry.call("GameTemplate:GetGameEntityOverview", {
            mode = "updater",
        })
        local world_overview_dict = overview_result.overviews
        local world_overview_schema = overview_result.schema or ""

        -- 获取 ECS 快照，匹配实体 specific_id → entity_id 映射
        local snapshot = ServiceRegistry.call("ecs:GetSnapshot", { includeMetadata = true })

        local filtered_ecs_parts = { "# Relevant ECS State (filtered)\n" .. world_overview_schema }
        local filtered_status_parts = {}
        local included_entity_count = 0
        local total_entity_count = 0

        -- 当没有 state_changes 提供实体ID时，包含所有实体（Analyzer 需要完整上下文独立分析）
        local has_entity_hints = next(related_creature_ids) or next(related_region_ids) or next(related_org_ids)

        for _, entity in ipairs(snapshot.entities) do
            total_entity_count = total_entity_count + 1
            local comps = entity.components
            local include = false
            local entity_label = ""

            if comps["Registry"] then
                -- 世界实体：始终包含
                include = true
                entity_label = "World (always included)"
            elseif not has_entity_hints then
                -- 无实体ID提示 → 包含所有实体（Analyzer 独立分析模式）
                include = true
                entity_label = "All (no hints, full context)"
            elseif comps["Creature"] then
                local cid = comps["Creature"].creature_id
                if related_creature_ids[cid] then
                    include = true
                    entity_label = "Creature " .. cid .. " (related)"
                end
            elseif comps["Region"] then
                local rid = comps["Region"].region_id
                if related_region_ids[rid] then
                    include = true
                    entity_label = "Region " .. rid .. " (related)"
                end
            elseif comps["Organization"] then
                local oid = comps["Organization"].organization_id
                if related_org_ids[oid] then
                    include = true
                    entity_label = "Organization " .. oid .. " (related)"
                end
            end

            if include then
                included_entity_count = included_entity_count + 1
                local eid = tostring(entity.entity_id)
                local overview_text = world_overview_dict[eid]
                if overview_text then
                    table.insert(filtered_ecs_parts, overview_text)
                end

                -- 收集该实体的 StatusEffects
                if comps["StatusEffects"] then
                    local effects = comps["StatusEffects"].status_effects
                    if effects and #effects > 0 then
                        local entity_type = "Unknown"
                        local entity_name = comps["Metadata"] and comps["Metadata"].name or "Unknown"
                        if comps["Registry"] then entity_type = "World"
                        elseif comps["Creature"] then entity_type = "Creature"
                        elseif comps["Region"] then entity_type = "Region"
                        elseif comps["Organization"] then entity_type = "Organization"
                        end
                        table.insert(filtered_status_parts, string.format("=== %s \"%s\" ===", entity_type, entity_name))
                        for _, effect in ipairs(effects) do
                            local remark = effect.remark and string.format(" \"%s\"", effect.remark) or ""
                            local data_str = effect.data and " data:" .. json.encode(effect.data) or ""
                            table.insert(filtered_status_parts, string.format("  - #%s%s%s", effect.instance_id or "", remark, data_str))
                        end
                    end
                end
            end
        end

        local filtered_ecs_text = table.concat(filtered_ecs_parts, "\n\n")
        local filtered_status_text = table.concat(filtered_status_parts, "\n")

        print(string.format("[UpdateGameStateAndDocs] ECS 过滤: %d/%d 实体 (creature: %d, region: %d, org: %d)",
            included_entity_count, total_entity_count,
            (function() local c = 0; for _ in pairs(related_creature_ids) do c = c + 1 end; return c end)(),
            (function() local c = 0; for _ in pairs(related_region_ids) do c = c + 1 end; return c end)(),
            (function() local c = 0; for _ in pairs(related_org_ids) do c = c + 1 end; return c end)()
        ))

        -- === 构建 stable context（很少变化的数据，放入 system prompt 以利用 KV cache） ===
        local stable_context_parts = {}

        -- 设定文档路径概览（仅在文档创建/删除时变化）
        local docs = all_docs or ServiceRegistry.call("state:GetSettingDocsResource", {}).data
        local path_overview = ""
        for _, doc in ipairs(docs) do
            path_overview = path_overview .. string.format("- %s (长度: %d 字) ", table.concat(doc.path, "/"), #doc.content)
        end
        table.insert(stable_context_parts, "# Current Setting Documents Overview\n" .. path_overview)

        -- 属性字段定义（完全不变，来自 Registry）
        table.insert(stable_context_parts, "# World Attribute Definitions Overview\n" .. getCreatureAttrFieldsDesc())

        -- 紧凑实体索引（所有实体的鸟瞰图，确保 Updater 知道所有实体存在，用于前置条件检查）
        local entity_index = ServiceRegistry.call("GameTemplate:GetCompactEntityIndex", {})
        table.insert(stable_context_parts, entity_index.index_text)

        local stable_context = "\n\n" .. table.concat(stable_context_parts, "\n\n")

        -- === 构建消息结构（分层优化 KV Cache） ===
        -- 层级1: system prompt = SYSTEM_PROMPT 核心指令（完全不变 → 最高 KV cache 命中率）
        -- 层级2: premessage 1 = API 参考 A-H（完全不变 → 高 KV cache）
        -- 层级3: premessage 2 = 实体索引 + 属性定义 + 文档概览（每回合可能变化）
        -- 层级4: collector_built_messages = 设定文档（来自 Collector，包含游戏规则）
        -- 层级5: user prompt = 过滤后的 ECS 数据 + 动态内容（每回合都变）

        local analyzer_system_prompt = PromptTemplateWithSettingDocs.SYSTEM_PROMPT

        local analyzer_premessages = {
            -- Premessage 1: API 参考（完全不变）
            { role = "user", content = "# Service API Reference (A-H)\n" .. PromptTemplateWithSettingDocs.API_REFERENCE },
            { role = "assistant", content = "I have read the complete Service API Reference (sections A through H). I will use the exact service names and parameter schemas documented above." },
            -- Premessage 2: 游戏上下文概览（每回合可能变化：文档增删、实体变动等）
            { role = "user", content = stable_context },
            { role = "assistant", content = "I have read the game context: entity index, attribute definitions, and document overview." },
        }

        -- 层级4: 注入 Collector 构建的设定文档 premessages（包含游戏规则、状态更新指令等）
        -- 注意：JS 传递的数组/对象在 Lua 中是 userdata，需用 type() 检查
        if inputs.collector_built_messages and type(inputs.collector_built_messages) ~= "nil" then
            local count = 0
            for _, msg in ipairs(inputs.collector_built_messages) do
                if msg.role and msg.content then
                    table.insert(analyzer_premessages, { role = tostring(msg.role), content = tostring(msg.content) })
                    count = count + 1
                end
            end
            print("[UpdateGameStateAndDocs] 注入 collector_built_messages: " .. count .. " 条消息")
        end

        -- === 构建 dynamic prompt（每回合都变的数据） ===
        local final_prompt = "<THE_ECS_DATA>\n" .. filtered_ecs_text .. "\n</THE_ECS_DATA>\n\n===============================\n\n"
            .. PromptTemplateWithSettingDocs.GENERATION_PROMPT

        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_STATUS_EFFECTS_OVERVIEW>", filtered_status_text)
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_NEW_EVENT>", new_event)
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_STATE_CHANGES>", state_changes_text ~= "" and state_changes_text or "(No hints from writer — you must independently extract ALL state changes from the story)")
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_SETTING_CHANGES>", setting_changes_text)
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_UPDATE_DOCS_CONTEXT>", update_docs_context ~= "" and update_docs_context or "(No documents targeted for update)")
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_EVENT_CHANGES>",
            event_changes_text ~= "" and (event_changes_text .. (event_update_context ~= "" and ("\n" .. event_update_context) or "")) or "(No event changes)")

        -- 注入 Writer 提供的新实体定义
        local new_entities_text = ""
        if inputs.new_entities and #inputs.new_entities > 0 then
            new_entities_text = "# [Writer] New Entity Definitions (use these to create entities via Spawn services)\n"
            new_entities_text = new_entities_text .. json.encode(inputs.new_entities)
            print("[UpdateGameStateAndDocs] Writer 提供了 " .. #inputs.new_entities .. " 个新实体定义")
        end
        final_prompt = Regex.replaceLiteral(final_prompt, "<THE_NEW_ENTITIES>",
            new_entities_text ~= "" and new_entities_text or "(No new entities from writer)")

        -- === 直接调用 Chat.Chat（绕过 GenerateContent，自行控制 premessages） ===
        print("[UpdateGameStateAndDocs] 直接调用 Chat.Chat (Analyzer 模式)...")
        local llm_success, llm_ret = pcall(function()
            return Chat.Chat("updateModel", final_prompt, {
                responseFormat = { type = "json_object" },
            }, analyzer_premessages, analyzer_system_prompt)
        end)

        if not llm_success then
            return {
                success = false,
                error = "Analyzer LLM call failed: " .. tostring(llm_ret)
            }
        end

        if llm_ret.error then
            return {
                success = false,
                error = "Analyzer LLM call failed: " .. tostring(llm_ret.error)
            }
        end

        local llm_output = llm_ret.content
        print("[UpdateGameStateAndDocs] LLM 输出长度: " .. #llm_output .. " 字符")

        -- 解析 JSON 输出
        local parse_ok, parsed = pcall(function() return PartialJson.parse(llm_output) end)
        if not parse_ok or not parsed then
            return {
                success = false,
                error = "JSON parse failed: " .. tostring(parsed),
                raw_text = llm_output
            }
        end

        if not parsed.calls then
            return {
                success = false,
                error = "JSON output missing calls array",
                raw_text = llm_output
            }
        end

        local audit = parsed.audit
        local outline = parsed.outline or ""
        local summary = parsed.summary or ""
        local calls = parsed.calls

        -- 如果 LLM 没输出 summary，从 outline 回退
        if summary == "" and outline ~= "" then
            summary = outline
        end

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

            -- 收集 UpdateSettingDoc 调用，按文档分组延迟批量处理
            local pending_doc_edits = {}  -- "target:name" -> { target_args, edits[], call_indices[] }

            for i, call in ipairs(call_list) do
                local service_name = call.service
                local args = call.args or {}

                table.insert(tracked_calls, { service = service_name, args = args })

                if service_name == "state:UpdateSettingDoc" or service_name == "state:AppendSettingDoc" then
                    -- 规范化：兜底推断缺失的实体ID、从全路径提取纯文档名
                    if not all_docs then
                        all_docs = ServiceRegistry.call("state:GetSettingDocsResource", {}).data or {}
                    end
                    args = normalizeUpdateDocArgs(args, all_docs)
                end

                if service_name == "state:UpdateSettingDoc" then

                    -- 收集，不立即执行
                    local target = args.creature_id or args.organization_id or args.region_id or "world"
                    local doc_key = target .. ":" .. (args.name or "")
                    if not pending_doc_edits[doc_key] then
                        pending_doc_edits[doc_key] = { target_args = args, edits = {}, call_indices = {} }
                    end
                    table.insert(pending_doc_edits[doc_key].edits, {
                        start_line = args.start_line,
                        end_line = args.end_line,
                        replacement = args.replacement or "",
                    })
                    table.insert(pending_doc_edits[doc_key].call_indices, i)
                    table.insert(tracked_results, { service = service_name, success = true, args = args })
                    print(string.format("[UpdateGameStateAndDocs] 📝 #%d %s (line %d-%d, batched)", i, service_name, args.start_line or 0, args.end_line or 0))
                else
                    local ok, result = pcall(ServiceRegistry.call, service_name, args)
                    if not ok then
                        failCount = failCount + 1
                        print(string.format("[UpdateGameStateAndDocs] ❌ #%d %s: %s", i, service_name, tostring(result)))
                        table.insert(tracked_results, {
                            service = service_name,
                            success = false,
                            error = tostring(result),
                            args = args
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
                            error = call_error,
                            args = args
                        })
                    end
                end
            end

            -- 批量处理收集的文档编辑
            for doc_key, info in pairs(pending_doc_edits) do
                local ok, err = processDocEdits(info)
                if not ok then
                    for _, idx in ipairs(info.call_indices) do
                        tracked_results[idx] = { service = "state:UpdateSettingDoc", success = false, error = err, args = tracked_calls[idx].args }
                    end
                    failCount = failCount + #info.call_indices
                    failDetails = failDetails .. string.format("UpdateSettingDoc [%s]: %s\n", doc_key, err)
                    print(string.format("[UpdateGameStateAndDocs] ❌ UpdateSettingDoc [%s]: %s", doc_key, err))
                end
            end

            return tracked_calls, tracked_results, failCount, failDetails
        end

        -- 创建检查点并执行首次调用
        local state_ckpt_id = State:checkpoint("Update-State-" .. os.time(), "")
        local tracked_calls, tracked_results, failCount, failDetails = executeCalls(calls)

        print(string.format("[UpdateGameStateAndDocs] 执行完成: %d 成功, %d 失败", #tracked_calls - failCount, failCount))

        -- 保存首次尝试的结果（用于调试，仅在重试时返回）
        local first_attempt = nil

        -- 首次执行有失败调用，尝试带错误反馈的重试（仅重试一次）
        if failCount > 0 then
            first_attempt = {
                calls = tracked_calls,
                results = tracked_results,
                outline = outline,
                failCount = failCount,
            }
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
                .. "- 'location not found' / '目标地点不存在' → The target location doesn't exist in the region. **You must create it first** using `ecs.system:Region.addLocationToRegion` BEFORE `moveCreature`. If the target region itself doesn't exist either, create it with `ecs.system:Spawn.spawnRegion` first. **Infer location_name and location_description from the story context** — the creative writer described the destination but forgot to plan the location creation. This is your job to fix.\n"
                .. "- 'instance_id not found' → The status instance_id doesn't exist. Check the entity's actual StatusEffects in World State and use the correct instance_id, or use `addStatusEffect` if it doesn't exist.\n"
                .. "- 'entity not found' / 'Creature not found' → The creature/region/organization doesn't exist yet. **Create it first** using the corresponding Spawn service (`spawnCharacter`/`spawnRegion`/`spawnOrganization`). Infer the entity's properties from the story context.\n"
                .. "- 'item not found' / '未持有该物品' → The item_id doesn't match any item in the character's inventory. **Check the [Inventory] section in ECS data** for the exact item_id. If the item truly doesn't exist, skip the removal.\n"
                .. "- 'Array index out of bounds' → The array_index you specified exceeds the array length. The error message shows the valid range. To append a new element to an array-type custom component, use `updateCustomComponent` with just `data={...}` (no array_index) or use `setCustomComponent`.\n"
                .. "- 'component_key not found in CustomComponentRegistry' → The component_key doesn't exist in the registry. Check the World entity's CustomComponentRegistry for valid keys.\n"
                .. "- 'does not exist on creature' → The custom component hasn't been initialized on this creature yet. `updateCustomComponent` with `data={...}` will auto-create it.\n"
                .. "- 'Line range X-Y exceeds document length Z' → Your start_line/end_line are out of bounds. Check the line numbers in '# [Context] Documents Targeted for Update'.\n"
                .. "- 'Overlapping edits at line X' → Two UpdateSettingDoc calls edit the same line. Merge overlapping edits into one call.\n\n"
                .. "Please regenerate the COMPLETE JSON with all issues fixed. Do NOT omit the successful calls — include everything.\n"

            local retry_success, retry_ret = pcall(function()
                return Chat.Chat("updateModel", retry_prompt, {
                    responseFormat = { type = "json_object" },
                }, analyzer_premessages, analyzer_system_prompt)
            end)

            if retry_success and retry_ret and not retry_ret.error then
                local retry_parse_ok, retry_parsed = pcall(function() return PartialJson.parse(retry_ret.content) end)

                if retry_parse_ok and retry_parsed and retry_parsed.calls then
                    print("[UpdateGameStateAndDocs] 重试 JSON 解析成功，共 " .. #retry_parsed.calls .. " 条调用")

                    -- 重置并重新执行
                    outline = retry_parsed.outline or outline
                    summary = retry_parsed.summary or summary
                    llm_output = retry_ret.content

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
                print("[UpdateGameStateAndDocs] 重试 Analyzer LLM 调用失败")
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
            summary = summary,
            audit = audit,
            calls = tracked_calls,
            results = tracked_results,
            error = failCount > 0 and string.format("%d/%d calls failed: %s", failCount, #tracked_calls, failDetails) or nil,
            raw_text = llm_output,
            first_attempt = first_attempt
        }
    end)

