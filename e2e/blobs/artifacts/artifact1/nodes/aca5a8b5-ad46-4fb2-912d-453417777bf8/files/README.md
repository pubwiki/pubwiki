# Universal Game Template

基于 Lua + React 的通用游戏模板，使用 ECS 架构和 AI 驱动的内容生成。

## 🎯 特性

- **Lua 运行时**：使用 `@pubwiki/lua` 提供的 WASM Lua 5.4 运行时
- **ECS 架构**：实体-组件-系统架构，灵活的游戏逻辑
- **RDF 状态管理**：基于 `@pubwiki/rdfstore` 的不可变版本控制
- **AI 集成**：通过 `@pubwiki/chat` 集成 LLM，支持 OpenAI/OpenRouter 等
- **虚拟文件系统**：使用 `@pubwiki/vfs` 管理游戏资源
- **React 前端**：现代化的 UI 界面
- **内置调试器**：Lua 代码在线调试工具

## 📦 技术栈

### 核心依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `@pubwiki/lua` | ^0.4.0 | Lua WASM 运行时 |
| `@pubwiki/vfs` | workspace:* | 虚拟文件系统 |
| `@pubwiki/chat` | workspace:* | LLM 聊天接口 |
| `@pubwiki/rdfstore` | workspace:* | RDF 三元组存储 |
| `react` | ^18.3.1 | UI 框架 |
| `vite` | ^6.0.1 | 构建工具 |

### 架构概览

```
┌─────────────────────────────────────────┐
│         React Frontend (TypeScript)      │
│  ├─ UI Components                        │
│  ├─ Game Selector                        │
│  └─ API Wrappers                         │
├─────────────────────────────────────────┤
│         Global APIs (window)             │
│  ├─ window.lua (LuaInstance)             │
│  ├─ window.pubchat (PubChat)             │
│  └─ window.callService()                 │
├─────────────────────────────────────────┤
│         Lua Runtime (@pubwiki/lua)       │
│  ├─ Core Modules (Service, Type, Loader)│
│  ├─ ECS System                           │
│  └─ JS Module Bridge (LLM, JSON)         │
├─────────────────────────────────────────┤
│   Storage Layer                          │
│  ├─ VFS (MemoryVfsProvider)              │
│  └─ RDFStore (MemoryLevel)               │
└─────────────────────────────────────────┘
```

## 🗂️ 项目结构

```
avg-game-template/
├── lua/                          # Lua 源代码
│   ├── assets/                   # 游戏资源包
│   │   ├── avg-template@pubwiki/ # AVG 模板模块
│   │   ├── ecs@pubwiki/          # ECS 系统
│   │   └── llm-rag@pubwiki/      # LLM RAG 模块
│   ├── backend/                  # 后端工具
│   │   ├── loader.lua            # 模块加载器
│   │   └── resource.lua          # 资源管理
│   └── core/                     # 核心模块
│       ├── service.lua           # 服务系统
│       ├── types.lua             # 类型系统
│       └── regex.lua             # 正则表达式
│
├── src/                          # TypeScript 源代码
│   ├── api/                      # API 封装层
│   │   ├── index.ts              # GameAPI 类
│   │   ├── systems.ts            # GameSystems 类
│   │   └── types.ts              # 类型定义
│   │
│   ├── components/               # React 组件
│   │   ├── ApiSettings.tsx       # API 配置界面
│   │   ├── GameSelector.tsx      # 游戏选择器
│   │   ├── StateDataEditor.tsx   # 状态编辑器
│   │   └── ai-generation/        # AI 生成向导
│   │
│   ├── games/                    # 游戏模式
│   │   ├── wuxia/                # 武侠门派经营
│   │   ├── trpg/                 # TRPG 冒险
│   │   ├── novel-generator/      # 小说生成器
│   │   └── test/                 # 测试工具
│   │
│   ├── vfs/                      # VFS 实现
│   │   ├── MemoryVfsProvider.ts  # 内存文件系统
│   │   └── index.ts
│   │
│   ├── App.tsx                   # 主应用
│   ├── global.d.ts               # 全局类型定义
│   └── main.tsx                  # 入口文件
│
├── package.json                  # 项目配置
├── pnpm-workspace.yaml           # pnpm workspace 配置
├── vite.config.ts                # Vite 配置
└── tsconfig.json                 # TypeScript 配置
```

## 🌐 全局 API

### window.lua

**类型**: `LuaInstance` (来自 `@pubwiki/lua`)

Lua 运行时实例，提供执行 Lua 代码的能力。

**方法**:

```typescript
interface LuaInstance {
  // 执行 Lua 代码
  run(code: string): Promise<{
    result: any        // Lua 返回值（自动转换为 JS 对象）
    output: string     // print() 输出
    error: string | null  // 错误信息
  }>
  
  // 注册 JS 模块（供 Lua require）
  registerJsModule(name: string, module: Record<string, Function>): void
  
  // 销毁实例
  destroy(): void
}
```

**示例**:

```typescript
// 执行 Lua 代码
const { result, output, error } = await window.lua.run(`
  return { hello = "world", count = 42 }
`)
console.log(result)  // { hello: 'world', count: 42 }

// 调用 Lua 服务
const serviceResult = await window.lua.run(`
  return Service.call("ecs.system:Query.getWorldEntity", {})
`)
```

### window.pubchat

**类型**: `PubChat` (来自 `@pubwiki/chat`)

LLM 聊天接口，支持多种 AI 模型。

**方法**:

```typescript
interface PubChat {
  // 发送消息
  chat(
    prompt: string, 
    historyId?: string, 
    overrideConfig?: Partial<LLMConfig>
  ): Promise<{
    message: MessageNode
    historyId: string
  }>
  
  // 流式聊天
  streamChat(
    prompt: string, 
    historyId?: string
  ): AsyncGenerator<ChatStreamEvent>
  
  // 对话管理
  getConversation(historyId: string): Promise<ConversationSnapshot>
  addConversation(messages: MessageNode[], parentId?: string): Promise<string[]>
  deleteConversation(historyId: string): Promise<void>
  
  // 工具注册
  registerTool(tool: ToolRegistrationParams): void
}
```

**示例**:

```typescript
// 发送消息
const { message, historyId } = await window.pubchat.chat('你好，请介绍一下自己')
console.log(message.blocks[0].content)

// 流式输出
for await (const event of window.pubchat.streamChat('写一首诗')) {
  if (event.type === 'token') {
    process.stdout.write(event.token)
  }
}
```

### window.callService()

**类型**: `<T = any>(serviceName: string, params?: any) => Promise<T>`

便捷方法，用于调用 Lua 服务。自动将 JS 对象转换为 Lua table。

**参数**:
- `serviceName`: 服务名称，格式为 `namespace:functionName`
- `params`: 参数对象（自动转换为 Lua table）

**返回**: Lua 服务的返回值（自动转换为 JS 对象）

**示例**:

```typescript
// 保存游戏状态
const result = await window.callService('state:LoadGameState', {
  data: { player_name: 'Alice', level: 5 }
})

// 查询实体
const world = await window.callService('ecs.system:Query.getWorldEntity', {})

// 生成角色
const character = await window.callService('ecs.system:Spawn.spawnCharacter', {
  creature_id: 'human',
  name: '张三',
  gender: 'male',
  age: 25
})
```

### window.llmconfig

**类型**: `LLMConfig`

LLM 配置对象，存储在 localStorage 中。

```typescript
interface LLMConfig {
  apiType: 'openai' | 'vertex'
  endpoint: string      // API 端点 URL
  model: string         // 模型名称（如 'gpt-4o'）
  apiKey: string        // API 密钥
  temperature?: number  // 温度参数
  maxTokens?: number    // 最大 token 数
  organizationId?: string
  
  // Vertex AI 专用
  projectId?: string
  location?: string
}
```

**示例**:

```typescript
// 设置配置
window.llmconfig = {
  apiType: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  apiKey: 'sk-...',
  temperature: 0.7
}

// 保存到 localStorage
localStorage.setItem('llm-config', JSON.stringify(window.llmconfig))
```

### window.GetGameState()

**类型**: `() => Promise<GetGameStateOutput>`

获取当前游戏状态的完整快照，包含所有实体和组件数据。

**返回值**:

```typescript
interface GetGameStateOutput {
  success: boolean
  data?: StateData
  error?: string
}
```

**示例**:

```typescript
// 获取游戏状态
const { success, data, error } = await window.GetGameState()

if (success && data) {
  console.log('世界实体:', data.World)
  console.log('玩家和 NPC:', data.Creatures)
  console.log('地域:', data.Regions)
  console.log('组织:', data.Organizations)
  console.log('设定文档:', data.SettingDocuments)
  console.log('剧情历史:', data.StoryHistory)
}
```

### window.LoadGameState()

**类型**: `(data: StateData) => Promise<LoadGameStateOutput>`

从快照恢复游戏状态，会清空当前世界并重建所有实体。

**参数**:
- `data`: StateData 对象（完整游戏状态快照）

**返回值**:

