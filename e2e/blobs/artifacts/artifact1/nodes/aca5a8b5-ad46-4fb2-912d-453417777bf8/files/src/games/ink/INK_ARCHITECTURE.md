# Ink 互动小说系统架构文档

## 📁 目录结构

```
front/src/games/ink/
├── index.tsx                    # 主入口组件
├── InkGame.css                  # 主样式文件
├── types.ts                     # TypeScript 类型定义
├── hooks.tsx                    # 自定义 React Hooks
├── components/                  # UI 组件目录
│   ├── index.ts                # 组件导出索引
│   ├── InkFlow.tsx             # 小说流渲染组件（含掷骰 UI）
│   ├── CollapsibleSections.tsx # 可折叠区域组件
│   ├── Modals.tsx              # 模态框组件集合
│   └── WorldOverview.tsx       # 世界概览面板
├── hooks/                       # 独立 Hook 目录
│   └── useTypewriter.ts        # 打字机动画 Hook
└── stores/                      # Zustand 状态管理
    ├── index.ts                # Store 导出索引
    ├── gameStore.ts            # 游戏核心逻辑状态（含掷骰逻辑）
    ├── creatureStore.ts        # 角色/实体状态
    ├── registryStore.ts        # 注册表数据状态
    ├── modalStore.ts           # 模态框状态
    └── uiStore.ts              # UI 界面状态与偏好设置
```

---

## 🧩 组件架构

### 1. 主组件 (`index.tsx`)

**功能**：Ink 互动小说游戏的主入口组件

**职责**：
- 整合所有 Zustand stores
- 管理游戏主界面布局（顶部栏、左侧面板、右侧内容区）
- 初始化游戏数据（加载注册表、角色、历史记录）
- 提供实体名称高亮和对话高亮功能
- 管理所有模态框的显示和隐藏
- 渲染小说流和可折叠区域
- 提供游戏设置（叙事人称、掷骰模式、段落数、打字机速度）

**使用的状态管理**：
- `gameStore` - 游戏流程、回合、玩家输入、掷骰状态
- `creatureStore` - 玩家实体、NPC、游戏时间
- `registryStore` - 技能、物品、招式、属性字段等注册表
- `modalStore` - 所有模态框状态
- `uiStore` - 面板折叠、区域展开、偏好设置（人称、骰子、速度、段落数）

**主要渲染内容**：
- 游戏开始前的欢迎界面
- 顶部导航栏（返回按钮、世界概览、发布文章、清空剧情）
- 左侧玩家面板（使用 `CreaturePanel` 组件）
- 右侧小说流（使用 `InkFlow` 组件）
- 设置区：叙事人称切换、掷骰模式、段落数滑块、打字机速度滑块
- 各类模态框（角色、组织、地点、词条、发布、思考、确认等）
- 世界概览面板（使用 `WorldOverview` 组件）

**样式来源**：
- 主样式文件：`InkGame.css`
- 模态框样式：`../components/GameModals.css`

---

### 2. InkFlow 组件 (`components/InkFlow.tsx`)

**功能**：渲染游戏的小说流（故事回合流）

**包含的子组件**：

#### 2.1 `StoryBlock`

**Props**: `{ turn: StoryTurn; scrollToBottom: (force: boolean) => void }`

**职责**：
- 渲染单个故事回合的完整内容
- **打字机动画**：使用 `useTypewriter` hook 逐字显示内容（两段分别独立动画）
- **自动滚动**：打字机动画期间自动滚动到底部
- 渲染可折叠区域（RAG 收集器、推理、思考、变更建议、状态更新）
- 显示章节标题和导演建议（`nextDirection`）
- **掷骰判定面板**：
  - 难度条可视化
  - 骰子滚动动画
  - 首次 / 重试结果显示
  - 重试按钮（仅首次失败时可用）
  - 取消按钮返回选择
- 渲染玩家选项（含特殊标记、骰子标记、难度提示）
- 自定义输入区域
- 时光倒流按钮（存档检查点回退）

**注意**：打字机动画不可通过点击跳过，只能自然播放完毕。

