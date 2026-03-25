# Phase 3: Simple Mode Bridge — 实现计划

## 一、目标

当用户切换到 Simple Mode 时，自动在当前项目中创建并维护一套最小流图结构，使世界编辑器 UI 能够：
1. 通过 STATE 节点的 TripleStore 持久化世界观数据
2. 通过 LOADER + SANDBOX + VFS 节点组合实现游戏预览

## 二、最小流图拓扑

```
[STATE: World Data]  ──(loader-state)──→  [LOADER: Game Engine]
                                                ↑
[VFS: Backend Lua]   ──(loader-backend)────────┘
                                                │
                                          (loader-output → service-input)
                                                │
                                                ↓
[VFS: Frontend]      ──(vfs-input)───→  [SANDBOX: Preview]
```

**5 个节点，4 条边：**

| # | 边 | Source Handle | Target Handle |
|---|---|---|---|
| 1 | STATE → LOADER | `default` | `loader-state` |
| 2 | VFS(Backend) → LOADER | `default` | `loader-backend` |
| 3 | LOADER → SANDBOX | `loader-output` | `service-input` |
| 4 | VFS(Frontend) → SANDBOX | `default` | `vfs-input` |

## 三、模板文件分发策略

### 3.1 问题

`llm-docs/avg-game-template/lua/` (23 files, ~500KB) 和 `front/` (~200 files, ~3MB) 中的文件需要作为 VFS 节点的初始内容。这些文件目前只是 LLM 参考文档，不是项目的构建产物。

### 3.2 方案：构建时打包为 tar 归档，运行时解压到 VFS

**思路**：在构建阶段将模板文件打包为 `.tar` 归档（无压缩，浏览器端高效解包），以静态资源的形式嵌入 Studio 应用。运行时初始化 VFS 节点时解压到 OPFS。

**步骤**：

1. **将模板文件夹移到合适的位置**

   目前 `llm-docs/avg-game-template/` 同时包含 LLM 文档和实际需要分发的资源。需要将实际分发的 Lua/Front 文件分离出来：

   ```
   packages/world-editor/
   └── templates/
       ├── backend/       ← 从 llm-docs/avg-game-template/lua/ 中提取运行时必需文件
       │   ├── init.lua
       │   ├── loader.lua
       │   ├── save.lua
       │   ├── regex.lua
       │   └── assets/
       │       ├── avg-template@pubwiki/  (*.lua + pkg.json)
       │       └── ecs@pubwiki/           (*.lua + pkg.json)
       └── frontend/      ← 从 llm-docs/avg-game-template/front/ 中提取运行时文件
           ├── index.html
           ├── package.json
           ├── tsconfig.json
           ├── vite.config.ts
           └── src/        (游戏运行时代码，不含编辑器 UI)
   ```

   > **关键决策**：`front/` 中的 Editor UI 组件（`state-editor/`、`SaveManager`、`AICopilotPanel` 等）**不需要分发**——这些已由 Studio 的 Svelte 世界编辑器替代。只需要**游戏运行时**部分（`games/`、`api/types.ts`、`stores/`、入口文件等）。

2. **构建脚本**（`packages/world-editor/scripts/pack-templates.ts`）

   ```typescript
   import { createTar, gzipCompress, type TarEntry } from '@pubwiki/flow-core';
   import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
   import { join, relative } from 'path';

   function collectFiles(dir: string, base: string = dir): TarEntry[] {
     const entries: TarEntry[] = [];
     for (const name of readdirSync(dir)) {
       const full = join(dir, name);
       if (statSync(full).isDirectory()) {
         entries.push(...collectFiles(full, base));
       } else {
         entries.push({
           path: relative(base, full),
           content: new Uint8Array(readFileSync(full)),
         });
       }
     }
     return entries;
   }

   async function main() {
     for (const name of ['backend', 'frontend']) {
       const entries = collectFiles(`templates/${name}`);
       const tar = createTar(entries);
       const gz = await gzipCompress(tar);
       writeFileSync(`dist/templates/${name}.tar.gz`, gz);
     }
   }
   main();
   ```

   在 `packages/world-editor/package.json` 的 `build` script 中调用此脚本。