```typescript
interface LoadGameStateOutput {
  success: boolean
  error?: string
}
```

**示例**:

```typescript
// 加载游戏状态
const stateData = { /* StateData 对象 */ }
const { success, error } = await window.LoadGameState(stateData)

if (success) {
  console.log('游戏状态加载成功')
} else {
  console.error('加载失败:', error)
}
```

## 💾 游戏存档系统

### StateData 类型

完整的游戏状态数据结构，用于存档和读档：

```typescript
interface StateData {
  World: WorldSnapshot                    // 世界实体
  Creatures: CreatureSnapshot[]           // 所有角色（玩家+NPC）
  Regions: RegionSnapshot[]               // 所有地域
  Organizations: OrganizationSnapshot[]   // 所有组织
  SettingDocuments?: SettingDocument[]    // 设定文档集合
  StoryHistory?: StoryHistoryEntry[]      // 剧情历史记录
  GameInitialStory?: GameInitialStory     // 游戏开局故事
  GameWikiEntry?: GameWikiEntry           // 游戏百科词条
}
```

### WorldSnapshot（世界实体）

```typescript
interface WorldSnapshot {
  entity_id: number
  GameTime?: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  }
  Registry?: {
    npc_creature_ids: string[]
    player_creature_id: string
    regions: Array<{
      id: string
      name: string
      description: string
    }>
    skills: Skill[]       // 技能定义
    moves: Move[]         // 招式定义
    items: ItemDef[]      // 物品定义
  }
  StatusTemplateRegistry?: {
    templates: StatusTemplate[]  // 状态模板定义
  }
  Switches?: {
    flags: Record<string, boolean>  // 游戏开关
  }
  Log?: {
    entries: string[]  // 世界日志
  }
}
```

### CreatureSnapshot（角色实体）

```typescript
interface CreatureSnapshot {
  entity_id: number
  Creature?: {
    creature_id: string
    name: string
    organization_id?: string
    titles: string[]
    skills: Record<string, number>  // 技能经验值
    attrs: {
      str: number  // 力量
      dex: number  // 敏捷
      con: number  // 体质
      int: number  // 智力
      wis: number  // 感知
      cha: number  // 魅力
    }
    plan?: {
      title: string
      description: string
      progress: number
    }
  }
  LocationRef?: {
    region_id: string
    location_id: string
  }
  Inventory?: {
    items: Array<{
      id: string
      count: number
    }>
  }
  Equipment?: {
    head?: string
    body?: string
    hands?: string
    legs?: string
    feet?: string
    accessory_slots: number
    accessories: string[]
  }
  Statuses?: {
    statuses: Array<{
      instance_id: string
      template_id: string
      value?: any
      remark?: string
    }>
  }
  Moves?: {
    move_ids: string[]
  }
  IsPlayer?: {}  // 存在此组件表示该角色是玩家
  Log?: {
    entries: string[]
  }
  BindSetting?: {
    root_path: string  // 关联的设定文档路径
  }
}
```

### RegionSnapshot（地域实体）

```typescript
interface RegionSnapshot {
  entity_id: number
  Metadata?: {
    name: string
    desc: string
  }
  LocationsAndPaths?: {
    region_id: string
    locations: Array<{
      id: string
      name: string
      description: string
    }>
    paths: Array<{
      src_location: string
      src_region: string
      discovered: boolean
      to_region: string
      to_location: string
      description: string
    }>
  }
  Statuses?: {
    statuses: Status[]
  }
  Log?: {
    entries: string[]
  }
  BindSetting?: {
    root_path: string
  }
}
```

### OrganizationSnapshot（组织实体）

```typescript
interface OrganizationSnapshot {
  entity_id: number
  Organization?: {
    organization_id: string
    name: string
    territories: Array<{
      region_id: string
      location_id: string
    }>
    description: string
  }
  Inventory?: {
    items: Item[]
  }
  Statuses?: {
    statuses: Status[]
  }
  Log?: {
    entries: string[]
  }
  BindSetting?: {
    root_path: string
  }
}
```

### 附加数据类型

```typescript
// 设定文档
interface SettingDocument {
  path: string      // 文档路径（如 "设定文档/国家/王国A"）
  content: string   // 文档内容
}

// 剧情历史记录
interface StoryHistoryEntry {
  timestamp: string
  story: string
}

// 游戏开局故事
interface GameInitialStory {
  background: string    // 玩家视角的背景故事介绍
  start_story: string   // 游戏开场剧情
}

// 游戏百科词条
type GameWikiEntry = Array<{
  title: string
  content: string
}>
```

### 存档/读档示例

#### 保存游戏存档

