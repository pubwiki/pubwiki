# 🎮 游戏状态编辑器 - 易用性改进计划

## 📁 项目结构

```
front/src/components/
├── StateDataEditor.tsx          # 主编辑器入口，标签页切换，工具栏按钮
├── AlertDialog.tsx              # 对话框工具 (showAlert, showConfirm, showPrompt)
├── GameInitEditor.css           # 主要样式文件
└── state-editor/                # 拆分后的子编辑器模块
    ├── index.ts                 # 统一导出
    ├── types.ts                 # 类型定义、常量、工具函数
    ├── CommonEditors.tsx        # 通用组件 (StringArrayEditor, AttributesEditor, LogEditor...)
    ├── CreatureSubEditors.tsx   # 角色子编辑器 (Skills, Moves, Inventory, Equipment...)
    ├── EntityEditors.tsx        # 实体编辑器 (CreaturesEditor, RegionsEditor, OrganizationsEditor)
    ├── WorldEditor.tsx          # 世界编辑器 (时间、技艺、招式、物品、状态模板)
    ├── OtherEditors.tsx         # 其他 (SettingDocuments, AppInfo, SaveManager...)
    ├── OutlinePanel.tsx         # 大纲导航面板组件
    └── OutlinePanel.css         # 大纲面板样式
```

---

## ✅ 高优先级功能

### 1. 🔍 搜索过滤

**状态**: ✅ 已完成

**目标**: 在角色、地域、组织、物品列表顶部添加搜索框，输入关键词实时过滤

**涉及文件**:
| 文件 | 改动 |
|------|------|
| `EntityEditors.tsx` | 在 `CreaturesEditor`、`RegionsEditor`、`OrganizationsEditor` 中添加搜索状态和过滤逻辑 |
| `WorldEditor.tsx` | 在技艺、招式、物品、状态模板列表中添加搜索 |
| `GameInitEditor.css` | 添加搜索框样式 `.search-input` |

**实现步骤**:
1. 添加 `searchQuery` 状态: `const [searchQuery, setSearchQuery] = useState('')`
2. 添加搜索输入框 UI
3. 使用 `useMemo` 过滤列表: `filteredCreatures = creatures.filter(c => c.name.includes(searchQuery))`
4. 渲染过滤后的列表

**示例代码**:
```tsx
// EntityEditors.tsx - CreaturesEditor 中
const [searchQuery, setSearchQuery] = useState('')

const filteredCreatures = useMemo(() => {
  if (!searchQuery.trim()) return creatures
  const q = searchQuery.toLowerCase()
  return creatures.filter(c => 
    c.Creature?.name?.toLowerCase().includes(q) ||
    c.Creature?.creature_id?.toLowerCase().includes(q)
  )
}, [creatures, searchQuery])

// JSX
<input
  type="text"
  className="search-input"
  placeholder="🔍 搜索角色..."
  value={searchQuery}
  onChange={e => setSearchQuery(e.target.value)}
/>
```

---

### 2. 📋 复制实体

**状态**: ✅ 已完成

**目标**: 每个实体卡片添加"复制"按钮，复制后自动生成新 ID

**涉及文件**:
| 文件 | 改动 |
|------|------|
| `EntityEditors.tsx` | 在 `CreaturesEditor` 中添加 `duplicateCreature` 函数和按钮 |
| `WorldEditor.tsx` | 在技艺、招式、物品、状态模板中添加复制功能 |
| `types.ts` | 添加 `generateUniqueId` 函数（已存在，可复用） |

**实现步骤**:
1. 在实体卡片 header 添加复制按钮 📋
2. 实现深拷贝函数，自动更新 `entity_id` 和关键 ID 字段
3. 将新实体添加到列表末尾并展开

**示例代码**:
```tsx
const duplicateCreature = (index: number) => {
  const original = creatures[index]
  const newId = Math.max(0, ...creatures.map(c => c.entity_id)) + 1
  const copy: CreatureSnapshot = {
    ...JSON.parse(JSON.stringify(original)), // 深拷贝
    entity_id: newId,
    Creature: {
      ...original.Creature,
      creature_id: `${original.Creature?.creature_id}_copy_${Date.now()}`,
      name: `${original.Creature?.name} (副本)`
    }
  }
  onChange([...creatures, copy])
  setExpandedIndex(creatures.length) // 展开新创建的
}

// JSX - 在 item-header 中
<button className="btn-copy" onClick={(e) => { e.stopPropagation(); duplicateCreature(index) }}>
  📋
</button>
```