3. **静态资源导入**

   Studio 的 Vite 配置支持 `?url` 后缀导入静态资源的 URL：

   ```typescript
   import backendTarUrl from '@pubwiki/world-editor/dist/templates/backend.tar.gz?url';
   import frontendTarUrl from '@pubwiki/world-editor/dist/templates/frontend.tar.gz?url';
   ```

   或者直接放在 `apps/studio/static/templates/` 下，通过 fetch 加载。

4. **运行时解压**

   ```typescript
   import { extractTarGz, type TarEntry } from '@pubwiki/flow-core';

   async function populateVfsFromTar(vfs: NodeVfs, tarGzUrl: string): Promise<void> {
     const response = await fetch(tarGzUrl);
     const buffer = await response.arrayBuffer();
     const entries: TarEntry[] = await extractTarGz(buffer);
     for (const entry of entries) {
       const content = new TextDecoder().decode(entry.content);
       await vfs.createFile('/' + entry.path, content);
     }
   }
   ```

### 3.3 方案确认：tar 归档

使用项目中已有的 tar 工具链：

- **`@pubwiki/flow-core`** 导出完整的 tar 工具集（[packages/flow-core/src/runtime/io/tar.ts](packages/flow-core/src/runtime/io/tar.ts)）：
  - `createTar(files: TarEntry[]): Uint8Array` — 打包（确定性输出，mtime=0）
  - `extractTar(tarData: Uint8Array): TarEntry[]` — 解包
  - `gzipCompress(data: Uint8Array): Promise<Uint8Array>` — gzip 压缩
  - `gzipDecompress(data: ArrayBuffer): Promise<Uint8Array>` — gzip 解压
  - `extractTarGz(data: ArrayBuffer): Promise<TarEntry[]>` — 解压+解包一步到位
  - `interface TarEntry { path: string; content: Uint8Array }`

- **已有使用先例**：
  - `apps/studio/src/lib/io/vfs-archive.ts` — VFS → tar.gz 打包（`createTar` + `gzipCompress`）
  - `apps/player/src/lib/io/remote-build-fetcher.ts` — 从 API 下载 tar.gz 并解压到 VFS（`extractTarGz`）
  - `packages/flow-core/src/runtime/io/vfs-fetcher.ts` — 同上

**构建时**用 `createTar` + `gzipCompress` 打包模板文件为 `.tar.gz`；**运行时**用 `extractTarGz` 解压并写入 VFS。无需引入任何新依赖。

### 3.4 需要从 front/ 分发的文件范围

`front/` 原始项目是个完整的 React SPA。Simple Mode 的 SANDBOX 预览执行的是**游戏运行时**，不包含编辑器 UI。需要分发的核心文件：

```
front/
├── index.html                  ← SANDBOX 入口
├── package.json                ← 依赖声明（bundler 需要）
├── tsconfig.json               ← TypeScript 配置
├── vite.config.ts              ← 构建配置
├── src/
│   ├── main.tsx                ← React 入口
│   ├── App.tsx                 ← 路由/模式切换
│   ├── App.css                 ← 全局样式
│   ├── api/
│   │   ├── types.ts            ← StateData 类型定义
│   │   ├── api.ts              ← 与 Lua 后端通信
│   │   ├── sandboxExecutor.ts  ← Sandbox 桥接
│   │   └── index.ts            ← 导出
│   ├── stores/                 ← 状态管理
│   ├── games/                  ← 游戏模式渲染器（ink/galgame/...）
│   │   ├── ink/
│   │   ├── galgame/
│   │   ├── custom/
│   │   └── utils/
│   ├── i18n/                   ← 国际化
│   ├── locales/                ← 翻译文件
│   └── styles/                 ← 游戏样式
```

> **注意**：完整 `front/` 包含编辑器组件（`state-editor/`、`copilot/`、`world-builder/`、`SaveManager` 等），这些**不需要分发**。但短期内可以先全量分发，因为 bundler 只打包入口引用链上的文件，未引用的编辑器组件不会被打入最终产物。

