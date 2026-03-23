# Rich Step Output Renderers for World Builder

将每个 World Builder 步骤的输出从原始 JSON 升级为结构化可读的卡片式渲染。

## Proposed Changes

### UI 渲染组件

#### [MODIFY] [StepRenderer.tsx](file:///g:/Projects/avg-game-template/front/src/components/world-builder/StepRenderer.tsx)

为每个步骤设计专属的渲染逻辑，替换通用的 [ResultCard](file:///g:/Projects/avg-game-template/front/src/components/world-builder/StepRenderer.tsx#20-37)（JSON dump）：

| Step | 当前渲染 | 改进后 |
|------|----------|--------|
| **synopsis** | ✅ 已有 Markdown 渲染 | 保持不变 |
| **registry** | JSON dump 分3个折叠卡片 | 表格化：角色列表、技能列表、招式列表、物品列表、自定义组件列表 |
| **regions** | 每个 region 一个 JSON 卡片 | 卡片内展示地域名+描述+地点列表+路径连接 |
| **organizations** | 每个 org 一个 JSON 卡片 | 卡片内展示组织名+描述+领地位置 |
| **creatures** | 每个角色一个 JSON 卡片 | 角色卡片：头部(名称+标签)、属性面板、技能条、关系列表、物品栏、自定义组件 |
| **setting_docs_world** | 每个 doc 一个 JSON 卡片 | Markdown 渲染文档内容，condition 作为标签 |
| **setting_docs_characters** | 按角色分组 JSON 卡片 | 按角色分组，每篇文档 Markdown 渲染，condition 标签 |
| **initial_story** | 单个 JSON 卡片 | 分两段 Markdown 渲染：背景旁白 + 开场故事 |
| **self_check** | 无渲染（或 default） | 审阅摘要 + 质量评分条 + 修复/遗留问题列表 + patches 计数 |

每个步骤的渲染将保留原始 JSON 作为折叠的"查看原始数据"选项。

---

#### [MODIFY] [WorldBuilder.css](file:///g:/Projects/avg-game-template/front/src/components/world-builder/WorldBuilder.css)

添加新的 CSS 样式：
- `.wb-step-section` — 步骤内容区块
- `.wb-creature-card` — 角色卡片（头部、属性、技能等区域）
- `.wb-stat-bar` — 数值条（用于 personality/emotion/skills）
- `.wb-tag` — 标签样式（titles、condition 等）
- `.wb-region-card` — 地域卡片
- `.wb-doc-card` — 文档卡片（Markdown 渲染）
- `.wb-story-panel` — 故事面板
- `.wb-review-panel` — 自检结果面板
- `.wb-raw-toggle` — "查看原始数据"折叠按钮

## Verification Plan

### Manual Verification
请用户使用 World Builder 生成一套完整数据，然后各步骤点击回看，确认每个步骤的输出渲染是否清晰可读。
