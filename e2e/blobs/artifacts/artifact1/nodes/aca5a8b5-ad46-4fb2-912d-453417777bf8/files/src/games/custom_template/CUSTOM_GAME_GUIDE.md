# 自定义游戏前端开发指南

本指南帮助你基于 avg-game-template 引擎构建自定义游戏前端。`custom_template/index.tsx` 是一个极简示例，展示了引擎的所有核心 API。你可以在此基础上构建任何类型的游戏 UI。

所有服务函数从 `../utils` 导入，类型从 `../../api/types` 导入。

---

## 目录

1. [核心 API 参考](#1-核心-api-参考)
2. [CustomComponent 系统](#2-customcomponent-系统)
3. [实战案例：赛博朋克义体状态前端](#3-实战案例赛博朋克义体状态前端)
4. [CreativeWritingStream 深入](#4-creativewritingstream-深入)
5. [UpdateGameStateAndDocs 深入](#5-updategamestateanddocs-深入)
6. [完整工作流](#6-完整工作流)

---

## 1. 核心 API 参考

### 1.1 `getGameState()` — 获取完整游戏状态

```ts
import { getGameState } from '../utils'

const result = await getGameState()
if (result.success && result.data) {
  const state = result.data
  // state.World — 世界实体（含注册表、自定义组件定义）
  // state.Creatures — 所有角色快照
  // state.Regions — 所有地域
  // state.Organizations — 所有组织
}
```

**输出类型：**

```ts
interface GetGameStateOutput {
  success: boolean
  data?: StateData
  error?: string
}
```

#### StateData

```ts
interface StateData {
  World: WorldSnapshot
  Creatures?: CreatureSnapshot[]
  Regions?: RegionSnapshot[]
  Organizations?: OrganizationSnapshot[]
  StoryHistory?: StoryHistoryEntry[]
  GameInitialStory?: GameInitialStory
  GameWikiEntry?: GameWikiEntry
  AppInfo?: AppInfo
  _save_version?: 'v2'             // 存档版本标记
}

interface StoryHistoryEntry {
  turn_id: string                   // 回合唯一标识符
  story: {
    content: any                    // 可序列化的剧情数据，格式由具体游戏定义
    checkpoint_id?: string          // 该剧情片段对应的存档检查点 ID
  }
}

interface GameInitialStory {
  background: string                // 玩家视角的背景故事介绍
  start_story: string               // 整个游戏的开场剧情
}

// 游戏百科词条
type GameWikiEntry = Array<{
  title: string
  content: string
}> | undefined

interface AppInfo {
  name: string
  slug: string
  version?: string
  visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED'
  tags?: string[]
  homepage?: string
  publish_type?: 'EDITOR' | 'NOVEL' | 'INK' | 'TEST' | 'CUSTOM' | 'GALGAME'
}
```

#### WorldSnapshot

```ts
interface WorldSnapshot {
  entity_id: number
  GameTime?: GameTime
  Registry?: Registry
  DirectorNotes?: DirectorNotes
  CustomComponentRegistry?: CustomComponentRegistry   // ⭐ 自定义组件定义
  Log?: Log
  BindSetting?: BindSetting
}

interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

interface Registry {
  creature_attr_fields?: CreatureAttrField[]           // 角色自定义属性字段定义
}

interface CreatureAttrField {
  field_name: string              // 属性标识符（如 "strength"、"intelligence"）
  hint: string                    // 描述/提示
  field_display_name?: string     // UI 显示名称
}

interface DirectorNotes {
  notes: string[]
  flags: Record<string, {
    id: string
    value: boolean
    remark?: string
  }>
  stage_goal?: string | null      // 阶段叙事目标
}

interface Log {
  entries: LogEntry[]
}

interface LogEntry {
  content: string
  add_at: string                  // 格式：YYYY年MM月DD日 HH:MM
}

interface BindSetting {
  documents: SettingDocument[]    // 该实体的设定文档列表
}

interface SettingDocument {
  name: string                    // 文档名称
  content: string                 // 文档内容
  static_priority?: number        // 静态优先级，数值越高越优先
  disable?: boolean               // 是否禁用
  condition?: string              // 给 LLM 召回器的自然语言条件
}
```

#### CreatureSnapshot

```ts
interface CreatureSnapshot {
  entity_id: number
  Creature?: Creature
  LocationRef?: LocationRef
  Inventory?: Inventory
  StatusEffects?: StatusEffects
  CustomComponents?: CustomComponents     // ⭐ 自定义组件实例数据
  Relationship?: Relationship_Component
  Log?: Log
  IsPlayer?: IsPlayer                     // 存在此字段表示该角色是玩家
  BindSetting?: BindSetting
}

interface Creature {
  creature_id: string             // 角色唯一 ID
  name: string                    // 角色名
  organization_id?: string        // 所属组织 ID
  titles: string[]                // 头衔列表
  appearance?: {
    body: string                  // 身体特征描述
    clothing: string              // 穿着描述
  }
  gender?: string                 // 性别
  race?: string                   // 种族
  emotion?: string                // 当前情绪状态（自由文本）
  attrs: Attributes               // ⭐ 自定义属性键值对
}

// 动态属性：key 为属性字段名（由 Registry.creature_attr_fields 定义），value 为整数或字符串
type Attributes = Record<string, number | string>
// 例: { strength: 15, intelligence: 12, charm: "高", hp: 100, max_hp: 100 }

interface LocationRef {
  region_id: string               // 所在地域 ID
  location_id: string             // 所在地点 ID
}

interface Inventory {
  items: Item[]
}

interface Item {
  id: string                      // 物品 ID
  name: string                    // 物品名称
  count: number                   // 数量
  description: string             // 描述
  details: string[]               // 详细信息列表
  equipped?: boolean              // 是否已装备
}

interface StatusEffects {
  status_effects: StatusEffect[]
}

interface StatusEffect {
  instance_id: string             // 状态实例唯一 ID
  display_name?: string           // 显示名称
  remark?: string                 // 备注（来源、效果、持续条件等）
  data?: any                      // 状态效果的数据，任意类型
  add_at?: string                 // 添加时间
  last_update_at?: string         // 最后更新时间
}

interface CustomComponents {
  custom_components: Array<{
    component_key: string         // 引用 CustomComponentDef 的 component_key
    data: any                     // 实际数据（结构由 type_schema 定义）
  }>
}

interface Relationship_Component {
  relationships: Relationship[]
}

interface Relationship {
  target_creature_id: string      // 目标角色 ID
  name: string                    // 关系名称（如 "朋友"、"师徒"）
  value: number                   // 关系值（好感度等）
}

interface IsPlayer {}             // 空接口，存在即表示该角色是玩家
```

#### RegionSnapshot

```ts
interface RegionSnapshot {
  entity_id: number
  Metadata?: Metadata
  Region?: Region
  StatusEffects?: StatusEffects
  Log?: Log
  BindSetting?: BindSetting
}

interface Metadata {
  name: string                    // 实体名称
  desc: string                    // 实体描述
}

interface Region {
  region_id: string               // 地域 ID
  region_name: string             // 地域名称
  description: string             // 地域描述
  locations?: Location[]          // 区域内的地点
  paths?: Path[]                  // 地点间的路径
}

interface Location {
  id: string                      // 地点 ID
  name: string                    // 地点名称
  description: string             // 地点描述
}

interface Path {
  src_location: string            // 起点地点 ID
  src_region: string              // 起点地域 ID
  to_location: string             // 终点地点 ID
  to_region: string               // 终点地域 ID
  discovered: boolean             // 是否已发现
  description: string             // 路径描述
}
```

#### OrganizationSnapshot

```ts
interface OrganizationSnapshot {
  entity_id: number
  Organization?: Organization
  StatusEffects?: StatusEffects
  Log?: Log
  BindSetting?: BindSetting
}

interface Organization {
  organization_id: string         // 组织 ID
  name: string                    // 组织名称
  description: string             // 组织描述
  territories?: Array<{           // 领地
    region_id: string
    location_id: string
  }>
}
```

---

### 1.2 `getPlayerEntity()` — 获取玩家实体

```ts
import { getPlayerEntity } from '../utils'

const player = await getPlayerEntity()
if (player.success && player.found) {
  console.log(player.Creature?.name)        // 角色名
  console.log(player.Creature?.attrs)        // 自定义属性 { strength: 15, ... }
  console.log(player.CustomComponents)                 // ⭐ 自定义组件数据
  console.log(player.Inventory)                        // 物品栏
  console.log(player.StatusEffects)                    // 状态效果
  console.log(player.Relationship)                     // 关系网
  console.log(player.LocationRef)                      // 当前位置
}
```

**输出类型：**

```ts
interface PlayerEntityOutput {
  success: boolean
  found: boolean
  entity_id?: number
  Creature?: Creature     // 见上方完整定义
  IsPlayer?: IsPlayer
  LocationRef?: LocationRef
  Inventory?: Inventory
  StatusEffects?: StatusEffects
  CustomComponents?: CustomComponents         // ⭐ 自定义组件
  Relationship?: Relationship_Component
  Log?: Log
  BindSetting?: BindSetting
  error?: string
}
```

> 所有子类型（Creature、Inventory、StatusEffects 等）的完整定义见上方 [CreatureSnapshot](#creaturesnapshot) 章节。

---

### 1.3 `getNPCEntities()` — 获取所有 NPC

```ts
import { getNPCEntities } from '../utils'

const result = await getNPCEntities()
if (result.success && result.entities) {
  for (const npc of result.entities) {
    console.log(npc.Creature.name)
    console.log(npc.CustomComponents)         // NPC 也可以有自定义组件
    console.log(npc.Relationship)             // NPC 的关系网
  }
}
```

**输出类型：**

```ts
interface NPCEntitiesOutput {
  success: boolean
  count: number
  entities?: NPCEntity[]
  error?: string
}

interface NPCEntity {
  entity_id: number
  Creature: Creature      // 注意：NPC 此字段非可选
  LocationRef?: LocationRef
  Inventory?: Inventory
  StatusEffects?: StatusEffects
  CustomComponents?: CustomComponents
  Relationship?: Relationship_Component
  Log?: Log
  BindSetting?: BindSetting
}
```

---

### 1.4 `creativeWritingStream()` — 流式创意写作

```ts
import { creativeWritingStream } from '../utils'

await creativeWritingStream({
  create_request: '玩家走进了一间昏暗的酒馆，请描写这个场景',
  thinking_instruction: '思考酒馆中可能有哪些有趣的角色和事件',
  previous_content_overview: '玩家刚刚完成了森林中的任务，带着疲惫来到小镇',
  output_content_schema: 'string',
  callback: (event) => {
    // 处理流式事件，详见 Section 4
  }
})
```

**输入类型：**

```ts
interface CreativeWritingStreamInput {
  create_request: string              // 创作请求（告诉 LLM 写什么）
  thinking_instruction: string        // 思考指令（引导 LLM 如何思考）
  previous_content_overview: string   // 之前内容概览（上下文）
  output_content_schema: string       // 输出结构的 TypeScript 接口定义字符串
  output_content_schema_definition?: object  // 可选，JSON Schema 严格约束
  reuse_last_collect?: boolean        // 重用上次 RAG 收集结果（重试时使用）
  model?: string                      // 可选，指定模型
  callback: CreativeWritingStreamCallback
}
```

**回调类型：**

```ts
type CreativeWritingStreamCallback = (streamEvent: {
  event_type: 'collector_result_update' | 'reasoning_update' | 'result_update' | 'done' | 'error'
  event_data: Partial<CreativeWritingOutput> | Error
}) => void
```

**输出类型（event_data）：**

```ts
interface CreativeWritingOutput {
  success: boolean
  content?: any                     // 结构取决于 output_content_schema
  thinking?: string                 // LLM 的思考过程
  reasoning?: string                // 推理过程
  raw_text?: string                 // 原始文本
  collector_results?: Array<{       // RAG 收集结果
    entity_id: string               // 实体 ID
    selected: boolean               // 是否被选中用于生成
    thinking: string                // 收集器的决策理由
    documents?: Array<{
      path: string                  // 文档路径
      selected: boolean             // 是否被选中
      thinking: string              // 选择理由
      flag_is_thinking_instruction?: boolean   // 是否为思考指导文档
      flag_is_writing_instruction?: boolean    // 是否为写作指导文档
      flag_is_updating_instruction?: boolean   // 是否为更新指导文档
    }>
  }>
  state_changes?: string[]          // ⭐ LLM 建议的状态变化列表
  setting_changes?: string[]        // ⭐ LLM 建议的设定变化列表
  director_notes?: DirectorNotesOutput  // 导演笔记与标记
  error?: string
}

interface DirectorNotesOutput {
  notes: string[]
  flags: Array<{
    id: string
    value: boolean
    remark?: string
  }>
  stage_goal?: string | null        // 阶段叙事目标
}
```

---

### 1.5 `updateGameStateAndDocs()` — 更新游戏状态

```ts
import { updateGameStateAndDocs } from '../utils'

const result = await updateGameStateAndDocs({
  new_event: '玩家在酒馆中与神秘老人交谈，获得了一把古剑',
  state_changes: [
    '玩家获得物品：破晓古剑',
    '玩家金币 -50',
    'NPC 神秘老人 好感度 +10',
  ],
  setting_changes: [
    '新增词条：破晓古剑 — 传说中的神器，据说能斩断黑暗',
  ]
})
```

**输入类型：**

```ts
interface UpdateGameStateAndDocsInput {
  new_event: string               // 新发生的事件描述
  state_changes: string[]         // 状态变化列表（自然语言，每条一个原子变更）
  setting_changes: string[]       // 设定变更列表（自然语言，世界观/词条变化）
  director_notes?: DirectorNotesOutput  // 可选，导演笔记（由 CreativeWritingStream 的 done 事件提供）
}
```

**输出类型：**

```ts
interface UpdateGameStateAndDocsOutput {
  success: boolean
  outline?: string                // 执行计划概述
  calls?: Array<{                 // 引擎执行的服务调用列表
    service: string               // 调用的服务名
    reason: string                // 调用原因
    args: any                     // 参数
  }>
  results?: Array<{               // 每个调用的执行结果
    service: string
    reason: string
    success: boolean
    error?: string
  }>
  error?: string
}
```

---

### 1.6 存档管理

```ts
import { createSave, loadSave, listSaves } from '../utils'

// 创建存档
const save = await createSave({ title: '酒馆对话后', description: '获得古剑' })
// save.checkpointId — 存档 ID

// 列出存档
const saves = await listSaves()

// 加载存档（回滚到某个状态）
await loadSave(checkpointId)
```

**类型：**

```ts
// 创建存档
interface CreateGameSaveOutput {
  success: boolean
  checkpointId: string            // 存档 ID
  error?: string
}

// 列出存档
interface ListGameSavesOutput {
  saves: GameSaveInfo[]
}

interface GameSaveInfo {
  checkpointId: string            // 存档 ID
  title: string                   // 存档标题
  description: string             // 存档描述
  timestamp: number               // 存档创建时间（Unix 时间戳）
}

// 加载存档
interface LoadGameSaveOutput {
  success: boolean
  error?: string
}
```

---

### 1.7 剧情历史管理

```ts
import { getStoryHistory, setNewStoryHistory, clearStoryHistory } from '../utils'

// 获取剧情历史
const history = await getStoryHistory()
if (history.success && history.data) {
  // history.data.turn_ids — 回合 ID 列表（按时间顺序）
  // history.data.story — 每个回合的剧情数据 { [turn_id]: { content, checkpoint_id? } }
}

// 保存新的剧情历史条目
await setNewStoryHistory({
  turn_id: 'turn_3',
  data: {
    content: { /* 你的自定义剧情数据 */ },
    checkpoint_id: save.checkpointId  // 可选，关联存档
  }
})

// 清空所有剧情历史
await clearStoryHistory()
```

**类型：**

```ts
interface GetStoryHistoryOutput {
  success: boolean
  data?: {
    turn_ids?: string[]            // 回合 ID 列表，按时间顺序
    story?: Record<string, {       // key: turn_id
      content: any                 // 剧情数据，格式由你的游戏定义
      checkpoint_id?: string       // 关联的存档检查点 ID
    }>
  }
  error?: string
}

interface SetNewStoryHistoryInput {
  turn_id: string
  data: {
    content: any                   // 可序列化的剧情数据
    checkpoint_id?: string         // 可选的存档检查点 ID
  }
}

interface ClearStoryHistoryOutput {
  success: boolean
  error?: string
}
```

---

## 2. CustomComponent 系统

CustomComponent 是引擎的核心扩展机制。游戏设计者可以在编辑器中定义任意数据组件，然后在前端读取和展示。

### 2.1 组件定义（CustomComponentDef）

组件定义存储在 `World.CustomComponentRegistry` 中，描述了组件的数据结构：

```ts
interface CustomComponentRegistry {
  custom_components: CustomComponentDef[]
}

interface CustomComponentDef {
  component_key: string           // 组件唯一标识（如 "cyberware_state"）
  component_name: string          // 显示名称（如 "义体状态"）
  is_array: boolean               // 数据实例是否为数组
  type_schema?: TypeSchema        // 数据类型的 JSON Schema
  data_registry?: Array<{         // 预定义的数据模板（可选）
    item_id: string               // 模板项 ID
    data: any                     // 模板数据
  }>
}
```

### 2.2 组件实例（CustomComponents）

组件实例存储在每个角色（Player/NPC）的 `CustomComponents` 字段中：

```ts
interface CustomComponents {
  custom_components: Array<{
    component_key: string         // 引用 CustomComponentDef 的 component_key
    data: any                     // 实际数据（结构由 type_schema 定义）
  }>
}
```

### 2.3 TypeSchema（类型定义）

TypeSchema 使用类 JSON Schema 语法定义组件数据的结构：

```ts
interface TypeSchema {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  properties?: Record<string, TypeSchema>   // object 的字段定义
  required?: string[]                       // 必填字段
  items?: TypeSchema                        // array 的元素类型
  additionalProperties?: boolean | TypeSchema
  oneOf?: TypeSchema[]                      // 联合类型
}
```

### 2.4 如何读取自定义组件

```ts
// 1. 获取组件定义（从 World）
const state = await getGameState()
const registry = state.data?.World?.CustomComponentRegistry?.custom_components || []

// 查找特定组件的定义
const cyberwareDef = registry.find(def => def.component_key === 'cyberware_state')
console.log(cyberwareDef?.component_name)   // "义体状态"
console.log(cyberwareDef?.type_schema)      // 数据结构定义

// 2. 获取组件实例（从 Player/NPC）
const player = await getPlayerEntity()
const components = player.CustomComponents?.custom_components || []

// 查找特定组件的数据
const cyberwareData = components.find(c => c.component_key === 'cyberware_state')
console.log(cyberwareData?.data)  // 实际的义体数据
```

---

## 3. 实战案例：赛博朋克义体状态前端

假设你在编辑器中为一个赛博朋克 2077 同人游戏定义了以下自定义组件：

### 3.1 组件定义

在编辑器的 World 实体 CustomComponentRegistry 中定义：

```json
{
  "component_key": "cyberware_state",
  "component_name": "义体状态",
  "is_array": false,
  "type_schema": {
    "type": "object",
    "description": "角色的义体安装状态",
    "properties": {
      "humanity": {
        "type": "integer",
        "description": "人性值 (0-100)，义体越多越低"
      },
      "slots": {
        "type": "object",
        "description": "义体槽位",
        "properties": {
          "frontal_cortex": {
            "type": "object",
            "properties": {
              "name": { "type": "string", "description": "义体名称" },
              "rarity": { "type": "string", "description": "稀有度: common/uncommon/rare/epic/legendary" },
              "effect": { "type": "string", "description": "效果描述" }
            }
          },
          "arms": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "rarity": { "type": "string" },
              "effect": { "type": "string" }
            }
          },
          "skeleton": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "rarity": { "type": "string" },
              "effect": { "type": "string" }
            }
          },
          "operating_system": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "rarity": { "type": "string" },
              "effect": { "type": "string" }
            }
          }
        }
      },
      "cyberpsychosis_risk": {
        "type": "number",
        "description": "赛博精神病风险 (0.0-1.0)"
      }
    }
  }
}
```

### 3.2 对应的 Player 实体数据

当玩家安装了义体后，Player 的 CustomComponents 中会有：

```json
{
  "component_key": "cyberware_state",
  "data": {
    "humanity": 72,
    "slots": {
      "frontal_cortex": {
        "name": "泰坦核心 Mk.3",
        "rarity": "epic",
        "effect": "RAM +8, 上传速度 +35%"
      },
      "arms": {
        "name": "螳螂刀",
        "rarity": "legendary",
        "effect": "近战伤害 +50%, 可跳跃攻击"
      },
      "skeleton": null,
      "operating_system": {
        "name": "军用级 Sandevistan",
        "rarity": "legendary",
        "effect": "子弹时间 12秒, 冷却 15秒"
      }
    },
    "cyberpsychosis_risk": 0.35
  }
}
```

### 3.3 前端实现：ESC 弹出义体状态面板

```tsx
import { useState, useEffect } from 'react'
import { getPlayerEntity } from '../utils'
import type { PlayerEntityOutput } from '../../api/types'

// ── 义体数据类型（根据 type_schema 手动定义）──
interface CyberwareSlot {
  name: string
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  effect: string
}

interface CyberwareState {
  humanity: number
  slots: {
    frontal_cortex: CyberwareSlot | null
    arms: CyberwareSlot | null
    skeleton: CyberwareSlot | null
    operating_system: CyberwareSlot | null
  }
  cyberpsychosis_risk: number
}

// ── 稀有度颜色 ──
const rarityColors: Record<string, string> = {
  common: '#9a9a9a',
  uncommon: '#4caf50',
  rare: '#2196f3',
  epic: '#9c27b0',
  legendary: '#ff9800',
}

// ── 义体面板组件 ──
function CyberwarePanel({ data, onClose }: { data: CyberwareState; onClose: () => void }) {
  const riskPercent = Math.round(data.cyberpsychosis_risk * 100)

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid #00f0ff', borderRadius: 8,
        padding: 32, minWidth: 500, color: '#e0e0e0',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ color: '#00f0ff', margin: 0 }}>义体状态</h2>
          <button onClick={onClose} style={{ background: 'none', color: '#888', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* 人性值 */}
        <div style={{ margin: '16px 0' }}>
          <div>人性值: {data.humanity}/100</div>
          <div style={{ height: 8, background: '#333', borderRadius: 4, marginTop: 4 }}>
            <div style={{
              height: '100%', borderRadius: 4,
              width: `${data.humanity}%`,
              background: data.humanity > 50 ? '#4caf50' : data.humanity > 25 ? '#ff9800' : '#f44336',
            }} />
          </div>
        </div>

        {/* 赛博精神病风险 */}
        <div style={{ color: riskPercent > 50 ? '#f44336' : '#ff9800', marginBottom: 16 }}>
          赛博精神病风险: {riskPercent}%
        </div>

        {/* 义体槽位 */}
        {Object.entries(data.slots).map(([slotKey, slot]) => (
          <div key={slotKey} style={{
            padding: '8px 12px', margin: '4px 0',
            background: '#16213e', borderRadius: 4,
            borderLeft: `3px solid ${slot ? rarityColors[slot.rarity] || '#666' : '#333'}`,
          }}>
            <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase' }}>
              {slotKey.replace(/_/g, ' ')}
            </div>
            {slot ? (
              <>
                <div style={{ color: rarityColors[slot.rarity], fontWeight: 'bold' }}>{slot.name}</div>
                <div style={{ fontSize: 12, color: '#aaa' }}>{slot.effect}</div>
              </>
            ) : (
              <div style={{ color: '#555' }}>— 空槽位 —</div>
            )}
          </div>
        ))}

        <div style={{ marginTop: 16, fontSize: 12, color: '#555' }}>按 ESC 关闭</div>
      </div>
    </div>
  )
}

// ── 在你的游戏主组件中使用 ──
export default function CyberpunkGame() {
  const [player, setPlayer] = useState<PlayerEntityOutput | null>(null)
  const [showCyberware, setShowCyberware] = useState(false)

  // 加载玩家数据
  useEffect(() => {
    getPlayerEntity().then(setPlayer)
  }, [])

  // ESC 键监听
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCyberware(prev => !prev)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 从 CustomComponents 中提取义体数据
  const cyberwareData = player?.CustomComponents?.custom_components
    ?.find(c => c.component_key === 'cyberware_state')
    ?.data as CyberwareState | undefined

  return (
    <div>
      <h1>{player?.Creature?.name || '加载中...'}</h1>
      <p>按 ESC 打开义体状态面板</p>

      {/* 你的游戏 UI ... */}

      {showCyberware && cyberwareData && (
        <CyberwarePanel data={cyberwareData} onClose={() => setShowCyberware(false)} />
      )}
    </div>
  )
}
```

---

## 4. CreativeWritingStream 深入

### 4.1 四个核心参数详解

#### `create_request` — 创作请求

告诉 LLM 要写什么。这是最重要的参数，包含：

- 玩家的行动描述
- 写作风格要求
- 输出格式说明
- 任何游戏特定的规则

**简单示例（纯文本输出）：**

```ts
create_request: `
玩家行动: 走进酒馆点了一杯酒

请写一段酒馆场景描写，200字左右，注意氛围营造。
`
```

**复杂示例（结构化输出，参考 Ink 游戏）：**

```ts
create_request: `
玩家(${playerName})行动: ${action}

你是一位优秀的故事作家。请把玩家行动展开成一段故事。

核心原则：
- 使用第二人称叙事
- 展示而非告诉
- 每段 150~200 字

输出结构：
- story_content: 3 个段落的故事内容
- choices: 2-4 个后续选项
`
```

#### `thinking_instruction` — 思考指令

引导 LLM 在写作前如何思考，确保输出质量：

```ts
thinking_instruction: `
深度思考后再创作：
1. 核对角色当前状态和性格，确保叙事一致
2. 检查玩家角色的认知边界——不能全知全能
3. 本段是否引入了新元素？避免重复
4. 遵守设定文档中的写作指导
`
```

#### `previous_content_overview` — 之前内容概览

提供上下文，让 LLM 了解之前发生了什么。通常是最近 1-2 轮的完整内容：

```ts
previous_content_overview: `
[上一轮]
玩家行动: 向老人询问古剑的来历
故事内容: 老人目光深邃，缓缓讲述了一个关于暗影之战的传说...
状态变更: 玩家获得线索"暗影神殿的位置"

[本轮]
玩家行动: 前往暗影神殿
`
```

#### `output_content_schema` — 输出结构定义

定义 LLM 输出 `content` 字段的结构。这是一个 **TypeScript 接口定义的字符串**（不是 JSON Schema）：

**最简单 — 纯文本：**

```ts
output_content_schema: 'string'
// content 将是一个字符串
```

**结构化 — 自定义字段：**

```ts
output_content_schema: `{
  story: string;       // 故事正文
  title: string;       // 章节标题
  choices: Array<{
    name: string;      // 选项名
    description: string;  // 选项描述
  }>;
}`
// content 将是一个符合此结构的对象
```

**可选的严格约束 — `output_content_schema_definition`：**

如果需要严格的结构验证，可以额外提供 JSON Schema：

```ts
output_content_schema_definition: {
  type: 'object',
  properties: {
    story: { type: 'string' },
    title: { type: 'string' },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        }
      }
    }
  }
}
```

### 4.2 流式回调事件详解

回调按时间顺序接收 5 种事件：

```
collector_result_update → reasoning_update → result_update (多次) → done
                                                                  ↘ error
```

```ts
callback: (streamEvent) => {
  const { event_type, event_data } = streamEvent

  switch (event_type) {
    // ① RAG 收集器结果 — 引擎从设定文档中检索到的相关内容
    case 'collector_result_update': {
      const data = event_data as Partial<CreativeWritingOutput>
      // data.collector_results: Array<{ entity_id, selected, thinking, documents }>
      // 可以展示给用户看 AI 参考了哪些设定
      break
    }

    // ② 推理更新 — LLM 的推理过程
    case 'reasoning_update': {
      const data = event_data as Partial<CreativeWritingOutput>
      // data.reasoning: string — 推理文本
      // data.collector_results 也可能在这里更新
      break
    }

    // ③ 结果增量更新 — 流式接收生成内容（会触发多次）
    case 'result_update': {
      const data = event_data as Partial<CreativeWritingOutput>
      // data.content — 根据 output_content_schema 的结构，逐步增长
      // data.thinking — LLM 的思考过程
      // 注意：每次 result_update 中的 content 是到目前为止的完整内容，不是增量
      break
    }

    // ④ 生成完成 — 获取最终结果
    case 'done': {
      const data = event_data as Partial<CreativeWritingOutput>
      // data.content — 完整的最终内容
      // data.state_changes — ⭐ LLM 建议的状态变化列表
      // data.setting_changes — ⭐ LLM 建议的设定变更列表
      // data.director_notes — 导演笔记（可传给 updateGameStateAndDocs）
      // 这些可以直接传给 updateGameStateAndDocs()
      break
    }

    // ⑤ 错误
    case 'error': {
      const err = event_data as Error
      // err.message — 错误消息
      break
    }
  }
}
```

### 4.3 Ink vs Galgame 的 output_content_schema 对比

**Ink 游戏（小说流）：**

```ts
output_content_schema: `{
  novel_content_part1: string;  // 第一节，多个段落
  novel_content_part2: string;  // 第二节，多个段落
  chapter_hint: string;         // 章节标题
  player_choices: Array<{
    name: string;               // 选项名（2-6字）
    description: string;        // 选项描述（10-30字）
    is_special: boolean;        // 是否特殊选项
    difficulty_level?: number;  // 掷骰难度 0-100
    difficulty_reason?: string; // 难度原因
  }>;
}`
```

**Galgame（对话流）：**

```ts
output_content_schema: `{
  story: Array<{
    speaker_creature_id: string;   // 说话者实体ID，旁白为空字符串
    speaker_display_name: string;  // 显示名称
    dialogue: string;              // 对话文本
    depiction?: string;            // 场景描写（CG级画面感）
    expression?: string;           // 表情: normal/happy/angry/sad/surprised/shy/disgusted/dazed
  }>;
  chapter_title: string;
  player_choices: Array<{
    name: string;
    description: string;
    is_special: boolean;
  }>;
  next_direction: string;          // 给下一次生成的导演建议
}`
```

**你的自定义游戏可以定义任意结构，例如：**

```ts
// 回合制战斗游戏
output_content_schema: `{
  battle_narration: string;        // 战斗描写
  enemy_action: string;            // 敌人的行动
  damage_dealt: number;            // 造成伤害
  damage_taken: number;            // 受到伤害
  available_skills: Array<{
    skill_name: string;
    mp_cost: number;
    description: string;
  }>;
}`

// 推理解谜游戏
output_content_schema: `{
  scene_description: string;       // 场景描述
  clues_found: Array<{
    clue_name: string;
    description: string;
    importance: 'critical' | 'useful' | 'misleading';
  }>;
  suspects: Array<{
    name: string;
    suspicion_level: number;       // 0-100
    new_info: string;
  }>;
  next_actions: Array<{
    action: string;
    description: string;
  }>;
}`
```

---

## 5. UpdateGameStateAndDocs 深入

### 5.1 工作原理

`updateGameStateAndDocs` 接收自然语言的事件描述和变更列表，引擎内部会：

1. 分析变更内容
2. 自动生成对应的 Lua 代码
3. 执行 Lua 代码更新 ECS 数据
4. 返回执行结果

你**不需要**直接操作 ECS，只需用自然语言描述变化即可。

### 5.2 输入参数示例

```ts
await updateGameStateAndDocs({
  // 新事件的叙事描述
  new_event: '玩家在废弃工厂中发现了一把传说级螳螂刀，并成功安装了义体。同时遭遇了清道夫帮派的伏击，击杀了3名敌人。',

  // 状态变化列表（每条一个原子变更）
  state_changes: [
    '玩家获得义体：螳螂刀（legendary），安装在 arms 槽位',
    '玩家人性值 -15（从 72 降至 57）',
    '玩家赛博精神病风险上升至 0.45',
    '玩家经验值 +150',
    '玩家 HP -30（战斗受伤）',
    '清道夫帮派与玩家关系变为敌对',
  ],

  // 设定变更列表（世界观/词条变化）
  setting_changes: [
    '更新地点描述：废弃工厂 — 现在已被清道夫占据，危险等级提升',
    '新增词条：清道夫帮派 — 在废弃工业区活动的赛博犯罪组织',
  ]
})
```

### 5.3 输出结果解读

```ts
const result = await updateGameStateAndDocs(input)

if (result.success) {
  // result.outline — 执行计划文本
  // 例: "将更新玩家的义体状态、HP、经验值，并修改帮派关系"

  // result.calls — 引擎执行的具体操作
  // 例: [
  //   { service: "ecs:ModifyCreature", reason: "安装螳螂刀", args: {...} },
  //   { service: "ecs:ModifyCreature", reason: "降低人性值", args: {...} },
  //   { service: "wiki:UpdateEntry", reason: "新增清道夫帮派词条", args: {...} },
  // ]

  // result.results — 每个操作的执行结果
  // 例: [
  //   { service: "ecs:ModifyCreature", reason: "安装螳螂刀", success: true },
  //   { service: "ecs:ModifyCreature", reason: "降低人性值", success: true },
  //   { service: "wiki:UpdateEntry", reason: "新增清道夫帮派词条", success: true },
  // ]

  // 更新成功后，重新拉取数据以获得最新状态
  const updatedPlayer = await getPlayerEntity()
  const updatedState = await getGameState()
} else {
  console.error('状态更新失败:', result.error)
  // 可以用 loadSave() 回滚到之前的存档
}
```

### 5.4 与 CreativeWritingStream 的配合

典型流程：

```ts
// 1. 流式生成故事
let stateChanges: string[] = []
let settingChanges: string[] = []
let directorNotes: DirectorNotesOutput | undefined
let storyContent = ''

await creativeWritingStream({
  create_request: '...',
  thinking_instruction: '...',
  previous_content_overview: '...',
  output_content_schema: 'string',
  callback: (event) => {
    if (event.event_type === 'result_update') {
      const data = event.event_data as Partial<CreativeWritingOutput>
      storyContent = data.content as string || storyContent
    }
    if (event.event_type === 'done') {
      const data = event.event_data as Partial<CreativeWritingOutput>
      stateChanges = data.state_changes || []
      settingChanges = data.setting_changes || []
      directorNotes = data.director_notes
    }
  }
})

// 2. 创建临时存档（用于失败回滚）
const tempSave = await createSave({ title: '状态更新前' })

// 3. 更新游戏状态
const updateResult = await updateGameStateAndDocs({
  new_event: storyContent,
  state_changes: stateChanges,
  setting_changes: settingChanges,
  director_notes: directorNotes,
})

// 4. 处理结果
if (updateResult.success) {
  // 创建正式存档
  await createSave({ title: '第 N 回合' })
  // 刷新数据
  const player = await getPlayerEntity()
  const npcs = await getNPCEntities()
} else {
  // 回滚到临时存档
  await loadSave(tempSave.checkpointId)
}
```

---

## 6. 完整工作流

一个自定义游戏的典型生命周期：

```
┌─────────────────────────────────────────────────┐
│  初始化                                          │
│  getGameState() → 获取世界、角色、注册表          │
│  getPlayerEntity() → 获取玩家数据                 │
│  getNPCEntities() → 获取 NPC 数据                 │
│  解析 CustomComponentRegistry → 了解自定义组件    │
│  解析 Player.CustomComponents → 获取组件实例       │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  游戏循环                                        │
│                                                  │
│  1. 展示当前状态 (Player/NPC/World)              │
│  2. 等待玩家输入 (选择/自由文本)                   │
│  3. creativeWritingStream()                       │
│     → 流式展示生成内容                            │
│     → done 事件获取 state_changes                 │
│  4. createSave() → 创建临时存档                   │
│  5. updateGameStateAndDocs()                      │
│     → 更新 ECS 状态                               │
│  6. 刷新数据 (getPlayerEntity, getGameState)      │
│  7. createSave() → 创建正式存档                   │
│  8. 回到步骤 1                                    │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│  错误处理                                        │
│  updateGameStateAndDocs 失败                      │
│  → loadSave(tempCheckpointId) 回滚               │
│  → 重试或提示用户                                 │
│                                                  │
│  creativeWritingStream 失败                       │
│  → reuse_last_collect: true 重试                  │
│  → 跳过 RAG 重新收集，只重新生成                  │
└─────────────────────────────────────────────────┘
```
