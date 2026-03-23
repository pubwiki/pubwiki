# 前端编辑器易用性改进计划

> 本文档用于规划和追踪编辑器的易用性改进。每个改进项包含问题描述、涉及文件、实施方案和验收标准。

---

## 总览

### 高优先级

| # | 改进项 | 状态 | 涉及文件数 | 复杂度 |
|---|--------|------|-----------|--------|
| 1 | [Toast 通知系统](#1-toast-通知系统) | ✅ 已完成 | ~4 | 中 |
| 2 | [脏数据标记 & 离开警告](#2-脏数据标记--离开警告) | ✅ 已完成 | ~2 | 低 |
| 3 | [LocalStorage 自动保存](#3-localstorage-自动保存) | ✅ 已完成 | ~2 | 低 |
| 4 | [游戏启动对话框 i18n](#4-游戏启动对话框-i18n) | ✅ 已完成 | ~4 | 中 |
| 5 | [折叠侧边栏 Tooltip 修复](#5-折叠侧边栏-tooltip-修复) | ✅ 已完成 | ~2 | 低 |

### 中优先级

| # | 改进项 | 状态 | 涉及文件数 | 复杂度 |
|---|--------|------|-----------|--------|
| 6 | [异步操作 Loading 状态](#6-异步操作-loading-状态) | ✅ 已完成 | ~3 | 低 |
| 7 | [搜索过滤增强（防抖+排序）](#7-搜索过滤增强防抖排序) | ✅ 已完成 | ~5 | 中 |
| 8 | [快捷键帮助对话框](#8-快捷键帮助对话框) | ✅ 已完成 | ~1 | 低 |
| 9 | [表单内联验证](#9-表单内联验证) | ✅ 已完成 | ~3 | 低 |
| 10 | [撤销/重做步数显示](#10-撤销重做步数显示) | ✅ 已完成 | ~2 | 低 |

---

## 1. Toast 通知系统

### 问题

当前所有用户反馈（撤销、重做、保存成功等）都通过 `showAlert()` 实现，这是一个**阻塞式模态弹窗**，用户必须点击"确定"才能继续操作。

典型问题场景：
- 连续 Ctrl+Z 撤销三次 → 弹出三个阻塞对话框
- 保存时先弹"正在保存..."需要点确认，再弹"保存成功"又要点确认

### 当前代码

```
src/components/StateDataEditor.tsx
├── L124: showAlert(t('common:undone'))         ← 撤销反馈
├── L134: showAlert(t('common:redone'))         ← 重做反馈
├── L521: showAlert(t('game.savingToGame'))     ← 保存中提示
├── L523: showAlert(t('game.savedToGame'))      ← 保存成功提示
└── L525: showAlert(t('game.saveFailed', ...))  ← 保存失败（这个应保留为弹窗）

src/components/AlertDialog.tsx
└── showAlert() — 单例模态弹窗，一次只能显示一个
```

### 实施方案

- [ ] 新建 `src/components/Toast.tsx` + `Toast.css`
  - 轻量级 Toast 组件，支持 `success` / `info` / `error` 三种类型
  - 自动消失（默认 2 秒），支持手动关闭
  - 最多同时显示 3 条，从底部向上堆叠
  - 导出 `showToast(message, type?)` 命令式 API，与 `showAlert` 风格一致
- [ ] 在 `App.tsx` 中挂载 `<ToastProvider />`
- [ ] 替换 `StateDataEditor.tsx` 中非关键的 `showAlert` 调用为 `showToast`
  - 撤销/重做 → `showToast(message, 'info')`
  - 保存成功 → `showToast(message, 'success')`
  - 保存中提示 → 直接移除（改为按钮 loading 态）
  - 保存失败 → 保留 `showAlert`（需要用户确认）
- [ ] 检查其他组件中的 `showAlert` 调用，将信息性提示改为 Toast

### 验收标准

- [ ] Ctrl+Z 连续撤销不弹出阻塞对话框，底部出现自动消失的 Toast
- [ ] 保存成功后显示 Toast，不阻塞操作
- [ ] 保存失败仍弹出 showAlert 让用户确认
- [ ] Toast 在移动端正常显示

---

## 2. 脏数据标记 & 离开警告

### 问题

编辑器没有任何视觉标记告诉用户"数据已修改但未保存"。用户可能编辑了大量内容后刷新页面，数据直接丢失，没有任何拦截。

### 当前代码

```
src/components/StateDataEditor.tsx
├── L50: const STORAGE_KEY = 'state-data-editor-data'  ← 已定义但未使用
├── data 状态通过 setData() 更新
└── 无任何 isDirty 跟踪逻辑
```

### 实施方案

- [ ] 在 `StateDataEditor.tsx` 中添加 `savedDataRef` (useRef)
  - 每次成功保存后更新 `savedDataRef.current = data`
  - 初始化时设为传入的 `initialData`
- [ ] 添加 `isDirty` 派生状态：`JSON.stringify(data) !== JSON.stringify(savedDataRef.current)`
  - 考虑用浅比较或 hash 优化性能（数据量大时 stringify 可能慢）
- [ ] 工具栏标题旁显示未保存标记
  - `isDirty` 时在标题后显示 `●` 圆点或 `*` 星号
  - 保存按钮在有未保存更改时高亮显示
- [ ] 添加 `beforeunload` 事件监听
  - `isDirty` 时拦截页面关闭/刷新，弹出浏览器原生确认对话框
- [ ] 撤销/重做后正确更新 dirty 状态

### 验收标准

- [ ] 修改任意字段后，标题栏出现未保存标记
- [ ] 保存后标记消失
- [ ] 有未保存更改时关闭/刷新页面，浏览器弹出确认对话框
- [ ] 撤销到原始状态后，标记正确消失

---

## 3. LocalStorage 自动保存

### 问题

编辑器的历史记录和数据完全存储在 React 内存状态中。刷新页面后所有未保存的编辑和撤销历史全部丢失。`STORAGE_KEY` 和 `HISTORY_STORAGE_KEY` 虽然已定义，但从未被使用。

### 当前代码

```
src/components/StateDataEditor.tsx
├── L50: const STORAGE_KEY = 'state-data-editor-data'         ← 未使用
├── L52: const HISTORY_STORAGE_KEY = 'state-data-editor-history'  ← 未使用
├── data / history / historyIndex 全是 useState，刷新即丢
└── L51: TAB_STORAGE_KEY — 唯一实际用到 localStorage 的
```

### 实施方案

- [ ] 添加自动保存 `useEffect`
  - 监听 `data` 变化，debounce 30 秒写入 `localStorage[STORAGE_KEY]`
  - 记录自动保存时间戳
- [ ] 添加历史记录持久化（可选，视数据量）
  - 将 `history` 和 `historyIndex` 保存到 `sessionStorage`（而非 localStorage，避免跨标签页冲突）
  - 限制持久化历史条目数量（最多 20 条）
- [ ] 启动时恢复逻辑
  - 检测 localStorage 中是否有自动保存的数据
  - 如果有且比 `initialData` 更新，提示用户"发现自动保存的数据，是否恢复？"
  - 用 `showChoice` 让用户选择：恢复自动保存 / 使用游戏数据 / 丢弃
- [ ] 在工具栏或状态栏显示"上次自动保存：xx:xx"

### 验收标准

- [ ] 编辑数据后等待 30 秒，刷新页面，提示恢复自动保存
- [ ] 选择恢复后数据正确还原
- [ ] 选择丢弃后使用游戏原始数据
- [ ] 状态栏显示自动保存时间
- [ ] 正常保存到游戏后，清除自动保存的 localStorage 数据

---

## 4. 游戏启动对话框 i18n

### 问题

`StateDataEditor.tsx` 中约 L910-L1280 的游戏启动两步对话框，**所有 UI 文字都是硬编码中文**，完全没有通过 `t()` 翻译函数。英文和日文用户看到的是纯中文界面。

### 涉及字符串（约 30+ 处）

**第一步 - 选择数据来源：**
- 标题：`🎮 启动游戏 - 选择数据来源`
- 副标题：`选择要使用的游戏数据来源：`
- 选项：`编辑器最新数据`、`游戏内最新数据`
- 描述：`使用当前编辑器中的数据启动游戏（推荐）`、`直接使用游戏中已有的数据...`
- 本地存档区：`📁 本地存档`、`暂无本地存档`、`· X 角色`
- 警告框：`您的编辑器改动可能丢失`、`如果您在编辑器中有未保存的改动...`
- 按钮：`💾 保存当前编辑器数据`、`取消`、`下一步 →`

**第二步 - 选择游戏前端：**
- 标题：`🎮 选择游戏前端`
- 数据来源摘要行
- 游戏卡片：`测试游戏` / `Ink 互动小说` / `自定义游戏` 及其描述
- 按钮：`← 返回`

### 实施方案

- [ ] 在 `locales/en/editor.json`、`locales/zh/editor.json`、`locales/ja/editor.json` 中添加 `gameLaunch` 命名空间的翻译键
  ```json
  "gameLaunch": {
    "title": "Launch Game - Select Data Source",
    "subtitle": "Choose the game data source:",
    "editorData": "Editor Latest Data",
    "editorDataDesc": "Launch game with current editor data (recommended)",
    "gameData": "In-Game Latest Data",
    "gameDataDesc": "Use existing in-game data without editor changes",
    "localSaves": "Local Saves",
    "localSavesCount": "({{count}} saves)",
    "noLocalSaves": "No local saves",
    "creaturesCount": "· {{count}} characters",
    "warningTitle": "Your editor changes may be lost",
    "warningDesc": "If you have unsaved changes in the editor, they will not be preserved with this option.",
    "saveEditorData": "Save Current Editor Data",
    "cancel": "Cancel",
    "next": "Next →",
    "selectFrontend": "Select Game Frontend",
    "dataSource": "Data source",
    "testGame": "Test Game",
    "testGameDesc": "Development testing frontend",
    "inkGame": "Ink Interactive Fiction",
    "inkGameDesc": "Choice-driven interactive story",
    "customGame": "Custom Game",
    "customGameDesc": "Blank game template",
    "back": "← Back"
  }
  ```
- [ ] 在 `StateDataEditor.tsx` 中将所有硬编码中文替换为 `t('gameLaunch.xxx')`
- [ ] 编写中文和日文翻译
- [ ] 测试三种语言下对话框显示

### 验收标准

- [ ] 切换到英文/日文后，游戏启动对话框完全翻译，无中文残留
- [ ] 中文环境下显示与当前一致
- [ ] 带插值的字符串（如存档数量、角色数量）正确显示

---

## 5. 折叠侧边栏 Tooltip 修复

### 问题

侧边栏折叠后，鼠标悬停在图标上**不显示任何标签名称**。用户完全无法识别每个图标对应的功能。

### 当前代码

```
src/components/state-editor/EditorSidebar.tsx
├── L152-157: "长按提示" tooltip 仅在 isExpanded 时显示
├── 导航按钮上没有 title 属性，也没有 data-tooltip
└── 折叠态下只有图标，无任何文字提示

src/styles/editor/sidebar.css
├── L267-285: .sidebar-nav-item[data-tooltip]::after 样式已写好
└── 但 JSX 中从未设置 data-tooltip 属性 → 样式永远不生效
```

### 实施方案

- [ ] 在 `EditorSidebar.tsx` 的导航按钮上添加属性
  - 方案 A（CSS tooltip）：添加 `data-tooltip={item.label}` + `aria-label={item.label}`
  - 方案 B（原生 tooltip）：添加 `title={item.label}` + `aria-label={item.label}`
  - **推荐方案 A**，与已有的 CSS 样式配合，视觉更一致
- [ ] 确保 CSS tooltip 仅在折叠态 (`!isExpanded`) 时显示
  - 展开态已经有文字标签，不需要 tooltip
- [ ] 验证 `sidebar.css` 中的 `::after` 伪元素样式是否正确定位
  - tooltip 应出现在图标右侧
  - 需要有适当的 z-index 和过渡动画

### 验收标准

- [ ] 折叠侧边栏后，悬停每个图标都显示对应名称 tooltip
- [ ] 展开侧边栏时不显示多余 tooltip
- [ ] tooltip 在深色主题下清晰可读
- [ ] 屏幕阅读器能正确朗读 aria-label

---

## 实施顺序建议

```
第一批（基础设施）：
  #1 Toast 通知系统  ← 其他改进会依赖它
  #5 侧边栏 Tooltip  ← 最简单，可快速完成

第二批（数据安全）：
  #2 脏数据标记
  #3 自动保存       ← 依赖 #2 的 isDirty 逻辑

第三批（国际化）：
  #4 游戏启动对话框 i18n  ← 独立，随时可做
```

---

---

## 6. 异步操作 Loading 状态

### 问题

Save/Load 等异步操作无 loading 指示，按钮不禁用，用户可能重复点击。

### 实施

- `buttons.css`：添加 `.btn-loading` 类 + CSS spinner 动画（`::after` 伪元素）
- `StateDataEditor.tsx`：添加 `isSaving` / `isLoadingFromGame` state
- 保存按钮添加 `disabled` + `btn-loading` 类，下拉菜单中加载/保存按钮同步禁用

---

## 7. 搜索过滤增强（防抖+排序）

### 问题

SearchFilter 无防抖（每次按键触发），无排序，搜索影响渲染性能。

### 实施

- `CommonEditors.tsx`：SearchFilter 改为内部 state + 300ms 防抖；添加可选排序 props
- `RegionsEditor.tsx` / `OrganizationsEditor.tsx`：添加 `sortOrder` state + 传入 SearchFilter
- `CreaturesEditor.tsx`：内联搜索添加防抖（useRef/setTimeout）+ 排序下拉框
- `forms.css`：添加 `.search-sort-select` 和 `.search-no-results` 样式

---

## 8. 快捷键帮助对话框

### 问题

快捷键仅在下拉菜单小字显示，不可发现。

### 实施

- `StateDataEditor.tsx`：添加 `showKeyboardShortcuts` 函数
- 快捷键 `Ctrl+/` 触发帮助对话框
- 编辑菜单底部添加"⌨️ 快捷键帮助"菜单项

---

## 9. 表单内联验证

### 问题

表单输入无实时验证反馈，无红色边框或错误消息。

### 实施

- `forms.css`：添加 `.form-input-error`（红色边框）和 `.form-field-error`（红色错误文字）
- `CreaturesEditor.tsx`：角色名 onBlur 验证，空名称显示错误消息
- `CommonEditors.tsx`：属性编辑器添加重复键检测，视觉反馈

---

## 10. 撤销/重做步数显示

### 问题

用户无法知道还能撤销/重做多少步。

### 实施

- `StateDataEditor.tsx`：编辑菜单撤销/重做按钮显示 `(N)` 步数徽章
- `header.css`：添加 `.history-badge` 样式

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-02-25 | 初始文档创建，5 个高优先级改进项 |
| 2026-02-25 | 实现全部 5 个高优先级改进项 |
| 2026-02-25 | 实现全部 5 个中优先级改进项（#6-#10） |