#### 2.2 `InkFlow`

**Props**: `{ scrollToBottom: (force: boolean) => void }`

**职责**：
- 遍历并渲染所有游戏回合（`inkTurns`）
- 按类型分发渲染：`StoryTurn` → `StoryBlock`、`PlayerActionTurn` → 行动块、`ErrorTurn` → 错误块
- 行动块显示：玩家行动内容、特殊标记、自定义标记、掷骰结果
- 错误块显示：错误消息、重试按钮

**使用的可折叠组件**：
- `CollectorResultsSection` - RAG 收集器结果
- `ReasoningSection` - AI 推理过程
- `ThinkingSection` - AI 思考过程
- `ChangeSuggestionsSection` - 状态/设定变更建议
- `UpdateGameStateSection` - 游戏状态更新结果

**支持的回合类型**：
- `StoryTurn` - 故事回合（章节、内容、选项、导演建议）
- `PlayerActionTurn` - 玩家行动回合（含掷骰结果）
- `SystemTurn` - 系统回合（日志、Lua 代码、摘要）
- `ErrorTurn` - 错误回合（带重试功能）

**样式来源**：
- 继承自 `InkGame.css` 中的 `.ink-flow` 及相关类

---

### 3. CollapsibleSections 组件 (`components/CollapsibleSections.tsx`)

**功能**：提供可折叠的内容区域

**包含的子组件**：

#### 3.1 `CollapsibleSection`（基础组件）
- 通用的可折叠容器
- 支持自动折叠和手动切换（用户偏好存储在 `uiStore`）
- 带有图标、标题、徽章、生成中指示器

#### 3.2 `CollectorResultsSection`
- 显示 RAG 收集器的检索结果
- 展示选中和未选中的实体
- 显示每个实体的文档列表和思考过程

#### 3.3 `ReasoningSection`
- 显示大模型的推理过程（reasoning）
- 通常在有思考过程或内容时自动折叠

#### 3.4 `ThinkingSection`
- 显示 AI 的思考过程（thinking）
- 在内容生成完成后自动折叠

#### 3.5 `ChangeSuggestionsSection`
- 显示状态变更建议（stateChanges）
- 显示设定变更建议（settingChanges）
- 默认展开

#### 3.6 `UpdateGameStateSection`
- 显示游戏状态更新的结果
- 支持失败后内联重试
- 显示执行计划、AI 思考、执行代码、输出等信息
- 状态指示：更新中 / 已更新 / 失败

**样式来源**：
- 主要样式在 `InkGame.css` 中的 `.collapsible-section` 系列类

---

### 4. Modals 组件 (`components/Modals.tsx`)

**功能**：提供各种游戏模态框

#### 4.1 `PublishModal`
- 允许用户选择要发布的章节范围
- 设置文章标题和可见性
- 调用发布 API 将内容发布到平台

#### 4.2 `ThinkingModal`
- 显示 AI 思考过程的全屏模态框

#### 4.3 `PreviewStoryModal`
- 预览剧情内容
- 支持确认操作

#### 4.4 `ConfirmModal`
- 通用确认对话框
- 显示消息并提供确认/取消按钮

**样式来源**：
- 使用 `InkGame.css` 中的 `.modal-overlay`、`.modal-content` 等类

---

### 5. WorldOverview 组件 (`components/WorldOverview.tsx`)

**功能**：世界概览面板，以标签页形式展示游戏世界信息

**职责**：
- 显示人物列表（玩家角色和 NPC）
- 显示地域列表（区域及其包含的地点）
- 显示组织列表
- 点击列表项打开对应的详情 Modal
- 支持 i18n 国际化

**技术实现**：
- 使用 `createPortal` 渲染到 `document.body`
- 标签页切换：`creatures` | `regions` | `organizations`

**Props**：
- `open` / `onClose` - 开关控制
- `creaturesMap` / `regionsMap` / `organizationsMap` - 数据来源
- `onShowCreature` / `onShowLocation` / `onShowOrganization` - Modal 触发器

---

### 6. 共享组件（来自 `../components`）

系统还使用了以下来自上层的共享组件：

