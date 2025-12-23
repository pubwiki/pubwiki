/**
 * VFS Bridge - 连接 Lua WASM 和 @pubwiki/vfs
 * 
 * 职责：
 * 1. 管理 VFS 上下文（支持并发执行）
 * 2. 提供 contextId 到 Vfs 实例的映射
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs'

// 使用 Map 来存储多个并发的 Vfs 上下文，避免竞态条件
const vfsContexts = new Map<number, Vfs<VfsProvider>>()
let nextVfsContextId = 1

/**
 * 创建一个新的 Vfs 上下文
 * 返回 context ID
 */
export function createVfsContext(vfs: Vfs<VfsProvider>): number {
  const contextId = nextVfsContextId++
  vfsContexts.set(contextId, vfs)
  return contextId
}

/**
 * 使用指定的 contextId 创建 Vfs 上下文
 * 用于与 RDF 上下文共享相同的 ID
 */
export function createVfsContextWithId(contextId: number, vfs: Vfs<VfsProvider>): void {
  vfsContexts.set(contextId, vfs)
  // 更新 nextVfsContextId 以避免冲突
  if (contextId >= nextVfsContextId) {
    nextVfsContextId = contextId + 1
  }
}

/**
 * 获取指定上下文的 Vfs
 */
export function getVfs(contextId: number): Vfs<VfsProvider> | null {
  return vfsContexts.get(contextId) ?? null
}

/**
 * 清除指定上下文
 */
export function clearVfsContext(contextId: number): void {
  vfsContexts.delete(contextId)
}

/**
 * 获取当前活跃的上下文数量（用于调试）
 */
export function getActiveVfsContextCount(): number {
  return vfsContexts.size
}
