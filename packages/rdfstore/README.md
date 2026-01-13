# @pubwiki/rdfstore

基于 quadstore 的带日志和版本控制的 RDF 存储库。

## 概述

`@pubwiki/rdfstore` 在 quadstore 的基础上增加了类似数据库的操作日志（Write-Ahead Log）功能，支持状态保存与回滚。

这是一个**独立的底层库**，不依赖任何其他 pubwiki 内部包。其他包（如 `@pubwiki/lua`）将依赖此库。

提供两种 API 风格：

1. **Functional API**: 类似不可变数据结构，每次操作返回新的状态引用
2. **Stateful API**: 传统的可变状态接口，内部包装 Functional API

## 核心概念

### 版本快照 (Snapshot)

每个快照代表存储在某个时间点的完整状态。快照是不可变的，通过 `SnapshotRef` 引用。

### 操作日志 (Operation Log)

记录所有对存储的修改操作，支持：
- 前向重放 (replay)：从空状态重建到任意版本
- 回滚 (rollback)：撤销到之前的版本
- 分支 (branch)：从历史版本创建新分支

### 增量 (Delta)

两个快照之间的差异，用于高效存储和传输。

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      User Application                        │
├─────────────────────────┬───────────────────────────────────┤
│   Stateful API          │         Functional API             │
│   (RDFStore class)      │    (pure functions on Snapshot)   │
├─────────────────────────┴───────────────────────────────────┤
│                     Log Manager                              │
│            (WAL, Compaction, Persistence)                    │
├─────────────────────────────────────────────────────────────┤
│                     Quadstore Adapter                        │
├─────────────────────────────────────────────────────────────┤
│                 quadstore + browser-level                    │
└─────────────────────────────────────────────────────────────┘
```

## API 设计

### 类型定义

```typescript
/**
 * RDF 三元组
 */
interface Triple {
  subject: string
  predicate: string
  object: any
}

/**
 * 三元组查询模式
 */
interface TriplePattern {
  subject?: string
  predicate?: string
  object?: any
}

/**
 * 操作类型
 */
type Operation = 
  | { type: 'insert'; triple: Triple }
  | { type: 'delete'; triple: Triple }
  | { type: 'batch-insert'; triples: Triple[] }
  | { type: 'batch-delete'; triples: Triple[] }

/**
 * 日志条目
 */
interface LogEntry {
  id: string           // 唯一标识符
  timestamp: number    // 时间戳
  operation: Operation // 操作内容
  prevRef: SnapshotRef // 前一个快照引用
}

/**
 * 快照引用 - 不透明句柄
 */
type SnapshotRef = string // 实际上是内容哈希或序列号

/**
 * 快照信息
 */
interface SnapshotInfo {
  ref: SnapshotRef
  timestamp: number
  tripleCount: number
  logIndex: number     // 对应的日志位置
  label?: string       // 可选的用户标签
  isAutoCheckpoint: boolean // 是否为自动检查点
}

/**
 * 存储配置
 */
interface StoreConfig {
  /** 每隔多少个操作自动保存检查点，默认 100 */
  autoCheckpointInterval: number
  /** 是否启用自动检查点，默认 true */
  enableAutoCheckpoint: boolean
}
```

### Functional API

```typescript
/**
 * 从快照引用加载只读视图
 */
function loadSnapshot(store: StoreBackend, ref: SnapshotRef): Promise<SnapshotView>

/**
 * 快照只读视图
 */
interface SnapshotView {
  readonly ref: SnapshotRef
  query(pattern: TriplePattern): Promise<Triple[]>
  count(): Promise<number>
  getAllTriples(): Promise<Triple[]>
}

/**
 * 对快照应用操作，返回新的快照引用
 * 原快照不变，实现结构共享
 */
function applyOperation(
  store: StoreBackend,
  snapshotRef: SnapshotRef,
  operation: Operation
): Promise<SnapshotRef>

/**
 * 批量应用操作
 */
function applyOperations(
  store: StoreBackend,
  snapshotRef: SnapshotRef,
  operations: Operation[]
): Promise<SnapshotRef>

