/**
 * @pubwiki/sandbox-service
 *
 * RPC interface definitions for sandbox applications to communicate with the main site.
 *
 * This package provides service interfaces that sandbox iframe applications can use:
 * - IVfsService: Read files from the virtual file system
 * - IHmrService: Receive Hot Module Replacement updates
 * - IWikiRAGService: Access WikiRAG AI/knowledge base features
 *
 * Architecture:
 * - Main site implements these service interfaces
 * - Sandbox applications import this package to get typed RPC stubs
 * - Communication happens via capnweb MessagePort RPC
 *
 * @example
 * ```ts
 * import { IVfsService, IHmrService, RpcStub, newMessagePortRpcSession } from '@pubwiki/sandbox-service'
 * 
 * // Create RPC session from MessagePort received from main site
 * const session = newMessagePortRpcSession(port, {})
 * 
 * // Get typed service stubs
 * const vfs = session.getStub(IVfsService, 'vfs')
 * const hmr = session.getStub(IHmrService, 'hmr')
 * 
 * // Use services
 * const content = await vfs.readFile('/index.html')
 * await hmr.subscribe(['**\/*.ts'])
 * ```
 *
 * @packageDocumentation
 */

// Re-export capnweb utilities for convenience
export {
  RpcTarget,
  RpcStub,
  type RpcPromise,
  newMessagePortRpcSession,
  newWebSocketRpcSession,
  newHttpBatchRpcSession,
} from 'capnweb'

// Export all types
export * from './types'

// Export all interfaces
export * from './interfaces'
