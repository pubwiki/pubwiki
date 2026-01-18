/**
 * Quad 序列化/反序列化工具
 * 
 * 将 Quad 转换为数据库存储格式
 */

import type { Quad, Operation } from './types';
// Re-export from shared sync module for deterministic ref generation
export {
  ROOT_REF,
  generateRef,
  generateRefChain,
  verifyRefChain,
  canonicalizeOperation,
} from '@pubwiki/rdfsync';

/**
 * 生成 Quad 的唯一键
 * 用于去重和查找
 */
export function quadKey(quad: Quad): string {
  return `${quad.subject}|${quad.predicate}|${quad.object}|${quad.objectDatatype ?? ''}|${quad.objectLanguage ?? ''}|${quad.graph ?? ''}`;
}

/**
 * 规范化 Quad (确保所有字段都有值)
 * 使用空字符串代替 null/undefined，确保 SQLite UNIQUE 索引正确工作
 * 
 * 此函数返回的字段类型与数据库 schema 兼容（非空字符串）
 */
export function normalizeQuad(quad: Quad): {
  subject: string;
  predicate: string;
  object: string;
  objectDatatype: string;
  objectLanguage: string;
  graph: string;
} {
  return {
    subject: quad.subject,
    predicate: quad.predicate,
    object: quad.object,
    objectDatatype: quad.objectDatatype || '',
    objectLanguage: quad.objectLanguage || '',
    graph: quad.graph ?? '',
  };
}

/**
 * 将 Quad 数组序列化为 JSONL 格式
 */
export function quadsToJsonl(quads: Quad[]): string {
  return quads.map(quad => JSON.stringify(quad)).join('\n');
}

/**
 * 从 JSONL 格式解析 Quad 数组
 */
export function jsonlToQuads(jsonl: string): Quad[] {
  if (!jsonl.trim()) return [];
  return jsonl
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Quad);
}

/**
 * 验证 Quad 格式
 */
export function validateQuad(quad: unknown): quad is Quad {
  if (typeof quad !== 'object' || quad === null) return false;
  const q = quad as Record<string, unknown>;
  return (
    typeof q.subject === 'string' &&
    typeof q.predicate === 'string' &&
    typeof q.object === 'string' &&
    (q.graph === undefined || typeof q.graph === 'string') &&
    (q.objectDatatype === undefined || q.objectDatatype === null || typeof q.objectDatatype === 'string') &&
    (q.objectLanguage === undefined || q.objectLanguage === null || typeof q.objectLanguage === 'string')
  );
}

/**
 * 验证 Operation 格式
 */
export function validateOperation(op: unknown): op is Operation {
  if (typeof op !== 'object' || op === null) return false;
  const o = op as Record<string, unknown>;
  
  switch (o.type) {
    case 'insert':
    case 'delete':
      return validateQuad(o.quad);
    case 'batch-insert':
    case 'batch-delete':
      return Array.isArray(o.quads) && o.quads.every(validateQuad);
    case 'patch':
      return (
        typeof o.subject === 'string' &&
        typeof o.predicate === 'string' &&
        typeof o.patch === 'object' &&
        o.patch !== null
      );
    default:
      return false;
  }
}
