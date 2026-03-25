# Simple Mode 前端适配指南

## 概述

简明模式 (`simple_mode = true`) 通过裁剪 LLM 上下文和简化 prompt 来减少 token 消耗。
核心设计变化：**StatusEffect 成为主要的游戏状态跟踪机制**，取代了 Inventory/Equipment/Attribute/Skill/Relationship 等专用组件。

---

## 1. 需要修改的 TypeScript 类型（types.ts）

### 1.1 服务输入类型 — 新增 `simple_mode` 字段

```typescript
// ✅ 需要修改
export interface CreativeWritingStreamInput {
  // ...existing fields...
  simple_mode?: boolean  // 新增：简明模式
}

export interface UpdateGameStateAndDocsInput {
  // ...existing fields...
  simple_mode?: boolean  // 新增：简明模式
}

// GenerateContent 的 input 目前没有独立 interface，
// 如果有的话也需要加 simple_mode?: boolean
```

### 1.2 不需要修改的类型

以下类型**不需要**修改，因为它们描述的是 ECS 数据结构本身，不会因为简明模式而改变 schema：
- `StatusEffect`, `StatusEffects` — 不变，简明模式下反而更重要
- `Creature`, `PlayerEntityOutput`, `NPCEntity` 等 — schema 不变，只是简明模式下某些字段可能为空/undefined
- `CreativeWritingOutput` — 输出结构不变（step_1~4 四个字段都还在）

---

## 2. 简明模式下 AI 输出行为变化

### 2.1 `step_3_gamestate_changes`（状态变更列表）

完整模式下，AI 会输出各种专用服务调用描述：
```
"addItemToCreature: [CreatureID: X] 获得 [皇家徽章/ItemID: badge]"
"setCreatureAttribute: [CreatureID: X] str = 15"
"setRelationship: [CreatureID: X] → [CreatureID: Y] 好感+20"
```

**简明模式下，大部分变更通过 StatusEffect 描述：**
```
"addStatusEffect: [CreatureID: X]（display_name: '获得皇家徽章', data: {name: '获得物品', item_name: '皇家徽章', count: 1}）"
"addStatusEffect: [CreatureID: X]（display_name: '力量提升', data: {name: '属性变化', attribute: 'str', delta: 5}）"
```

仍然保留的非 StatusEffect 变更类型：
- `moveCreature` — 位置变更
- `setCreatureAppearance` / `setCreatureClothing` — 外貌/服饰
- `advanceTime` — 时间流逝
- `spawnCharacter` / `spawnRegion` — 创建新实体
- `addLog` — 日志

### 2.2 `UpdateGameStateAndDocs` 实际执行的服务调用

简明模式下 `UpdateGameStateAndDocs` 的 `calls` 数组中：

**会出现的服务：**
| 服务名 | 用途 |
|--------|------|
| `ecs.system:Modify.addStatusEffect` | 添加状态（核心：物品/属性/关系/效果等） |
| `ecs.system:Modify.updateStatusEffect` | 更新已有状态 |
| `ecs.system:Modify.removeStatusEffect` | 移除状态 |
| `ecs.system:Modify.moveCreature` | 移动角色 |
| `ecs.system:Modify.setCreatureAppearance` | 更新外貌 |
| `ecs.system:Modify.setCreatureClothing` | 更新服饰 |
| `ecs.system:Modify.addLog` | 添加日志 |
| `ecs.system:Time.advanceTime` | 推进时间 |
| `ecs.system:Spawn.spawnCharacter` | 创建新角色 |
| `ecs.system:Spawn.spawnRegion` | 创建新区域 |
| `ecs.system:Region.addLocationToRegion` | 添加地点（由更新器自动补充） |
| `state:AppendSettingDoc` | 更新设定文档 |

**不会出现的服务：**
| 服务名 | 替代方案 |
|--------|----------|
| `ecs.system:Modify.addItemToCreature` | → StatusEffect data |
| `ecs.system:Modify.removeItemFromCreature` | → removeStatusEffect |
| `ecs.system:Modify.setEquipment` / `unequipItem` | → StatusEffect data |
| `ecs.system:Modify.setCreatureAttribute` | → StatusEffect data |
| `ecs.system:Modify.addSkillExpToCreature` | → StatusEffect data |
| `ecs.system:Modify.setCreaturePersonality` | → 不跟踪 |
| `ecs.system:Modify.setCreatureEmotion` | → 不跟踪 |
| `ecs.system:Modify.setRelationship` | → StatusEffect data |
| `ecs.system:Modify.setCreatureOrganization` | → 不跟踪 |
| `ecs.system:Modify.addMoveToCreature` | → StatusEffect data |
| `ecs.system:Modify.setCustomComponent` / `updateCustomComponent` | → StatusEffect data |
| `ecs.system:Registry.*` (registerItem/Skill/Move, updateDetail) | → 不注册 |

