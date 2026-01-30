# PubWiki Homepage

PubWiki 官方网站 - 一个现代、优雅的产品展示页面。

## 技术栈

- **框架**: SvelteKit 2.x + Svelte 5 (Runes)
- **样式**: TailwindCSS v4 + @tailwindcss/typography
- **部署**: 静态站点 (@sveltejs/adapter-static)
- **动画**: CSS Keyframes + Intersection Observer

## 设计特点

### 视觉风格

- 与 Hub/Studio 保持一致的 GitHub 风格配色
- 紫-粉渐变作为 Fancy 点缀
- 毛玻璃效果 (glassmorphism)
- 流畅的 CSS 动画

### 页面结构

| 组件 | 描述 |
|------|------|
| **Header** | 固定导航栏，滚动时显示毛玻璃效果 |
| **Hero** | 主视觉区域，包含动态节点图 |
| **NodeGraph** | SVG 动画展示节点编辑器概念 |
| **Features** | 6 大核心功能卡片 |
| **HowItWorks** | 3 步工作流程交互展示 |
| **Showcase** | 精选作品画廊 |
| **CTA** | 行动号召区域 |
| **Footer** | 页脚导航与社交链接 |

### 动画效果

- `float` - 漂浮动画
- `pulse-glow` - 脉冲发光
- `draw-line` - 线条绘制
- `fade-in-up` - 滚动渐入
- `gradient-shift` - 渐变流动

### 节点颜色系统

| 节点类型 | 颜色 | 用途 |
|----------|------|------|
| PROMPT | `#3b82f6` (蓝) | 可编辑提示词 |
| INPUT | `#8b5cf6` (紫) | 用户输入 |
| GENERATED | `#22c55e` (绿) | AI 生成内容 |
| LOADER | `#06b6d4` (青) | 数据加载器 |

## 开发

```bash
# 安装依赖
pnpm install

# 开发服务器
pnpm dev

# 类型检查
pnpm check

# 构建静态站点
pnpm build

# 预览构建结果
pnpm preview
```

## 目录结构

```
apps/homepage/
├── src/
│   ├── app.css               # 全局样式 + CSS 变量 + 动画
│   ├── app.html              # HTML 模板
│   ├── routes/
│   │   ├── +layout.svelte    # 根布局
│   │   └── +page.svelte      # 首页
│   └── lib/
│       ├── assets/           # 静态资源
│       │   └── favicon.svg
│       └── components/       # 页面组件
│           ├── Header.svelte
│           ├── Hero.svelte
│           ├── NodeGraph.svelte
│           ├── Features.svelte
│           ├── HowItWorks.svelte
│           ├── Showcase.svelte
│           ├── CTA.svelte
│           ├── Footer.svelte
│           └── index.ts
├── static/                   # 静态文件
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tsconfig.json
```

## 后续规划

- [ ] 接入 Hub API 获取真实 Showcase 数据
- [ ] 添加 i18n 国际化支持
- [ ] 添加暗色模式
- [ ] 集成 SEO meta 标签
- [ ] 添加 Analytics
- [ ] 性能优化 (图片懒加载、字体优化)

## 相关文档

- [设计分析报告](./HOMEPAGE_ANALYSIS.md) - 详细的设计决策与技术方案
- [项目总览](../../llm-docs/overview.md) - PubWiki 整体架构文档