---

### 3. 💾 折叠状态记忆

**状态**: ✅ 已完成

**目标**: 记住用户展开的角色和区块，刷新页面后自动恢复

**涉及文件**:
| 文件 | 改动 |
|------|------|
| `EntityEditors.tsx` | 在 `CreaturesEditor` 中用 localStorage 保存/恢复展开状态 |
| `WorldEditor.tsx` | 同上 |
| `StateDataEditor.tsx` | 保存当前活动标签页 |

**实现步骤**:
1. 定义存储 key: `'state-editor-expanded-creatures'`
2. 初始化时从 localStorage 读取
3. 状态变化时写入 localStorage
4. 使用 `useEffect` 监听变化

**示例代码**:
```tsx
const STORAGE_KEY = 'state-editor-expanded-creatures'

// 初始化
const [expandedIndex, setExpandedIndex] = useState<number | null>(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved ? JSON.parse(saved).expandedIndex : null
})

// 保存
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ 
    expandedIndex,
    expandedSections: Array.from(expandedSections)
  }))
}, [expandedIndex, expandedSections])
```

---

### 4. ⚡ 快捷键

**状态**: ✅ 已完成

**目标**: 支持 Ctrl+S 保存、Ctrl+Z 撤销

**涉及文件**:
| 文件 | 改动 |
|------|------|
| `StateDataEditor.tsx` | 添加 `useEffect` 监听键盘事件 |

**实现步骤**:
1. 在主组件添加 `keydown` 事件监听
2. 判断组合键并调用对应函数
3. 使用 `e.preventDefault()` 阻止默认行为

**示例代码**:
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') {
        e.preventDefault()
        handleSaveToGame()
      }
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [handleSaveToGame])
```

---

### 5. 🔄 撤销/重做

**状态**: ✅ 已完成

**目标**: 编辑错误时可以回退到之前的状态

**涉及文件**:
| 文件 | 改动 |
|------|------|
| `StateDataEditor.tsx` | 添加历史记录栈和撤销/重做逻辑 |
| `types.ts` | 可选：添加 `useHistory` 自定义 Hook |

**实现步骤**:
1. 维护 `history` 数组和 `historyIndex` 指针
2. 每次 `setData` 时将旧状态推入历史
3. 撤销时回退 index，重做时前进 index
4. 添加工具栏按钮和快捷键

**示例代码**:
```tsx
const [history, setHistory] = useState<StateData[]>([])
const [historyIndex, setHistoryIndex] = useState(-1)

const updateData = (newData: StateData) => {
  // 截断历史（如果在中间位置）
  const newHistory = history.slice(0, historyIndex + 1)
  newHistory.push(data) // 保存当前状态
  setHistory(newHistory)
  setHistoryIndex(newHistory.length - 1)
  setData(newData)
}

const undo = () => {
  if (historyIndex >= 0) {
    setData(history[historyIndex])
    setHistoryIndex(historyIndex - 1)
  }
}

const redo = () => {
  if (historyIndex < history.length - 1) {
    setHistoryIndex(historyIndex + 1)
    setData(history[historyIndex + 1])
  }
}
```

---

## 📊 进度追踪

| # | 功能 | 状态 | 完成日期 |
|---|------|------|----------|
| 1 | 🔍 搜索过滤 | ✅ 已完成 | 2026-01-28 |
| 2 | 📋 复制实体 | ✅ 已完成 | 2026-01-28 |
| 3 | 💾 折叠状态记忆 | ✅ 已完成 | 2026-01-28 |
| 4 | ⚡ 快捷键 | ✅ 已完成 | 2026-01-28 |
| 5 | 🔄 撤销/重做 | ✅ 已完成 | 2026-01-28 |

---

## 📝 备注

- 每完成一个功能后更新状态为 ✅
- 实现顺序建议：1 → 2 → 3 → 4 → 5（按实现难度递增）
- 所有样式统一添加到 `GameInitEditor.css`
