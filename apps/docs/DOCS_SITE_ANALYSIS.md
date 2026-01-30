# PubWiki 文档网站设计分析报告

## 一、项目概述

### 1.1 目标

为 PubWiki 项目创建一个独立的文档网站，支持：
- 从目录中读取 Markdown/MDsveX 文件并渲染
- 与官网（homepage）保持一致的设计风格
- 静态站点生成，便于部署

### 1.2 技术选型

| 技术 | 选择 | 理由 |
|------|------|------|
| **框架** | SvelteKit 2.x + Svelte 5 | 与现有项目一致 |
| **Markdown 处理** | mdsvex | 用户指定，支持 Svelte 组件嵌入 |
| **样式** | TailwindCSS v4 + @tailwindcss/typography | 与 homepage 一致 |
| **构建** | Vite + @sveltejs/adapter-static | 静态站点生成 |
| **代码高亮** | Shiki | 现代语法高亮，主题丰富 |

---

## 二、现有官网设计风格分析

### 2.1 配色方案

从 `apps/homepage/src/app.css` 提取的设计系统：

```css
/* 主色调 */
--color-primary: #0969da;         /* GitHub 蓝 */
--color-primary-dark: #0a53be;
--color-primary-light: #54aeff;

/* 背景色 */
--color-bg-primary: #ffffff;
--color-bg-secondary: #f6f8fa;    /* 浅灰背景 */
--color-bg-dark: #0d1117;         /* 暗色模式 */
--color-bg-dark-secondary: #161b22;

/* 文字色 */
--color-text-primary: #24292f;
--color-text-secondary: #57606a;
--color-text-muted: #8b949e;

/* 边框色 */
--color-border: #d0d7de;
--color-border-muted: #d8dee4;

/* 装饰色（节点类型） */
--color-prompt: #3b82f6;     /* 蓝色 */
--color-input: #8b5cf6;      /* 紫色 */
--color-generated: #22c55e;  /* 绿色 */
--color-loader: #06b6d4;     /* 青色 */

/* 渐变 */
--gradient-hero: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
--gradient-accent: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
```

### 2.2 组件风格

1. **Header**: 固定顶部，滚动时玻璃态效果（glassmorphism）
2. **导航**: 简洁的文字链接，hover 时变蓝色
3. **按钮**: 渐变背景（紫→粉），圆角，阴影
4. **排版**: Inter 字体，1.6 行高
5. **动画**: 渐入、浮动、脉冲发光效果

### 2.3 官网已有链接

官网 Header 和 Footer 中已预留文档相关链接：
- `/docs` - 文档首页
- `/docs/api` - API 参考

---

## 三、文档网站架构设计

### 3.1 项目结构

```
apps/docs/
├── src/
│   ├── app.css                    # 全局样式（复用 homepage 设计系统）
│   ├── app.d.ts                   # TypeScript 声明
│   ├── app.html                   # HTML 模板
│   ├── lib/
│   │   ├── components/            # 文档专用组件
│   │   │   ├── DocLayout.svelte   # 文档布局（侧边栏+内容）
│   │   │   ├── Sidebar.svelte     # 侧边导航
│   │   │   ├── TableOfContents.svelte  # 目录（TOC）
│   │   │   ├── CodeBlock.svelte   # 代码块（Shiki 高亮）
│   │   │   ├── Callout.svelte     # 提示框（info/warning/error）
│   │   │   ├── Header.svelte      # 顶部导航（可复用 homepage）
│   │   │   └── Footer.svelte      # 页脚（可复用 homepage）
│   │   ├── assets/                # 静态资源
│   │   │   └── favicon.svg
│   │   └── utils/
│   │       └── docs.ts            # 文档工具函数
│   └── routes/
│       ├── +layout.svelte         # 根布局
│       ├── +page.svelte           # 文档首页
│       └── [...slug]/             # 动态路由（捕获所有文档路径）
│           ├── +page.ts           # 加载 MDsveX 文件
│           └── +page.svelte       # 渲染文档内容
├── content/                       # 📁 文档内容目录（用户编写）
│   ├── index.md                   # 文档首页
│   ├── getting-started/
│   │   ├── index.md               # 快速开始
│   │   ├── installation.md
│   │   └── first-project.md
│   ├── studio/
│   │   ├── index.md
│   │   ├── nodes.md
│   │   └── version-control.md
│   ├── hub/
│   │   └── ...
│   └── api/
│       └── ...
├── static/
│   └── images/                    # 文档图片
├── mdsvex.config.js               # mdsvex 配置
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### 3.2 路由设计

| 路由 | 对应文件 | 说明 |
|------|---------|------|
| `/` | `content/index.md` | 文档首页 |
| `/getting-started` | `content/getting-started/index.md` | 快速开始 |
| `/getting-started/installation` | `content/getting-started/installation.md` | 安装指南 |
| `/studio/nodes` | `content/studio/nodes.md` | Studio 节点文档 |
| `/api/artifacts` | `content/api/artifacts.md` | API 文档 |

### 3.3 文档 Frontmatter 规范

```yaml
---
title: "快速开始"
description: "5 分钟内创建你的第一个 AI 互动体验"
order: 1                      # 侧边栏排序
category: "getting-started"   # 分类
---
```

---

## 四、技术实现方案

### 4.1 mdsvex 配置

```javascript
// mdsvex.config.js
import { defineMDSveXConfig as defineConfig } from 'mdsvex';
import shiki from 'shiki';

