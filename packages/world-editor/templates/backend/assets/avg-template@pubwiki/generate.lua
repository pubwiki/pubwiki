local CREATIVE_WRITING_PROMPT = require("./prompt_generate_content_with_change_recomands")
local Chat = require("./chat")
local PartialJson = require("partial-json")

-- 缓存上次 RAG 收集结果，用于 reuse_last_collect 跳过重复收集
local last_overview_result = nil
Service:define()
    :namespace("GameTemplate")
    :name("GenerateContent")
    :desc("通用AI内容生成服务，使用LLM根据提示词生成结构化JSON内容")
    :usage("通用AI内容生成服务。先通过 GetGameOverviewNEXT 获取游戏上下文，再结合 prompt 调用 LLM 生成内容。支持纯文本或 JSON 输出（可选 output_schema 约束格式）。with_setting_docs 默认 true。")
    :inputs(Type.Object({
        output_json = Type.Bool:desc("是否输出JSON格式的结果，默认为false"),
        output_schema = Type.Optional(Type.Object({})):desc("如果output_json为true，则可以提供一个JSON Schema来约束输出格式"),
        with_system_docs = Type.Optional(Type.Bool):desc("是否在RAG阶段包含系统文档，默认为false"),
        with_setting_docs = Type.Optional(Type.Bool):desc("是否在RAG阶段包含设定文档，默认为true"),
        skip_overview = Type.Optional(Type.Bool):desc("跳过 GetGameOverviewNEXT 调用，不自动注入 ECS 数据。调用者需自行在 prompt 或 additional_system_prompt 中包含所需上下文"),
        prompt = Type.String:desc("完整的提示词文本，一般包含最近两到三段的剧情内容，以保证上下文连贯"),
        model = Type.Optional(Type.String):desc("使用的LLM模型，不填则为默认模型"),
        model_preset = Type.Optional(Type.String):desc("使用的模型预设配置名称,召回模型'retrievalModel',生成模型'generationModel',更新模型'updateModel'，这个会作为基底的配置，被model参数覆盖"),
        additional_system_prompt = Type.Optional(Type.String):desc("额外的系统提示词，会追加到基础提示词的末尾，提供给LLM更多指引信息"),
        premessages = Type.Optional(Type.Array(Type.Object({
            role = Type.String,
            content = Type.String,
        }))):desc("自定义 premessages，注入到对话历史前部（用于 KV cache 优化）"),
        overview_mode = Type.Optional(Type.String):desc("概览模式，透传给 GetGameEntityOverview。'updater' 模式省略 DirectorNotes 和 Log 以节省 token"),
    }))
    :outputs(Type.Object({
        success = Type.Bool:desc("是否成功"),
        text = Type.String:desc("LLM返回的文本内容"),
        error = Type.Optional(Type.String):desc("错误信息"),
    }))
    :impl(function(inputs)

        local overview_text = ""
        local overview_ecs = ""
        local overview_system_docs = ""
        local overview_setting = ""

        if not inputs.skip_overview then
            local overview_result = Service.call("GameTemplate:GetGameOverviewNEXT", {
                with_system_docs = inputs.with_system_docs or false,
                with_setting_docs = inputs.with_setting_docs ~= false,
                overview_mode = inputs.overview_mode,
            })
            overview_text = overview_result.overview_text or ""
            overview_ecs = overview_result.overview_ecs or ""
            overview_system_docs = overview_result.overview_system_docs or ""
            overview_setting = overview_result.overview_setting or ""
        end

        -- 构建完整提示词
        local full_prompt = inputs.prompt

        if overview_ecs ~= "" then
            full_prompt = "<THE_ECS_DATA>\n".. overview_ecs .. "</THE_ECS_DATA>" .. "\n\n===============================\n\n" .. inputs.prompt
        end

        local cfg = {}

        if inputs.model then
            cfg.model = inputs.model
        end

        if inputs.output_json then
            local responseFormat = {
                type = "json_object"
            }

            if inputs.output_schema then
                responseFormat = {
                    type = "json_schema",
                    json_schema = {
                        name = "OutputSchema",
                        schema = inputs.output_schema,
                        strict = false
                    }
                }
            end
            cfg.responseFormat = responseFormat
        end
        local premessages = {}

        -- 注入自定义 premessages（如果提供）
        if inputs.premessages then
            for _, msg in ipairs(inputs.premessages) do
                table.insert(premessages, msg)
            end
        end

        if inputs.with_system_docs then
            table.insert(premessages, {
                role = "user",
                content = "System doc:\n" .. overview_system_docs
            })
            table.insert(premessages, {
                role = "assistant",
                content = "I have read the system documnents. I will call these system APIs if necessary during game play." 
            })
        end

        if inputs.with_setting_docs then
            table.insert(premessages, {
                role = "user",
                content = "Setting doc:\n" .. overview_setting
            })
            table.insert(premessages, {
                role = "assistant",
                content = "I have read the setting documnents. I will use the information in these documents if necessary during game play." 
            })
        end

        -- 调用LLM生成内容
        local llm_success, ret = pcall(function()
            local model_to_use = inputs.model_preset or "generationModel"
            local llm_result = Chat.Chat(model_to_use, full_prompt, cfg, premessages, inputs.additional_system_prompt or "")
            return llm_result 
        end)
        
        if not llm_success then
            return {
                success = false,
                error = "LLM call failed: " .. tostring(ret)
            }
        end

        if ret.error then
            return {
                success = false,
                error = "LLM call failed: " .. tostring(ret.error)
            }
        end
        
        local result = {
            success = true,
            text = ret.content,
        }
        
        return result
    end)