```typescript
// 1. 获取当前游戏状态
const { success, data } = await window.GetGameState()

if (success && data) {
  // 2. 保存到 localStorage
  localStorage.setItem('game-save-1', JSON.stringify(data))
  console.log('存档保存成功')
  
  // 或者上传到服务器
  await fetch('/api/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}
```

#### 加载游戏存档

```typescript
// 1. 从 localStorage 读取
const savedData = localStorage.getItem('game-save-1')

if (savedData) {
  const stateData: StateData = JSON.parse(savedData)
  
  // 2. 加载游戏状态
  const { success, error } = await window.LoadGameState(stateData)
  
  if (success) {
    console.log('存档加载成功')
    
    // 3. 刷新 UI
    // 重新查询玩家、世界等数据更新界面
  } else {
    console.error('加载失败:', error)
  }
}

// 或者从服务器下载
const response = await fetch('/api/saves/save-1')
const stateData = await response.json()
await window.LoadGameState(stateData)
```

#### 在组件中使用

```typescript
import { StateData } from './api/types'

function SaveLoadComponent() {
  const handleSave = async () => {
    const { success, data } = await window.GetGameState()
    if (success && data) {
      // 保存存档
      const saveSlot = 'autosave'
      localStorage.setItem(`save-${saveSlot}`, JSON.stringify(data))
      alert('游戏已保存')
    }
  }
  
  const handleLoad = async (saveSlot: string) => {
    const savedData = localStorage.getItem(`save-${saveSlot}`)
    if (savedData) {
      const stateData: StateData = JSON.parse(savedData)
      const { success, error } = await window.LoadGameState(stateData)
      
      if (success) {
        alert('存档加载成功')
        // 刷新游戏界面
      } else {
        alert(`加载失败: ${error}`)
      }
    }
  }
  
  return (
    <div>
      <button onClick={handleSave}>保存游戏</button>
      <button onClick={() => handleLoad('autosave')}>加载游戏</button>
    </div>
  )
}
```

## 🎮 Lua 服务系统

### 服务命名空间

项目中的 Lua 服务按命名空间组织：

| 命名空间 | 描述 | 示例 |
|---------|------|------|
| `state:*` | 状态管理 | `state:LoadGameState`, `state:GetGameState` |
| `ecs.system:Spawn.*` | 实体生成 | `ecs.system:Spawn.spawnWorld` |
| `ecs.system:Query.*` | 实体查询 | `ecs.system:Query.getWorldEntity` |
| `ecs.system:Action.*` | 游戏动作 | `ecs.system:Action.advanceTime` |
| `GameTemplate:*` | 游戏模板 | `GameTemplate:Initialize` |

### 查看可用服务

```typescript
// 获取所有服务列表
const { result } = await window.lua.run(`
  return Service.exportByNamespace()
`)
console.log(result)

// 输出示例：
// {
//   "state": ["LoadGameState", "GetGameState"],
//   "ecs.system:Spawn": ["spawnWorld", "spawnCharacter", ...],
//   "ecs.system:Query": ["getWorldEntity", "getPlayerEntity", ...],
//   ...
// }
```

## 🔧 开发指南

### 启动开发服务器

```bash
pnpm install
pnpm dev
```

访问 `http://localhost:5173`

### 构建生产版本

```bash
pnpm build
```

### 目录说明

#### lua/ 目录

存放所有 Lua 源代码，启动时会自动加载到虚拟文件系统。

**核心模块**:
- `core/service.lua` - 服务注册和调用系统
- `core/types.lua` - 类型定义和验证
- `backend/loader.lua` - 模块加载器，支持 `assets/` 自动加载

**资源包**:
- `assets/ecs@pubwiki/` - ECS 系统实现
- `assets/avg-template@pubwiki/` - AVG 游戏模板
- `assets/llm-rag@pubwiki/` - LLM RAG 集成

#### src/api/ 目录

提供类型安全的 API 封装：

```typescript
import { createGameAPI, createGameSystems } from './api'

const api = createGameAPI(window.lua)
const systems = createGameSystems(window.lua)

// 使用 API
const world = await api.getWorldEntity()
const player = await api.getPlayerEntity()

// 使用系统
await systems.spawnCharacter({
  creature_id: 'human',
  name: '张三',
  gender: 'male'
})
```

#### src/games/ 目录

游戏模式实现，每个游戏是独立的 React 组件：

```typescript
// 新游戏模式示例
export default function MyGame() {
  const [gameState, setGameState] = useState(null)
  
  useEffect(() => {
    // 初始化游戏
    window.callService('MyGame:Initialize', {}).then(setGameState)
  }, [])
  
  return <div>My Game UI</div>
}
```

