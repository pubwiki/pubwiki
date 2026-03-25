local loaded,pubwiki = pcall(function()
    return require("pubwiki")
end)

Service:define():namespace("publish"):name("PublishApp")
    :desc("发布独立应用")
    :inputs(
        Type.Object({})
    )
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
        artifactId = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        -- 调用 GetAppInfo 服务获取应用信息
        local appInfoResult = Service.call("state:GetAppInfo", {})
        if not appInfoResult.success then
            return {
                success = false,
                error = appInfoResult.error or "Failed to get app info",
            }
        end

        local appInfo = appInfoResult.data

        if not loaded then
            return {
                success = false,
                error = "pubwiki module not loaded",
            }
        end

        -- 使用 pubwiki 模块的发布功能
        local result = pubwiki.publish(appInfo)

        if not result.success then
            return {
                success = false,
                error = result.error or "Failed to publish app",
            }
        end

        return {
            success = true,
            artifactId = result.artifactId,
        }
    end)

Service:define():namespace("publish"):name("PublishArticle")
    :desc("发布文章")
    :inputs(
        Type.Object({
            content = Type.Array(Type.Object({
                    type = Type.String:desc("text或者game_ref"),
                    id = Type.Optional(Type.String):desc("type为text时提供，Unique identifier for this text block"),
                    text = Type.Optional(Type.String):desc("type为text时提供， The actual text content (支持 markdown heading: # ## ###)"),
                    textId = Type.Optional(Type.String):desc("type为game_ref时提供，指定对应的text块ID"),
                    checkpointId = Type.Optional(Type.String):desc("type为game_ref时提供，指定游戏存档对应的ID"),
                })):desc("文章内容"),
        })
    )
    :outputs(Type.Object({
        success = Type.Bool,
        articleId = Type.Optional(Type.String),
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        -- 使用 pubwiki 模块的发布文章功能
        if not loaded then
            return {
                success = false,
                error = "pubwiki module not loaded",
            }
        end

        local result = pubwiki.uploadArticle({
            content = inputs.content,
        })

        if not result.success then
            return {
                success = false,
                error = result.error or "Failed to publish article",
            }
        end
        return {
            success = true,
            articleId = result.articleId,
        }
    end)


Service:define():namespace("publish"):name("PublishCheckpoint")
    :desc("发布游戏存档")
    :inputs(
        Type.Object({
            checkpointId = Type.Optional(Type.String):desc("存档ID"),
            isListed = Type.Optional(Type.Bool):desc("存档是否公开"),
        })
    )
    :outputs(Type.Object({
        success = Type.Bool,
        error = Type.Optional(Type.String),
    }))
    :impl(function(inputs)
        -- 使用 pubwiki 模块的发布文章功能
        if not loaded then
            return {
                success = false,
                error = "pubwiki module not loaded",
            }
        end

        local result = pubwiki.uploadCheckpoint({
            checkpointId = inputs.checkpointId,
            isListed = inputs.isListed,
        })

        if not result.success then
            return {
                success = false,
                error = result.error or "Failed to publish checkpoint",
            }
        end
        return {
            success = true,
        }
    end)