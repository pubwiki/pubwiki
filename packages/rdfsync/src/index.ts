/**
 * @pubwiki/rdfsync
 * 
 * Blockchain-style verifiable sync protocol for RDF operations
 * 
 * 核心算法: ref = SHA256(parentRef + '|' + canonical(operation))[0:16]
 */

export type {
  Quad,
  TextPatch,
  PatchHunk,
  Operation,
  OperationWithRef,
  SyncOperationsRequest,
  SyncOperationsResponse,
  SyncErrorType,
  RefMismatchInfo,
} from './types.js'

export {
  ROOT_REF,
  generateRef,
  generateRefChain,
  verifyRefChain,
} from './ref.js'

export { canonicalizeOperation } from './canonical.js'

// RDF.js 转换工具
export { fromRdfQuad, fromRdfOperation } from './convert.js'
