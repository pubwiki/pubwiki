local ServiceRegistry = require("core/service")
local Type = require("core/types")
local ecs = require("./ecs")

-- ============ 源1：组件类型定义 ============
ServiceRegistry:definePure()
    :namespace("ecs")
    :name("ComponentTypes")
    :desc("获取所有已注册组件的类型定义文档")
    :usage("返回 ECS 系统中所有已注册组件的完整类型定义，包括组件名称、描述和数据结构。帮助 AI 理解组件系统的结构和每个字段的含义。")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        resources = Type.Array(Type.Object({
            path = Type.Array(Type.String),
            content = Type.String,
        })):desc("组件类型定义资源列表")
    }))
    :impl(function(params)
        local resources = {}
        
        table.insert(resources, {
            path = {"ComponentTypes"},
            content = "Component type definition document",
            metadata = {
                description = "All registered component types and their data structure specifications",
                priority = 100,
            }
        })
        
        -- 从 RDF store 查询所有已注册的组件类型
        local componentTypes = State:match({ 
            subject = "ecs://component", 
            predicate = "ecs://component/contains" 
        })
        
        for _, triple in pairs(componentTypes) do
            -- 从 URI 中提取组件 key：ecs://component/type/ComponentKey -> ComponentKey
            local componentKey = string.sub(triple.object, 22)
            
            -- 通过 World 获取组件类型定义
            local componentType = ecs.World:getComponentTypeByKey(componentKey)
            
            -- 获取组件的类型定义
            local typeSpec = componentType:getTypeSpec()
            
            -- 使用 Type.format 生成类型文档
            local typeDoc = Type.format(typeSpec, 0, true)
            
            -- 组合组件信息
            local componentDoc = string.format(
                "[Component: %s (%s)]\nDescription: %s\n\nData Structure:\n%s",
                componentType.name or componentKey,
                componentKey,
                componentType.description or "No description",
                typeDoc
            )
            
            table.insert(resources, {
                path = {"ComponentTypes", componentKey},
                content = componentDoc,
                metadata = {
                    componentKey = componentKey,
                    componentName = componentType.name or componentKey,
                    description = "Component type definition: " .. (componentType.name or componentKey),
                    priority = 90,
                }
            })
        end
        
        return { resources = resources }
    end)

-- ============ 源2：实体数据 ============
ServiceRegistry:definePure()
    :namespace("ecs")
    :name("WorldState")
    :desc("获取世界中所有实体的组件数据")
    :usage("返回当前 ECS 世界中所有实体及其组件的快照，便于进行状态查询、调试或持久化存储。建议配合 ECS.ComponentTypes 源使用以获得完整的上下文。")
    :inputs(Type.Object({
        includeMetadata = Type.optional.Bool:desc("是否包含Metadata组件"),
    }))
    :outputs(Type.Object({
        resources = Type.Array(Type.Object({
            path = Type.Array(Type.String),
            content = Type.String,
        })):desc("实体数据资源列表")
    }))
    :impl(function(inputs)
        local resources = {}
        local includeMetadata = inputs.includeMetadata
        if includeMetadata == nil then
            includeMetadata = true
        end
        
        
        -- 遍历所有实体
        for entityId, entity in pairs(ecs.World.entities) do
            local componentKeys = {}
            for componentType, _ in pairs(entity.components) do
                table.insert(componentKeys, componentType.key)
            end
            
            table.insert(resources, {
                path = {"Entities", tostring(entityId)},
                content = "Has components: " .. table.concat(componentKeys, ", "),
                metadata = {
                    description = "Entity ID: " .. tostring(entityId),
                    priority = 40,
                }
            })
            
            -- 遍历实体的所有组件，直接插入数据
            for componentType, componentInstance in pairs(entity.components) do
                local componentKey = componentType.key
                
                -- 可选：跳过 Metadata 组件
                if not includeMetadata and componentKey == "Metadata" then
                    goto continue
                end
                
                -- 获取组件数据快照
                local componentData = componentInstance.properties()
                
                -- 使用 json 将数据序列化为字符串
                local serializedData = json.encode(componentData)
                
                -- 构建资源内容
                local content = string.format(
                    "[%s]\n%s",
                    componentType.name or componentKey,
                    serializedData
                )
                
                table.insert(resources, {
                    path = {"Entities", tostring(entityId), componentKey},
                    content = content,
                    metadata = {
                        entityId = entityId,
                        componentKey = componentKey,
                        componentName = componentType.name or componentKey,
                        description = string.format("Entity %s %s component data", entityId, componentType.name or componentKey),
                        priority = 30,
                    }
                })
                
                ::continue::
            end
        end
        
        return { resources = resources }
    end)

-- ============ 源3：实体概览（粗粒度）============

-- 辅助函数：将Lua表转换为XML
local function tableToXml(data, indent)
    indent = indent or ""
    local result = {}
    
    for key, value in pairs(data) do
        local xmlKey = tostring(key)
        
        if type(value) == "table" then
            table.insert(result, string.format("%s<%s>", indent, xmlKey))
            table.insert(result, tableToXml(value, indent .. "  "))
            table.insert(result, string.format("%s</%s>", indent, xmlKey))
        elseif type(value) == "string" then
            -- 转义XML特殊字符
            local escaped = value:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"):gsub("'", "&apos;")
            table.insert(result, string.format("%s<%s>%s</%s>", indent, xmlKey, escaped, xmlKey))
        elseif type(value) == "boolean" then
            table.insert(result, string.format("%s<%s>%s</%s>", indent, xmlKey, tostring(value), xmlKey))
        elseif type(value) == "number" then
            table.insert(result, string.format("%s<%s>%s</%s>", indent, xmlKey, tostring(value), xmlKey))
        elseif value == nil then
            table.insert(result, string.format("%s<%s/>", indent, xmlKey))
        end
    end
    
    return table.concat(result, "\n")
end

-- ============ 源4: ECS System 暴露的 Service 文档 =======
ServiceRegistry:definePure()
    :namespace("ecs")
    :name("SystemServices")
    :desc("获取 ECS 系统暴露的所有服务文档")
    :usage("返回 ECS 系统中所有已注册服务的文档说明，包含服务名称、描述、输入输出类型等信息。帮助 AI 理解可调用的服务接口及其功能。")
    :inputs(Type.Object({
        service_names = Type.Optional(Type.Array(Type.String)):desc("可选的服务标识符列表，只返回这些服务的文档。不提供则返回全部非Query服务"),
    }))
    :outputs(Type.Object({
        resources = Type.Array(Type.Object({
            path = Type.Array(Type.String),
            content = Type.String,
        })):desc("服务文档资源列表")
    }))
    :impl(function(inputs)
        local docs = ServiceRegistry.exportDocByNamespace("ecs.system")
        local resources = {}

        -- 构建过滤集合
        local filter_set = nil
        if inputs.service_names and #inputs.service_names > 0 then
            filter_set = {}
            for _, name in ipairs(inputs.service_names) do
                filter_set[name] = true
            end
        end

        for _, docEntry in pairs(docs) do
            if Regex.find(docEntry.name, "Query") then goto continue end
            if filter_set and not filter_set[docEntry.name] then goto continue end
            table.insert(resources, {
                path = {"ECSSystemServices", docEntry.name},
                content = docEntry.doc,
            })
            ::continue::
        end
        return { resources = resources }
    end)