---

## 3. ECS 实体数据在简明模式下的变化

### 3.1 LLM 可见的组件（影响 AI 生成质量）

简明模式下 AI 看到的实体概览中 **保留** 的组件：

| 组件 | 保留字段 |
|------|----------|
| `GameTime` | 全部（year/month/day/hour/minute） |
| `Creature` | creature_id, name, appearance(body/clothing), titles |
| `IsPlayer` | 全部 |
| `StatusEffects` | 全部（这是核心） |
| `Log` | 全部 |

简明模式下 AI **看不到** 的组件：

| 组件 | 说明 |
|------|------|
| `Registry` | 技艺/招式/物品定义表、creature_attr_fields |
| `CustomComponentRegistry` | 自定义组件注册表 |
| `Personality` (OCEAN) | Creature 子字段 |
| `Emotion` (PAD) | Creature 子字段 |
| `Attrs` | Creature 子字段（动态属性） |
| `Skills` | Creature 子字段（技艺经验表） |
| `LocationRef` | 角色当前位置 |
| `Inventory` | 携带物品列表 |
| `Equipment` | 装备槽位 |
| `Moves` | 掌握的招式 |
| `Relationship` | 关系列表 |
| `CustomComponents` | 自定义组件数据 |
| `LocationsAndPaths` | 地域的地点和路径 |
| `Organization` | 组织信息 |

### 3.2 前端 UI 的影响

**注意**：简明模式只影响 **AI 看到的上下文**，不影响 ECS 数据本身。
前端仍然可以通过 `getPlayerEntity()` / `getNPCEntities()` 等查询到完整的 ECS 数据。

但是，由于 AI 不再使用专用服务更新这些组件，所以：
- `Inventory` / `Equipment` 不会被 AI 更新 → 如果前端 UI 展示物品栏，在简明模式下可能需要隐藏或标记为"简明模式不可用"
- `Attrs` / `Skills` 不会被 AI 更新 → 属性面板无意义
- `Relationship` 不会被 AI 更新 → 关系面板无意义
- `StatusEffects` 将包含更多信息（物品、属性、关系等都通过状态效果跟踪）→ 状态面板更重要

**建议前端在简明模式下：**
1. 隐藏或弱化：物品栏、装备栏、属性面板、技能面板、关系面板
2. 突出显示：状态效果面板（它现在是所有游戏状态的来源）
3. 保留：基本信息（名字、外貌、称号）、位置、时间、日志

---

## 4. 调用链路总结

```
前端调用 CreativeWritingStream({ ..., simple_mode: true })
  │
  ├─ 选择 prompt_generate_content_with_change_recomands_simple.lua
  │   （STEP3 只描述 StatusEffect 为主的变更）
  │
  ├─ GetGameOverviewRAGNEXT({ simple_mode: true })
  │   └─ GetGameEntityOverview({ simple_mode: true })
  │       → 只输出核心组件的 XML
  │
  └─ AI 生成 step_3_gamestate_changes（StatusEffect 为主）
     │
     └─ 前端拿到后调用 UpdateGameStateAndDocs({ ..., simple_mode: true })
        │
        ├─ 选择 prompt_update_gamestate_and_setting_simple.lua
        │   （只列出简明模式支持的服务）
        │
        ├─ GenerateContent({ simple_mode: true, with_system_docs: false })
        │   └─ GetGameOverviewNEXT({ simple_mode: true })
        │       → 只输出核心组件
        │
        └─ AI 生成 calls 数组（StatusEffect + move + appearance + time + doc）
           → 执行服务调用
```

---

## 5. StatusEffect 的 data 约定（简明模式下）

简明模式下 StatusEffect.data 用于记录各种游戏状态，以下是推荐的 data 结构约定：

```typescript
// 物品获取/失去
{ name: "获得宝剑", item_name: "青锋剑", item_desc: "一把古朴的长剑", count: 1 }

// 属性变化
{ name: "力量提升", attribute: "str", delta: 5, new_value: 15 }

// 关系变化
{ name: "与XX结盟", target: "creature_id", relationship: "ally", value: 80 }

// 技能习得
{ name: "习得影步术", skill: "shadow_step", proficiency: "beginner" }

// 临时/永久状态效果
{ name: "中毒", severity: "moderate", duration_minutes: 120 }
```

**注意**：这些只是 AI prompt 中的**推荐格式**，AI 可能产生任意结构的 data。
前端如果需要展示这些状态，应做好兼容处理（显示 display_name，data 作为 tooltip 详情）。