#### 6.1 `CreaturePanel` (`../../components/CreaturePanel.tsx`)
- 显示角色属性面板（HP、MP、经验值等）
- 显示技能、物品、装备、状态
- 显示关系和日志

**样式来源**：`../../components/CreaturePanel.css`

#### 6.2 游戏模态框集合 (`../components`)
- `InfoModal` - 通用信息展示
- `CreatureModal` - 角色详情
- `OrganizationModal` - 组织详情
- `LocationModal` - 地点详情
- `EntryModal` - 词条详情（支持词条间跳转）

**样式来源**：`../components/GameModals.css`

---

## 🎣 自定义 Hooks

### `hooks.tsx`

#### `useHighlightEntities()`

**功能**：在文本中高亮显示实体名称

**返回值**：
- `highlightEntitiesInText(text, keyPrefix)` - 高亮实体（角色、组织、地点、词条）
- `highlightCreatureNames(text)` - 高亮对话和实体

**实现细节**：
1. 从 `registryStore` 获取所有注册表（角色、组织、地点、词条）
2. 按名称长度排序（避免短名称误匹配）
3. 使用正则表达式匹配所有实体名称
4. 为不同类型的实体添加不同的高亮样式和点击事件
5. 对对话文本（多种引号样式：""、""、「」、''、''）单独处理，应用 `.dialogue-text` 样式

**样式类**：
- `.creature-name-highlight` - 角色名高亮
- `.organization-name-highlight` - 组织名高亮
- `.location-name-highlight` - 地点名高亮
- `.entry-name-highlight` - 词条名高亮
- `.dialogue-text` - 对话文本样式
- `.entry-button` - 词条查询按钮

#### `useGameRegistries()`

**功能**：构建 registries 对象供模态框组件使用

**实现细节**：
- 整合 `registryStore` 中的技能、物品、招式注册表
- 整合 `creatureStore` 中的角色、组织映射
- 返回统一的 `registries` 对象供共享模态框组件消费
- 使用 `useMemo` 缓存

### `hooks/useTypewriter.ts`

#### `useTypewriter(text, enabled, charsPerSecond)`

**功能**：打字机效果，逐字显示文本

**参数**：
- `text: string` - 完整文本（可在流式生成中增长）
- `enabled: boolean` - 是否启用动画（一旦启用不可中断）
- `charsPerSecond: number` - 显示速度（默认 40 字/秒）

**返回值**：
- `visibleText: string` - 当前可见文本
- `isComplete: boolean` - 动画是否完成

**行为特点**：
- 一旦激活（`enabled=true`），动画持续到自然完成，不受后续 `enabled` 变化影响
- 未激活时直接显示全部文本（用于历史回合）
- 以 50ms 间隔更新（20fps），性能友好
- 支持流式文本增长（文本变长时继续动画）
- 不提供手动跳过功能

---

## 🗄️ 状态管理（Zustand Stores）

### 1. gameStore (`stores/gameStore.ts`)

**职责**：管理游戏核心逻辑

**状态**：
- `gameStarted` - 游戏是否已开始
- `backgroundStory` - 背景故事
- `startStory` - 开场故事
- `inkTurns` - 游戏回合数组
- `turnCounter` - 回合计数器
- `currentPhase` - 当前阶段：`'idle'` | `'generating-story'` | `'updating-state'` | `'waiting-choice'` | `'dice-rolling'`
- `playerInput` - 玩家自定义输入
- `showCustomInput` - 是否显示自定义输入框
- `pendingChoiceTurnId` - 等待玩家选择的回合 ID
- `errorInfo` - 错误信息（含重试方法）
- `diceState` - 掷骰状态（选项、骰子阶段、骰点结果、滚动回调）
- `turnIdRef` - 内部回合 ID 引用
- `currentRequestId` - 当前请求 ID（防止并发请求冲突）

**掷骰系统方法**：
- `rollDice()` - 掷骰（600ms 动画延迟）
- `retryDice()` - 重试掷骰（仅首次失败可用）
- `confirmDiceResult()` - 确认结果，继续生成故事
- `cancelDice()` - 取消掷骰，返回选择界面

