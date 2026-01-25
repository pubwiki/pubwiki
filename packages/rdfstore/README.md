# @pubwiki/rdfstore

基于 quadstore 的带不可变版本 DAG 和 SPARQL 支持的 RDF 四元组存储库。

## 概述

`@pubwiki/rdfstore` 在 quadstore 的基础上增加了：

1. **不可变版本 DAG**: 每次操作返回新的 Ref，支持任意时间点回滚和隐式分支
2. **SPARQL 查询**: 基于 quadstore-comunica 的完整 SPARQL 1.1 支持
3. **检查点系统**: 手动创建检查点加速历史状态恢复

这是一个**独立的底层库**，不依赖任何其他 pubwiki 内部包。

## 存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                      User Application                        │
├─────────────────────────────────────────────────────────────┤
│                       RDFStore API                           │
│   (insert/delete/query/checkout/checkpoint/sparqlQuery)      │
├─────────────────────────────────────────────────────────────┤
│   VersionDAG (Dexie)   │         SPARQL Engine               │
│   ├── refNodes         │    (quadstore-comunica)             │
│   ├── checkpoints      │                                     │
│   └── meta             │                                     │
├─────────────────────────────────────────────────────────────┤
│                   Quadstore Backend                          │
│               (quadstore + abstract-level)                   │
└─────────────────────────────────────────────────────────────┘
```

该库使用**混合存储架构**：
- **Quadstore (RDF 数据)**: 使用 abstract-level (browser-level/memory-level)
- **VersionDAG (版本元数据)**: 使用 Dexie.js (IndexedDB)

## 核心概念

### Ref (引用)

每次操作（insert/delete/batch-insert/batch-delete）都会返回一个新的 `Ref`，代表操作后的状态。Ref 是不可变的，保留旧的 Ref 可以随时 checkout 回历史状态。

```typescript
type Ref = string  // 唯一标识符

const ROOT_REF = '__ROOT__'  // 空状态的特殊引用
```

### RefNode (版本节点)

DAG 中的每个节点，记录操作信息和父引用：

```typescript
interface RefNode {
  ref: Ref
  parent: Ref
  operation: Operation
  timestamp: number
}
```

### 隐式分支

不需要显式创建分支。保留任意 Ref，后续可以 checkout 到该 Ref 并继续操作，自然形成分支：

```
ROOT → A → B → C (current)
           ↘
             D → E (从 B checkout 后操作形成的分支)
```

### Checkpoint (检查点)

检查点保存完整的四元组数据，用于加速 checkout 到远离当前状态的历史版本：

```typescript
interface Checkpoint {
  ref: Ref
  timestamp: number
  quadCount: number
}
```

## API

### 类型定义

```typescript
import type { Quad } from '@rdfjs/types'

// 存储配置
interface StorageConfig {
  /** abstract-level 实例用于 Quadstore (RDF 数据) */
  quadstoreLevel: LevelInstance
  /** Dexie 数据库名称用于 VersionDAG (版本元数据) */
  versionDbName: string
}

// 查询模式
interface QuadPattern {
  subject?: Quad_Subject
  predicate?: Quad_Predicate
  object?: Quad_Object
  graph?: Quad_Graph
}

// 操作类型
type Operation = 
  | { type: 'insert'; quad: Quad }
  | { type: 'delete'; quad: Quad }
  | { type: 'batch-insert'; quads: Quad[] }
  | { type: 'batch-delete'; quads: Quad[] }

// SPARQL 查询结果
type SparqlBinding = Record<string, unknown>
```

### RDFStore

```typescript
class RDFStore {
  // === 创建/关闭 ===
  static async create(storage: StorageConfig, config?: Partial<StoreConfig>): Promise<RDFStore>
  async close(): Promise<void>
  
  // === 状态 ===
  get isOpen(): boolean
  get currentRef(): Ref
  
