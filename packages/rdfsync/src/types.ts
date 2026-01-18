/**
 * Sync Protocol Types
 * 
 * 简化的类型定义，不依赖 @rdfjs/types
 */

/**
 * 简化的 Quad - 所有字段都是字符串
 */
export interface Quad {
  subject: string       // '<uri>' 或 '_:blank'
  predicate: string     // '<uri>'
  object: string        // 值
  objectDatatype?: string  // Literal datatype URI
  objectLanguage?: string  // Literal 语言标签
  graph?: string        // 图名称，空字符串表示 default graph
}

/**
 * 文本补丁
 */
export interface TextPatch {
  originalLength: number
  hunks: PatchHunk[]
}

export interface PatchHunk {
  start: number
  deleteCount: number
  insert: string
}

/**
 * 操作类型
 */
export type Operation =
  | { type: 'insert'; quad: Quad }
  | { type: 'delete'; quad: Quad }
  | { type: 'batch-insert'; quads: Quad[] }
  | { type: 'batch-delete'; quads: Quad[] }
  | { type: 'patch'; subject: string; predicate: string; patch: TextPatch }

/**
 * 带 ref 的操作
 */
export interface OperationWithRef {
  operation: Operation
  ref: string
}

/**
 * 同步操作请求
 */
export interface SyncOperationsRequest {
  baseRef: string
  operations: OperationWithRef[]
}

/**
 * 同步错误类型
 */
export type SyncErrorType = 
  | 'UNKNOWN_BASE_REF'
  | 'REF_MISMATCH'
  | 'INVALID_OPERATION'
  | 'INTERNAL_ERROR'

/**
 * Ref 不匹配详情
 */
export interface RefMismatchInfo {
  index: number
  expected: string
  received: string
}

/**
 * 同步操作响应
 */
export type SyncOperationsResponse =
  | { success: true; finalRef: string; affectedCount: number }
  | { success: false; error: SyncErrorType; message?: string; mismatch?: RefMismatchInfo }
