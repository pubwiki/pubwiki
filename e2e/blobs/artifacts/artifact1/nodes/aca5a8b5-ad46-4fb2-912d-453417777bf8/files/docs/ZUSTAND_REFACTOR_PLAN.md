# InkGame 组件 Zustand 重构方案

## 1. 背景与动机

### 1.1 当前问题

`InkGame` 组件目前使用 React 原生的 `useState` + `useCallback` 管理状态，存在以下问题：

1. **闭包陷阱** - `useCallback` 的依赖数组管理极其痛苦，多个函数互相依赖导致循环引用问题
   - 例如：`handleChoiceSelect` → `generateStory` → `playerEntity`，依赖链条复杂
   - 不得不使用 `useRef` 来打破循环依赖（如 `generateStoryRef`）

2. **状态膨胀** - 单个组件内有 **40+ 个 useState**，代码可读性差

3. **重渲染问题** - 任意一个状态变化都可能触发整个组件重渲染

4. **逻辑分散** - 业务逻辑散落在各个 `useCallback` 中，难以维护和测试

### 1.2 为什么选择 Zustand

| 特性 | useState | Zustand |
|------|----------|---------|
| 闭包问题 | 需要手动管理依赖数组 | ✅ 无闭包陷阱，直接 get() 获取最新状态 |
| 组件外访问 | ❌ 不支持 | ✅ `useStore.getState()` 随时可用 |
| 重渲染控制 | 粗粒度 | ✅ selector 精确控制 |
| 学习成本 | 低 | 低（API 简洁） |
| 代码组织 | 状态和逻辑混在组件里 | ✅ 状态和逻辑分离到 store |
| TypeScript | 良好 | ✅ 良好 |
| DevTools | React DevTools | ✅ Redux DevTools 兼容 |

---

## 2. Store 划分方案

将现有状态按职责划分为 **5 个 Store**：

### 2.1 Store 结构图

```
stores/
├── index.ts              # 统一导出
├── gameStore.ts          # 核心游戏状态
├── registryStore.ts      # 注册表数据
├── creatureStore.ts      # 生物/组织/地点实体
├── modalStore.ts         # 所有模态框状态
└── uiStore.ts            # UI 状态
```

### 2.2 各 Store 详细设计

#### 📦 gameStore.ts - 核心游戏状态

```typescript
interface GameState {
  // 状态
  gameStarted: boolean
  backgroundStory: string
  startStory: string
  inkTurns: InkTurn[]
  turnCounter: number
  currentPhase: 'idle' | 'generating-story' | 'updating-state' | 'waiting-choice'
  playerInput: string
  showCustomInput: boolean
  pendingChoiceTurnId: number | null
  errorInfo: { message: string; retryAction: () => void } | null
  gameTime: GameTime | null
  
  // Actions
  setGameStarted: (started: boolean) => void
  setInkTurns: (turns: InkTurn[] | ((prev: InkTurn[]) => InkTurn[])) => void
  setCurrentPhase: (phase: GameState['currentPhase']) => void
  startGame: () => Promise<void>
  generateStory: (action: string, actionTurnId: number) => Promise<void>
  handleChoiceSelect: (choice: PlayerChoice, storyTurnId: number) => void
  handleCustomInput: (input: string, storyTurnId: number) => void
  retryUpdateGameState: (storyTurnId: number) => Promise<void>
  clearStoryHistory: () => Promise<void>
  buildHistoryText: () => string
}
```

**迁移的状态：**
- `gameStarted`, `backgroundStory`, `startStory`
- `inkTurns`, `turnCounter`
- `currentPhase`, `playerInput`, `showCustomInput`
- `pendingChoiceTurnId`, `errorInfo`, `gameTime`

**迁移的函数：**
- `startGame`, `generateStory`
- `handleChoiceSelect`, `handleCustomInput`
- `retryUpdateGameState`, `clearStoryHistory`
- `buildHistoryText`

