/**
 * Canonical Serialization
 * 
 * 使用 RFC 8785 (JSON Canonicalization Scheme)
 */

import canonicalize from 'canonicalize'
import type { Quad, Operation } from './types.js'

/**
 * 规范化 Quad
 */
function normalizeQuad(quad: Quad): object {
  return {
    s: quad.subject,
    p: quad.predicate,
    o: quad.object,
    dt: quad.objectDatatype ?? '',
    lang: quad.objectLanguage ?? '',
    g: quad.graph ?? '',
  }
}

/**
 * 生成 Quad 的排序键
 */
function quadKey(quad: Quad): string {
  return `${quad.subject}|${quad.predicate}|${quad.object}|${quad.objectDatatype ?? ''}|${quad.objectLanguage ?? ''}|${quad.graph ?? ''}`
}

/**
 * 规范化 Operation 为确定性 JSON 字符串
 */
export function canonicalizeOperation(op: Operation): string {
  switch (op.type) {
    case 'insert':
    case 'delete':
      return canonicalize({
        type: op.type,
        quad: normalizeQuad(op.quad),
      }) ?? ''
    
    case 'batch-insert':
    case 'batch-delete':
      const sorted = [...op.quads].sort((a, b) => quadKey(a).localeCompare(quadKey(b)))
      return canonicalize({
        type: op.type,
        quads: sorted.map(normalizeQuad),
      }) ?? ''
    
    case 'patch':
      return canonicalize({
        type: 'patch',
        subject: op.subject,
        predicate: op.predicate,
        patch: op.patch,
      }) ?? ''
  }
}