/**
 * 计算两个快照之间的增量
 */
function computeDelta(
  store: StoreBackend,
  fromRef: SnapshotRef,
  toRef: SnapshotRef
): Promise<Operation[]>

/**
 * 创建空快照
 */
function createEmptySnapshot(store: StoreBackend): Promise<SnapshotRef>

/**
 * 从三元组集合创建快照
 */
function createSnapshot(
  store: StoreBackend,
  triples: Triple[]
): Promise<SnapshotRef>
```

### Stateful API

```typescript
/**
 * 带状态的 RDF 存储
 */
class RDFStore {
  /**
   * 创建新的存储实例
   * @param dbName IndexedDB 数据库名称
   * @param config 可选配置
   */
  static async create(dbName: string, config?: Partial<StoreConfig>): Promise<RDFStore>
  
  /**
   * 从现有存储打开
   */
  static async open(dbName: string, config?: Partial<StoreConfig>): Promise<RDFStore>
  
  /**
   * 关闭存储
   */
  async close(): Promise<void>
  
  // === 基础 CRUD ===
  
  async insert(subject: string, predicate: string, object: any): Promise<void>
  async delete(subject: string, predicate: string, object?: any): Promise<void>
  async query(pattern: TriplePattern): Promise<Triple[]>
  async batchInsert(triples: Triple[]): Promise<void>
  async batchDelete(patterns: TriplePattern[]): Promise<void>
  
  // === 版本控制 ===
  
  /**
   * 获取当前快照引用
   */
  get currentRef(): SnapshotRef
  
  /**
   * 保存当前状态为命名快照
   */
  async saveSnapshot(label?: string): Promise<SnapshotInfo>
  
  /**
   * 列出所有保存的快照
   */
  async listSnapshots(): Promise<SnapshotInfo[]>
  
  /**
   * 回滚到指定快照
   * @returns 被撤销的操作列表
   */
  async rollbackTo(ref: SnapshotRef): Promise<Operation[]>
  
  /**
   * 撤销最近 n 个操作
   */
  async undo(count?: number): Promise<Operation[]>
  
  /**
   * 重做之前撤销的操作
   */
  async redo(count?: number): Promise<Operation[]>
  
  /**
   * 获取操作历史
   */
  async getHistory(options?: {
    limit?: number
    since?: SnapshotRef
    until?: SnapshotRef
  }): Promise<LogEntry[]>
  
  /**
   * 清除历史日志（保留当前状态）
   * 注意：此库设计为永不自动压缩日志，此方法仅供用户显式调用
   */
  async compactHistory(): Promise<void>
  
  /**
   * 删除指定快照
   */
  async deleteSnapshot(ref: SnapshotRef): Promise<void>
  
  // === 事件 ===
  
  /**
   * 监听状态变化
   */
  on(event: 'change', callback: (entry: LogEntry) => void): () => void
  on(event: 'snapshot', callback: (info: SnapshotInfo) => void): () => void
  on(event: 'rollback', callback: (from: SnapshotRef, to: SnapshotRef) => void): () => void
}
```

## 实现策略

### 1. 日志结构

采用 Write-Ahead Log (WAL) 模式：

```
┌─────────────────────────────────────────┐
│ Log Storage (IndexedDB)                  │
├─────────────────────────────────────────┤
│ [0] { op: create, snapshot: S0 }        │  ← 初始检查点
│ [1] { op: insert, triple: T1, prev: S0 }│
│ [2] { op: insert, triple: T2, prev: S1 }│
│ ...                                      │
│ [100] { op: checkpoint, snapshot: S100 } │  ← 自动检查点
│ [101] { op: delete, triple: T1, prev: S100}│
│ ...                                      │
├─────────────────────────────────────────┤
│ Saved Snapshots Index                    │
│ - "initial": S0 (auto)                   │
│ - "auto-100": S100 (auto)                │
│ - "before-migration": S150 (manual)      │
└─────────────────────────────────────────┘
```

### 2. 快照存储策略（采用方案 C: 混合策略）

- 完整保存所有操作日志，**永不压缩或删除**
- 自动检查点：每隔 N 个操作自动保存全量快照
- 用户也可手动保存命名检查点
- 回滚时：找到最近的检查点，然后重放后续日志

**自动检查点配置：**
```typescript
interface CheckpointConfig {
  /** 每隔多少个操作自动保存检查点，默认 100 */
  autoCheckpointInterval: number
  /** 是否启用自动检查点，默认 true */
  enableAutoCheckpoint: boolean
}
```

**优点：**
- 完整的历史记录，支持任意时间点回滚
- 检查点加速长历史的回放
- 日志可用于审计、调试、协作冲突解决

### 4. 增量计算（使用 jsdiff）

使用 [jsdiff](https://github.com/kpdecker/jsdiff) 的 `diffArrays` 计算两个快照之间的增量：

```typescript
import { diffArrays } from 'diff'