---

#### 📦 registryStore.ts - 注册表数据

```typescript
interface RegistryState {
  // 状态
  skillsRegistry: Map<string, { name: string; description?: string }>
  itemsRegistry: Map<string, { name: string; description?: string; detail?: string[] }>
  movesRegistry: Map<string, { name: string; desc: string; details: string[] }>
  statusTemplatesRegistry: Map<string, { name: string; description: string; details: string[]; gm_hint?: string }>
  organizationsRegistry: Map<string, { name: string }>
  creaturesRegistry: Map<string, { name: string }>
  locationsRegistry: Map<string, { name: string; description?: string }>
  regionsRegistry: Map<string, { name: string }>
  entriesMap: Map<string, string>
  
  // Actions
  loadRegistries: () => Promise<void>
  
  // Computed (getter)
  getRegistries: () => GameRegistries
}
```

**迁移的状态：**
- 所有 `xxxRegistry` 状态
- `entriesMap`

**迁移的函数：**
- `loadRegistries`

---

#### 📦 creatureStore.ts - 生物/组织/地点实体

```typescript
interface CreatureState {
  // 状态
  playerEntity: CreatureEntity | null
  playerLoading: boolean
  creaturesMap: Map<string, CreatureEntity>
  organizationsMap: Map<string, OrganizationEntity>
  regionsMap: Map<string, RegionEntity>
  
  // Actions
  refreshCreatures: () => Promise<void>
  setPlayerEntity: (entity: CreatureEntity | null) => void
}
```

**迁移的状态：**
- `playerEntity`, `playerLoading`
- `creaturesMap`, `organizationsMap`, `regionsMap`

**迁移的函数：**
- `refreshCreatures`

---

#### 📦 modalStore.ts - 模态框状态

```typescript
interface ModalState {
  // 思考过程模态框
  thinkingModalOpen: boolean
  thinkingModalContent: string
  
  // 信息模态框
  infoModalOpen: boolean
  infoModalContent: InfoModalContent | null
  
  // 角色模态框
  creatureModalOpen: boolean
  creatureModalEntity: CreatureEntity | null
  
  // 组织模态框
  organizationModalOpen: boolean
  organizationModalEntity: OrganizationEntity | null
  
  // 地点模态框
  locationModalOpen: boolean
  locationModalRegion: RegionEntity | null
  locationModalLocationId: string | null
  
  // 词条模态框
  entryModalOpen: boolean
  entryModalName: string
  
  // 调试模态框
  debugModalOpen: boolean
  debugLuaCode: string
  debugResult: { result?: any; output?: string; error?: string } | null
  debugExecuting: boolean
  
  // 发布模态框
  publishModalOpen: boolean
  publishStartTurn: number
  publishEndTurn: number
  publishTitle: string
  publishVisibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED'
  publishing: boolean
  
  // Actions
  openThinkingModal: (content: string) => void
  closeThinkingModal: () => void
  openCreatureModal: (creatureId: string) => void
  closeCreatureModal: () => void
  openOrganizationModal: (organizationId: string) => void
  closeOrganizationModal: () => void
  openLocationModal: (regionId: string, locationId: string) => void
  closeLocationModal: () => void
  openEntryModal: (entryName: string) => void
  closeEntryModal: () => void
  // ... 其他 open/close actions
}
```

**迁移的状态：**
- 所有 `xxxModalOpen`, `xxxModalContent`, `xxxModalEntity` 等

**迁移的函数：**
- `openCreatureModal`, `openOrganizationModal`, `openLocationModal`, `openEntryModal`

---

#### 📦 uiStore.ts - UI 状态

```typescript
interface UIState {
  // 状态
  isLeftPanelOpen: boolean
  collapsedSections: Map<string, boolean>
  
  // Actions
  toggleLeftPanel: () => void
  setLeftPanelOpen: (open: boolean) => void
  toggleSection: (sectionId: string) => void
  
  // Refs (不放在 store 里，保留在组件中)
  // inkFlowRef, initializedRef, turnIdRef, currentRequestIdRef
}
```