**核心方法**：
- `buildHistoryText()` - 构建历史文本（取最近两轮，含章节、变更、导演建议）
- `saveToState()` - 保存故事到状态（含检查点 ID）
- `handleChoiceSelect()` - 处理玩家选择：
  - 若 `diceMode='visible'` 且选项有难度 → 进入掷骰阶段
  - 若 `diceMode='hidden'` → 隐式掷骰
  - 否则 → 直接生成故事
- `handleCustomInput()` - 处理自定义输入（若 `diceMode!='off'` 则隐式掷骰）
- `generateStory()` - 流式生成故事内容（含掷骰结果传递）
- `retryUpdateGameState()` - 重试更新游戏状态（含回滚到临时存档）
- `startGame()` - 开始游戏
- `clearStoryHistory()` - 清空剧情历史
- `loadInitialData()` - 加载初始数据
- `loadStoryHistory()` - 加载剧情历史
- `reset()` - 重置所有状态

**调用的服务**（通过 `../../utils` 封装函数）：
- `creativeWritingStream()` - 流式生成故事内容
- `updateGameStateAndDocs()` - 更新游戏状态和文档
- `setNewStoryHistory()` - 保存剧情历史
- `getStoryHistory()` - 获取剧情历史
- `clearStoryHistory()` - 清空剧情历史
- `getGameState()` - 获取完整游戏状态
- `createSave()` - 创建存档检查点
- `loadSave()` - 加载存档（回滚用）

---

### 2. creatureStore (`stores/creatureStore.ts`)

**职责**：管理角色和实体相关数据

**状态**：
- `playerEntity` - 玩家实体
- `playerLoading` - 玩家数据加载中
- `creaturesMap` - 所有角色映射表
- `organizationsMap` - 所有组织映射表
- `regionsMap` - 所有地域映射表
- `gameTime` - 游戏时间

**核心方法**：
- `refreshCreatures()` - 刷新角色数据（玩家 + NPC）
- `loadEntityMaps()` - 加载实体映射表（组织、地域、游戏时间）
- `reset()` - 重置所有状态

**调用的服务**：
- `getPlayerEntity()` - 获取玩家实体
- `getNPCEntities()` - 获取所有 NPC
- `getGameState()` - 获取游戏状态（包含组织、地域）

---

### 3. registryStore (`stores/registryStore.ts`)

**职责**：管理游戏注册表数据

**状态**：
- `skillsRegistry` - 技能注册表
- `itemsRegistry` - 物品注册表
- `movesRegistry` - 招式注册表
- `customComponentRegistry` - 自定义组件定义注册表
- `organizationsRegistry` - 组织名称注册表
- `creaturesRegistry` - 角色名称注册表
- `locationsRegistry` - 地点名称注册表（含描述）
- `regionsRegistry` - 地域名称注册表
- `entriesMap` - 游戏词条映射表
- `attrFields` - 角色属性字段定义（`CreatureAttrField[]`，来自后端注册）

**核心方法**：
- `loadRegistries()` - 一次性加载所有注册表（含自定义组件注册表和属性字段定义）
- `reset()` - 重置所有状态

**调用的服务**：
- `getGameState()` - 获取完整游戏状态（包含所有注册表）

---

### 4. modalStore (`stores/modalStore.ts`)

**职责**：管理所有模态框的状态

**管理的模态框**：
- 思考过程模态框（`thinkingModal`）
- 信息模态框（`infoModal`）
- 角色模态框（`creatureModal`）
- 组织模态框（`organizationModal`）
- 地点模态框（`locationModal`）
- 词条模态框（`entryModal`）
- 发布模态框（`publishModal`）
  - `publishStartTurn` / `publishEndTurn` - 发布章节范围
  - `publishTitle` - 文章标题
  - `publishVisibility` - 可见性（`PUBLIC` | `PRIVATE` | `UNLISTED`）
  - `publishing` - 发布中状态

**核心方法**：
- 每个模态框都有对应的 `open` 和 `close` 方法
- 角色/组织/地点模态框的 `open` 方法会从 `creatureStore` 查找实体
- 发布模态框有额外的 setter 方法（标题、可见性等）