## 四、前置改动：Node Metadata 字段

### 4.0 动机

Simple Mode 需要识别哪些节点属于自动创建的"最小流图"。与其在 `StoredProject` 上加一个特化字段 `simpleModeNodeIds`，不如给所有节点添加一个通用的 `metadata: Record<string, string>` 字段。这个字段：

- 适用于所有节点类型（定义在 `BaseNodeData` 基类型上）
- **参与 commit 计算**——修改 metadata 就是修改了节点，语义上应该产生新版本
- 其他功能也可以利用（如标记节点用途、来源、标签等）

### 4.0.1 改动范围

全栈改动，需要后端配合。下列按依赖顺序排列：

#### 1. `packages/flow-core` — 类型定义

```typescript
// packages/flow-core/src/types/node.ts
export interface BaseNodeData<T extends NodeContent> {
  id: string
  name: string
  commit: string
  contentHash: string
  parent: string | null
  snapshotRefs: NodeRef[]
  content: T
  metadata?: Record<string, string>   // NEW — 可选，不存在等价于 {}
}
```

所有 node factory 函数（`createStateNodeData` 等）默认不设置 metadata（保持 `undefined`）。

#### 2. `packages/api` — commit 计算

```typescript
// packages/api/src/utils.ts
export async function computeNodeCommit(
  nodeId: string,
  parent: string | null,
  contentHash: string,
  type: string,
  metadata?: Record<string, string> | null,  // NEW
): Promise<string> {
  // metadata 规范化：undefined / null / {} → null，确保 canonicalize 稳定
  const normalizedMeta = metadata && Object.keys(metadata).length > 0
    ? metadata
    : null;
  const payload = canonicalize({ nodeId, parent, contentHash, type, metadata: normalizedMeta });
  return sha256Hex(payload);
}
```

> **Breaking change**：所有现存 commit hash 作废。项目不做向后兼容，可以接受。

所有调用 `computeNodeCommit` 的地方（node factory、`syncVersions` 验证、前端 rehash 等）需同步传入 `metadata`。

#### 3. `packages/api` — OpenAPI

`NodeVersionSummary` / `NodeVersionDetail` 增加可选字段：

```yaml
# packages/api/openapi/schemas/node-version.yaml
metadata:
  type: object
  nullable: true
  additionalProperties:
    type: string
  description: User-defined key-value annotations. Participates in commit hash.
```

`SyncNodeVersionInput`（syncVersions 的输入）同样增加 `metadata`。

#### 4. `packages/db` — Drizzle schema + migration

```typescript
// packages/db/src/schema/node-versions.ts
metadata: text('metadata', { mode: 'json' }).$type<Record<string, string>>(),
```

生成迁移：`ALTER TABLE node_versions ADD COLUMN metadata TEXT;`

`NodeVersionService.syncVersions` 中验证 commit hash 时需要把 `metadata` 传入 `computeNodeCommit`。

#### 5. `apps/studio` — 前端持久化

```typescript
// apps/studio/src/lib/persistence/db.ts
export interface StoredNodeData {
  // ... existing fields
  metadata?: Record<string, string>;   // NEW
}
```

NodeStore 的 `serialize` / `deserialize` 带上 metadata 字段。

### 4.0.2 metadata 规范化规则

为保证 `canonicalize` 输出稳定（以及 commit 确定性）：

| 输入 | 规范化后 | 说明 |
|------|---------|------|
| `undefined` | `null` | 未设置 |
| `null` | `null` | 显式空 |
| `{}` | `null` | 空对象视为未设置 |
| `{ "a": "1" }` | `{ "a": "1" }` | 有内容，保留 |

`canonicalize` 本身会对 object key 排序，所以 `{ b: "2", a: "1" }` 与 `{ a: "1", b: "2" }` 产生相同输出。

---

## 五、SimpleModeBridge 实现

### 5.1 接口设计