---

## 3. 迁移步骤

### Phase 1: 准备工作 (30 min)

1. 安装 Zustand
   ```bash
   pnpm add zustand
   ```

2. 创建 stores 目录结构

3. 定义类型文件 `stores/types.ts`

### Phase 2: 迁移模态框状态 (30 min) ⭐ 风险最低，先做

1. 创建 `modalStore.ts`
2. 在 InkGame 中引入 modalStore
3. 替换所有模态框相关的 useState
4. 测试所有模态框功能

### Phase 3: 迁移 UI 状态 (15 min)

1. 创建 `uiStore.ts`
2. 迁移 `isLeftPanelOpen`, `collapsedSections`
3. 测试侧边栏折叠功能

### Phase 4: 迁移注册表状态 (30 min)

1. 创建 `registryStore.ts`
2. 迁移所有 registry 状态
3. 迁移 `loadRegistries` 函数
4. 测试注册表加载和显示

### Phase 5: 迁移生物实体状态 (30 min)

1. 创建 `creatureStore.ts`
2. 迁移 `playerEntity`, `creaturesMap` 等
3. 迁移 `refreshCreatures` 函数
4. 测试角色面板显示

### Phase 6: 迁移核心游戏状态 (1-2 hours) ⭐ 最复杂

1. 创建 `gameStore.ts`
2. 迁移游戏流程状态
3. **重点：迁移 `generateStory` 等复杂函数**
   - 不再需要 useCallback
   - 不再需要依赖数组
   - 不再需要 generateStoryRef 这种 workaround
4. 全面测试游戏流程

### Phase 7: 清理与优化 (30 min)

1. 删除不再需要的 useRef（如 `generateStoryRef`）
2. 删除空的依赖数组 workaround
3. 优化 selector 减少重渲染
4. 添加 Redux DevTools 支持（可选）

---

## 4. 代码示例

### 4.1 Store 创建示例

```typescript
// stores/gameStore.ts
import { create } from 'zustand'
import { useCreatureStore } from './creatureStore'
import { useRegistryStore } from './registryStore'

interface GameState {
  inkTurns: InkTurn[]
  currentPhase: 'idle' | 'generating-story' | 'updating-state' | 'waiting-choice'
  // ... 其他状态
  
  generateStory: (action: string, actionTurnId: number) => Promise<void>
}

export const useGameStore = create<GameState>((set, get) => ({
  inkTurns: [],
  currentPhase: 'idle',
  
  generateStory: async (action, actionTurnId) => {
    // ✅ 直接获取最新状态，无闭包问题
    const { playerEntity } = useCreatureStore.getState()
    const { inkTurns } = get()
    
    set({ currentPhase: 'generating-story' })
    
    try {
      // ... 生成逻辑
      const historyText = get().buildHistoryText()
      
      await window.callService('GameTemplate:CreativeWritingStream', {
        create_request: `玩家(${playerEntity?.Creature?.name})行动: ${action}`,
        // ...
      })
      
    } catch (e) {
      // 错误处理
    }
  },
  
  buildHistoryText: () => {
    const { inkTurns } = get()
    const { playerEntity } = useCreatureStore.getState()
    // ... 构建历史文本
  }
}))
```

### 4.2 组件使用示例

```typescript
// InkGame 组件中
export default function InkGame({ onBack }: InkGameProps) {
  // 精确选择需要的状态，避免不必要的重渲染
  const inkTurns = useGameStore(s => s.inkTurns)
  const currentPhase = useGameStore(s => s.currentPhase)
  const generateStory = useGameStore(s => s.generateStory)
  
  const playerEntity = useCreatureStore(s => s.playerEntity)
  
  const { openCreatureModal, creatureModalOpen } = useModalStore()
  
  // 保留必要的 ref（DOM ref、request ID 等）
  const inkFlowRef = useRef<HTMLDivElement>(null)
  const currentRequestIdRef = useRef(0)
  
  // useEffect 简化
  useEffect(() => {
    // 初始化逻辑
    useRegistryStore.getState().loadRegistries()
    useCreatureStore.getState().refreshCreatures()
  }, [])
  
  // 渲染逻辑保持不变
  return (...)
}
```

