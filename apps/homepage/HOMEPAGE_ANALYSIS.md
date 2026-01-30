# PubWiki 官网设计分析报告

## 一、项目概述与产品定位

### 1.1 产品简介

PubWiki 是一个面向 **AI Roleplay** 用户群体的创作与分享平台，核心功能包括：

1. **Studio** - Prompt 工程工作室：可视化的节点编辑器，用于构建 AI 角色扮演游戏/互动体验
2. **Hub** - 用户门户：Artifact（作品）的浏览、发布、社区互动
3. **Sandbox** - 沙盒预览：运行和体验创作的 AI 互动内容

### 1.2 目标用户群体

- **AI Roleplay 爱好者**：喜欢与 AI 进行角色扮演、互动叙事的用户
- **内容创作者**：想要制作 AI 驱动的互动故事、游戏的创作者
- **二次创作社区**：基于他人作品进行改编、混搭的用户

### 1.3 核心 Value Proposition

| 特性 | 描述 |
|------|------|
| **可视化创作** | 节点式编辑器，无需编程即可创建复杂的 AI 互动体验 |
| **版本追溯** | 完整的版本历史，支持分支和回溯 |
| **云同步存档** | 游戏状态云端保存，跨设备继续体验 |
| **开源谱系** | Fork、混搭、溯源，形成创作生态 |
| **沙盒预览** | 实时预览创作内容，支持 Lua/TypeScript 扩展 |

---

## 二、现有设计风格分析

### 2.1 技术栈

- **框架**: SvelteKit 2.x + Svelte 5 (Runes)
- **样式**: TailwindCSS v4 + @tailwindcss/typography
- **图形**: @xyflow/svelte（流程图）

### 2.2 Hub 设计风格

**配色方案（来自 layout.css）**:
```css
--color-bg-primary: #ffffff;
--color-bg-secondary: #f6f8fa;  /* GitHub-like light gray */
--color-border: #d0d7de;
--color-text-primary: #24292f;
--color-text-secondary: #57606a;
--color-accent: #0969da;        /* GitHub blue */
--color-accent-hover: #0a53be;
```

**设计特点**:
- GitHub 风格的简洁设计
- 白色/浅灰为主的背景色
- 蓝色作为强调色
- 卡片式布局，圆角边框
- 紧凑的信息密度
- 响应式网格布局

**组件风格**:
- **Header**: 白色背景，底部边框分隔
- **Cards**: 白色背景、浅灰边框、hover 阴影效果
- **Buttons**: 扁平化设计，GitHub 风格
- **Tags**: 小型药丸形状，浅灰背景

### 2.3 Studio 设计风格

**设计特点**:
- 全屏工作区布局
- 深色/浅色双模式支持
- 节点类型通过颜色区分：
  - PROMPT: 蓝色
  - INPUT: 紫色
  - GENERATED: 绿色
  - VFS: 默认
  - SANDBOX: 默认
  - LOADER: 青色
  - STATE: 默认
- 扑克牌层叠效果（版本历史）
- 侧边栏 Tab 布局

---

## 三、产品核心功能亮点（适合展示在官网）

### 3.1 🎭 AI 角色扮演引擎

- 支持多轮对话历史
- 可配置的 System Prompt
- 多 LLM 提供商支持（OpenAI, OpenRouter, Anthropic, Google AI）
- 流式响应

### 3.2 📊 可视化节点编辑器

- **6种节点类型**:
  - `PROMPT` - 可编辑的提示词，支持 `#hashtag` 语法
  - `INPUT` - 用户输入内容
  - `GENERATED` - AI 生成的内容
  - `VFS` - 虚拟文件系统（存储游戏资源）
  - `SANDBOX` - 沙盒预览（运行游戏）
  - `LOADER` - 服务执行器（Lua/TypeScript）
  - `STATE` - RDF 状态存储 + 云存档

- **连接系统**: 类型安全的节点连接验证
- **自动布局**: Dagre 算法自动排列节点

### 3.3 🔄 版本控制系统

- 基于内容哈希的 Commit
- 快照历史
- 版本预览与回溯
- 父子版本追踪
- 扑克牌层叠效果可视化

### 3.4 ☁️ 云存档同步

- 区块链式可验证同步
- Checkpoint API
- 跨设备游戏进度

### 3.5 🧬 开源谱系生态

- Fork 功能
- 父子作品关系追踪
- Lineage Graph 可视化
- 版本号管理（semver）

### 3.6 🛠️ 可扩展性

- Lua 脚本支持（wasmoon）
- TypeScript 支持（QuickJS）
- VFS 虚拟文件系统
- 工具调用（Tool Calling）
- 结构化输出

---

## 四、官网页面规划

### 4.1 首页结构建议

```
┌─────────────────────────────────────────────────────────────┐
│                        HEADER                                │
│  Logo    Nav(Features | Community | Docs | Pricing)  CTA    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                     HERO SECTION                             │
│     "Create AI-Powered Interactive Stories"                 │
│     [Try Studio]  [Explore Hub]                             │
│     <Animated Demo / Video>                                 │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                   FEATURES GRID                              │
│   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐                │
│   │ Icon │   │ Icon │   │ Icon │   │ Icon │                │
│   │Visual│   │Cloud │   │Fork &│   │Multi │                │
│   │Editor│   │Save  │   │Remix │   │ LLM  │                │
│   └──────┘   └──────┘   └──────┘   └──────┘                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                  HOW IT WORKS                                │
│   1. Create Prompts → 2. Connect Nodes → 3. Publish        │
│   <Interactive Demo / Animated SVG>                         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│               SHOWCASE / FEATURED WORKS                      │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│   │ Game 1  │  │ Game 2  │  │ Game 3  │                    │
│   └─────────┘  └─────────┘  └─────────┘                    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                  TESTIMONIALS                                │
│   "Quote from user..."                                      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                 CALL TO ACTION                               │
│   "Start Creating Today"  [Get Started - It's Free]        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                        FOOTER                                │
│  Links | Social | Copyright                                 │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 设计风格建议

#### 配色方案（保持与 Hub/Studio 一致，但更 Fancy）

```css
/* 主色调 - 保持 GitHub 风格的蓝色 */
--color-primary: #0969da;
--color-primary-dark: #0a53be;