---

### 5. uiStore (`stores/uiStore.ts`)

**职责**：管理 UI 界面状态与用户偏好

**类型定义**：
- `NarrativePerson` = `'second'` | `'third'` — 叙事人称
- `DiceMode` = `'off'` | `'visible'` | `'hidden'` — 掷骰模式

**状态**：
- `isLeftPanelOpen` - 左侧面板是否打开
- `isWorldOverviewOpen` - 世界概览面板是否打开
- `collapsedSections` - 折叠区域状态映射表
- `totalParagraphs` - 生成段落数（10-24，默认 18）
- `typewriterSpeed` - 打字机速度（20-120 字/秒，默认 20）
- `narrativePerson` - 叙事人称（`'second'`=第二人称 / `'third'`=第三人称，默认 `'second'`）
- `diceMode` - 掷骰模式（默认 `'visible'`）

**掷骰模式说明**：
- `'off'` - 不使用掷骰系统
- `'visible'` - 有难度的选项触发可见掷骰面板；自定义输入触发隐式掷骰
- `'hidden'` - 所有行动（选项+自定义）都隐式掷骰，结果不展示给玩家

**核心方法**：
- `setIsLeftPanelOpen()` / `toggleLeftPanel()` - 控制左侧面板
- `toggleWorldOverview()` / `closeWorldOverview()` - 控制世界概览面板
- `toggleSection(sectionId)` - 切换指定区域的折叠状态
- `isCollapsed(sectionId, autoCollapsed)` - 判断区域是否折叠
- `setTotalParagraphs(count)` - 设置段落数（限制 10-24）
- `setTypewriterSpeed(speed)` - 设置打字机速度（限制 20-120）
- `setNarrativePerson(person)` - 设置叙事人称
- `setDiceMode(mode)` - 设置掷骰模式

**持久化**：
- `typewriterSpeed`、`narrativePerson`、`diceMode`、`totalParagraphs` 通过 `localStorage`（key: `'ink-ui-prefs-v2'`）持久化

---

## 🎨 样式文件

### 1. 主样式 (`InkGame.css`)

**涵盖范围**：
- 全局重置和基础样式
- 滚动条美化
- 顶部导航栏样式
- 主布局（左侧面板、右侧内容区）
- 小说流容器和回合块
- 章节标题、故事内容、对话文本
- 可折叠区域（RAG 收集器、推理、思考、变更建议、状态更新）
- 掷骰判定面板样式
- 世界概览面板
- 玩家选项和自定义输入
- 设置面板（人称、骰子、段落、速度）
- 模态框基础样式
- 响应式设计（移动端适配）

**关键样式类**：
```css
.ink-game                    /* 主容器 */
.ink-header                  /* 顶部栏 */
.ink-layout                  /* 主布局 */
.left-panel                  /* 左侧面板 */
.right-panel                 /* 右侧内容区 */
.ink-flow                    /* 小说流容器 */
.ink-turn                    /* 单个回合 */
.story-block                 /* 故事块 */
.novel-content               /* 小说内容 */
.dialogue-text               /* 对话文本高亮 */
.creature-name-highlight     /* 角色名高亮 */
.organization-name-highlight /* 组织名高亮 */
.location-name-highlight     /* 地点名高亮 */
.entry-name-highlight        /* 词条名高亮 */
.collapsible-section         /* 可折叠区域 */
.dice-roll-container         /* 掷骰面板 */
.dice-difficulty-bar         /* 难度条 */
.dice-roll-marker            /* 骰点标记 */
.dice-result-display         /* 掷骰结果 */
.world-overview-overlay      /* 世界概览遮罩 */
.world-overview-panel        /* 世界概览面板 */
.player-choices-container    /* 玩家选项容器 */
.choice-button               /* 选项按钮 */
.next-direction-hint         /* 导演建议 */
.modal-overlay               /* 模态框遮罩 */
.modal-content               /* 模态框内容 */
```

