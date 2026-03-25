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
        prompt = Type.String:desc("完整的提示词文本，一般包含最近两到三段的剧情内容，以保证上下文连贯"),
        model = Type.Optional(Type.String):desc("使用的LLM模型，不填则为默认模型"),
        model_preset = Type.Optional(Type.String):desc("使用的模型预设配置名称,召回模型'retrievalModel',生成模型'generationModel',更新模型'updateModel'，这个会作为基底的配置，被model参数覆盖"),
        additional_system_prompt = Type.Optional(Type.String):desc("额外的系统提示词，会追加到基础提示词的末尾，提供给LLM更多指引信息"),
        overview_mode = Type.Optional(Type.String):desc("概览模式，透传给 GetGameEntityOverview。'updater' 模式省略 DirectorNotes 和 Log 以节省 token"),
    }))
    :outputs(Type.Object({
        success = Type.Bool:desc("是否成功"),
        text = Type.String:desc("LLM返回的文本内容"),
        error = Type.Optional(Type.String):desc("错误信息"),
    }))
    :impl(function(inputs)

        local overview_result = Service.call("GameTemplate:GetGameOverviewNEXT", {
            with_system_docs = inputs.with_system_docs or false,
            with_setting_docs = inputs.with_setting_docs ~= false,
            overview_mode = inputs.overview_mode,
        })

        local overview_text = overview_result.overview_text or ""
        local overview_ecs = overview_result.overview_ecs or ""
        local overview_system_docs = overview_result.overview_system_docs or ""
        local overview_setting = overview_result.overview_setting or ""
        
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
        local premessages = {

        }

        if inputs.with_system_docs then
            table.insert(premessages, {
                role = "user",
                content = "系统文档:\n" .. overview_system_docs
            })
            table.insert(premessages, {
                role = "assistant",
                content = "I have read the system documnents. I will call these system APIs if necessary during game play." 
            })
        end

        if inputs.with_setting_docs then
            table.insert(premessages, {
                role = "user",
                content = "设定文档:\n" .. overview_setting
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
                error = "LLM调用失败: " .. tostring(ret)
            }
        end

        if ret.error then
            return {
                success = false,
                error = "LLM调用失败: " .. tostring(ret.error)
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
    :name("CreativeWritingStream")
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
                previous_content_overview = Type.String:desc("之前剧情内容的片段，用于保持上下文连贯"),
                output_content_schema = Type.String:desc("输出内容的【TypeScript】schema，不严格校验，只用于指导AI生成符合预期结构的内容"),
                output_content_schema_definition = Type.Optional(Type.Object({})):desc("可选的输出内容的接口定义说明，如果提供，则会按照schema严格约束"),
                reuse_last_collect = Type.Optional(Type.Bool):desc("重用上次缓存的 RAG 收集结果，跳过 collector 阶段，用于生成失败后的重试"),
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
        request_prompt = Regex.replaceLiteral(request_prompt, "<PREVIOUS_CONTENT_OVERVIEW>", inputs.previous_content_overview or "")
        print("[GENERATE]PREVIOUS CONTENT OVERVIEW 长度:", #(inputs.previous_content_overview or ""))
        local output_schema = {
            type = "object",
            properties = {
                step_1_thinking_result = { type = "string" },
                step_2_creative_content = inputs.output_content_schema_definition,
                step_3_gamestate_changes = {
                    type = "array",
                    items = {
                        type = "string",
                    }
                },
                step_4_setting_update_recommands = {
                    type = "array",
                    items = {
                        type = "string",
                    }
                },
                step_5_director_notes = {
                    type = "object",
                    properties = {
                        notes = {type = "array", items = { type = "string" } },
                        flags = {type = "array", items = { type = "object", properties = { id = { type = "string" }, value = { type = "boolean" }, remark = { type = "string" } } } },
                        stage_goal = {type = {"string", "null"} },
                    }
                }
            },
            required = { "step_1_thinking_result", "step_2_creative_content", "step_3_gamestate_changes", "step_4_setting_update_recommands", "step_5_director_notes" }
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
                    event_data = "调用 GetGameOverviewRAGNEXT 失败: " .. tostring(overview_result.error)
                })
                return {}
            end

            if overview_result.collector_results == nil or #overview_result.collector_results == 0 then
                error("RAG 收集器未返回任何结果")
            end

            -- 缓存本次 RAG 结果
            last_overview_result = overview_result
        end

        inputs.callback({
            event_type = "collector_result_update",
            event_data = { collector_results = overview_result.collector_results }
        })

        -- 从 collector_results 中提取标记的指令文档
        local thinking_instruction_docs = {}
        local writing_instruction_docs = {}
        local updating_instruction_docs = {}
        for _, decision in ipairs(overview_result.collector_results or {}) do
            if decision.selected and decision.documents then
                for _, doc in ipairs(decision.documents) do
                    if doc.selected then
                        if doc.flag_is_thinking_instruction then
                            table.insert(thinking_instruction_docs, doc.path)
                        end
                        if doc.flag_is_writing_instruction then
                            table.insert(writing_instruction_docs, doc.path)
                        end
                        if doc.flag_is_updating_instruction then
                            table.insert(updating_instruction_docs, doc.path)
                        end
                    end
                end
            end
        end

        -- 追加思考指令文档引用到 request_prompt（深度思考指令后）
        if #thinking_instruction_docs > 0 then
            local lines = {"\n\n【重要·思考指令文档】以下文档包含关键的思考/推理指引，请在深度思考时务必遵循："}
            for _, path in ipairs(thinking_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            request_prompt = request_prompt .. table.concat(lines, "\n")
        end

        -- 追加写作指令文档引用到 request_prompt（创作请求后）
        if #writing_instruction_docs > 0 then
            local lines = {"\n\n【重要·写作指令文档】以下文档包含关键的写作风格/格式指引，请在创作时务必遵循："}
            for _, path in ipairs(writing_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            request_prompt = request_prompt .. table.concat(lines, "\n")
        end

        -- 从 collector_results 中提取选中的文档路径
        -- 收集选中文档路径和原因
        local selected_doc_info_text = {}
        for _, decision in ipairs(overview_result.collector_results or {}) do
            if decision.selected and decision.documents then
                for _, doc in ipairs(decision.documents) do
                    if doc.selected then
                        table.insert(selected_doc_info_text, string.format("%s: %s", doc.path, doc.thinking or "无"))
                    end
                end
            end
        end

        -- 增加所有文档的info
        request_prompt = request_prompt .. (selected_doc_info_text and ("\n\n【选中文档及理由】以下是RAG阶段选中的文档路径及对应的选择理由：\n" .. table.concat(selected_doc_info_text, "\n")) or "")

        -- 替换状态更新指令文档占位符（仅当有标记文档时显示该节）
        local updating_docs_section = ""
        if #updating_instruction_docs > 0 then
            local lines = {"\n* [状态更新指令文档]（请在 STEP3 游戏状态变更和 STEP4 文档更新时特别遵循这些文档中的规则）："}
            for _, path in ipairs(updating_instruction_docs) do
                table.insert(lines, "  - " .. path)
            end
            updating_docs_section = table.concat(lines, "\n")
        end
        request_prompt = Regex.replaceLiteral(request_prompt, "<THE_UPDATING_INSTRUCTION_DOCS>", updating_docs_section)



        print(string.format("[GENERATE] 标记文档统计 - 思考指令: %d, 写作指令: %d, 状态更新: %d",
            #thinking_instruction_docs, #writing_instruction_docs, #updating_instruction_docs))

        -- 构建固定指令（放入system prompt，利用KV cache）
        local fixed_instructions = CREATIVE_WRITING_PROMPT.FIXED_INSTRUCTIONS

        -- 注入 creature_attr_fields 描述到固定指令中
        local attr_fields_desc = "(No creature_attr_fields defined in Registry)"
        local worldEntities = ServiceRegistry.call("ecs:GetEntitiesByComponent", {
            component_keys = {"Registry"}
        })
        if worldEntities.count > 0 then
            local registryResult = ServiceRegistry.call("ecs:GetComponentData", {
                entity_id = worldEntities.entity_ids[1],
                component_key = "Registry"
            })
            if registryResult.found and registryResult.data.creature_attr_fields and #registryResult.data.creature_attr_fields > 0 then
                local parts = {}
                for _, field in ipairs(registryResult.data.creature_attr_fields) do
                    table.insert(parts, string.format("%s: %s", field.field_name, field.hint))
                end
                attr_fields_desc = "Attribute names defined by Registry.creature_attr_fields: " .. table.concat(parts, ", ")
            end
        end
        fixed_instructions = Regex.replaceLiteral(fixed_instructions, "<CREATURE_ATTR_FIELDS_DESC>", attr_fields_desc)

        -- 动态部分：PART1（收集器结果+Review）+ DYNAMIC_SUFFIX（输出Schema+请求+提醒）
        local prompt = CREATIVE_WRITING_PROMPT.PART1 .. CREATIVE_WRITING_PROMPT.DYNAMIC_SUFFIX

        print("[GENERATE] FIXED_INSTRUCTIONS 长度:", #fixed_instructions)
        print("[GENERATE] DYNAMIC prompt 长度:", #prompt)

        -- 替换请求Prompt
        prompt = Regex.replaceLiteral(prompt, "<THE_REQUEST_PROMPT>", request_prompt)
        print("[GENERATE] 替换请求Prompt后长度:", #prompt)

        -- 替换收集器的结果（设定文档已通过 built_messages 作为 premessages 送入，这里只放 ECS 数据）
        prompt = Regex.replaceLiteral(prompt, "<THE_COLLECTOR_RESULT>", "<COLLECTOR_RESULT>" .. (overview_result.overview_ecs or overview_result.overview_text) .. "</COLLECTOR_RESULT>")
        print("[GENERATE] 替换收集器结果后长度:", #prompt)
        
        -- 替换GAME_DOCUMENT_PATH_OVERVIEW:
        -- 这里收集所有文档的路径
        local setting_docs = ServiceRegistry.call("state:GetSettingDocsResource", {}).data or {}
        local all_setting_doc_info_text = {}
        for _, doc in ipairs(setting_docs) do
            table.insert(all_setting_doc_info_text, string.format("- %s (长度: %d 字) ", table.concat(doc.path,"/"), #doc.content))
        end
        prompt = Regex.replaceLiteral(prompt, "<GAME_DOCUMENT_PATH_OVERVIEW>", table.concat(all_setting_doc_info_text, "\n"))

        prompt = Regex.replaceLiteral(prompt, "<SETTING_DOCS_REASONS_OVERVIEW>", table.concat(selected_doc_info_text, "\n"))

        local static_docs_info_text = ""
        for _, doc in ipairs(setting_docs) do
            if doc.static_priority then
                static_docs_info_text = static_docs_info_text .. string.format("- %s (长度: %d 字) - StaticPriority: %d, condition: %s", table.concat(doc.path,"/"), #doc.content, doc.static_priority, doc.condition or "无") .. "\n"
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
                        collector_results = overview_result.collector_results
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
                        state_changes = data.step_3_gamestate_changes or nil,
                        setting_changes = data.step_4_setting_update_recommands or nil,
                        director_notes = data.step_5_director_notes or nil,
                        collector_results = overview_result.collector_results
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
                local success, data = pcall(function() return json.decode(raw_text) end)
                if not success then
                    data = {}
                end
                if data._error then
                    inputs.callback({
                        event_type = "error",
                        event_data = "JSON解析失败: " .. tostring(data._error)
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
                        state_changes = data.step_3_gamestate_changes or nil,
                        setting_changes = data.step_4_setting_update_recommands or nil,
                        director_notes = data.step_5_director_notes or nil,
                        collector_results = overview_result.collector_results
                    }
                })
                require("LLM").deleteChat(ret.root_history)
                return {}
            end
        end

        return {}
    end
    )