# TypeScript/JSX 转译功能测试指南

## 功能概述

Preview-site 的 Service Worker 现在支持自动转译用户的 TypeScript 和 JSX 代码：

- ✅ TypeScript (`.ts`) → JavaScript
- ✅ TSX (`.tsx`) → JavaScript
- ✅ JSX (`.jsx`) → JavaScript
- ✅ 内存缓存，提高重复访问性能
- ✅ Service Worker 安装时预初始化 esbuild

## 已实现的功能

### 1. ESBuildBundler (`src/service-worker/esbuild-bundler.ts`)
- 封装 esbuild-wasm 转译功能
- 自动根据文件扩展名选择 loader
- 支持 React 17+ 自动 JSX 运行时
- 生成 inline source map

### 2. TransformCache (`src/service-worker/transform-cache.ts`)
- 基于内存的 LRU 缓存
- 基于源码哈希验证缓存有效性
- 自动淘汰最旧的缓存条目
- 可配置的缓存大小和条目数限制

### 3. Service Worker 集成 (`src/service-worker/index.ts`)
- 拦截 `.ts`、`.tsx`、`.jsx` 文件请求
- 自动转译并返回 JavaScript
- 转译错误时返回友好的错误消息
- 在 install 事件时预初始化 esbuild

## 测试步骤

### 前提条件

1. 确保已安装依赖：
   ```bash
   cd preview-site
   pnpm install
   ```

2. 构建项目：
   ```bash
   pnpm build
   ```

### 方法 1: 使用主站的预览功能

这是最真实的测试方式，因为它使用了完整的 VFS 集成。

1. 在主站中创建一个包含 TypeScript/JSX 文件的项目
2. 使用预览功能打开项目
3. Service Worker 会自动转译这些文件

**测试文件示例**：

`game.tsx`:
```typescript
import React from 'react';

interface GameProps {
  title: string;
  score: number;
}

export const Game: React.FC<GameProps> = ({ title, score }) => {
  return (
    <div>
      <h1>{title}</h1>
      <p>Score: {score}</p>
    </div>
  );
};
```

`index.ts`:
```typescript
type Point = {
  x: number;
  y: number;
};

export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}
```

### 方法 2: 开发模式测试

1. 启动开发服务器：
   ```bash
   cd preview-site
   pnpm dev
   ```

2. 在浏览器中打开开发工具的 Console 和 Network 面板

3. 观察 Service Worker 的日志输出

**预期看到的日志**：
```
[PreviewSW] Installing...
[ESBuildBundler] Initializing esbuild-wasm...
[ESBuildBundler] esbuild-wasm initialized successfully
[PreviewSW] Intercepting: src/game.tsx
[PreviewSW] File needs transformation: src/game.tsx
[PreviewSW] Transform cache miss, transforming...
[ESBuildBundler] Transforming src/game.tsx with loader: tsx
[ESBuildBundler] Transformed src/game.tsx in 45.23ms
[TransformCache] Cached src/game.tsx (size: 2048 bytes, total: 2048 bytes, entries: 1)
```

### 验证转译结果

1. **检查 Network 面板**：
   - 找到 `.ts`/`.tsx`/`.jsx` 文件的请求
   - 查看 Response Headers，应该看到：
     ```
     Content-Type: application/javascript; charset=utf-8
     X-Transformed-From: src/game.tsx
     ```

2. **检查返回的代码**：
   - TypeScript 类型应该被移除
   - JSX 应该被转换为 JavaScript
   - 应该包含 inline source map

3. **测试缓存**：
   - 第二次请求同一文件应该看到：
     ```
     [TransformCache] Cache hit for src/game.tsx
     ```
   - 转译时间应该显著减少（接近 0ms）

## 性能指标

### 首次转译
- esbuild-wasm 初始化：~500-1000ms
- 单个文件转译：~20-100ms（取决于文件大小）

### 缓存命中
- 读取缓存：<1ms
- 无需重新转译

### 内存占用
- esbuild-wasm：~5-10MB
- 缓存：默认最大 50MB
- 每个转译结果：约为源文件大小的 1.5-2 倍

## 故障排查

### 问题：esbuild 初始化失败

**症状**：
```
[ESBuildBundler] Failed to initialize esbuild-wasm: ...
```

**解决方案**：
1. 检查网络连接（需要从 unpkg.com 下载 WASM 文件）
2. 检查浏览器是否支持 WebAssembly
3. 清除浏览器缓存后重试

### 问题：转译错误

**症状**：
```
[PreviewSW] Transform failed: ...
```

**解决方案**：
1. 检查 TypeScript 语法是否正确
2. 查看浏览器控制台的详细错误信息
3. 错误会被包装成 JavaScript 抛出，方便调试

### 问题：缓存未命中

**症状**：
每次都重新转译，即使文件未变化

**解决方案**：
1. 检查文件内容是否真的未变化（哈希验证）
2. 查看缓存统计信息（可以添加调试输出）
3. 确认缓存未被清空

## 下一步计划

根据架构文档 `sandbox-typescript-esbuild-architecture.md`：

### Phase 2: 依赖解析 + CDN (计划中)
- [ ] 实现相对路径解析
- [ ] 集成 npm 包 CDN 解析（unpkg/esm.sh）
- [ ] esbuild 插件系统

### Phase 3: 高级缓存 (计划中)
- [ ] IndexedDB 持久化
- [ ] 更智能的淘汰策略
- [ ] 缓存预热

### Phase 4: HMR 支持 (计划中)
- [ ] 依赖图构建
- [ ] 文件变更检测
- [ ] 模块热更新

## 已知限制

1. **首次加载较慢**：esbuild-wasm 需要下载和初始化（~2-3秒）
2. **仅支持单文件转译**：暂不支持模块解析和打包
3. **npm 包需要从 CDN 加载**：暂不支持 node_modules
4. **缓存在刷新后丢失**：使用内存缓存，未持久化到磁盘

## 技术细节

### 转译配置

```typescript
{
  loader: 'tsx',           // 自动推断
  sourcemap: 'inline',     // 内联 source map
  format: 'esm',           // ESM 格式
  target: 'es2020',        // 目标环境
  jsx: 'automatic',        // React 17+ 自动运行时
  jsxImportSource: 'react' // JSX 导入源
}
```

### 缓存策略

- **验证**：基于源码的简单哈希（快速）
- **淘汰**：LRU（Least Recently Used）
- **限制**：默认 100 个条目，50MB 总大小

### 文件拦截规则

拦截以下扩展名的文件：
- `.ts`
- `.tsx`
- `.jsx`

不拦截：
- Vite 内部资源（`/@vite/`、`/@fs/`）
- npm 模块（`/node_modules/`）
- Source maps（`.map`）

## 相关文档

- [架构文档](../docs/sandbox-typescript-esbuild-architecture.md)
- [Service Worker TypeScript 迁移](./SERVICE-WORKER-TYPESCRIPT-MIGRATION.md)
- [完整 TypeScript 迁移](./FULL-TYPESCRIPT-MIGRATION.md)