### 添加新服务

1. 在 `lua/` 目录创建 Lua 文件
2. 使用 `Service.define()` 定义服务
3. 在 TypeScript 中调用

**Lua 端**:

```lua
-- lua/my-module.lua
Service.define("MyNamespace:MyService", {
  inputs = Type.shape({
    param1 = Type.string(),
    param2 = Type.number():optional()
  }),
  outputs = Type.shape({
    result = Type.string()
  })
}, function(inputs)
  return { result = "Hello " .. inputs.param1 }
end)
```

**TypeScript 端**:

```typescript
const result = await window.callService('MyNamespace:MyService', {
  param1: 'World',
  param2: 42
})
console.log(result.result)  // "Hello World"
```

## 📚 内置工具

### Lua 调试器

访问主菜单 → **🔧 Lua 调试器**

支持：
- 实时执行 Lua 代码
- 查看返回值（JSON 格式化）
- 查看 `print()` 输出
- 错误信息高亮显示

**示例代码**:

```lua
-- 查询实体
local world = Service.call("ecs.system:Query.getWorldEntity", {})
print("World entity ID:", world.entity_id)

-- 遍历组件
for k, v in pairs(world.components) do
  print(k, json.encode(v))
end

return world
```

### API 设置

访问主菜单 → **API 设置**

配置 LLM 接口：
- API 端点（OpenAI/OpenRouter/自定义）
- 模型选择
- API Key
- 高级参数（温度、max tokens）

## 🔌 JS 模块注册

Lua 可以通过 `require()` 调用 JS 模块。

### 内置 JS 模块

#### LLM 模块

```lua
local LLM = require("LLM")

-- 发送消息
local response = LLM.chat("写一首诗")
print(response.content)
print(response.historyId)

-- 获取对话历史
local history = LLM.getConversation(historyId)
```

#### JSON 模块

```lua
local JSON = require("JSON")

-- 编码
local str = JSON.encode({ name = "Alice", age = 25 })
print(str)  -- '{"name":"Alice","age":25}'

-- 解码
local obj = JSON.decode(str)
print(obj.name)  -- "Alice"
```

### 注册自定义模块

```typescript
window.lua.registerJsModule('MyModule', {
  // 同步函数
  add: (a: number, b: number) => a + b,
  
  // 异步函数（Lua 中自动 await）
  fetchData: async (url: string) => {
    const res = await fetch(url)
    return res.json()
  },
  
  // 异步生成器（Lua 中变成 iterator）
  streamData: async function* () {
    yield { chunk: 1 }
    yield { chunk: 2 }
  }
})
```

```lua
local MyModule = require("MyModule")

-- 调用同步函数
local sum = MyModule.add(1, 2)

-- 调用异步函数
local data = MyModule.fetchData("https://api.example.com/data")

-- 迭代异步生成器
for item in MyModule.streamData() do
  print(item.chunk)
end
```

## 🎯 最佳实践

### 1. 类型安全

使用 TypeScript API 封装而非直接调用 `window.callService`：

```typescript
// ❌ 不推荐
const result = await window.callService('ecs.system:Query.getWorldEntity', {})

// ✅ 推荐
import { createGameAPI } from './api'
const api = createGameAPI(window.lua)
const world = await api.getWorldEntity()
```

### 2. 错误处理

```typescript
try {
  const result = await window.callService('MyService', params)
} catch (error) {
  console.error('Service call failed:', error)
  // 显示用户友好的错误信息
}
```

### 3. 状态管理

游戏状态存储在 RDFStore 中，支持版本控制：

```lua
-- 插入数据
local ref1 = State:insert('player:1', 'name', 'Alice')
local ref2 = State:insert('player:1', 'level', 5)

-- 查询数据
local player_data = State:match({subject = 'player:1'})

-- 回滚到之前的状态
State:checkout(ref1)
```

### 4. 模块组织

- **通用逻辑** → Lua 服务
- **UI 交互** → React 组件
- **API 封装** → TypeScript API 层

## 📖 相关文档

- [@pubwiki/lua README](../pubwiki/packages/lua/README.md)
- [@pubwiki/vfs README](../pubwiki/packages/vfs/README.md)
- [@pubwiki/chat README](../pubwiki/packages/chat/README.md)
- [@pubwiki/rdfstore README](../pubwiki/packages/rdfstore/README.md)
- [迁移计划](MIGRATION_PLAN.md)
- [ContextRAG 迁移分析](CONTEXTRAG_MIGRATION.md)

## 📄 License

MIT
