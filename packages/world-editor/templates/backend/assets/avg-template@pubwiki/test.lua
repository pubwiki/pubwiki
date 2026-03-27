-- test.lua
-- 测试服务，用于执行 Lua 代码并返回结果

Service:define():namespace("test"):name("ExecuteLuaCode")
    :desc("执行一段 Lua 代码并返回结果、错误和输出")
    :inputs(Type.Object({
        code = Type.String:desc("要执行的 Lua 代码"),
    }))
    :outputs(Type.Object({
        success = Type.Bool:desc("执行是否成功"),
        result = Type.Optional(Type.Any):desc("代码返回值"),
        output = Type.Optional(Type.String):desc("截获的 print 输出"),
        error = Type.Optional(Type.String):desc("错误信息"),
    }))
    :impl(function(inputs)
        local code = inputs.code
        
        if not code or code == "" then
            return {
                success = false,
                error = "Code cannot be empty",
            }
        end
        
        -- 用于收集 print 输出
        local outputLines = {}
        
        -- 保存原始 print 函数
        local originalPrint = print
        
        -- 重载 print 函数以截获输出
        local function capturedPrint(...)
            local args = {...}
            local parts = {}
            for i, v in ipairs(args) do
                parts[i] = tostring(v)
            end
            table.insert(outputLines, table.concat(parts, "\t"))
        end
        
        -- 替换全局 print
        print = capturedPrint
        
        local success, result, errorMsg
        
        -- 使用 pcall 安全执行代码
        local ok, err = pcall(function()
            -- 编译代码
            local chunk, loadErr = load(code, "user_code", "t")
            if not chunk then
                errorMsg = "Code compilation failed: " .. (loadErr or "unknown error")
                success = false
                return
            end
            
            -- 执行代码
            local execOk, execResult = pcall(chunk)
            if execOk then
                success = true
                result = execResult
            else
                success = false
                errorMsg = "Code execution failed: " .. tostring(execResult)
            end
        end)
        
        -- 恢复原始 print
        print = originalPrint
        
        -- 处理外层 pcall 错误
        if not ok then
            return {
                success = false,
                error = "Execution exception: " .. tostring(err),
                output = #outputLines > 0 and table.concat(outputLines, "\n") or nil,
            }
        end
        
        -- 返回结果
        return {
            success = success,
            result = result,
            output = #outputLines > 0 and table.concat(outputLines, "\n") or nil,
            error = errorMsg,
        }
    end)

Service:define():namespace("test"):name("GetServiceDocs")
    :desc("测试服务连通性，返回 Pong")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        doc = Type.String:desc("服务文档字符串"),
    }))
    :impl(function(inputs)
        local namespaces = {"GameTemplate","ecs.system","save","state"}
        -- 逐个调用 ServiceRegistry.exportDocByNamespace()
        local text = ""
        for _, ns in ipairs(namespaces) do
            text = text .. "=== Namespace: " .. ns .. " ===\n"
            local docs = ServiceRegistry.exportDocByNamespace(ns)
            for _, docEntry in pairs(docs) do
                text = text .. "Service Name: " .. docEntry.name .. "\n"
                text = text .. "Document: " .. docEntry.doc .. "\n\n"
            end
        end
        return {
            doc = text,
        }
    end)
return {}
