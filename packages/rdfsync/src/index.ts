/**
 * @pubwiki/rdfsync
 * 
 * Blockchain-style verifiable sync protocol for RDF operations
 * 
 * 核心算法: ref = SHA256(parentRef + '|' + canonical(operation))[0:16]
 * 
 * Note: RDF.js conversion utilities are in a separate export '@pubwiki/rdfsync/convert'
 * to avoid bundling n3 dependency when only sync functions are needed.
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