  // === 基础 CRUD (返回新 Ref) ===
  async insert(s: Quad_Subject, p: Quad_Predicate, o: Quad_Object, g?: Quad_Graph): Promise<Ref>
  async delete(s: Quad_Subject, p: Quad_Predicate, o: Quad_Object, g?: Quad_Graph): Promise<Ref>
  async batchInsert(quads: Quad[]): Promise<Ref>
  async batchDelete(patterns: QuadPattern[]): Promise<Ref>
  
  // === 查询 ===
  async query(pattern: QuadPattern): Promise<Quad[]>
  async getAllQuads(): Promise<Quad[]>
  
  // === SPARQL 查询 ===
  async *sparqlQuery(sparql: string): AsyncIterableIterator<SparqlBinding>
  
  // === 版本控制 ===
  async checkout(ref: Ref): Promise<void>
  async checkpoint(options: CheckpointOptions): Promise<Ref>
  async log(limit?: number): Promise<RefNode[]>
  async listCheckpoints(): Promise<Checkpoint[]>
  async getChildren(ref: Ref): Promise<Ref[]>
  
  // === 导入/导出 ===
  async exportData(options?: ExportOptions): Promise<string>
  async importData(data: string, options?: ImportOptions): Promise<Ref>
  async replaceWithImport(data: string, options?: ImportOptions): Promise<Ref>
  
  // === 事件 ===
  on(event: 'change', callback: (data: { ref: Ref; operation: Operation }) => void): () => void
  on(event: 'checkout', callback: (data: { from: Ref; to: Ref }) => void): () => void
}
```

## 使用示例

### 基础使用

```typescript
import { MemoryLevel } from 'memory-level'
import { RDFStore, ROOT_REF } from '@pubwiki/rdfstore'
import { DataFactory } from 'rdf-data-factory'

const df = new DataFactory()
const level = new MemoryLevel()

// 创建 store，指定 quadstore 和 version 的存储
const store = await RDFStore.create({
  quadstoreLevel: level,
  versionDbName: 'my-rdf-store-version'
})

// 插入四元组，返回新 Ref
const ref1 = await store.insert(
  df.namedNode('http://example.org/s1'),
  df.namedNode('http://example.org/name'),
  df.literal('Alice')
)

const ref2 = await store.insert(
  df.namedNode('http://example.org/s1'),
  df.namedNode('http://example.org/age'),
  df.literal('30')
)

// 查询
const results = await store.query({ 
  subject: df.namedNode('http://example.org/s1') 
})
console.log(results.length) // 2

// 关闭
await store.close()
```

### 浏览器使用 (IndexedDB)

```typescript
import { BrowserLevel } from 'browser-level'
import { RDFStore } from '@pubwiki/rdfstore'

// Quadstore 使用 BrowserLevel (IndexedDB)
// VersionDAG 自动使用 Dexie.js (IndexedDB)
const store = await RDFStore.create({
  quadstoreLevel: new BrowserLevel('my-rdf-quads'),
  versionDbName: 'my-rdf-version'
})
```

### 版本控制

```typescript
// 保存当前 Ref
const savedRef = store.currentRef

// 继续操作
const ref3 = await store.insert(
  df.namedNode('http://example.org/s2'),
  df.namedNode('http://example.org/name'),
  df.literal('Bob')
)

// 回滚到之前的状态
await store.checkout(savedRef)
console.log(store.currentRef === savedRef) // true

// 查询只会返回 savedRef 时的数据
const results = await store.query({})
console.log(results.length) // 2 (没有 Bob)

// 从 savedRef 继续操作，形成隐式分支
const branchRef = await store.insert(
  df.namedNode('http://example.org/s3'),
  df.namedNode('http://example.org/name'),
  df.literal('Charlie')
)

