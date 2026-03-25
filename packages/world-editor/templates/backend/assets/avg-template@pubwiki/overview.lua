-- 文档次序缓存：存储每一次实际送入 LLM 的文档顺序，用于稳定排序以提升 KV cache 命中率
local doc_order_history = {}

--- 稳定排序算法：对当前文档集合按历史最佳匹配次序重排
--- PlotEvent 文档排除在外（总是放最后），因为它们会不断追加变动
local function stable_reorder_docs(resources)
    -- 1. 分离 PlotEvent 和非 PlotEvent 文档
    local stable = {}
    local plot_event = {}
    for _, item in ipairs(resources) do
        local path_str = table.concat(item.resource.path, "/")
        if path_str:find("PlotEvent") then
            table.insert(plot_event, item)
        else
            table.insert(stable, item)
        end
    end

    -- 2. 构建当前文档集合用于匹配
    local current_set = {}
    for _, item in ipairs(stable) do
        current_set[table.concat(item.resource.path, "/")] = true
    end

    -- 3. 在所有历史次序中找最佳匹配（重叠文档数最多的）
    local best_match = nil
    local best_score = 0
    for _, history in ipairs(doc_order_history) do
        local score = 0
        for _, path in ipairs(history) do
            if current_set[path] then
                score = score + 1
            end
        end
        if score > best_score then
            best_score = score
            best_match = history
        end
    end

    -- 4. 如果找到匹配，按历史次序重排
    if best_match and best_score > 0 then
        local position = {}
        for i, path in ipairs(best_match) do
            position[path] = i
        end

        local known = {}
        local new = {}
        for _, item in ipairs(stable) do
            local path_str = table.concat(item.resource.path, "/")
            if position[path_str] then
                table.insert(known, item)
            else
                table.insert(new, item)
            end
        end

        -- 已知文档按历史位置排序
        table.sort(known, function(a, b)
            return position[table.concat(a.resource.path, "/")] < position[table.concat(b.resource.path, "/")]
        end)

        -- 合并：已知(历史次序) + 新增 + PlotEvent
        stable = {}
        for _, item in ipairs(known) do table.insert(stable, item) end
        for _, item in ipairs(new) do table.insert(stable, item) end

        print(string.format("[DocOrderCache] 匹配历史次序，重叠: %d/%d, 新增: %d, PlotEvent: %d",
            #known, best_score, #new, #plot_event))
    else
        print(string.format("[DocOrderCache] 无历史匹配，首次排序，文档: %d, PlotEvent: %d",
            #stable, #plot_event))
    end

    -- 5. 记录本次次序到历史
    local current_order = {}
    for _, item in ipairs(stable) do
        table.insert(current_order, table.concat(item.resource.path, "/"))
    end
    table.insert(doc_order_history, current_order)

    -- 6. 拼接结果：stable + plot_event
    local result = {}
    for _, item in ipairs(stable) do table.insert(result, item) end
    for _, item in ipairs(plot_event) do table.insert(result, item) end
    return result
end

Service:define()
    :namespace("GameTemplate")
    :name("GetGameOverviewRAGNEXT")
    :desc("使用 LLM Collector 智能获取当前游戏的相关概览信息，根据 prompt 和 rag_config 配置决定包含哪些内容。")
    :usage("基于 RAG 技术，使用 Collector LLM 根据 prompt 智能筛选相关实体和文档，返回精简的游戏概览文本和筛选决策详情。相比 GetGameOverviewNEXT 只返回相关信息，避免上下文过长。with_system_docs=true 时额外包含系统服务文档。")
    :inputs(Type.Object({
        prompt = Type.String:desc("查询指令，用于指导 LLM 筛选相关资源"),
        with_system_docs = Type.Optional(Type.Bool):desc("是否包含系统服务相关文档，默认 false"),
    }))
    :outputs(Type.Object({
        overview_text = Type.String:desc("根据 RAG 配置和提示词筛选出的游戏概览文本"),
        collector_results = Type.Array(Type.Object(
            {
                entity_id = Type.String:desc("实体ID"),
                selected = Type.Bool:desc("是否被选中"),
                thinking = Type.String:desc("思考过程简述"),
                documents = Type.Optional(Type.Array(Type.Object({
                    path = Type.String:desc("文档路径"),
                    selected = Type.Bool:desc("是否被选中"),
                    thinking = Type.String:desc("思考过程简述"),
                    flag_is_thinking_instruction = Type.Bool:desc("是否为思考指令"),
                    flag_is_writing_instruction = Type.Bool:desc("是否为写作指令"),
                    flag_is_updating_instruction = Type.Bool:desc("是否为更新指令"),
                }))):desc("文档决策列表")
            }
        )),
        static_results = Type.Array(Type.Object({
            path = Type.String:desc("文档路径"),
            priority = Type.Int:desc("优先级，数值越大优先级越高"),
        })),
        built_messages = Type.Array(Type.Object({
            role = Type.String:desc("消息角色，user 或 assistant"),
            content = Type.String:desc("消息内容，通常包含设定文档文本"),
        }))
    }))
    :impl(function(inputs)
        
        -- 从 ECS 快照中收集静态优先级文档
        local static_priority_setting_resources = {}

        -- 获取所有实体
        local ecs_snapshot = ServiceRegistry.call("ecs:GetSnapshot", {}).entities
        local world_overview_dict = ServiceRegistry.call("GameTemplate:GetGameEntityOverview", {}).overviews
        local entities = {}
        local prefixs = {
            ["org"] = "OrganizationSetting",
            ["creature"] = "CreatureSetting",
            ["region"] = "RegionSetting",
            ["world"] = "WorldSetting"
        }

        local static_results = {}
        

        for _, entity in pairs(ecs_snapshot) do
            local entity_obj = {}
            local entity_type = "unknown"
            local entity_name = "unknown"
            entity_obj.entity_id = tostring(entity.entity_id)
            entity_obj.description = entity.components["Metadata"].desc
            entity_obj.content = world_overview_dict[tostring(entity.entity_id)] or ""
            if entity.components["Organization"] then
                entity_type = "org"
                entity_name = entity.components["Organization"].name
            elseif entity.components["Creature"] then
                entity_type = "creature"
                entity_name = entity.components["Creature"].name
            elseif entity.components["Region"] then
                entity_type = "region"
                entity_name = entity.components["Region"].region_name
            elseif entity.components["Registry"] then
                entity_type = "world"
                entity_name = "World"
            end

            entity_obj.content = entity_obj.content
            entity_obj.name = entity_name or "null"
            
            -- 直接从实体的 BindSetting.documents 组件读取文档
            local entity_documents = {} 
            if entity.components["BindSetting"] and entity.components["BindSetting"].documents then
                for _, doc in ipairs(entity.components["BindSetting"].documents) do
                    if not doc.disable and doc.content and doc.content ~= "" then
                        local doc_path = (prefixs[entity_type] or "Unknown") .. "/" .. (entity_name or "unknown") .. "/" .. doc.name
                        if doc.static_priority then
                            -- 带静态优先级的文档直接加入，不参与 RAG 筛选
                            table.insert(static_priority_setting_resources, {
                                path = { prefixs[entity_type] or "Unknown", entity_name or "unknown", doc.name },
                                content = doc.content,
                                static_priority = doc.static_priority,
                            })
                            table.insert(static_results, {
                                path = doc_path,
                                priority = doc.static_priority or 100
                            })
                            print("[GetGameOverviewRAG] 静态优先级文档: " .. doc_path .. " (优先级: " .. doc.static_priority .. ")")
                        else
                            table.insert(entity_documents, {
                                path = doc_path,
                                condition = doc.condition,
                                content = doc.content
                            })
                        end
                    end
                end
            end
            
            if entity_type ~= "unknown" then
                entity_obj.documents = entity_documents
                table.insert(entities, entity_obj)
            end

        end

        print("[GetGameOverviewRAG] 静态优先级设定文档数量: " .. tostring(#static_priority_setting_resources))
        

         -- 使用GameTemplate:Collector服务进行筛选
        
        print("[GetGameOverviewRAG] 调用 Collector 服务，实体数量: " .. tostring(#entities))
        local collector_result = ServiceRegistry.call("GameTemplate:Collector", {
            resources = entities,
            instruction = inputs.prompt
        })

        
        if collector_result.error or collector_result._error then
            return {
                error = "[GetGameOverviewRAG] 调用 Collector 失败: ".."error type:" .. type(collector_result.error) .. "_error type:" .. type(collector_result._error) .. "error:" .. tostring(collector_result.error) .. "_error:" .. tostring(collector_result._error),
            }
        end


        print("[GetGameOverviewRAG] RAG筛选完成，选中实体数量: " .. tostring(#collector_result.decisions))

         -- 从 Collector 决策中收集选中的文档
         local rag_filtered_setting_resources = {}
         local rag_filtered_entity_ids = {}

         

         for _, decision in pairs(collector_result.decisions or {}) do
             if decision.selected then
                 rag_filtered_entity_ids[#rag_filtered_entity_ids + 1] = {id = decision.entity_id, reason = decision.thinking}
                 -- 该实体被选中，查找其选中的文档
                 if decision.documents then
                     for _, doc_decision in pairs(decision.documents) do
                         if doc_decision.selected then
                             -- 文档 path 已经是 "Type/EntityName/DocName" 格式
                             -- 将其转换为 Resource 格式以便后续排序合并
                             local pathParts = {}
                             for part in string.gmatch(doc_decision.path, "[^/]+") do
                                 table.insert(pathParts, part)
                             end
                             rag_filtered_setting_resources[#rag_filtered_setting_resources + 1] = {
                                 path = pathParts,
                                 content = doc_decision.content or "",
                             }
                             print("[GetGameOverviewRAG] RAG选中文档: " .. doc_decision.path)
                         end
                     end
                 end
             end
         end
-- 
         -- 合并静态优先级文档和RAG筛选文档(筛选出来的文档优先级默认为50)
         local final_overview_resources = {}
         for _, doc in pairs(static_priority_setting_resources) do
             final_overview_resources[#final_overview_resources + 1] = {
                 resource = doc,
                 priority = doc.static_priority or 100
             }
         end
         for _, doc in pairs(rag_filtered_setting_resources) do
             final_overview_resources[#final_overview_resources + 1] = {
                 resource = doc,
                 priority = 50
             }
         end
-- 
         -- 根据优先级排序
         table.sort(final_overview_resources, function(a, b)
             return a.priority > b.priority
         end)

         -- 应用稳定排序：匹配历史次序，PlotEvent 放最后
         final_overview_resources = stable_reorder_docs(final_overview_resources)
--
         -- 生成最终的文档文本
         local overview_setting = "# 游戏设定文档概览\n\n"
--
         for _, item in ipairs(final_overview_resources) do
             overview_setting = overview_setting .. "## 文档路径: " .. table.concat(item.resource.path, "/") .. "\n"
             overview_setting = overview_setting .. item.resource.content .. "\n\n"
         end

         -- 构建 built_messages：每 3 条设定文档构造一组 user/assistant 消息对
         -- 排在前面的稳定文档次序不变 → 对应的 premessage 可命中 KV cache
         local built_messages = {}
         local batch = {}
         local batch_paths = {}
         for i, item in ipairs(final_overview_resources) do
             local path_str = table.concat(item.resource.path, "/")
             local doc_text = "## 文档路径: " .. path_str .. "\n" .. item.resource.content
             table.insert(batch, doc_text)
             table.insert(batch_paths, path_str)

             if #batch >= 3 or i == #final_overview_resources then
                 table.insert(built_messages, {
                     role = "user",
                     content = table.concat(batch, "\n\n")
                 })
                 table.insert(built_messages, {
                     role = "assistant",
                     content = "I have read the setting documents: " .. table.concat(batch_paths, ", ")
                 })
                 batch = {}
                 batch_paths = {}
             end
         end
-- 
         -- 生成最终的ECS概览文本
         -- 从RAG选中的实体中
         local overview_ecs = "# 游戏ECS状态概览\n\n"
         for _, selected_entity in pairs(rag_filtered_entity_ids) do
             for _, entity in pairs(ecs_snapshot) do
                 if tostring(entity.entity_id) == selected_entity.id then
                     overview_ecs = overview_ecs .. "## 实体ID: " .. tostring(entity.entity_id) .. "\n"
                     --选择原因
                     overview_ecs = overview_ecs .. "### 选择原因: " .. selected_entity.reason .. "\n"
                     overview_ecs = overview_ecs .. "### 名称: " .. entity.components["Metadata"].name .. "\n"
                     overview_ecs = overview_ecs .. "### 描述: " .. entity.components["Metadata"].desc .. "\n"
                     overview_ecs = overview_ecs .. world_overview_dict[tostring(entity.entity_id)] .. "\n\n"
                 end
             end
         end
-- 
         -- 添加系统服务文档（如果为真）
         local overview_system_docs = ""
         if inputs.with_system_docs then
             local system_docs = ServiceRegistry.call("ecs:SystemServices", {})
             overview_system_docs = "# 系统服务文档概览\n\n"
             for _, doc in pairs(system_docs) do
                 overview_system_docs = overview_system_docs .. "## 文档路径: " .. table.concat(doc.path, "/") .. "\n"
                 overview_system_docs = overview_system_docs .. doc.content .. "\n\n"
             end
         end
-- 
         -- 合并所有概览文本
         local overview_text = overview_setting .. overview_ecs .. overview_system_docs
         -- 输出collector_results 字段
         --   collector_results = Type.Array(Type.Object(
         --     {
         --         entity_id = Type.String:desc("实体ID"),
         --         selected = Type.Bool:desc("是否被选中"),
         --         thinking = Type.String:desc("思考过程简述"),
         --         documents = Type.Optional(Type.Array(Type.Object({
         --             path = Type.String:desc("文档路径"),
         --             selected = Type.Bool:desc("是否被选中"),
         --             thinking = Type.String:desc("思考过程简述")
         --         }))):desc("文档决策列表")
         --     }
         -- ))
         
         return {
             overview_text = overview_text,
             overview_ecs = overview_ecs,
             built_messages = built_messages,
             collector_results = collector_result.decisions or {},
             static_results = static_results
         }
         end)

-- 不使用 RAG 筛选，直接返回所有资源的概览
Service:define()
    :namespace("GameTemplate")
    :name("GetGameOverviewNEXT")
    :desc("直接获取当前游戏的完整概览信息，包含所有实体和文档，不进行 RAG 筛选。")
    :usage("直接返回所有实体和文档的完整概览，不进行 RAG 筛选。with_setting_docs 默认 true（包含设定文档），with_system_docs 默认 false。返回全量信息，上下文可能较长。")
    :inputs(Type.Object({
        with_system_docs = Type.Optional(Type.Bool):desc("是否包含系统服务相关文档，默认 false"),
        with_setting_docs = Type.Optional(Type.Bool):desc("是否包含设定文档，默认 true"),
        overview_mode = Type.Optional(Type.String):desc("概览模式，透传给 GetGameEntityOverview。'updater' 模式省略 DirectorNotes 和 Log"),
    }))
    :outputs(Type.Object({
        overview_text = Type.String:desc("完整的游戏概览文本，包含所有实体和文档"),
    }))
    :impl(function(inputs)
        
        -- 获取所有实体
        local ecs_snapshot = ServiceRegistry.call("ecs:GetSnapshot", {}).entities

        print("[GetGameOverviewNEXT] ECS实体总数: " .. tostring(#ecs_snapshot))

        -- 生成设定文档概览（如果需要）
        local overview_setting = ""
        local with_setting_docs = inputs.with_setting_docs
        if with_setting_docs == nil then
            with_setting_docs = true  -- 默认包含设定文档
        end
        
        if with_setting_docs then
            local result = ServiceRegistry.call("state:GetSettingDocsResource", {})
            local setting_docs = result.data or {}
            
            print("[GetGameOverviewNEXT] 设定文档总数: " .. tostring(#setting_docs))
            
            overview_setting = "# 游戏设定文档概览\n\n"
            
            -- 按优先级排序文档
            local sorted_docs = {}
            for _, doc in ipairs(setting_docs) do
                local priority = 50 -- 默认优先级
                if doc.static_priority then
                    priority = doc.static_priority
                end
                table.insert(sorted_docs, {
                    resource = doc,
                    priority = priority
                })
            end
            
            table.sort(sorted_docs, function(a, b)
                return a.priority > b.priority
            end)

            for _, item in ipairs(sorted_docs) do
                overview_setting = overview_setting .. "## 文档路径: " .. table.concat(item.resource.path, "/") .. "\n"
                overview_setting = overview_setting .. item.resource.content .. "\n\n"
            end
        else
            print("[GetGameOverviewNEXT] 跳过设定文档")
        end

        -- 生成 ECS 状态概览
        local overview_ecs = "# 游戏ECS状态概览\n\n"
        
        overview_ecs = overview_ecs .. "总实体数: " .. tostring(#ecs_snapshot) .. "\n\n"

        local world_overview_dict = ServiceRegistry.call("GameTemplate:GetGameEntityOverview", {
            mode = inputs.overview_mode,
        }).overviews

        for _, entity in pairs(ecs_snapshot) do
            overview_ecs = overview_ecs .. world_overview_dict[tostring(entity.entity_id)] .. "\n\n"
        end

        -- 添加系统服务文档（如果需要）
        local overview_system_docs = ""
        if inputs.with_system_docs then
            local system_docs = ServiceRegistry.call("ecs:SystemServices", {}).resources
            overview_system_docs = "# 系统服务文档概览\n\n"
            for _, doc in pairs(system_docs) do
                overview_system_docs = overview_system_docs .. "## 文档路径: " .. table.concat(doc.path, "/") .. "\n"
                overview_system_docs = overview_system_docs .. doc.content .. "\n\n"
            end
        end

        -- 合并所有概览文本
        local overview_text = overview_setting .. overview_ecs .. overview_system_docs
        
        return {
            overview_text = overview_text,
            overview_ecs = overview_ecs,
            overview_system_docs = overview_system_docs,
            overview_setting = overview_setting
        }
    end)