Service:define()
    :namespace("GameTemplate")
    :name("CreativeWriting")
    :desc("通用创意写作服务(流式版)，是对 GenerateContent 的改版，简化参数，专门用于生成剧情文本")
    :usage([==[
创意写作流式版本。先调用 RAG 筛选相关上下文，再流式调用 LLM 生成剧情内容。
通过 callback 接收事件：
  collector_result_update: RAG 检索完成
  result_update: 增量内容（thinking/content/state_changes/setting_changes）
  done: 生成完成，包含最终结果
  error: 错误信息
output_content_schema 使用 TypeScript 接口格式描述期望的输出结构。
]==])
    :inputs(
        Type.Object(
            {
                model = Type.Optional(Type.String):desc("使用的LLM模型，不填则为默认模型"),
                create_request = Type.String:desc("创意写作请求，描述需要生成的剧情内容"),
                thinking_instruction = Type.String:desc("思考指令，指导AI如何思考和组织内容"),
                thinking_example = Type.Optional(Type.String):desc("思考示例，展示step_1_thinking_result的期望输出格式"),
                previous_content_overview = Type.String:desc("之前剧情内容的片段，用于保持上下文连贯"),
                output_content_schema = Type.String:desc("输出内容的【TypeScript】schema，不严格校验，只用于指导AI生成符合预期结构的内容"),
                output_content_schema_definition = Type.Optional(Type.Object({})):desc("可选的输出内容的接口定义说明，如果提供，则会按照schema严格约束"),
                reuse_last_collect = Type.Optional(Type.Bool):desc("重用上次缓存的 RAG 收集结果，跳过 collector 阶段，用于生成失败后的重试"),
                skip_state_updates = Type.Optional(Type.Bool):desc("内容专注模式：为true时只输出step_1(思考)和step_2(创意内容)，跳过step_3(状态更新)和step_4(导演笔记)，节省token并让AI专注于创作质量"),
                callback = Type.Function({params = Type.Object({
                    event_type = Type.String:desc("事件类型,'collector_result_update'表示collector结果更新,'error'表示出错,'result_update'表示收到部分输出内容 ,'done'表示完成"),
                    event_data = Type.Any:desc("事件数据，具体内容取决于事件类型"),
                })}):desc("流式回调函数"),  -- 新增回调函数参数
            }
        )
    )
    :outputs(Type.Object({}))
    :impl(function(inputs)
        local prompt_part1 = CREATIVE_WRITING_PROMPT.PART1

        local request_prompt = CREATIVE_WRITING_PROMPT.PART1_2
        -- 替换用户请求
        print("[GENERATE]开始生成内容...")
        print("[GENERATE]CREATIVE_WRITING_PROMPT 原始长度:", #request_prompt)
        request_prompt = Regex.replaceLiteral(request_prompt, "<THE_CREATE_REQUEST>", inputs.create_request)
        print("[GENERATE]CREATE REQUEST 长度:", #inputs.create_request)
        request_prompt = Regex.replaceLiteral(request_prompt, "<THE_THINKING_INSTRUCTION>", inputs.thinking_instruction)
        print("[GENERATE]THINKING INSTRUCTION 长度:", #inputs.thinking_instruction)
        -- 在 previous_content_overview 末尾追加当前游戏时间提醒，强化 LLM 时间感知
        local prev_content = inputs.previous_content_overview or ""
        local timeQueryResult = ServiceRegistry.call("ecs.system:Time.getWorldTime", {})
        if timeQueryResult.success then
            local t = timeQueryResult
            prev_content = prev_content .. string.format(
                "\n\n⏰ **Current Game Time (when this new turn begins)**: %d/%d/%d %02d:%02d — all new content must be consistent with this timestamp.",
                t.year, t.month, t.day, t.hour, t.minute)
        end
        request_prompt = Regex.replaceLiteral(request_prompt, "<PREVIOUS_CONTENT_OVERVIEW>", prev_content)
        print("[GENERATE]PREVIOUS CONTENT OVERVIEW 长度:", #prev_content)
        local output_schema = {
            type = "object",
            properties = {
                step_1_thinking_result = { type = "string" },
                step_2_creative_content = inputs.output_content_schema_definition,
                step_3a_setting_update_recommands = {
                    type = "array",
                    items = {
                        type = "object",
                        properties = {
                            option = { type = "string", enum = {"create", "append", "update"} },
                            creature_id = { type = "string" },
                            organization_id = { type = "string" },
                            region_id = { type = "string" },
                            doc_name = { type = "string" },
                            suggestion = { type = "string" },
                        },
                        required = { "option", "doc_name", "suggestion" }
                    }
                },
                step_3b_event_recommands = {
                    type = "array",
                    items = {
                        type = "object",
                        properties = {
                            option = { type = "string", enum = {"create", "append", "update"} },
                            event_id = { type = "string" },
                            title = { type = "string" },
                            summary = { type = "string" },
                            suggestion = { type = "string" },
                            related_entities = { type = "array", items = { type = "string" } },
                        },
                        required = { "option", "event_id", "summary", "suggestion" }
                    }
                },
                step_3c_new_entities = {
                    type = "array",
                    items = {
                        type = "object",
                        properties = {
                            type = { type = "string", enum = {"creature", "region", "organization"} },
                            name = { type = "string" },
                            description = { type = "string" },
                        },
                        required = { "type", "name", "description" }
                    }
                },
                step_4_director_notes = {
                    type = "object",
                    properties = {
                        notes = {type = "array", items = { type = "string" } },
                        flags = {type = "array", items = { type = "object", properties = { id = { type = "string" }, value = { type = "boolean" }, remark = { type = "string" } } } },
                        stage_goal = {type = {"string", "null"} },
                    }
                }
            },
            required = { "step_1_thinking_result", "step_2_creative_content", "step_3a_setting_update_recommands", "step_3b_event_recommands", "step_3c_new_entities", "step_4_director_notes" }
        }

        print("[GENERATE]CREATIVE_WRITING_PROMPT 最终长度:", #request_prompt)

        -- 调用RAG（或重用上次缓存的结果）
        local overview_result
        if inputs.reuse_last_collect and last_overview_result then
            overview_result = last_overview_result
            print("[GENERATE] 重用上次缓存的 RAG 收集结果，跳过 collector 阶段")
        else
            overview_result = Service.call("GameTemplate:GetGameOverviewRAGNEXT", {
                    prompt = prompt_part1 .. request_prompt,
                    with_system_docs = false,
                })

            if overview_result.error then
                print("[GENERATE] 调用 GetGameOverviewRAGNEXT 失败:", overview_result.error)
                inputs.callback({
                    event_type = "error",
                    event_data = "GetGameOverviewRAGNEXT call failed: " .. tostring(overview_result.error)
                })
                return {}
            end

            if overview_result.collector_results == nil or #overview_result.collector_results == 0 then
                print("[GENERATE] RAG collector 未返回结果，跳过 collector 阶段继续生成")
                overview_result.collector_results = {}
            end

            -- 缓存本次 RAG 结果
            last_overview_result = overview_result
        end

        inputs.callback({
            event_type = "collector_result_update",
            event_data = { collector_results = overview_result.collector_results, collector_outline = overview_result.collector_outline, selected_events = overview_result.selected_events }
        })

        -- 将 collector 返回的 path 转为元数据格式引用
        local dm = overview_result.doc_metadata or {}
        local function formatDocRef(path)
            local meta = dm[path]
            if meta and meta.id_key and meta.specific_id then
                return string.format('{%s: "%s", name: "%s"}', meta.id_key, meta.specific_id, meta.doc_name)
            elseif meta then
                return string.format('{name: "%s"} (World Setting)', meta.doc_name)
            end
            return path
        end

        -- 从 collector_results 中提取标记的指令文档
        local thinking_instruction_docs = {}
        local writing_instruction_docs = {}
        local updating_instruction_docs = {}
        for _, decision in ipairs(overview_result.collector_results or {}) do
            if decision.selected and decision.documents then
                for _, doc in ipairs(decision.documents) do
                    if doc.selected then
                        local ref = formatDocRef(doc.path)
                        if doc.flag_is_thinking_instruction then
                            table.insert(thinking_instruction_docs, ref)
                        end
                        if doc.flag_is_writing_instruction then
                            table.insert(writing_instruction_docs, ref)
                        end
                        if doc.flag_is_updating_instruction then
                            table.insert(updating_instruction_docs, ref)
                        end
                    end
                end
            end
        end

        -- 追加思考指令文档引用到 request_prompt（深度思考指令后）
        if #thinking_instruction_docs > 0 then
            local lines = {"\n\n【Important·Thinking Instruction Documents】The following documents contain key thinking/reasoning guidelines, please follow them when engaging in deep thinking:"}
            for _, path in ipairs(thinking_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            request_prompt = request_prompt .. table.concat(lines, "\n")
        end

        -- 追加写作指令文档引用到 request_prompt（创作请求后）
        if #writing_instruction_docs > 0 then
            local lines = {"\n\n【Important·Writing Instruction Documents】The following documents contain key writing style/formatting guidelines, please follow them when creating content:"}
            for _, path in ipairs(writing_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            request_prompt = request_prompt .. table.concat(lines, "\n")
        end

        -- 从 collector_results 中提取选中的文档引用（元数据格式）
        local selected_doc_paths = {}
        for _, decision in ipairs(overview_result.collector_results or {}) do
            if decision.selected and decision.documents then
                for _, doc in ipairs(decision.documents) do
                    if doc.selected then
                        table.insert(selected_doc_paths, formatDocRef(doc.path))
                    end
                end
            end
        end

        -- 增加选中文档列表和collector outline
        local collector_outline = overview_result.collector_outline or ""
        if #selected_doc_paths > 0 then
            local doc_list = "\n\n【Chosen Documents And Rationale】\n"
            if collector_outline ~= "" then
                doc_list = doc_list .. "Collector analysis: " .. collector_outline .. "\n\nSelected documents:\n"
            end
            doc_list = doc_list .. table.concat(selected_doc_paths, "\n")
            request_prompt = request_prompt .. doc_list
        end

        -- 增加选中事件的摘要信息，帮助 LLM 回忆近期剧情
        local selected_events = overview_result.selected_events or {}
        if #selected_events > 0 then
            -- 从世界实体获取事件详情
            local evts_result = ServiceRegistry.call("ecs.system:Events.getEvents", { event_ids = selected_events })
            if evts_result.success and evts_result.events and #evts_result.events > 0 then
                local evt_lines = {"\n\n【Selected Plot Events (recent/relevant — review before writing)】"}
                for _, evt in ipairs(evts_result.events) do
                    local related = ""
                    if evt.related_entities and #evt.related_entities > 0 then
                        related = " [related: " .. table.concat(evt.related_entities, ", ") .. "]"
                    end
                    table.insert(evt_lines, string.format("  - 🎬 %s: \"%s\" — %s%s",
                        evt.event_id, evt.title, evt.summary or "", related))
                end
                request_prompt = request_prompt .. table.concat(evt_lines, "\n")
            end
        end

        -- 替换状态更新指令文档占位符（仅当有标记文档时显示该节）
        local updating_docs_section = ""
        if #updating_instruction_docs > 0 then
            local lines = {"\n* [Updating Instruction Documents]（Please follow these rules especially in STEP3 game state changes and STEP4 document updates）："}
            for _, path in ipairs(updating_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            updating_docs_section = table.concat(lines, "\n")
        end
        request_prompt = Regex.replaceLiteral(request_prompt, "<THE_UPDATING_INSTRUCTION_DOCS>", updating_docs_section)



        print(string.format("[GENERATE] 标记文档统计 - 思考指令: %d, 写作指令: %d, 状态更新: %d",
            #thinking_instruction_docs, #writing_instruction_docs, #updating_instruction_docs))

        -- === 提取 DirectorNotes + GameTime，用于在 prompt 显眼位置单独呈现 ===
        local director_notes_section = ""
        local worldEntitiesForDN = ServiceRegistry.call("ecs:GetEntitiesByComponent", {
            component_keys = {"Registry"}
        })
        if worldEntitiesForDN.count > 0 then
            local worldEid = worldEntitiesForDN.entity_ids[1]
            local dn_parts = {}

            -- 获取当前游戏时间
            local timeResult = ServiceRegistry.call("ecs:GetComponentData", {
                entity_id = worldEid,
                component_key = "GameTime"
            })
            if timeResult.found then
                local gt = timeResult.data
                table.insert(dn_parts, string.format("**Current Game Time**: %d/%d/%d %d:%02d",
                    gt.year, gt.month, gt.day, gt.hour, gt.minute))
            end

            -- 获取 DirectorNotes
            local dnResult = ServiceRegistry.call("ecs:GetComponentData", {
                entity_id = worldEid,
                component_key = "DirectorNotes"
            })
            if dnResult.found then
                local dn = dnResult.data
                if dn.stage_goal and dn.stage_goal ~= "" then
                    table.insert(dn_parts, "**⚠️ Stage Goal (MUST follow)**: " .. dn.stage_goal)
                end
                -- Flags 先显示（可能很多，包含远古的），放在前面让 LLM 先建立全局认知
                if dn.flags then
                    local flag_list = {}
                    for key, flag in pairs(dn.flags) do
                        table.insert(flag_list, { key = key, value = flag.value, remark = flag.remark })
                    end
                    if #flag_list > 0 then
                        table.insert(dn_parts, "**📌 Permanent Flags** (milestone markers — never forget these):")
                        for _, f in ipairs(flag_list) do
                            local remark = f.remark and (" — " .. f.remark) or ""
                            table.insert(dn_parts, string.format("  📌 %s = %s%s", f.key, tostring(f.value), remark))
                        end
                    end
                end
                -- Notes 后显示（只有最近几条），紧贴 Creative Request，LLM 最后读到的就是最新上下文
                if dn.notes and #dn.notes > 0 then
                    table.insert(dn_parts, "**🔄 Director Notes** (rolling memory, most recent context):")
                    local total = #dn.notes
                    local start_idx = math.max(1, total - 4) -- last 5 notes
                    for i = start_idx, total do
                        local tag = i >= total - 1 and "⭐RECENT" or "older"
                        table.insert(dn_parts, string.format("  [%d] (%s) %s", i, tag, dn.notes[i]))
                    end
                end
            end

            if #dn_parts > 0 then
                director_notes_section = "\n\n## ⚠️ Director's Dashboard (READ BEFORE WRITING) ⚠️\n" .. table.concat(dn_parts, "\n") .. "\n"
            end
        end

        request_prompt = Regex.replaceLiteral(request_prompt, "<THE_DIRECTOR_DASHBOARD>", director_notes_section)

        -- 构建固定指令（放入system prompt，利用KV cache）
        local fixed_instructions = CREATIVE_WRITING_PROMPT.FIXED_INSTRUCTIONS

        -- 动态部分：PART1（收集器结果+Review）+ DYNAMIC_SUFFIX（输出Schema+请求+提醒）
        local prompt = CREATIVE_WRITING_PROMPT.PART1 .. CREATIVE_WRITING_PROMPT.DYNAMIC_SUFFIX

        -- 内容专注模式：移除 STEP3/4 指令和输出 schema，只保留 STEP1(思考) + STEP2(创意内容)
        if inputs.skip_state_updates then
            -- 从 system prompt 中截断 STEP3/4 任务流指令，替换为 content-only 说明
            local step3_start = fixed_instructions:find("### Task Flow: STEP3")
            if step3_start then
                fixed_instructions = fixed_instructions:sub(1, step3_start - 1) .. CREATIVE_WRITING_PROMPT.CONTENT_ONLY_TASK_INSTRUCTIONS
            end
            -- 使用 content-only 版本的动态后缀（无 STEP3/4 schema 和提醒）
            prompt = CREATIVE_WRITING_PROMPT.PART1 .. CREATIVE_WRITING_PROMPT.DYNAMIC_SUFFIX_CONTENT_ONLY
            print("[GENERATE] 内容专注模式：跳过 STEP3/4 输出")
        end

        print("[GENERATE] FIXED_INSTRUCTIONS 长度:", #fixed_instructions)
        print("[GENERATE] DYNAMIC prompt 长度:", #prompt)

        -- 替换请求Prompt
        prompt = Regex.replaceLiteral(prompt, "<THE_REQUEST_PROMPT>", request_prompt)
        print("[GENERATE] 替换请求Prompt后长度:", #prompt)

        -- 替换思考示例
        local default_thinking_example = [[    Following [Creative Request] and [Deep Thinking Instruction]:
    1. ...
    2. ...
    3. ...
    (If the user has other thinking instructions, list them)
    **New Element Planning**: Does this segment need new locations/characters? Judge based on actual narrative needs. If yes, list planned new entities; if existing entities suffice, explain why.]]
        prompt = Regex.replaceLiteral(prompt, "<THE_THINKING_EXAMPLE>", inputs.thinking_example or default_thinking_example)

        -- 替换收集器的结果（设定文档已通过 built_messages 作为 premessages 送入，这里只放 ECS 数据）
        -- 附加紧凑实体索引，帮助LLM了解游戏中所有存在的实体/地点/组件，避免引用不存在的东西
        local entity_index = ServiceRegistry.call("GameTemplate:GetCompactEntityIndex", {})
        prompt = Regex.replaceLiteral(prompt, "<THE_COLLECTOR_RESULT>",
            "<COLLECTOR_RESULT>"  .. "\n\n" .. entity_index.index_text .. "\n\n" .. (overview_result.overview_ecs or overview_result.overview_text) .. "</COLLECTOR_RESULT>")
        print("[GENERATE] 替换收集器结果后长度:", #prompt)
        
        -- 替换GAME_DOCUMENT_PATH_OVERVIEW:
        -- 这里收集所有文档的路径
        local setting_docs = ServiceRegistry.call("state:GetSettingDocsResource", {}).data or {}
        local all_setting_doc_info_text = {}
        for _, doc in ipairs(setting_docs) do
            table.insert(all_setting_doc_info_text, string.format("- %s (Length: %d word) ", table.concat(doc.path,"/"), #doc.content))
        end
        
        local id_key_map = {
            CreatureSetting = "creature_id",
            OrganizationSetting = "organization_id",
            RegionSetting = "region_id",
        }
        local static_docs_info_text = ""
        for _, doc in ipairs(setting_docs) do
            if doc.static_priority then
                local doc_name = doc.path[3] or table.concat(doc.path, "/")
                local ik = id_key_map[doc.path[1]]
                local meta_str
                if ik and doc.specific_id and doc.specific_id ~= "world" then
                    meta_str = string.format('{%s: "%s", name: "%s"}', ik, doc.specific_id, doc_name)
                else
                    meta_str = string.format('{name: "%s"} (World Setting)', doc_name)
                end
                static_docs_info_text = static_docs_info_text .. string.format("- %s (Length: %d Word) - StaticPriority: %d, condition: %s", meta_str, #doc.content, doc.static_priority, doc.condition or "none") .. "\n"
            end
        end

        prompt = Regex.replaceLiteral(prompt, "<STATIC_DOCS_OVERVIEW>", static_docs_info_text)
        print("[GENERATE] 替换设定文档路径速览后长度:", #prompt)

        -- 替换输出schema指令
        prompt = Regex.replaceLiteral(prompt, "<THE_CREATE_SCHEMA_INSTRUCTION>", inputs.output_content_schema)
        print("[GENERATE] 替换输出schema指令后长度:", #prompt)

        -- 构建LLM配置
        local cfg = {
            responseFormat = {
                type = "json_object"
            }
        }
        
        -- if inputs.output_content_schema_definition then
        --     cfg.responseFormat.type = "json_schema"
        --     cfg.responseFormat.json_schema = {
        --         name = "OutputContentSchema",
        --         schema = output_schema
        --     }
        -- end


        if inputs.model then
            cfg.model = inputs.model
        end
        -- 设定文档作为 premessages（稳定排序，每3条一组，利于 KV cache）
        local premessages = overview_result.built_messages or {}
        local ret = Chat.ChatStream("generationModel", prompt, cfg, premessages, fixed_instructions)

        local raw_text = ""
        local reasoning = ""
            
        -- | { type: 'token'; token: string }
        -- | { type: 'reasoning'; token: string }
        -- | { type: 'tool_call'; id: string; name: string; args: unknown }
        -- | { type: 'tool_result'; id: string; result: unknown }
        -- | { type: 'iteration_limit_reached'; currentIteration: number; maxIterations: number }
        -- | { type: 'error'; error: Error }
        -- | { type: 'done'; message: MessageNode; historyId: string }
             
        for chunk in ret.stream do
            inputs.callback({
                event_type = "debug_chunk",
                event_data = { type = chunk.type, token = chunk.token }
            })
            if chunk.type == "reasoning" then
                reasoning = reasoning .. chunk.token
                inputs.callback({
                    event_type = "reasoning_update",
                    event_data = {
                        raw_text = raw_text,
                        reasoning = reasoning,
                        collector_results = overview_result.collector_results,
                        collector_outline = overview_result.collector_outline
                    }
                })
            end
            if chunk.type == "token" then
                raw_text = raw_text .. chunk.token
                -- 使用pcall 调用require("partial-json").parse(raw_text)
                local success, data = pcall(function() return PartialJson.parse(raw_text) end)
                if not success then
                    data = {}
                end
                if not data or data._error then
                    data = {}
                end
                inputs.callback({
                    event_type = "result_update",
                    event_data = {
                        raw_text = raw_text,
                        reasoning = reasoning,
                        thinking = data.step_1_thinking_result or nil,
                        content = data.step_2_creative_content or nil,
                        setting_changes = data.step_3a_setting_update_recommands or nil,
                        event_changes = data.step_3b_event_recommands or nil,
                        new_entities = data.step_3c_new_entities or nil,
                        director_notes = data.step_4_director_notes or nil,
                        collector_results = overview_result.collector_results,
                        collector_outline = overview_result.collector_outline
                    }
                })
            end
            if chunk.type == "error" then
                inputs.callback({
                    event_type = "error",
                    event_data = chunk.error
                })
                return {}
            end
            if chunk.type == "done" then
                local success, data = pcall(function() return PartialJson.parse(raw_text) end)
                if not success then
                    data = {}
                end
                if data._error then
                    inputs.callback({
                        event_type = "error",
                        event_data = "JSON parse failed: " .. tostring(data._error)
                    })
                    return {}
                end
                inputs.callback({
                    event_type = "done",
                    event_data = {
                        thinking = data.step_1_thinking_result or nil,
                        reasoning = reasoning,
                        raw_text = raw_text,
                        content = data.step_2_creative_content or nil,
                        setting_changes = data.step_3a_setting_update_recommands or nil,
                        event_changes = data.step_3b_event_recommands or nil,
                        new_entities = data.step_3c_new_entities or nil,
                        director_notes = data.step_4_director_notes or nil,
                        collector_results = overview_result.collector_results,
                        collector_outline = overview_result.collector_outline,
                        updater_messages = overview_result.updater_messages or {}
                    }
                })
                require("LLM").deleteChat(ret.root_history)
                return {}
            end
        end

        return {}
    end
    )