# Custom Game Architecture (Visual Novel)

## Directory Structure

```
custom/
├── index.tsx                  # 入口：初始化所有 store，渲染开始画面 / VN 主界面 / 模态层
├── types.ts                   # 类型定义：GalTurn, GalDialogue, GalExpression 等
├── hooks.tsx                  # useHighlightEntities（实体高亮）, useGameRegistries
├── GalgameGame.css            # 全部样式（场景、文本框、选项、抽屉、设置等）
├── stores/
│   ├── index.ts               # 统一导出
│   ├── gameStore.ts           # 核心：回合管理、流式生成、存档、状态更新
│   ├── creatureStore.ts       # 玩家 & NPC 实体、游戏时间、导演笔记
│   ├── registryStore.ts       # 技能/物品/招式/组织/地点 等注册表
│   ├── modalStore.ts          # 各种模态框开关状态
│   ├── spriteStore.ts         # 立绘管理（IndexedDB 持久化）
│   └── uiStore.ts             # UI 偏好（打字速度、自动播放、对话行数）
├── hooks/
│   └── useTypewriter.ts       # 复用 ink 的打字机效果 hook
└── components/
    ├── index.ts               # 统一导出
    ├── GalFlow.tsx            # VNPresenter：场景+文本框+控制栏+选项+日志+设置
    ├── Modals.tsx             # PublishModal：发布章节为文章
    └── SpriteManager.tsx      # 立绘上传/删除/导入导出 UI
```

## Data Flow

### 初始化

```
index.tsx useEffect
  → resetStores()
  → loadInitialData()      // 背景故事
  → loadRegistries()       // 技能、物品、生物等注册表
  → refreshCreatures()     // 玩家 + NPC 实体
  → loadEntityMaps()       // 游戏时间、地区、组织
  → loadStoryHistory()     // 恢复之前的剧情进度
  → initSprites()          // 从 IndexedDB 加载立绘
```

### 回合循环

```
1. 玩家选择/输入 → PlayerActionTurn 加入 galTurns[]
2. generateStory() 流式生成 → GalStoryTurn（含 dialogues[], choices[]）
3. 生成完成 → updateGameStateAndDocs() 更新后端状态
4. 刷新实体数据 → 等待下一次玩家选择
```

### 生成阶段 (currentPhase)

- `idle` — 空闲
- `generating-story` — AI 流式生成中（子阶段：collecting → reasoning → thinking → writing）
- `updating-state` — 将剧情变化同步到后端
- `waiting-choice` — 显示选项，等待玩家操作

## Store 职责

| Store | 职责 | 持久化 |
|-------|------|--------|
| gameStore | 回合历史、生成阶段、玩家输入、错误信息 | 后端 checkpoint |
| creatureStore | 玩家/NPC 实体、世界地图、时间 | 后端 state |
| registryStore | 游戏世界元数据（技能、物品、地点等） | 后端 state |
| modalStore | 模态框开关 + 实体引用 | 无 |
| spriteStore | 角色立绘 (creatureId__expression → dataUrl) | IndexedDB |
| uiStore | 打字速度、自动播放延迟、对话行数 | localStorage |

## 组件层级

```
index.tsx
├── 开始画面（未开始时）
│   └── 背景故事 + START 按钮
├── VN 主界面（开始后）
│   ├── VNPresenter          ← GalFlow.tsx
│   │   ├── 场景区（立绘 + 背景描写）
│   │   ├── 文本框（说话人 + 对话 + 打字机效果）
│   │   ├── 选项覆盖层
│   │   ├── VNLogDrawer      ← 历史日志抽屉
│   │   └── VNSettingsPanel  ← 设置面板
│   └── 导航按钮（返回/角色/世界/立绘/发布）
└── 模态层
    ├── CreaturePanel        ← 玩家角色面板
    ├── CreatureModal        ← NPC 详情
    ├── OrganizationModal    ← 组织详情
    ├── LocationModal        ← 地点详情
    ├── EntryModal           ← 百科词条
    ├── InfoModal            ← 通用信息
    ├── PublishModal         ← 发布文章
    ├── WorldOverview        ← 世界总览
    └── SpriteManager        ← 立绘管理
```

## 关键模式

- **流式生成**：`creativeWritingStream()` 通过回调逐步更新 GalStoryTurn 的 dialogues/choices
- **实体高亮**：`useHighlightEntities()` 扫描对话文本，匹配角色/组织/地点名，生成可点击链接
- **立绘系统**：8 种表情 (normal/happy/angry/sad/surprised/shy/disgusted/dazed)，fallback 到 normal
- **错误恢复**：生成失败时创建临时 checkpoint，可回滚重试
