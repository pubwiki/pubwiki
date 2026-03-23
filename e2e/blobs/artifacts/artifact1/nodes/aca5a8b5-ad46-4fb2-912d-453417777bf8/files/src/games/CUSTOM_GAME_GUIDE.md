# 🎮 Custom Game Frontend Development Guide

> 本指南面向希望基于本框架构建自定义 AI 游戏前端的开发者。框架内置的 Ink 游戏（互动小说）只是一个参考实现——你可以用同一套后端服务做出各种类型的 AI 游戏。

## 目录

- [架构总览](#架构总览)
- [快速开始](#快速开始)
- [共享服务 API 参考](#共享服务-api-参考)
- [核心概念：CreativeWriting 与 output_content_schema](#核心概念creativewriting-与-output_content_schema)
- [游戏类型灵感](#游戏类型灵感)
- [参考：Ink 游戏如何使用这些服务](#参考ink-游戏如何使用这些服务)

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    App.tsx                           │
│  publish_type → 'INK' | 'CUSTOM' | 'TEST' | ...    │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐   │
│  │ InkGame   │  │CustomGame │  │  YourGame     │   │
│  │ (参考实现) │  │ (空白模板) │  │  (你的作品!)  │   │
│  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘   │
│        │              │                │            │
│        └──────────────┼────────────────┘            │
│                       ▼                             │
│            games/utils/gameServices.ts              │
│            (共享服务 API — 统一入口)                  │
│                       │                             │
│                       ▼                             │
│              window.callService()                   │
│              (Lua 后端 RPC 桥接)                     │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Lua ECS Backend │
              │  ├── 世界状态     │
              │  ├── 实体管理     │
              │  ├── RAG 召回     │
              │  └── LLM 生成     │
              └──────────────────┘
```

**关键认识：** 你的游戏前端只负责 **UI 和交互逻辑**。所有 AI 生成、状态持久化、存档管理都由后端服务完成，你只需调用 `games/utils/gameServices.ts` 中的函数即可。

---

## 快速开始

### 1. 创建你的游戏组件

在 `front/src/games/custom/index.tsx`（或新建一个目录）中创建你的游戏组件：

```tsx
import { useState, useEffect } from 'react'
import {
  getGameState,
  getPlayerEntity,
  creativeWritingStream,
  createSave,
  updateGameStateAndDocs,
} from '../utils'
import type { CreativeWritingOutput } from '../../api/types'

interface MyGameProps {
  onBack: () => void
}

export default function MyGame({ onBack }: MyGameProps) {
  const [player, setPlayer] = useState<any>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  // 初始化：加载玩家数据
  useEffect(() => {
    const init = async () => {
      const playerData = await getPlayerEntity()
      if (playerData.found) {
        setPlayer(playerData)
      }
    }
    init()
  }, [])

  // AI 生成
  const handleGenerate = async (userAction: string) => {
    setLoading(true)
    setContent('')

    await creativeWritingStream({
      create_request: `玩家行动: ${userAction}`,
      thinking_instruction: '分析玩家行动的合理性和后果',
      previous_content_overview: content,
      output_content_schema: `{
        narrative: string,    // 叙事内容
        choices: Array<{      // 下一步选择
          text: string,
          difficulty?: number
        }>
      }`,
      callback: (event) => {
        if (event.event_type === 'result_update' && event.event_data.content) {
          setContent(event.event_data.content.narrative || '')
        }
        if (event.event_type === 'done') {
          setLoading(false)
        }
        if (event.event_type === 'error') {
          console.error('生成出错:', event.event_data)
          setLoading(false)
        }
      }
    })
  }

  return (
    <div>
      <h1>我的 AI 游戏</h1>
      {player && <p>玩家: {player.Creature?.name}</p>}
      <div>{content}</div>
      <button onClick={() => handleGenerate('探索周围环境')} disabled={loading}>
        {loading ? '生成中...' : '行动'}
      </button>
    </div>
  )
}
```

### 2. 注册你的游戏

在 `App.tsx` 中，你的游戏通过 `publish_type` 路由：

```tsx
// App.tsx 中已有的路由逻辑
type GameType = 'NOVEL' | 'INK' | 'TEST' | 'CUSTOM'

const renderGame = () => {
  switch (activeGame) {
    case 'INK':     return <InkGame onBack={() => {}} />
    case 'CUSTOM':  return <CustomGame onBack={() => {}} />  // ← 你的游戏
    // 你也可以添加更多 GameType...
  }
}
```

在编辑器的 AppInfo 中将 `publish_type` 设为 `CUSTOM`，即可在启动时加载你的游戏。

### 3. 使用 Zustand 管理状态（推荐）

对于复杂游戏，建议参考 Ink 游戏的做法，创建 Zustand store 来管理状态：

```tsx
// stores/myGameStore.ts
import { create } from 'zustand'
import { getGameState, creativeWritingStream, createSave } from '../../utils'

interface MyGameState {
  // 你的游戏状态
  initialized: boolean
  // 你的 actions
  initialize: () => Promise<void>
}

export const useMyGameStore = create<MyGameState>((set, get) => ({
  initialized: false,

  initialize: async () => {
    const state = await getGameState()
    if (state.success && state.data) {
      // 从 state.data 中提取你需要的初始数据
      set({ initialized: true })
    }
  },
}))
```

---

## 共享服务 API 参考

所有服务函数位于 `games/utils/gameServices.ts`，通过 `games/utils/index.ts` 导出。

### 状态管理

| 函数 | 说明 | 返回类型 |
|------|------|----------|
| `getGameState()` | 获取完整游戏状态快照 | `GetGameStateOutput` |
| `loadState(data)` | 将完整状态写回引擎 | `LoadGameStateOutput` |

`StateData` 包含所有游戏数据：世界信息、角色、地域、组织、设定文档、剧情历史等。

### 存档管理

| 函数 | 说明 | 返回类型 |
|------|------|----------|
| `createSave(opts?)` | 创建存档点 | `CreateGameSaveOutput` |
| `loadSave(checkpointId)` | 加载指定存档 | `LoadGameSaveOutput` |
| `listSaves()` | 列出所有存档 | `ListGameSavesOutput` |

### 剧情历史

| 函数 | 说明 | 返回类型 |
|------|------|----------|
| `getStoryHistory()` | 获取完整剧情历史 | `GetStoryHistoryOutput` |
| `setNewStoryHistory(input)` | 添加新的历史条目 | `void` |
| `clearStoryHistory()` | 清空所有历史 | `ClearStoryHistoryOutput` |

你可以自由定义 `content` 的数据格式——它就是一个 `any` 类型，由你的游戏负责序列化和反序列化。

### AI 内容生成

| 函数 | 说明 | 返回类型 |
|------|------|----------|
| `creativeWritingStream(input)` | 流式 AI 内容生成 | `void` |
| `updateGameStateAndDocs(input)` | 根据叙事事件更新游戏状态 | `UpdateGameStateAndDocsOutput` |

### 实体查询（ECS）

| 函数 | 说明 | 返回类型 |
|------|------|----------|
| `getPlayerEntity()` | 查询玩家实体 | `PlayerEntityOutput` |
| `getNPCEntities()` | 查询所有 NPC | `NPCEntitiesOutput` |

### 发布与配置

| 函数 | 说明 |
|------|------|
| `initializeGame()` | 初始化游戏模板 |
| `getAppInfo()` | 获取应用信息 |
| `publishApp()` | 发布应用 |
| `publishArticle(input)` | 发布文章 |
| `setAPIConfig(input)` | 配置 LLM 模型 |

---

## 核心概念：CreativeWriting 与 output_content_schema

`creativeWritingStream` 是整个框架的**核心引擎**。它不仅仅是"写小说"——它是一个通用的 **RAG 增强 + 流式 LLM 生成** 管线，你可以通过 `output_content_schema` 让 AI 输出任何结构化数据。

### CreativeWritingStreamInput 详解

```typescript
interface CreativeWritingStreamInput {
  create_request: string       // 告诉 AI "要做什么"
  thinking_instruction: string // 告诉 AI "如何思考"
  previous_content_overview: string // 之前的上下文摘要
  output_content_schema: string    // 输出数据的 TypeScript 格式定义
  callback: (event) => void        // 流式事件回调
  model?: string                    // 可选：指定模型
}
```

### output_content_schema 的威力

这是一个**字符串形式的 TypeScript 接口定义**，AI 会按照你定义的结构返回数据。这意味着你可以让 AI 输出任何格式的结构化数据：

```typescript
// 小说模式（Ink 游戏的做法）
output_content_schema: `{
  chapter_hint: string,
  novel_content_part1: string,
  novel_content_part2: string,
  player_choices: Array<{ name: string, description: string }>,
  state_changes: string[],
  setting_changes: string[]
}`

// 战斗系统
output_content_schema: `{
  battle_narration: string,
  damage_dealt: number,
  effects_applied: Array<{ target: string, effect: string, duration: number }>,
  enemy_action: { type: string, description: string },
  battle_state: 'ongoing' | 'victory' | 'defeat'
}`

// 对话系统
output_content_schema: `{
  speaker: string,
  dialogue: string,
  emotion: string,
  relationship_change: number,
  available_responses: Array<{ text: string, tone: string }>
}`

// 探索/解谜
output_content_schema: `{
  scene_description: string,
  discovered_items: Array<{ id: string, name: string, description: string }>,
  available_actions: string[],
  hidden_clue?: string
}`
```

### 流式回调事件

回调函数会收到以下事件类型：

```typescript
type StreamEvent = {
  event_type: 'collector_result_update' | 'result_update' | 'done' | 'error'
  event_data: Partial<CreativeWritingOutput> | Error
}
```

| 事件类型 | 触发时机 | event_data 内容 |
|----------|----------|-----------------|
| `collector_result_update` | RAG 召回完成 | `collector_results`: 被召回的实体和文档列表 |
| `result_update` | AI 输出更新（流式） | `content`: 你定义的结构化数据（部分或完整） |
| `done` | 生成结束 | 最终的完整 `content` |
| `error` | 出错 | `Error` 对象 |

### RAG 知识召回

`creativeWritingStream` 的一大强项是内置的 **RAG（检索增强生成）** 机制。AI 在生成之前，会自动根据上下文从设定文档中召回相关知识。你不需要手动管理这些——只需在编辑器中编写好设定文档，AI 就会在合适的时机引用它们。

`collector_result_update` 事件会告诉你哪些实体和文档被召回了，你可以选择在 UI 中展示这些信息（就像 Ink 游戏的 RAG 面板那样），也可以完全隐藏。

### 状态变更与自动更新

AI 在 `output_content_schema` 中返回 `state_changes` 和 `setting_changes` 时，你可以将它们传递给 `updateGameStateAndDocs` 服务，由后端 AI 自动生成并执行 Lua 代码来更新游戏世界状态：

```typescript
// AI 生成完成后
if (result.state_changes?.length || result.setting_changes?.length) {
  const updateResult = await updateGameStateAndDocs({
    new_event: narrativeContent,      // 发生了什么
    state_changes: result.state_changes || [],    // AI 建议的状态变化
    setting_changes: result.setting_changes || [] // AI 建议的设定变化
  })

  if (updateResult.success) {
    // 刷新前端数据
    // ...
  }
}
```

---

## 游戏类型灵感

以下是一些你可以用这个框架实现的 AI 游戏类型：

### 🎭 互动对话 / 视觉小说

```typescript
output_content_schema: `{
  speaker: string,
  dialogue: string,
  inner_thought?: string,
  background_change?: string,
  character_expression: string,
  choices: Array<{ text: string, leads_to: string }>
}`
```

### ⚔️ 回合制 RPG 战斗

```typescript
output_content_schema: `{
  turn_narration: string,
  enemy_intent: string,
  battle_log: Array<{ actor: string, action: string, result: string }>,
  player_options: Array<{
    type: 'attack' | 'skill' | 'item' | 'defend' | 'flee',
    name: string,
    description: string,
    success_rate?: number
  }>
}`
```

### 🔍 推理解谜

```typescript
output_content_schema: `{
  scene: string,
  dialogue?: { speaker: string, text: string },
  evidence_found?: Array<{ id: string, name: string, description: string }>,
  deduction_prompt?: string,
  available_actions: Array<{ action: string, target?: string }>
}`
```

### 🏰 经营模拟

```typescript
output_content_schema: `{
  day_report: string,
  resource_changes: Array<{ resource: string, delta: number, reason: string }>,
  events: Array<{ type: string, description: string, choices: string[] }>,
  advisor_suggestions: string[]
}`
```

### 🃏 卡牌对战

```typescript
output_content_schema: `{
  round_narration: string,
  opponent_play: { card_name: string, effect: string },
  board_state: { player_hp: number, opponent_hp: number },
  hand_advice: string,
  available_plays: Array<{ card: string, mana_cost: number, effect_preview: string }>
}`
```

### 🌍 开放世界探索

```typescript
output_content_schema: `{
  location_description: string,
  atmosphere: string,
  npcs_present: Array<{ name: string, activity: string, approachable: boolean }>,
  points_of_interest: Array<{ name: string, hint: string }>,
  travel_options: Array<{ destination: string, distance: string, risk: string }>
}`
```

---

## 参考：Ink 游戏如何使用这些服务

Ink 游戏是框架内置的参考实现，展示了完整的服务集成模式：

### 初始化流程

```
组件挂载
  → getGameState()         获取世界数据、背景故事
  → getPlayerEntity()      获取玩家实体
  → getNPCEntities()       获取所有 NPC
  → getStoryHistory()      恢复历史记录
```

### 每回合游戏循环

```
1. 玩家选择行动
2. creativeWritingStream()    → AI 生成叙事 + 选择项 + 状态变化建议
   ├── collector_result_update → 展示 RAG 召回信息
   ├── result_update           → 流式展示小说内容
   └── done                    → 生成完成
3. createSave()               → 创建临时存档（用于失败回滚）
4. updateGameStateAndDocs()   → 后端执行状态变更
5. setNewStoryHistory()       → 保存本回合历史
6. createSave()               → 创建正式存档
7. 刷新前端数据（重新查询实体）
```

### 错误恢复机制

Ink 游戏在执行 `updateGameStateAndDocs` 前会创建临时存档，如果状态更新失败，可以通过 `loadSave(tempCheckpointId)` 回滚到更新前的状态。建议你的游戏也实施类似的回滚机制。

---

## 最佳实践

1. **始终使用 `games/utils` 导入服务** — 不要直接调用 `window.callService`
2. **设计好你的 `output_content_schema`** — 这是你游戏体验的核心，AI 的输出质量与 schema 设计直接相关
3. **利用 `thinking_instruction`** — 引导 AI 的思考方向，产生更合理的内容
4. **实现状态回滚** — 在修改状态前创建存档，失败时可回滚
5. **保存剧情历史** — 使用 `setNewStoryHistory` 持久化每回合数据，支持断点续玩
6. **利用 RAG** — 在编辑器中编写丰富的设定文档，AI 会自动在生成时召回相关内容
7. **流式展示** — 充分利用 `callback` 的流式事件，给用户实时反馈而非长时间等待

---

## 文件结构建议

```
front/src/games/
├── utils/
│   ├── gameServices.ts        ← 共享服务 API（已提供）
│   └── index.ts               ← barrel 导出
├── components/                ← 共享 UI 组件（如模态框）
├── custom/                    ← 你的自定义游戏
│   ├── index.tsx              ← 主入口组件
│   ├── stores/                ← Zustand 状态管理
│   │   ├── gameStore.ts
│   │   └── uiStore.ts
│   ├── components/            ← 游戏专用组件
│   └── MyGame.css             ← 游戏样式
└── ink/                       ← Ink 参考实现（供学习）
    ├── index.tsx
    ├── stores/
    ├── components/
    └── types.ts
```