// 查看分支
const children = await store.getChildren(savedRef)
console.log(children) // [ref3, branchRef]
```

### 检查点

```typescript
// 大量操作后创建检查点
for (let i = 0; i < 1000; i++) {
  await store.insert(
    df.namedNode(`http://example.org/item${i}`),
    df.namedNode('http://example.org/value'),
    df.literal(String(i))
  )
}

// 创建检查点加速后续 checkout
const checkpointRef = await store.checkpoint({
  title: '批量插入完成',
  description: '可选的描述信息'
})

// 更多操作...

// checkout 到检查点会更快（直接加载检查点数据）
await store.checkout(checkpointRef)
```

### SPARQL 查询

```typescript
// 插入一些数据
await store.insert(
  df.namedNode('http://example.org/alice'),
  df.namedNode('http://example.org/type'),
  df.namedNode('http://example.org/Person')
)
await store.insert(
  df.namedNode('http://example.org/alice'),
  df.namedNode('http://example.org/name'),
  df.literal('Alice')
)
await store.insert(
  df.namedNode('http://example.org/alice'),
  df.namedNode('http://example.org/age'),
  df.literal('30', df.namedNode('http://www.w3.org/2001/XMLSchema#integer'))
)

// SPARQL SELECT 查询
for await (const binding of store.sparqlQuery(`
  SELECT ?name ?age WHERE {
    ?person <http://example.org/type> <http://example.org/Person> .
    ?person <http://example.org/name> ?name .
    OPTIONAL { ?person <http://example.org/age> ?age }
  }
`)) {
  console.log(binding.name, binding.age)
}

// 支持 FILTER
for await (const binding of store.sparqlQuery(`
  SELECT ?item WHERE {
    ?item <http://example.org/value> ?v .
    FILTER (?v > 500)
  }
`)) {
  console.log(binding.item)
}
```

### 事件监听

```typescript
// 监听变化
const unsubChange = store.on('change', ({ ref, operation }) => {
  console.log('New ref:', ref)
  console.log('Operation:', operation.type)
})

// 监听 checkout
const unsubCheckout = store.on('checkout', ({ from, to }) => {
  console.log(`Checkout from ${from} to ${to}`)
})

// 取消订阅
unsubChange()
unsubCheckout()
```

## 文件结构

```
packages/rdfstore/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # 统一导出
│   ├── types.ts              # 类型定义
│   ├── store.ts              # RDFStore 主类
│   ├── backend/              # quadstore 适配 (abstract-level)
│   │   ├── index.ts
│   │   └── quadstore.ts
│   ├── version/              # 版本 DAG (Dexie.js)
│   │   ├── index.ts
│   │   ├── dag.ts            # VersionDAG 类
│   │   └── store.ts          # VersionStore (Dexie schema)
│   ├── delta/                # 增量计算
│   │   └── index.ts
│   ├── serialization/        # 序列化
│   │   └── index.ts
│   └── utils/
│       ├── hash.ts           # 内容哈希
│       └── events.ts         # 事件发射器
└── test/
    ├── store.test.ts         # 主存储测试 (含 SPARQL)
    ├── delta.test.ts
    ├── serialization.test.ts
    └── utils.test.ts
```

## 依赖

```json
{
  "dependencies": {
    "quadstore": "^15.4.1",
    "quadstore-comunica": "^6.3.1",
    "abstract-level": "^3.0.0",
    "n3": "^1.26.0"
  }
}
```

## 与旧版本的区别

旧版本使用 WAL (Write-Ahead Log) 和双 API (Functional + Stateful)。新版本：

1. **单一 API**: 只保留 `RDFStore` 类，更简洁
2. **不可变 Ref**: 每次操作返回新 Ref，而非修改内部状态
3. **隐式分支**: 无需显式 branch 操作，保留 Ref 即可分支
4. **移除 undo/redo**: 使用 checkout 到具体 Ref 替代
5. **手动检查点**: 移除自动检查点，用户按需创建
6. **SPARQL 支持**: 新增完整的 SPARQL 1.1 查询能力