```typescript
// apps/studio/src/lib/simple-mode/bridge.ts

export interface SimpleModeBridgeState {
  /** 是否已完成初始化 */
  initialized: boolean;
  /** 管理的节点 ID */
  nodeIds: {
    state: string;
    backendVfs: string;
    frontendVfs: string;
    loader: string;
    sandbox: string;
  } | null;
}

export class SimpleModeBridge {
  /**
   * 确保简单模式的最小流图结构存在。
   * 幂等操作——如果节点已存在则跳过创建。
   *
   * @param projectId 当前项目 ID
   * @returns 管理的节点 ID 集合
   */
  async ensureGraph(projectId: string): Promise<SimpleModeBridgeState['nodeIds']>;

  /**
   * 获取 STATE 节点的 TripleStore 实例。
   * WorldEditor 通过此方法获取 store，而非自行创建临时 store。
   */
  async getTripleStore(): Promise<TripleStore>;

  /**
   * 销毁管理的流图节点（当用户切换回专家模式或删除项目时）。
   * 可选操作，一般不会调用——节点保留在图中供专家模式查看/编辑。
   */
  async cleanup(): Promise<void>;
}
```

### 5.2 初始化流程

```
ensureGraph(projectId)
│
├── 1. 检测是否已有简单模式节点
│   └── 通过 nodeStore.findByMetadata("simple-mode-role", *) 查找
│       匹配 metadata 中包含 simple-mode-role 的节点
│
├── 2a. 如果全部找到（5 个 role 齐全）→ 返回已有 nodeIds
│
├── 2b. 如果不存在 → 创建
│   ├── createStateNodeData("🌍 World Data")
│   │   └── .metadata = { "simple-mode-role": "state" }
│   ├── createVFSNodeData(projectId, "📦 Backend")
│   │   └── .metadata = { "simple-mode-role": "backend-vfs" }
│   ├── createVFSNodeData(projectId, "🎮 Frontend")
│   │   └── .metadata = { "simple-mode-role": "frontend-vfs" }
│   ├── createLoaderNodeData("⚙️ Engine")
│   │   └── .metadata = { "simple-mode-role": "loader" }
│   ├── createSandboxNodeData("👁️ Preview")
│   │   └── .metadata = { "simple-mode-role": "sandbox" }
│   │
│   ├── nodeStore.create(stateNode)
│   ├── nodeStore.create(backendVfsNode)
│   ├── nodeStore.create(frontendVfsNode)
│   ├── nodeStore.create(loaderNode)
│   ├── nodeStore.create(sandboxNode)
│   │
│   ├── layoutStore.add(...)  // 布局位置（不影响简单模式 UI，但专家模式查看时需要）
│   │
│   ├── 创建 4 条边 → saveEdges()
│   │
│   └── 填充 VFS 内容
│       ├── populateVfsFromTar(backendVfs, backendTarUrl)
│       └── populateVfsFromTar(frontendVfs, frontendTarUrl)
│
└── 3. 完成（nodeIds 已通过 metadata 标记在节点上，无需额外持久化）
```

### 5.3 节点识别策略

通过 `metadata["simple-mode-role"]` 标记识别简单模式节点：

| Role 值 | 节点类型 | 说明 |
|---------|---------|------|
| `"state"` | STATE | 世界观数据 |
| `"backend-vfs"` | VFS | Lua 后端代码 |
| `"frontend-vfs"` | VFS | 前端游戏运行时 |
| `"loader"` | LOADER | 服务运行时 |
| `"sandbox"` | SANDBOX | 预览入口 |

**查找方式**：

```typescript
// NodeStore 新增方法
findByMetadata(key: string, value: string): StudioNodeData | undefined {
  for (const node of this.data.values()) {
    if (node.metadata?.[key] === value) return node;
  }
  return undefined;
}

findAllByMetadata(key: string): StudioNodeData[] {
  return [...this.data.values()].filter(n => n.metadata?.[key] !== undefined);
}
```

**优势**（相比之前的 `StoredProject.simpleModeNodeIds` 方案）：
- metadata 跟随节点版本走，不需要单独的存储位置
- 通用机制，其他功能也能用（如标记 AI 生成的节点、标记模板来源等）
- 节点导入/导出时 metadata 自动随行