**样式特点**：
- 深色科幻主题（#0d1117 背景）
- 使用径向渐变和半透明效果
- 字体：'Noto Serif SC'（宋体）用于正文
- 流畅的动画过渡（`transition`）
- 响应式布局（移动端优化）

---

### 2. 游戏模态框样式 (`../components/GameModals.css`)

**涵盖范围**：
- 通用模态框容器
- 角色模态框样式
- 组织模态框样式
- 地点模态框样式
- 词条模态框样式
- 信息模态框样式

**关键样式类**：
```css
.game-modal-overlay          /* 模态框遮罩 */
.game-modal                  /* 模态框容器 */
.game-modal-header           /* 模态框标题栏 */
.game-modal-content          /* 模态框内容 */
.creature-modal              /* 角色模态框 */
.organization-modal          /* 组织模态框 */
.location-modal              /* 地点模态框 */
.entry-modal                 /* 词条模态框 */
```

---

### 3. 角色面板样式 (`../../components/CreaturePanel.css`)

**涵盖范围**：
- 角色属性展示（HP、MP、等级）
- 技能、物品、装备列表
- 状态效果显示
- 关系和日志

---

## 📡 API 调用与服务

### 封装服务函数（`../../utils`）

Ink 系统通过 `../../utils` 中的封装函数调用后端服务：

#### 1. 游戏状态服务
```typescript
getGameState()
// 返回：完整的游戏状态（World、Creatures、Regions、Organizations、GameWikiEntry、Registry 等）

getPlayerEntity()
// 返回：玩家实体数据

getNPCEntities()
// 返回：所有 NPC 实体数据
```

#### 2. 创意写作服务（流式）
```typescript
creativeWritingStream({
  create_request: string,        // 创作请求（含提示词）
  thinking_instruction: string,  // 思考指令
  previous_content_overview: string, // 历史内容摘要
  callback: (event) => void,    // 流式事件回调
  output_content_schema: string  // 输出内容 schema
})
// 流式生成故事内容，通过 callback 接收事件
```

#### 3. 游戏状态更新服务
```typescript
updateGameStateAndDocs({
  new_event: string,             // 新事件描述
  state_changes: string[],      // 状态变更列表
  setting_changes: string[]     // 设定变更列表
})
// 返回：UpdateGameStateAndDocsOutput
```

#### 4. 存档服务
```typescript
createSave({ title: string, description: string })
// 创建存档检查点，返回 checkpointId

loadSave(checkpointId: string)
// 加载指定存档（用于回滚）
```

#### 5. 剧情历史服务
```typescript
getStoryHistory()
// 获取剧情历史

setNewStoryHistory({ turn_id, data: { content, checkpoint_id } })
// 保存新的剧情历史

clearStoryHistory()
// 清空剧情历史（需用户确认）
```

---

## 🔄 数据流

### 初始化流程
```
1. useEffect (初始化)
   ├─> loadInitialData() - 加载游戏初始数据（背景故事等）
   ├─> loadRegistries() - 加载所有注册表（含属性字段定义）
   ├─> refreshCreatures() - 刷新角色数据
   ├─> loadEntityMaps() - 加载实体映射表
   └─> loadStoryHistory() - 加载剧情历史
```

### 故事生成流程
```
1. 玩家选择/自定义输入
   ├─> handleChoiceSelect() / handleCustomInput()
   │   ├─> [diceMode=visible + 有难度] 进入掷骰阶段
   │   │   ├─> rollDice() → 600ms 动画 → 显示结果
   │   │   ├─> [失败] retryDice() → 重试一次
   │   │   └─> confirmDiceResult() → generateStory(action, diceResult)
   │   ├─> [diceMode=hidden] 隐式掷骰 → generateStory(action, diceResult)
   │   └─> [diceMode=off 或无难度] generateStory(action)
   └─> generateStory(action, diceResult?)
       ├─> 递增 requestId（防并发）
       ├─> 创建 PlayerActionTurn
       ├─> 创建 StoryTurn（初始状态）
       └─> creativeWritingStream()
           ├─> 接收流式事件
           │   ├─> reasoning (推理 + RAG 收集)
           │   ├─> result_update / collector_result_update (渐进更新)
           │   ├─> thinking (AI 思考)
           │   ├─> success (完成，启用打字机)
           │   └─> error (错误)
           └─> complete 事件触发后续流程：
               └─> [异步] 游戏状态更新
                   ├─> createSave() - 创建临时存档（回滚保护）
                   ├─> updateGameStateAndDocs() - 更新状态
                   ├─> 失败 → loadSave() 回滚到临时存档
                   ├─> 成功 → createSave() 创建正式存档
                   ├─> refreshCreatures() + loadRegistries() + loadEntityMaps()
                   └─> saveToState() - 保存剧情历史
```

