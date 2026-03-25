Loader.loadModule("ecs@pubwiki")
require("./components")
require("./systems")
require("./state")
require("./rag")
require("./overview")
require("./llm_collector")
require("./generate")
require("./publish")
require("./test")

Service:definePure():namespace("GameTemplate"):name("CheckGameAvailable")
    :desc("检查游戏的服务是否可用")
    :inputs(Type.Object({}))
    :outputs(Type.Object({
        available = Type.Bool,
    }))
    :impl(function(inputs)
        return {
            available = true
        }
    end)