### 4.3 跨 Store 访问示例

```typescript
// 在 gameStore 中访问 creatureStore
const generateStory = async (action: string) => {
  // 方式 1: 使用 getState()
  const playerEntity = useCreatureStore.getState().playerEntity
  
  // 方式 2: 在 store 创建时订阅（适合频繁访问的场景）
}

// 在组件中组合多个 store
const GamePanel = () => {
  const playerEntity = useCreatureStore(s => s.playerEntity)
  const currentPhase = useGameStore(s => s.currentPhase)
  // ...
}
```

---

## 5. 注意事项

### 5.1 保留在组件内的内容

以下内容 **不迁移** 到 Zustand，保留在组件中：

- **DOM Refs**: `inkFlowRef` - 需要直接操作 DOM
- **Request ID Ref**: `currentRequestIdRef` - 用于取消请求，不需要响应式
- **Turn ID Ref**: `turnIdRef` - 可选择保留或迁移
- **Initialized Ref**: `initializedRef` - 防重复初始化

### 5.2 Map 类型的处理

Zustand 默认使用浅比较，对于 Map 类型需要注意：

```typescript
// ❌ 错误：直接修改 Map 不会触发更新
set(state => {
  state.creaturesMap.set(id, entity)
  return state
})

// ✅ 正确：创建新 Map
set(state => ({
  creaturesMap: new Map(state.creaturesMap).set(id, entity)
}))
```

### 5.3 异步操作

Zustand 原生支持异步 action，无需中间件：

```typescript
generateStory: async (action) => {
  set({ currentPhase: 'generating-story' })
  try {
    const result = await api.generate(action)
    set({ inkTurns: [...get().inkTurns, result] })
  } catch (e) {
    set({ errorInfo: { message: e.message, retryAction: () => get().generateStory(action) } })
  }
}
```

### 5.4 DevTools 支持（可选）

```typescript
import { devtools } from 'zustand/middleware'

export const useGameStore = create<GameState>()(
  devtools(
    (set, get) => ({
      // ...
    }),
    { name: 'GameStore' }
  )
)
```

---

## 6. 风险评估

| 风险 | 等级 | 应对措施 |
|------|------|----------|
| 功能回归 | 中 | 分阶段迁移，每阶段充分测试 |
| 性能问题 | 低 | 使用 selector 精确订阅 |
| 类型错误 | 低 | TypeScript 严格模式 |
| 迁移遗漏 | 中 | 编写迁移 checklist，逐项确认 |

---

## 7. 时间估算

| 阶段 | 预估时间 |
|------|----------|
| Phase 1: 准备工作 | 30 min |
| Phase 2: 模态框状态 | 30 min |
| Phase 3: UI 状态 | 15 min |
| Phase 4: 注册表状态 | 30 min |
| Phase 5: 生物实体状态 | 30 min |
| Phase 6: 核心游戏状态 | 1.5-2 hours |
| Phase 7: 清理优化 | 30 min |
| **总计** | **4-5 hours** |

---

## 8. 预期收益

1. ✅ **彻底解决闭包陷阱** - 不再需要 `useCallback` 依赖数组
2. ✅ **代码更清晰** - 状态和逻辑分离到独立文件
3. ✅ **更好的可测试性** - store 可以独立测试
4. ✅ **减少重渲染** - selector 精确控制订阅
5. ✅ **更好的开发体验** - Redux DevTools 支持
6. ✅ **组件外访问** - 可以在任何地方访问和修改状态