### 5.4 与 WorldEditor 的集成

当前 `WorldEditor.svelte` 使用 `createTripleStore()` 创建内存中的临时 store。需要改为接收外部 TripleStore：

```typescript
// WorldEditor.svelte — 修改后
interface Props {
  projectId: string;
  store: TripleStore;       // 由 SimpleModeBridge 提供
}
```

**调用方（+page.svelte）的改动**：

```svelte
{:else}
  <!-- World Editor (Simple Mode) -->
  {#await bridge.ensureGraph(currentProjectId)}
    <LoadingSpinner />
  {:then nodeIds}
    {#await bridge.getTripleStore()}
      <LoadingSpinner />
    {:then store}
      <WorldEditor projectId={currentProjectId} {store} />
    {/await}
  {/await}
{/if}
```

### 5.5 SvelteFlow 节点同步

简单模式下创建的节点需要同步到 SvelteFlow 的 `nodes` 和 `edges` 数组，这样切换到专家模式时用户能看到这些自动生成的节点。

Bridge 创建节点后需要：
1. `nodeStore.create(nodeData)` — 持久化
2. `layoutStore.add(nodeId, x, y)` — 布局
3. 通知 `+page.svelte` 刷新 SvelteFlow nodes/edges — 通过回调或事件

但因为简单模式下 SvelteFlow 不渲染，可以**延迟同步**——只在切换回专家模式时重新加载 nodes/edges from IndexedDB。

## 六、WorldEditor 接入 STATE 节点的 TripleStore

### 6.1 当前架构（需修改）

```
WorldEditor.svelte
  └── const store = createTripleStore()     ← 内存中，关闭页面就丢失
      └── batchInsert(defaultTriples)
```

### 6.2 目标架构

```
+page.svelte
  └── SimpleModeBridge.ensureGraph()
      └── getNodeRDFStore(stateNodeId)      ← IndexedDB 持久化
          └── WorldEditor.svelte
              └── props.store               ← 由外部注入
```

### 6.3 改动清单

| 文件 | 改动 |
|------|------|
| `WorldEditor.svelte` | 改为接收 `store` prop；去掉 `createTripleStore()` 和 `batchInsert` |
| `state/context.ts` | `WorldEditorContext.store` 类型改为外部传入的 TripleStore |
| `+page.svelte` | 在 simple mode 分支中实例化 Bridge，获取 store，传给 WorldEditor |

### 6.4 初始化 & 空 Store 处理

首次创建 STATE 节点时，TripleStore 是空的。WorldEditor 需要检测并写入默认数据：

```typescript
// WorldEditor.svelte 初始化逻辑
const allTriples = store.getAll();
if (allTriples.length === 0) {
  // 空 store，写入默认 StateData
  const defaultState = createDefaultStateData();
  const triples = translator.stateDataToTriples(defaultState);
  store.batchInsert(triples);
}
// 然后正常 materialize
stateData = view.materializeAndSubscribe(store);
```

## 七、前端 Bundling 与游戏预览

### 7.1 前端 VFS → SANDBOX 的执行链

1. SANDBOX 节点的 `entryFile` = `'index.html'`
2. SANDBOX 通过 `VFS_INPUT` edge 找到 Frontend VFS
3. `BuildAwareVfs` 包装 VFS，透明地编译 TypeScript → JavaScript
4. Service Worker 拦截 iframe 请求 → 从 BuildAwareVfs 读取编译产物
5. iframe 加载 `index.html` → 游戏运行

### 7.2 后端 VFS → LOADER 的执行链

1. LOADER 通过 `LOADER_BACKEND` edge 找到 Backend VFS
2. 检测 `/init.lua` → 使用 LuaBackend
3. 创建 Lua VM，加载 init.lua → require 其他模块
4. LOADER 通过 `LOADER_STATE` edge 找到 STATE 节点
5. Lua 通过 `State:match/insert/set/delete` 读写 TripleStore

### 7.3 预览触发