### 状态同步流程
```
1. 用户触发操作（如打开角色面板）
   └─> 从 creatureStore 获取 playerEntity
       └─> 如果需要刷新
           └─> refreshCreatures()
               └─> getPlayerEntity() + getNPCEntities()
                   └─> 更新 creatureStore
```

---

## 📦 类型定义 (`types.ts`)

### 核心类型

#### 1. 基础回合
```typescript
interface BaseTurn {
  id: number
}
```

#### 2. 故事回合
```typescript
interface StoryTurn extends BaseTurn {
  type: 'story'
  content: string              // 第一节内容
  contentPart2?: string        // 第二节内容
  chapterHint?: string
  reasoning?: string           // 大模型推理输出
  thinking?: string
  collectorResults?: CollectorResult[]
  collectorOutline?: string      // Collector 全局分析摘要
  settingChanges?: string[]
  stateChanges?: string[]
  updateGameStateResult?: UpdateGameStateAndDocsOutput
  playerChoices?: PlayerChoice[]
  allowCustomInput?: boolean   // 是否允许自定义输入
  nextDirection?: string       // 导演建议（下一步方向提示）
  generationPhase?: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done'
  typewriterEnabled?: boolean  // 是否启用打字机动画
  relatedActionId?: number     // 关联的行动回合 ID
  checkpointId?: string        // 存档检查点 ID
}
```

#### 3. 玩家行动回合
```typescript
interface PlayerActionTurn extends BaseTurn {
  type: 'action'
  playerAction: string
  selectedChoice?: PlayerChoice
  isCustomInput?: boolean
  diceResult?: DiceResult      // 掷骰结果
}
```

#### 4. 系统回合
```typescript
interface SystemTurn extends BaseTurn {
  type: 'system'
  logs?: string[]
  luaCode?: string
  summary?: string
}
```

#### 5. 错误回合
```typescript
interface ErrorTurn extends BaseTurn {
  type: 'error'
  errorMessage: string
  relatedActionId?: number
  retryAction?: () => void
}
```

#### 6. 联合类型与类型守卫
```typescript
type InkTurn = StoryTurn | PlayerActionTurn | SystemTurn | ErrorTurn

function isStoryTurn(turn: InkTurn): turn is StoryTurn
function isPlayerActionTurn(turn: InkTurn): turn is PlayerActionTurn
function isErrorTurn(turn: InkTurn): turn is ErrorTurn
```

#### 7. 玩家选项
```typescript
interface PlayerChoice {
  name: string
  description: string
  is_special: boolean
  difficulty_level?: number    // 0-100，掷骰难度
  difficulty_reason?: string   // 难度原因说明
}
```

#### 8. 掷骰结果
```typescript
interface DiceResult {
  difficulty: number
  roll: number                 // 0-100
  success: boolean
  retried: boolean
  retryRoll?: number
}
```

#### 9. RAG 收集器结果
```typescript
interface CollectorResult {
  entity_id: string
  selected: boolean
  thinking: string              // 紧凑模式下为空字符串
  documents?: Array<{
    path: string
    selected: boolean
    thinking: string            // 紧凑模式下为空字符串
    flag_is_thinking_instruction?: boolean
    flag_is_writing_instruction?: boolean
    flag_is_updating_instruction?: boolean
  }>
}
// StoryTurn.collectorOutline 存储 Collector 的全局分析摘要（替代分散的 per-entity/per-doc thinking）
```

