-- init.lua for ecs@pubwiki
-- ECS 框架核心模块

-- 加载核心 ECS 模块（导出 World, Component, System）
local ECS = require("./ecs")

-- 设置为全局变量以保持向后兼容
World = ECS.World
Component = ECS.Component
System = ECS.System
print("[ecs@pubwiki] ECS 核心模块已加载")
-- 加载服务模块（服务已在 ecs_services.lua 中通过 Service:define() 自动注册）
local ECS_Services = require("./ecs_services")

require("./ecs_rag")  -- 加载 ECS RAG 集成模块
