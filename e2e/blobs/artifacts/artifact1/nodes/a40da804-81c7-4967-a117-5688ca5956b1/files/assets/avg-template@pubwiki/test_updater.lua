-- 测试 UpdateGameStateAndDocs 服务
local Service = require("service")

local result = Service.call("GameTemplate:UpdateGameStateAndDocs", {
    new_event = "玩家(艾利克斯)行动: 从侧面恶臭排水渠潜入。艾利克斯通过充满剧毒与变异生物的排水渠成功潜入血牙仓库内部，发现了帮派分子与所谓'高危原型机'的线索。",
    setting_changes = {},
    event_changes = {
        {
            option = "create",
            event_id = "2055_04_13_Warehouse_Basement_Infiltration",
            title = "血牙仓库：下水道潜入",
            summary = "艾利克斯通过充满剧毒与变异生物的排水渠成功潜入血牙仓库内部",
            suggestion = "(plot continuation) 记录艾利克斯在下水道中无声击杀变异拾荒者的过程",
            related_entities = { "player_alex", "unity_city_the_furnace" },
        }
    },
    new_entities = {},
    director_notes = {
        notes = { "Alex is now positioned directly beneath the warehouse cold room." },
        flags = {},
        stage_goal = nil,
    },
    -- 注意：不传 collector_built_messages，测试 Analyzer 独立工作模式
})

print("=== UpdateGameStateAndDocs 结果 ===")
print("success:", result.success)
if result.error then
    print("error:", result.error)
end
if result.audit then
    print("audit:", result.audit)
end
if result.outline then
    print("outline:", result.outline)
end
if result.results then
    print("results count:", #result.results)
    for i, r in ipairs(result.results) do
        print(string.format("  [%d] %s %s: %s", i, r.success and "✅" or "❌", r.service or "?", r.error or "ok"))
    end
end

return result