#### 10. 剧情历史数据
```typescript
interface StoryHistoryData {
  player?: {
    id: number
    playerAction: string
    selectedChoice?: PlayerChoice
    isCustomInput?: boolean
    diceResult?: DiceResult
  }
  story: {
    id: number
    content: string
    contentPart2?: string
    chapterHint?: string
    reasoning?: string
    thinking?: string
    collectorResults?: CollectorResult[]
    settingChanges?: string[]
    stateChanges?: string[]
    playerChoices?: PlayerChoice[]
    allowCustomInput?: boolean
    nextDirection?: string
    checkpointId?: string
    updateGameStateResult?: UpdateGameStateAndDocsOutput
  }
}
```

#### 11. 游戏时间
```typescript
interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}
```

#### 12. 注册表类型
```typescript
interface SkillInfo {
  name: string
  description?: string
  details?: string[]
}

interface ItemInfo {
  name: string
  description?: string
  detail?: string[]
}

interface MoveInfo {
  name: string
  desc: string
  details: string[]
}

interface CustomComponentDefInfo {
  component_key: string
  component_name: string
  is_array: boolean
  type_schema?: TypeSchema
}

interface InfoModalContent {
  title: string
  content: string | React.ReactNode
}
```

---

## 🎯 功能总结

### 已实现的核心功能

1. **互动式故事生成**
   - 基于 LLM 的流式故事生成
   - 支持玩家选择和自定义输入
   - 实时显示生成进度（收集、推理、思考、写作）
   - 打字机逐字显示效果（速度可调）

2. **掷骰判定系统**
   - 三种模式：关闭 / 可见 / 隐式
   - 可见模式：显示难度条、骰点标记、动画
   - 支持失败后重试一次
   - 隐式模式：后台掷骰，玩家不感知

3. **智能内容高亮**
   - 自动识别并高亮角色、组织、地点名称
   - 对话文本特殊样式（支持多种引号格式）
   - 词条悬浮提示和跳转

4. **RAG 知识检索**
   - 自动收集相关实体和文档
   - 显示 AI 的检索思考过程
   - 可折叠查看详细信息

5. **游戏状态管理**
   - 根据剧情自动更新游戏状态
   - 支持状态更新失败重试（含回滚保护）
   - 显示状态变更建议
   - 临时存档和回滚保护

6. **剧情历史管理**
   - 保存和加载剧情历史
   - 清空剧情功能
   - 文章发布功能
   - 存档检查点系统（时光倒流）

7. **游戏设置**
   - 叙事人称切换（第二/第三人称）
   - 掷骰模式切换
   - 段落数量调节（10-24）
   - 打字机速度调节（20-120 字/秒）
   - 设置通过 localStorage 持久化

8. **世界概览**
   - 人物、地域、组织的概览面板
   - 点击查看详情
   - 支持国际化

9. **响应式 UI**
   - 左侧角色面板可折叠
   - 各类内容区域可折叠（用户偏好记忆）
   - 移动端适配

---

## 🚀 技术栈

- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Zustand** - 状态管理（5 个独立 store）
- **CSS3** - 样式（不使用 CSS-in-JS）
- **react-i18next** - 国际化
- **Web APIs** - 流式数据、本地存储

---

## 📝 开发建议

### 添加新功能
1. 在 `types.ts` 中定义类型
2. 在对应的 store 中添加状态和方法
3. 在组件中使用 store
4. 在 `InkGame.css` 中添加样式

### 性能优化
- 使用 `useMemo` 缓存计算结果
- 使用 `useCallback` 缓存回调函数
- 避免不必要的状态更新

### 样式规范
- 使用 BEM 命名规范
- 保持样式文件与组件对应
- 复用通用样式类

---

## 📚 相关文档

- [核心 API 文档](../../CORE_API.md)
- [可用性改进计划](../../docs/USABILITY_IMPROVEMENTS.md)
- [Zustand 重构计划](../../docs/ZUSTAND_REFACTOR_PLAN.md)

---

**文档版本**：3.0
**最后更新**：2026-03-02
**维护者**：Ink 开发团队
