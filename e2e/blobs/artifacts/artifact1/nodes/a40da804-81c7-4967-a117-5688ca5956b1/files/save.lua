--- 读取文件内容
--- @param path string 文件路径
--- @return string|nil content, string|nil error
local function readFile(path)
  local ok, content = pcall(function()
    return fs.read(path)
  end)
  if ok and content then
    return content
  end
  return nil, "Cannot read file: " .. path
end

Service:define():namespace("save"):name("CreateGameSave")
    :desc("创建游戏存档检查点")
    :inputs(
        Type.Object({
            title = Type.Optional(Type.String):desc("存档标题"),
            description = Type.Optional(Type.String):desc("存档描述"),
        })
    )
    :outputs(Type.Object({
        success = Type.Bool,
        checkpointId = Type.String:desc("存档ID"),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        local checkpoint_id = State:checkpoint(
           inputs.title or "Untitled Save",inputs.description or ""
        )
        return {
            success = true,
            checkpointId = checkpoint_id,
        }
    end)

Service:define():namespace("save"):name("LoadGameSave")
    :desc("加载游戏存档检查点")
    :inputs(Type.Object({
        checkpointId = Type.String:desc("存档对应的游戏状态ID"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        State:checkout(inputs.checkpointId)
        return {
            success = true,
        }
    end)

Service:define():namespace("save"):name("DeleteGameSave")
    :desc("删除游戏存档检查点")
    :inputs(Type.Object({
        checkpointId = Type.String:desc("存档对应的游戏状态ID"),
    }))
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        State:deleteCheckpoint(inputs.checkpointId)
        return {
            success = true,
        }
    end)

Service:define():namespace("save"):name("ListGameSaves")
    :desc("列出所有游戏存档检查点")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        saves = Type.Array(
            Type.Object({
                checkpointId = Type.String:desc("存档自身的ID"),
                title = Type.String:desc("存档标题"),
                description = Type.String:desc("存档描述"),
                timestamp = Type.Int:desc("存档创建时间"),
            })
        ):desc("存档列表"),
    }))
    :impl(function()
        local checkpoints = State:listCheckpoints()
        local result = {}
        for _, save in ipairs(checkpoints) do
            table.insert(result, {
                checkpointId = save.id,
                title = save.title,
                description = save.description,
                timestamp = save.timestamp,
            })
        end
        return {
            saves = result,
        }
    end)