const config = defineConfig({
  extensions: ['.md', '.svx'],
  smartypants: {
    dashes: 'oldschool'
  },
  layout: {
    _: './src/lib/components/DocLayout.svelte'
  },
  remarkPlugins: [
    // remark-gfm: GitHub Flavored Markdown
    // remark-toc: 自动生成目录
  ],
  rehypePlugins: [
    // rehype-slug: 为标题添加 id
    // rehype-autolink-headings: 标题锚点链接
  ],
  highlight: {
    highlighter: async (code, lang) => {
      // 使用 Shiki 高亮
    }
  }
});

export default config;
```

### 4.2 SvelteKit 配置

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import mdsvexConfig from './mdsvex.config.js';

const config = {
  extensions: ['.svelte', ...mdsvexConfig.extensions],
  preprocess: [vitePreprocess(), mdsvex(mdsvexConfig)],
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: undefined,
      precompress: false,
      strict: true
    }),
    prerender: {
      entries: ['*']
    }
  }
};

export default config;
```

### 4.3 动态路由实现

```typescript
// src/routes/[...slug]/+page.ts
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  const slug = params.slug || 'index';
  
  // 动态导入 MDsveX 文件
  const modules = import.meta.glob('/content/**/*.{md,svx}', { eager: true });
  
  const path = `/content/${slug}.md`;
  const indexPath = `/content/${slug}/index.md`;
  
  const module = modules[path] || modules[indexPath];
  
  if (!module) {
    throw error(404, 'Document not found');
  }
  
  return {
    content: module.default,
    metadata: module.metadata
  };
};
```

### 4.4 侧边栏导航生成

```typescript
// src/lib/utils/docs.ts
export interface DocItem {
  title: string;
  slug: string;
  order: number;
  children?: DocItem[];
}

export function generateSidebar(): DocItem[] {
  // 从 content 目录读取所有文档
  // 解析 frontmatter 获取 title 和 order
  // 构建树形结构
}
```

---

## 五、UI 组件设计

### 5.1 DocLayout（文档布局）

```
┌─────────────────────────────────────────────────────────────────┐
│                          Header                                  │
├────────────────┬────────────────────────────────┬───────────────┤
│                │                                │               │
│    Sidebar     │         Content Area           │     TOC       │
│   (固定宽度)    │        (自适应宽度)             │   (可选)      │
│                │                                │               │
│  - Section 1   │   # Document Title             │  - Heading 1  │
│    - Item 1    │                                │  - Heading 2  │
│    - Item 2    │   Content here...              │    - Sub 1    │
│  - Section 2   │                                │  - Heading 3  │
│    - Item 3    │   ```code block```             │               │
│                │                                │               │
├────────────────┴────────────────────────────────┴───────────────┤
│                          Footer                                  │
└─────────────────────────────────────────────────────────────────┘
```

**布局规格**：
- Sidebar: 固定 260px，可折叠
- Content: 最大宽度 768px，居中
- TOC: 固定 200px，桌面端显示