function computeDelta(oldTriples: Triple[], newTriples: Triple[]): Operation[] {
  // 将 triple 序列化为可比较的字符串
  const serialize = (t: Triple) => JSON.stringify([t.subject, t.predicate, t.object])
  
  const oldSerialized = oldTriples.map(serialize)
  const newSerialized = newTriples.map(serialize)
  
  const changes = diffArrays(oldSerialized, newSerialized)
  const operations: Operation[] = []
  
  let oldIndex = 0
  let newIndex = 0
  
  for (const change of changes) {
    if (change.removed) {
      // 删除的三元组
      for (let i = 0; i < change.count!; i++) {
        operations.push({ type: 'delete', triple: oldTriples[oldIndex++] })
      }
    } else if (change.added) {
      // 新增的三元组
      for (let i = 0; i < change.count!; i++) {
        operations.push({ type: 'insert', triple: newTriples[newIndex++] })
      }
    } else {
      // 保持不变
      oldIndex += change.count!
      newIndex += change.count!
    }
  }
  
  return operations
}
```

**优点：**
- Myers 差分算法，O(ND) 复杂度，高效计算最小编辑距离
- 生成紧凑的增量，适合存储和传输
- 可用于合并分支、冲突检测

### 5. 与现有代码的关系

`@pubwiki/rdfstore` 是一个独立的底层库：
1. **不依赖任何 pubwiki 内部包**，是最底层的 RDF 存储实现
2. `@pubwiki/lua` 未来将依赖此库，使用其 `RDFStore` 接口
3. `apps/studio` 中的 `QuadstoreRDFStore` 将被此库替换

### 6. 数据持久化

使用两个 IndexedDB 数据库：
- `{dbName}-data`: quadstore 的 RDF 数据
- `{dbName}-log`: 操作日志和快照索引

## 文件结构

```
packages/rdfstore/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # 统一导出
│   ├── types.ts              # 类型定义
│   ├── functional/           # Functional API
│   │   ├── index.ts
│   │   ├── snapshot.ts       # 快照操作
│   │   └── operations.ts     # 操作函数
│   ├── stateful/             # Stateful API
│   │   ├── index.ts
│   │   └── store.ts          # RDFStore 类
│   ├── log/                   # 日志管理
│   │   ├── index.ts
│   │   ├── manager.ts        # LogManager
│   │   └── persistence.ts    # IndexedDB 存储
│   ├── checkpoint/           # 检查点管理
│   │   ├── index.ts
│   │   └── auto.ts           # 自动检查点逻辑
│   ├── delta/                # 增量计算
│   │   ├── index.ts
│   │   └── diff.ts           # 基于 jsdiff 的增量计算
│   ├── backend/              # quadstore 适配
│   │   ├── index.ts
│   │   └── quadstore.ts
│   └── utils/
│       ├── hash.ts           # 内容哈希
│       └── events.ts         # 事件发射器
└── test/
    ├── functional.test.ts
    ├── stateful.test.ts
    ├── checkpoint.test.ts
    ├── delta.test.ts
    └── log.test.ts
```

## 使用示例

### Functional API

```typescript
import { 
  createEmptySnapshot, 
  applyOperation, 
  loadSnapshot 
} from '@pubwiki/rdfstore'

// 创建后端
const backend = await createBackend('my-store')

// 创建空快照
let ref = await createEmptySnapshot(backend)