Simple Mode 需要一个 "Preview" 按钮，触发：
1. 确保所有节点和边就绪
2. 启动 LOADER（如果还没启动）
3. 启动 SANDBOX iframe

这部分可以复用现有的 SANDBOX/LOADER 控制器逻辑，暂不在本阶段实现——先聚焦于 Bridge 创建节点 + WorldEditor 接入持久化 TripleStore。

## 八、实施步骤

### Step 0: 添加 Node Metadata 字段（全栈）

> **此步骤涉及后端改动，需要后端配合。**

1. `packages/flow-core/src/types/node.ts` — `BaseNodeData` 增加 `metadata?: Record<string, string>`
2. `packages/api/src/utils.ts` — `computeNodeCommit` 增加 `metadata` 参数，参与 hash
3. `packages/api/openapi.yaml` — `NodeVersionSummary` / `NodeVersionDetail` 增加 `metadata` 字段
4. `packages/api` — `pnpm generate` 重新生成类型
5. `packages/db/src/schema/node-versions.ts` — 加 `metadata` 列
6. `packages/db` — `pnpm generate` 生成 migration
7. `packages/db/src/services/node-version.ts` — `syncVersions` 中传 metadata 到 commit 验证和写入
8. `apps/studio/src/lib/persistence/db.ts` — `StoredNodeData` 增加 `metadata`
9. `apps/studio/src/lib/persistence/node-store.svelte.ts` — serialize/deserialize 带上 metadata
10. `apps/studio/src/lib/types/node-data.ts` — 所有 node factory 函数传 metadata 到 `computeNodeCommit`
11. NodeStore 新增 `findByMetadata(key, value)` 和 `findAllByMetadata(key)` 方法

### Step 1: 准备模板文件

1. 在 `packages/world-editor/templates/` 下建立 `backend/` 和 `frontend/` 目录
2. 从 `llm-docs/avg-game-template/lua/` 复制 Lua 运行时文件（排除 .md）
3. 从 `llm-docs/avg-game-template/front/` 复制游戏运行时文件（排除编辑器 UI）
4. 编写 `scripts/pack-templates.ts` 打包脚本
5. 在 `package.json` 中添加 `build:templates` script

### Step 2: 实现 SimpleModeBridge

1. 创建 `apps/studio/src/lib/simple-mode/bridge.ts`
2. 实现 `ensureGraph()` — 创建 5 个节点（带 metadata 标记）+ 4 条边
3. 实现 `getTripleStore()` — 调用 `getNodeRDFStore(stateNodeId)`
4. 实现 VFS 填充逻辑（从 tar 解压到 OPFS）
5. 通过 `nodeStore.findByMetadata("simple-mode-role", role)` 识别已有节点

### Step 3: 改造 WorldEditor

1. `WorldEditor.svelte` 添加 `store` prop，移除内部 `createTripleStore()`
2. 处理空 store 初始化（写入默认 StateData）
3. 确保 `onDestroy` 不关闭外部 store（store 的生命周期由 Bridge 管理）

### Step 4: 集成到 +page.svelte

1. Simple mode 分支中创建 `SimpleModeBridge` 实例
2. `#await` 确保 graph 就绪后渲染 WorldEditor
3. 传递 `store` prop

### Step 5: 验证

1. 切换到 Simple Mode → 确认 5 个节点创建成功，metadata 正确
2. 编辑世界观数据 → 刷新页面 → 确认数据持久化
3. 切换到 Expert Mode → 确认能看到自动创建的节点和边
4. 切回 Simple Mode → 确认通过 metadata 正确识别到节点

## 九、暂不实现

以下功能在 Phase 3 范围外，留待后续：

- [ ] 游戏预览（SANDBOX 运行时启动）— 需要确认 LOADER/SANDBOX 控制器在没有 SvelteFlow 渲染时是否能工作
- [ ] Undo/Redo — 需要 TripleStore checkpoint 接入 Bridge 层
- [ ] 模板更新检测 — 模板文件更新后如何同步已有项目中的 VFS 内容
- [ ] AI 工具集 — Phase 4 内容