### 5.2 Sidebar（侧边导航）

- 树形结构，支持折叠
- 当前页面高亮
- 分类标题（Getting Started, Studio, API 等）
- 响应式：移动端转为抽屉式

### 5.3 TableOfContents（目录）

- 自动从文档标题生成
- 滚动时高亮当前章节
- 点击跳转到对应位置
- 桌面端固定在右侧

### 5.4 Callout（提示框）

```svelte
<Callout type="info">
  这是一条信息提示
</Callout>

<Callout type="warning">
  这是一条警告
</Callout>

<Callout type="error">
  这是一条错误提示
</Callout>

<Callout type="tip">
  这是一条小技巧
</Callout>
```

样式参考产品的节点颜色：
- `info`: 蓝色 (#3b82f6)
- `warning`: 黄色 (#f59e0b)
- `error`: 红色 (#ef4444)
- `tip`: 绿色 (#22c55e)

### 5.5 CodeBlock（代码块）

- Shiki 语法高亮
- 显示语言标签
- 复制按钮
- 行号（可选）
- 行高亮（可选）

---

## 六、依赖清单

```json
{
  "name": "pubwiki-docs",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "prepare": "svelte-kit sync || echo ''",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.8",
    "@sveltejs/kit": "catalog:",
    "@sveltejs/vite-plugin-svelte": "catalog:",
    "@tailwindcss/typography": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@types/node": "catalog:",
    "mdsvex": "^0.12.3",
    "rehype-autolink-headings": "^7.1.0",
    "rehype-slug": "^6.0.0",
    "remark-gfm": "^4.0.0",
    "shiki": "^1.24.0",
    "svelte": "catalog:",
    "svelte-check": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:"
  },
  "dependencies": {}
}
```

---

## 七、开发计划

### Phase 1: 基础框架搭建
1. ✅ 创建 `apps/docs` 项目骨架
2. ✅ 配置 SvelteKit + mdsvex
3. ✅ 配置 TailwindCSS + typography
4. ✅ 实现动态路由加载 `.md` 文件

### Phase 2: 核心组件开发
1. ✅ DocLayout 布局组件
2. ✅ Sidebar 侧边导航
3. ✅ Header/Footer（复用 homepage）
4. ✅ TableOfContents 目录

### Phase 3: 增强功能
1. ✅ Shiki 代码高亮
2. ✅ Callout 提示框组件
3. ✅ 搜索功能（可选，使用 pagefind 等）
4. ✅ 上一篇/下一篇导航

### Phase 4: 内容与优化
1. ✅ 创建示例文档结构
2. ✅ 响应式适配
3. ✅ SEO 优化
4. ✅ 性能优化（预渲染、图片优化）

---

## 八、文件命名与组织约定

### 8.1 文档文件

- 使用小写字母和连字符：`getting-started.md`
- 目录首页使用 `index.md`
- 图片放在 `static/images/` 下，按文档路径组织

### 8.2 Frontmatter 必填字段

```yaml
---
title: string       # 必填，文档标题
description: string # 可选，SEO 描述
order: number       # 可选，排序权重（默认按字母排序）
draft: boolean      # 可选，草稿状态（不渲染）
---
```

### 8.3 在 Markdown 中使用 Svelte 组件

```markdown
<script>
  import Callout from '$lib/components/Callout.svelte';
  import Demo from './Demo.svelte';
</script>

# 我的文档

<Callout type="info">
  这是一条提示
</Callout>

下面是一个交互式演示：

<Demo />
```

---

## 九、参考资源

- [mdsvex 官方文档](https://mdsvex.pngwn.io/docs)
- [SvelteKit 文档](https://kit.svelte.dev/docs)
- [TailwindCSS Typography](https://tailwindcss.com/docs/typography-plugin)
- [Shiki 语法高亮](https://shiki.style/)
- 类似文档站点参考：
  - [Svelte 官方文档](https://svelte.dev/docs)
  - [SvelteKit 官方文档](https://kit.svelte.dev/docs)
  - [MDN Web Docs](https://developer.mozilla.org/)

---

*报告生成时间: 2025-01-30*
*作者: GitHub Copilot*