// 应用操作，得到新引用
ref = await applyOperation(backend, ref, {
  type: 'insert',
  triple: { subject: 'ex:s1', predicate: 'ex:p1', object: 'value1' }
})

// 保存旧引用用于回滚
const savedRef = ref

ref = await applyOperation(backend, ref, {
  type: 'insert',
  triple: { subject: 'ex:s2', predicate: 'ex:p2', object: 'value2' }
})

// 查询
const snapshot = await loadSnapshot(backend, ref)
const results = await snapshot.query({ subject: 'ex:s1' })

// 回滚只需使用旧引用
const oldSnapshot = await loadSnapshot(backend, savedRef)
```

### Stateful API

```typescript
import { RDFStore } from '@pubwiki/rdfstore'

// 创建存储（启用自动检查点，每 50 个操作保存一次）
const store = await RDFStore.create('my-state-node', {
  autoCheckpointInterval: 50,
  enableAutoCheckpoint: true
})

// 基础操作
await store.insert('ex:subject', 'ex:predicate', 'value')
await store.insert('ex:subject', 'ex:name', 'Entity Name')

// 保存快照
const checkpoint = await store.saveSnapshot('before-batch-update')

// 批量操作
await store.batchInsert([
  { subject: 'ex:s1', predicate: 'ex:p1', object: 'v1' },
  { subject: 'ex:s2', predicate: 'ex:p2', object: 'v2' },
])

// 查询
const results = await store.query({ predicate: 'ex:p1' })

// 撤销最近的批量操作
await store.undo()

// 或回滚到检查点
await store.rollbackTo(checkpoint.ref)

// 查看历史
const history = await store.getHistory({ limit: 10 })

// 监听变化
const unsubscribe = store.on('change', (entry) => {
  console.log('Operation:', entry.operation)
})

// 关闭
await store.close()
```

### Delta 计算示例

```typescript
import { computeDelta, loadSnapshot } from '@pubwiki/rdfstore'

// 获取两个快照之间的增量
const snapshots = await store.listSnapshots()
const oldRef = snapshots[0].ref
const newRef = snapshots[snapshots.length - 1].ref

const delta = await computeDelta(store.backend, oldRef, newRef)
console.log('Changes:', delta.length, 'operations')

// 可以将 delta 序列化传输给其他客户端
const serialized = JSON.stringify(delta)

// 在另一个客户端应用 delta
const otherStore = await RDFStore.open('other-store')
for (const op of JSON.parse(serialized) as Operation[]) {
  if (op.type === 'insert') {
    await otherStore.insert(op.triple.subject, op.triple.predicate, op.triple.object)
  } else if (op.type === 'delete') {
    await otherStore.delete(op.triple.subject, op.triple.predicate, op.triple.object)
  }
}
```

## 依赖

```json
{
  "dependencies": {
    "quadstore": "^15.4.1",
    "browser-level": "^2.0.0",
    "n3": "^1.26.0",
    "diff": "^7.0.0"
  }
}
```

## 迁移指南

### 从 `apps/studio` 的 `QuadstoreRDFStore` 迁移

```typescript
// 旧代码
import { QuadstoreRDFStore } from './rdf/store'
const store = await QuadstoreRDFStore.create(dbName)

// 新代码
import { RDFStore } from '@pubwiki/rdfstore'
const store = await RDFStore.create(dbName)
// API 保持兼容，新增版本控制功能
```

### `@pubwiki/lua` 迁移

`@pubwiki/lua` 中的 `RDFStore` 接口和相关类型将移至此库，`@pubwiki/lua` 改为依赖 `@pubwiki/rdfstore`：

```typescript
// @pubwiki/lua 将这样引用
import type { RDFStore, Triple, TriplePattern } from '@pubwiki/rdfstore'
```

## 后续扩展

1. **协作编辑支持**: 基于 CRDT 的合并策略，利用 jsdiff 进行三方合并
2. **导入/导出**: 支持 N-Triples、Turtle 格式
3. **远程同步**: 与后端服务同步快照和增量
4. **分支管理**: 类似 Git 的分支和合并功能