/* 渐变强调色 - 增加 Fancy 感 */
--gradient-hero: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
--gradient-accent: linear-gradient(135deg, #0969da 0%, #22c55e 100%);

/* 背景色 */
--color-bg-hero: linear-gradient(180deg, #f6f8fa 0%, #ffffff 100%);
--color-bg-dark: #0d1117;  /* 暗色模式 */

/* 节点类型色（用于装饰） */
--color-prompt: #3b82f6;     /* 蓝色 */
--color-input: #8b5cf6;      /* 紫色 */
--color-generated: #22c55e;  /* 绿色 */
--color-loader: #06b6d4;     /* 青色 */
```

#### 视觉元素建议

1. **Hero Section**:
   - 大标题 + 副标题
   - 渐变背景或动态粒子效果
   - 右侧展示 Studio 节点编辑器的动画截图
   - 流动的连接线动画

2. **Feature Cards**:
   - 玻璃态效果（glassmorphism）
   - 悬浮时轻微上移 + 阴影
   - 图标使用渐变色或轮廓线风格
   - 节点式卡片边框（呼应产品设计）

3. **节点动画装饰**:
   - 页面背景可以有隐约的节点连接线
   - 滚动时节点图逐渐显现
   - 使用产品中的节点颜色作为装饰点缀

4. **互动演示**:
   - 嵌入简化版的节点编辑器演示
   - 或使用 Lottie 动画展示工作流程

---

## 五、技术实现建议

### 5.1 项目结构

```
apps/homepage/
├── src/
│   ├── lib/
│   │   ├── components/           # 页面组件
│   │   │   ├── Hero.svelte
│   │   │   ├── Features.svelte
│   │   │   ├── HowItWorks.svelte
│   │   │   ├── Showcase.svelte
│   │   │   ├── Testimonials.svelte
│   │   │   ├── CTA.svelte
│   │   │   └── Footer.svelte
│   │   ├── assets/               # 图片、图标
│   │   └── animations/           # Lottie/GSAP 动画
│   ├── routes/
│   │   ├── +layout.svelte
│   │   └── +page.svelte
│   └── app.css
├── static/
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tailwind.config.ts
```

### 5.2 依赖建议

```json
{
  "dependencies": {
    "@sveltejs/kit": "catalog:",
    "svelte": "catalog:"
  },
  "devDependencies": {
    "@tailwindcss/vite": "catalog:",
    "tailwindcss": "catalog:",
    "@tailwindcss/typography": "catalog:",
    "vite": "catalog:",
    "gsap": "^3.12.0"  // 可选，用于高级动画
  }
}
```

### 5.3 动画效果建议

1. **滚动触发动画**: 使用 Intersection Observer + CSS transitions
2. **节点连接线动画**: SVG path animation
3. **悬浮效果**: CSS transform + transition
4. **背景粒子**: Canvas 或 CSS 实现

---

## 六、内容策略

### 6.1 核心信息架构

| Section | 关键信息 | 目标 |
|---------|---------|------|
| Hero | 产品愿景 + 核心价值 | 抓住注意力，传达 AI Roleplay 定位 |
| Features | 4-6 个核心功能 | 展示差异化优势 |
| How it Works | 3 步流程 | 降低认知门槛 |
| Showcase | 精选作品 | 社会证明，激发创作欲 |
| Testimonials | 用户评价 | 建立信任 |
| CTA | 行动召唤 | 转化 |

### 6.2 文案方向

**Hero 标题选项**:
- "Create AI-Powered Interactive Stories"
- "Your AI Roleplay Creation Platform"
- "Build, Share, and Play AI Adventures"
- "Where AI Stories Come to Life"

**Feature 标题**:
1. **Visual Node Editor** - "Design without Code"
2. **Cloud Save Sync** - "Your Story, Anywhere"
3. **Fork & Remix** - "Build on What Others Created"
4. **Multi-LLM Support** - "Choose Your AI Engine"
5. **Version History** - "Never Lose Your Progress"
6. **Lua/TS Scripting** - "Unlimited Possibilities"

---

## 七、下一步行动

1. **确认设计方向**: 基于此分析，确认视觉风格和页面结构
2. **创建项目脚手架**: 使用 pnpm workspace 创建 apps/homepage
3. **设计 Hero Section**: 首先完成最重要的首屏
4. **迭代开发**: 逐步完成各个 Section
5. **响应式适配**: 确保移动端体验
6. **性能优化**: 图片懒加载、动画性能

---

## 八、视觉参考

建议参考的网站风格：
- [Linear](https://linear.app/) - 现代渐变 + 动画
- [Raycast](https://raycast.com/) - 简洁 + 功能展示
- [Vercel](https://vercel.com/) - 暗色现代风格
- [Notion](https://notion.so/) - 简洁 + 用例展示
- [Character.AI](https://character.ai/) - AI 角色扮演领域参考

---

*报告生成时间: 2026-01-30*
