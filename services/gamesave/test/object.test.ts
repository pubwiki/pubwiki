/**
 * CloudSaveObject 单元测试
 * 
 * 测试 Durable Object 的核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { CloudSaveObject } from '../src/object';
import { generateRef } from '../src/serialization';
import type { Operation, OperationWithRef, Quad } from '../src/types';

/**
 * 辅助函数：执行操作并自动生成正确的 ref 链
 * 使用 getCachedRef 作为 baseRef
 */
async function applyOperations(
  instance: CloudSaveObject,
  operations: Operation[]
): Promise<{ success: boolean; finalRef: string; affectedCount: number }> {
  const baseRef = await instance.getCachedRef();
  
  if (operations.length === 0) {
    return { success: true, finalRef: baseRef, affectedCount: 0 };
  }

  let currentRef = baseRef;
  const opsWithRef: OperationWithRef[] = [];

  for (const op of operations) {
    const ref = await generateRef(currentRef, op);
    opsWithRef.push({ operation: op, ref });
    currentRef = ref;
  }

  const result = await instance.syncOperations(baseRef, opsWithRef);
  if (result.success) {
    return { success: true, finalRef: result.finalRef, affectedCount: result.affectedCount };
  }
  return { success: false, finalRef: baseRef, affectedCount: 0 };
}

/**
 * 辅助函数：执行单个操作
 */
async function applyOperation(
  instance: CloudSaveObject,
  operation: Operation
): Promise<{ success: boolean; ref: string; affectedCount: number }> {
  const result = await applyOperations(instance, [operation]);
  return { success: result.success, ref: result.finalRef, affectedCount: result.affectedCount };
}

/**
 * 辅助函数：获取当前缓存状态的所有 quads
 * 用于替代已删除的 query 方法
 */
async function getCurrentQuads(instance: CloudSaveObject): Promise<Quad[]> {
  const cachedRef = await instance.getCachedRef();
  const result = await instance.exportAtRef(cachedRef);
  if (!result.data) return [];
  return result.data.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Quad);
}

/**
 * 辅助函数：在当前 quads 中按条件过滤
 */
function filterQuads(
  quads: Quad[],
  pattern: { subject?: string; predicate?: string; object?: string; graph?: string }
): Quad[] {
  return quads.filter(q => {
    if (pattern.subject !== undefined && q.subject !== pattern.subject) return false;
    if (pattern.predicate !== undefined && q.predicate !== pattern.predicate) return false;
    if (pattern.object !== undefined && q.object !== pattern.object) return false;
    if (pattern.graph !== undefined && q.graph !== pattern.graph) return false;
    return true;
  });
}

describe('CloudSaveObject', () => {
  // 获取一个新的 DO 实例
  function getSaveObject(saveId: string = 'test-save-1') {
    const id = env.CLOUD_SAVE.idFromName(saveId);
    return env.CLOUD_SAVE.get(id) as DurableObjectStub<CloudSaveObject>;
  }

  describe('initialize', () => {
    it('should initialize save with user and state node', async () => {
      const stub = getSaveObject('init-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-123', 'state-456');
        
        const meta = await instance.getMetadata();
        expect(meta).not.toBeNull();
        expect(meta!.userId).toBe('user-123');
        expect(meta!.stateNodeId).toBe('state-456');
        expect(meta!.createdAt).toBeGreaterThan(0);
        expect(meta!.updatedAt).toBeGreaterThan(0);
        
        // cachedRef should be 'root' initially
        const cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe('root');
      });
    });

    it('should not overwrite existing metadata', async () => {
      const stub = getSaveObject('init-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        const meta1 = await instance.getMetadata();
        
        // 再次初始化
        await instance.initialize('user-2', 'state-2');
        const meta2 = await instance.getMetadata();
        
        // 应该保持原来的值
        expect(meta2!.userId).toBe('user-1');
        expect(meta2!.stateNodeId).toBe('state-1');
      });
    });
  });

  describe('executeOperation', () => {
    it('should insert a quad', async () => {
      const stub = getSaveObject('op-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await applyOperation(instance, {
          type: 'insert',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/p>',
            object: 'test value',
            objectDatatype: 'http://www.w3.org/2001/XMLSchema#string',
            graph: '',
          },
        });
        
        expect(result.success).toBe(true);
        expect(result.ref).not.toBe('root');
        expect(result.affectedCount).toBe(1);
        
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(1);
      });
    });

    it('should delete a quad', async () => {
      const stub = getSaveObject('op-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 先插入
        await applyOperation(instance, {
          type: 'insert',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/p>',
            object: 'value',
            graph: '',
          },
        });
        
        // 验证插入
        let quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(1);
        
        // 删除
        await applyOperation(instance, {
          type: 'delete',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/p>',
            object: 'value',
            graph: '',
          },
        });
        
        // 验证删除
        quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(0);
      });
    });

    it('should handle duplicate inserts gracefully', async () => {
      const stub = getSaveObject('op-test-3');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const quad = {
          subject: '<http://example.org/s>',
          predicate: '<http://example.org/p>',
          object: 'value',
          graph: '',
        };
        
        await applyOperation(instance, { type: 'insert', quad });
        await applyOperation(instance, { type: 'insert', quad });
        
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(1);
      });
    });
  });

  describe('executeOperations (batch)', () => {
    it('should batch insert multiple quads', async () => {
      const stub = getSaveObject('batch-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await applyOperations(instance, [{
          type: 'batch-insert',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
            { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
            { subject: '<http://example.org/s3>', predicate: '<http://example.org/p>', object: 'v3', graph: '' },
          ],
        }]);
        
        expect(result.success).toBe(true);
        expect(result.affectedCount).toBe(3);
        
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(3);
      });
    });

    it('should batch delete multiple quads', async () => {
      const stub = getSaveObject('batch-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 批量插入
        await applyOperations(instance, [{
          type: 'batch-insert',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
            { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
          ],
        }]);
        
        // 批量删除
        await applyOperations(instance, [{
          type: 'batch-delete',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
          ],
        }]);
        
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(1);
        expect(quads[0].subject).toBe('<http://example.org/s2>');
      });
    });

    it('should return correct ref after empty operations', async () => {
      const stub = getSaveObject('batch-test-3');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await applyOperations(instance, []);
        expect(result.success).toBe(true);
        expect(result.finalRef).toBe('root');
        expect(result.affectedCount).toBe(0);
      });
    });
  });

  describe('version history', () => {
    it('should track version history', async () => {
      const stub = getSaveObject('version-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 执行多个操作
        const result1 = await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
        });
        
        const result2 = await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s>', predicate: '<http://example.org/p2>', object: 'v2', graph: '' },
        });
        
        const history = await instance.getHistory(10);
        expect(history).toHaveLength(2);
        
        // 验证包含两个不同的 ref
        const refs = history.map(h => h.ref);
        expect(refs).toContain(result1.ref);
        expect(refs).toContain(result2.ref);
        
        // 验证第二个操作的 parent 是第一个操作的 ref
        const second = history.find(h => h.ref === result2.ref);
        expect(second?.parent).toBe(result1.ref);
      });
    });

    it('should update cachedRef after operations', async () => {
      const stub = getSaveObject('version-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const ref1 = await instance.getCachedRef();
        expect(ref1).toBe('root');
        
        const result = await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s>', predicate: '<http://example.org/p>', object: 'v', graph: '' },
        });
        
        const ref2 = await instance.getCachedRef();
        expect(ref2).toBe(result.ref);
        expect(ref2).not.toBe('root');
      });
    });
  });

  describe('export', () => {
    it('should export quads as JSONL at specific ref', async () => {
      const stub = getSaveObject('export-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await applyOperations(instance, [{
          type: 'batch-insert',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
            { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
          ],
        }]);
        
        // 使用 exportAtRef 导出最新状态
        const exported = await instance.exportAtRef(result.finalRef);
        
        expect(exported.quadCount).toBe(2);
        expect(exported.ref).toBe(result.finalRef);
        
        // 解析 JSONL
        const lines = exported.data.split('\n').filter(l => l.trim());
        expect(lines).toHaveLength(2);
        
        const parsed = lines.map(l => JSON.parse(l));
        expect(parsed[0].subject).toBeDefined();
        expect(parsed[0].predicate).toBeDefined();
      });
    });
  });

  describe('counts', () => {
    it('should return correct quad count', async () => {
      const stub = getSaveObject('count-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        expect(await instance.getQuadCount()).toBe(0);
        
        await applyOperations(instance, [{
          type: 'batch-insert',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
            { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
            { subject: '<http://example.org/s3>', predicate: '<http://example.org/p>', object: 'v3', graph: '' },
          ],
        }]);
        
        expect(await instance.getQuadCount()).toBe(3);
      });
    });

    it('should return correct version count', async () => {
      const stub = getSaveObject('count-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        expect(await instance.getVersionCount()).toBe(0);
        
        await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s>', predicate: '<http://example.org/p>', object: 'v', graph: '' },
        });
        
        await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
        });
        
        expect(await instance.getVersionCount()).toBe(2);
      });
    });
  });

  describe('clear', () => {
    it('should clear all quads and version history', async () => {
      const stub = getSaveObject('clear-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        await applyOperations(instance, [{
          type: 'batch-insert',
          quads: [
            { subject: '<http://example.org/s1>', predicate: '<http://example.org/p>', object: 'v1', graph: '' },
            { subject: '<http://example.org/s2>', predicate: '<http://example.org/p>', object: 'v2', graph: '' },
          ],
        }]);
        
        expect(await instance.getQuadCount()).toBe(2);
        expect(await instance.getVersionCount()).toBe(1);
        
        await instance.clear();
        
        expect(await instance.getQuadCount()).toBe(0);
        expect(await instance.getVersionCount()).toBe(0);
      });
    });

    it('should preserve metadata after clear', async () => {
      const stub = getSaveObject('clear-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-123', 'state-456');
        
        await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://example.org/s>', predicate: '<http://example.org/p>', object: 'v', graph: '' },
        });
        
        await instance.clear();
        
        // 元数据应该保留
        const meta = await instance.getMetadata();
        expect(meta).not.toBeNull();
        expect(meta!.userId).toBe('user-123');
        expect(meta!.stateNodeId).toBe('state-456');
      });
    });
  });

  describe('literal handling', () => {
    it('should handle quads with datatype', async () => {
      const stub = getSaveObject('literal-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        await applyOperation(instance, {
          type: 'insert',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/age>',
            object: '25',
            objectDatatype: 'http://www.w3.org/2001/XMLSchema#integer',
            graph: '',
          },
        });
        
        const result = await getCurrentQuads(instance);
        expect(result).toHaveLength(1);
        expect(result[0].object).toBe('25');
        expect(result[0].objectDatatype).toBe('http://www.w3.org/2001/XMLSchema#integer');
      });
    });

    it('should handle quads with language tag', async () => {
      const stub = getSaveObject('literal-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        await applyOperation(instance, {
          type: 'insert',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/label>',
            object: 'Hello',
            objectLanguage: 'en',
            graph: '',
          },
        });
        
        await applyOperation(instance, {
          type: 'insert',
          quad: {
            subject: '<http://example.org/s>',
            predicate: '<http://example.org/label>',
            object: '你好',
            objectLanguage: 'zh-CN',
            graph: '',
          },
        });
        
        const result = await getCurrentQuads(instance);
        expect(result).toHaveLength(2);
        
        const en = result.find(q => q.objectLanguage === 'en');
        const zh = result.find(q => q.objectLanguage === 'zh-CN');
        
        expect(en).toBeDefined();
        expect(en!.object).toBe('Hello');
        expect(zh).toBeDefined();
        expect(zh!.object).toBe('你好');
      });
    });
  });

  describe('graph support', () => {
    it('should support named graphs', async () => {
      const stub = getSaveObject('graph-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        await applyOperations(instance, [
          {
            type: 'insert',
            quad: {
              subject: '<http://example.org/s>',
              predicate: '<http://example.org/p>',
              object: 'default',
              graph: '',
            },
          },
          {
            type: 'insert',
            quad: {
              subject: '<http://example.org/s>',
              predicate: '<http://example.org/p>',
              object: 'named',
              graph: '<http://example.org/graph1>',
            },
          },
        ]);
        
        // 查询默认图
        const allQuads = await getCurrentQuads(instance);
        const defaultGraph = filterQuads(allQuads, { graph: '' });
        expect(defaultGraph).toHaveLength(1);
        expect(defaultGraph[0].object).toBe('default');
        
        // 查询命名图
        const namedGraph = filterQuads(allQuads, { graph: '<http://example.org/graph1>' });
        expect(namedGraph).toHaveLength(1);
        expect(namedGraph[0].object).toBe('named');
      });
    });
  });

  // ============ Blockchain-style Verifiable Sync Tests ============

  describe('refExists', () => {
    it('should return true for ROOT_REF', async () => {
      const stub = getSaveObject('refexists-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const exists = await instance.refExists('root');
        expect(exists).toBe(true);
      });
    });

    it('should return true for existing ref', async () => {
      const stub = getSaveObject('refexists-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await applyOperation(instance, {
          type: 'insert',
          quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
        });
        
        const exists = await instance.refExists(result.ref);
        expect(exists).toBe(true);
      });
    });

    it('should return false for non-existing ref', async () => {
      const stub = getSaveObject('refexists-test-3');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const exists = await instance.refExists('nonexistent123456');
        expect(exists).toBe(false);
      });
    });
  });

  describe('syncOperations (verifiable sync)', () => {
    it('should succeed with correct refs', async () => {
      const stub = getSaveObject('sync-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };

        // 计算正确的 ref 链
        const ref1 = await generateRef('root', op1);
        const ref2 = await generateRef(ref1, op2);

        const operations: OperationWithRef[] = [
          { operation: op1, ref: ref1 },
          { operation: op2, ref: ref2 },
        ];

        const result = await instance.syncOperations('root', operations);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.finalRef).toBe(ref2);
          expect(result.affectedCount).toBe(2);
        }

        // 验证数据已插入
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(2);
      });
    });

    it('should fail with UNKNOWN_BASE_REF for invalid baseRef', async () => {
      const stub = getSaveObject('sync-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op: Operation = {
          type: 'insert',
          quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
        };
        const ref = await generateRef('nonexistent', op);

        const result = await instance.syncOperations('nonexistent', [
          { operation: op, ref },
        ]);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('UNKNOWN_BASE_REF');
          expect(result.message).toContain('nonexistent');
        }

        // 验证没有数据被插入
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(0);
      });
    });

    it('should fail with REF_MISMATCH for incorrect ref', async () => {
      const stub = getSaveObject('sync-test-3');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op: Operation = {
          type: 'insert',
          quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
        };

        // 提供错误的 ref
        const result = await instance.syncOperations('root', [
          { operation: op, ref: 'wrongref12345678' },
        ]);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('REF_MISMATCH');
          expect(result.mismatch).toBeDefined();
          expect(result.mismatch!.index).toBe(0);
          expect(result.mismatch!.received).toBe('wrongref12345678');
        }

        // 验证没有数据被插入
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(0);
      });
    });

    it('should detect mismatch at specific operation index', async () => {
      const stub = getSaveObject('sync-test-4');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };

        const ref1 = await generateRef('root', op1);
        // 第二个 ref 故意错误
        const wrongRef2 = 'wrongref12345678';

        const result = await instance.syncOperations('root', [
          { operation: op1, ref: ref1 },
          { operation: op2, ref: wrongRef2 },
        ]);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('REF_MISMATCH');
          expect(result.mismatch!.index).toBe(1);
          expect(result.mismatch!.received).toBe(wrongRef2);
        }

        // 验证没有数据被插入（原子性保证）
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(0);
      });
    });

    it('should succeed with empty operations', async () => {
      const stub = getSaveObject('sync-test-5');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const result = await instance.syncOperations('root', []);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.finalRef).toBe('root');
          expect(result.affectedCount).toBe(0);
        }
      });
    });

    it('should support branching (sync from non-head ref)', async () => {
      const stub = getSaveObject('sync-test-6');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 先执行一个操作
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const result1 = await applyOperation(instance, op1);
        const branch1Ref = result1.ref;

        // 再执行另一个操作（在 branch1Ref 上继续）
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };
        await applyOperation(instance, op2);

        // 现在从 branch1Ref 分叉，执行不同的操作
        const branchOp: Operation = {
          type: 'insert',
          quad: { subject: '<http://branch>', predicate: '<http://p>', object: 'branch-v', graph: '' },
        };
        const branchRef = await generateRef(branch1Ref, branchOp);

        const result = await instance.syncOperations(branch1Ref, [
          { operation: branchOp, ref: branchRef },
        ]);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.finalRef).toBe(branchRef);
        }
      });
    });

    it('should correctly checkout to baseRef before applying forked operations', async () => {
      const stub = getSaveObject('sync-test-fork-checkout');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 1. 从 root 执行第一个操作，添加 quad A
        const opA: Operation = {
          type: 'insert',
          quad: { subject: '<http://A>', predicate: '<http://p>', object: 'valueA', graph: '' },
        };
        const resultA = await applyOperation(instance, opA);
        const refA = resultA.ref;
        expect(resultA.success).toBe(true);

        // 验证 quads 表有 1 个 quad
        let allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(1);
        expect(allQuads[0].subject).toBe('<http://A>');

        // 2. 从 refA 继续执行，添加 quad B
        const opB: Operation = {
          type: 'insert',
          quad: { subject: '<http://B>', predicate: '<http://p>', object: 'valueB', graph: '' },
        };
        const resultB = await applyOperation(instance, opB);
        const refB = resultB.ref;
        expect(resultB.success).toBe(true);

        // 验证 quads 表现在有 2 个 quads (A + B)
        allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(2);
        const subjects = allQuads.map(q => q.subject).sort();
        expect(subjects).toEqual(['<http://A>', '<http://B>']);

        // 3. 现在从 refA 分叉（不是从 refB），添加 quad C
        // 这模拟了另一个客户端基于旧版本同步操作
        const opC: Operation = {
          type: 'insert',
          quad: { subject: '<http://C>', predicate: '<http://p>', object: 'valueC', graph: '' },
        };
        const refC = await generateRef(refA, opC);

        const result = await instance.syncOperations(refA, [
          { operation: opC, ref: refC },
        ]);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.finalRef).toBe(refC);
        }

        // 关键验证：quads 表应该反映 refC 的状态
        // refC 是从 refA 分叉的，所以应该只有 A + C，没有 B
        allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(2);
        const subjectsAfterFork = allQuads.map(q => q.subject).sort();
        expect(subjectsAfterFork).toEqual(['<http://A>', '<http://C>']);

        // 验证 B 不在当前状态中（因为我们从 refA 分叉，没有 B）
        const hasB = allQuads.some(q => q.subject === '<http://B>');
        expect(hasB).toBe(false);
      });
    });

    it('should handle multiple consecutive forks correctly', async () => {
      const stub = getSaveObject('sync-test-multi-fork');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 1. 从 root 添加 quad X
        const opX: Operation = {
          type: 'insert',
          quad: { subject: '<http://X>', predicate: '<http://p>', object: 'X', graph: '' },
        };
        const refX = await generateRef('root', opX);
        await instance.syncOperations('root', [{ operation: opX, ref: refX }]);

        // 2. 从 refX 添加 quad Y
        const opY: Operation = {
          type: 'insert',
          quad: { subject: '<http://Y>', predicate: '<http://p>', object: 'Y', graph: '' },
        };
        const refY = await generateRef(refX, opY);
        await instance.syncOperations(refX, [{ operation: opY, ref: refY }]);

        // 当前状态：X + Y
        let allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(2);

        // 3. 第一次分叉：从 root 添加 quad A（回到最开始）
        const opA: Operation = {
          type: 'insert',
          quad: { subject: '<http://A>', predicate: '<http://p>', object: 'A', graph: '' },
        };
        const refA = await generateRef('root', opA);
        await instance.syncOperations('root', [{ operation: opA, ref: refA }]);

        // 状态应该只有 A（从 root 分叉）
        allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(1);
        expect(allQuads[0].subject).toBe('<http://A>');

        // 4. 第二次分叉：从 refX 添加 quad B（有 X，没有 Y）
        const opB: Operation = {
          type: 'insert',
          quad: { subject: '<http://B>', predicate: '<http://p>', object: 'B', graph: '' },
        };
        const refB = await generateRef(refX, opB);
        await instance.syncOperations(refX, [{ operation: opB, ref: refB }]);

        // 状态应该只有 X + B（从 refX 分叉）
        allQuads = await getCurrentQuads(instance);
        expect(allQuads).toHaveLength(2);
        const subjects = allQuads.map(q => q.subject).sort();
        expect(subjects).toEqual(['<http://B>', '<http://X>']);
      });
    });

    it('should update cachedRef correctly after sync', async () => {
      const stub = getSaveObject('sync-test-cachedref');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        // 初始 cachedRef 应该是 root
        let cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe('root');

        // 执行一个操作
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const ref1 = await generateRef('root', op1);
        await instance.syncOperations('root', [{ operation: op1, ref: ref1 }]);

        // cachedRef 应该更新为 ref1
        cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe(ref1);

        // 再执行一个操作
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };
        const ref2 = await generateRef(ref1, op2);
        await instance.syncOperations(ref1, [{ operation: op2, ref: ref2 }]);

        // cachedRef 应该更新为 ref2
        cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe(ref2);

        // 从 root 分叉
        const op3: Operation = {
          type: 'insert',
          quad: { subject: '<http://s3>', predicate: '<http://p>', object: 'v3', graph: '' },
        };
        const ref3 = await generateRef('root', op3);
        await instance.syncOperations('root', [{ operation: op3, ref: ref3 }]);

        // cachedRef 应该更新为 ref3
        cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe(ref3);
      });
    });
  });

  describe('deterministic ref generation', () => {
    it('should generate same ref for same operation', async () => {
      const stub = getSaveObject('deterministic-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op: Operation = {
          type: 'insert',
          quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
        };

        // 计算两次
        const ref1 = await generateRef('root', op);
        const ref2 = await generateRef('root', op);

        expect(ref1).toBe(ref2);
      });
    });

    it('should generate same ref on client and server', async () => {
      const stub = getSaveObject('deterministic-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op: Operation = {
          type: 'insert',
          quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
        };

        // 客户端预计算 ref
        const clientRef = await generateRef('root', op);

        // 服务端执行操作
        const result = await applyOperation(instance, op);

        // 应该匹配
        expect(result.ref).toBe(clientRef);
      });
    });

    it('should form correct chain', async () => {
      const stub = getSaveObject('deterministic-test-3');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };

        // 执行操作
        const result1 = await applyOperation(instance, op1);
        const result2 = await applyOperation(instance, op2);

        // 验证链式关系
        const history = await instance.getHistory(10);
        const node2 = history.find(h => h.ref === result2.ref);
        
        expect(node2).toBeDefined();
        expect(node2!.parent).toBe(result1.ref);

        // 手动验证 ref 计算
        const expectedRef1 = await generateRef('root', op1);
        const expectedRef2 = await generateRef(expectedRef1, op2);

        expect(result1.ref).toBe(expectedRef1);
        expect(result2.ref).toBe(expectedRef2);
      });
    });
  });

  describe('transaction atomicity', () => {
    it('should rollback on syncOperations ref mismatch', async () => {
      const stub = getSaveObject('atomic-test-1');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const op1: Operation = {
          type: 'insert',
          quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
        };
        const op2: Operation = {
          type: 'insert',
          quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
        };

        const ref1 = await generateRef('root', op1);
        // 第二个 ref 错误
        const wrongRef2 = 'wrongref12345678';

        const result = await instance.syncOperations('root', [
          { operation: op1, ref: ref1 },
          { operation: op2, ref: wrongRef2 },
        ]);

        expect(result.success).toBe(false);

        // 验证没有任何数据被写入
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(0);

        const history = await instance.getHistory(10);
        expect(history).toHaveLength(0);

        const cachedRef = await instance.getCachedRef();
        expect(cachedRef).toBe('root');
      });
    });

    it('should commit all changes on syncOperations success', async () => {
      const stub = getSaveObject('atomic-test-2');
      
      await runInDurableObject(stub, async (instance: CloudSaveObject) => {
        await instance.initialize('user-1', 'state-1');
        
        const ops: Operation[] = [
          { type: 'insert', quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' } },
          { type: 'insert', quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' } },
          { type: 'insert', quad: { subject: '<http://s3>', predicate: '<http://p>', object: 'v3', graph: '' } },
        ];

        // 生成正确的 ref 链
        let currentRef = 'root';
        const operations: OperationWithRef[] = [];
        for (const op of ops) {
          const ref = await generateRef(currentRef, op);
          operations.push({ operation: op, ref });
          currentRef = ref;
        }

        const result = await instance.syncOperations('root', operations);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.finalRef).toBe(currentRef);
        }

        // 验证所有数据都被写入
        const quads = await getCurrentQuads(instance);
        expect(quads).toHaveLength(3);

        const history = await instance.getHistory(10);
        expect(history).toHaveLength(3);
      });
    });
  });

  // ============ 边界情况和错误处理测试 ============

  describe('edge cases and error handling', () => {
    describe('syncOperations input validation', () => {
      it('should reject empty baseRef', async () => {
        const stub = getSaveObject('edge-input-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await instance.syncOperations('', []);
          
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe('INVALID_OPERATION');
          }
        });
      });

      it('should reject operation without ref field', async () => {
        const stub = getSaveObject('edge-input-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const op: Operation = {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          };
          
          // 强制类型转换来模拟缺少 ref 的情况
          const badOps = [{ operation: op }] as unknown as OperationWithRef[];
          
          const result = await instance.syncOperations('root', badOps);
          
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe('INVALID_OPERATION');
          }
        });
      });

      it('should reject operation with invalid type', async () => {
        const stub = getSaveObject('edge-input-3');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const badOps = [{
            operation: { type: 'invalid-type', quad: {} },
            ref: 'abc123',
          }] as unknown as OperationWithRef[];
          
          const result = await instance.syncOperations('root', badOps);
          
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe('INVALID_OPERATION');
          }
        });
      });

      it('should reject non-array operations', async () => {
        const stub = getSaveObject('edge-input-4');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await instance.syncOperations('root', {} as unknown as OperationWithRef[]);
          
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe('INVALID_OPERATION');
          }
        });
      });
    });

    describe('exportAtRef edge cases', () => {
      it('should throw for non-existent ref', async () => {
        const stub = getSaveObject('edge-export-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          await expect(instance.exportAtRef('nonexistent123')).rejects.toThrow(
            "Ref 'nonexistent123' does not exist"
          );
        });
      });

      it('should return empty data for ROOT_REF', async () => {
        const stub = getSaveObject('edge-export-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await instance.exportAtRef('root');
          
          expect(result.quadCount).toBe(0);
          expect(result.ref).toBe('root');
          expect(result.data).toBe('');
        });
      });

      it('should use quads table cache when cachedRef matches targetRef', async () => {
        const stub = getSaveObject('edge-export-3');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 插入数据
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'value', graph: '' },
          });
          
          // cachedRef 应该等于最新的 ref
          const cachedRef = await instance.getCachedRef();
          expect(cachedRef).toBe(result.ref);
          
          // 导出应该直接使用 quads 表缓存
          const exported = await instance.exportAtRef(result.ref);
          expect(exported.quadCount).toBe(1);
        });
      });
    });

    describe('checkpoint edge cases', () => {
      it('should throw when creating duplicate checkpoint', async () => {
        const stub = getSaveObject('edge-checkpoint-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          // 创建第一个 checkpoint
          await instance.createCheckpoint(result.ref, { name: 'test' });
          
          // 尝试创建重复的 checkpoint
          await expect(instance.createCheckpoint(result.ref)).rejects.toThrow(
            `Checkpoint at ref '${result.ref}' already exists`
          );
        });
      });

      it('should return false when deleting non-existent checkpoint', async () => {
        const stub = getSaveObject('edge-checkpoint-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const deleted = await instance.deleteCheckpoint('nonexistent123');
          expect(deleted).toBe(false);
        });
      });

      it('should list checkpoints in descending order by timestamp', async () => {
        const stub = getSaveObject('edge-checkpoint-3');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 创建多个操作和 checkpoints
          const ref1 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
          })).ref;
          await instance.createCheckpoint(ref1, { name: 'first' });
          
          // 添加小延迟确保时间戳不同
          await new Promise(resolve => setTimeout(resolve, 10));
          
          const ref2 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
          })).ref;
          await instance.createCheckpoint(ref2, { name: 'second' });
          
          const checkpoints = await instance.listCheckpoints();
          
          expect(checkpoints).toHaveLength(2);
          expect(checkpoints[0].name).toBe('second'); // 最新的在前
          expect(checkpoints[1].name).toBe('first');
        });
      });

      it('should create checkpoint with visibility', async () => {
        const stub = getSaveObject('edge-checkpoint-visibility-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          // 创建 PUBLIC visibility 的 checkpoint
          await instance.createCheckpoint(result.ref, { name: 'public-cp', visibility: 'PUBLIC' });
          
          const checkpoints = await instance.listCheckpoints();
          expect(checkpoints).toHaveLength(1);
          expect(checkpoints[0].visibility).toBe('PUBLIC');
        });
      });

      it('should default to PRIVATE visibility', async () => {
        const stub = getSaveObject('edge-checkpoint-visibility-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          await instance.createCheckpoint(result.ref, { name: 'private-cp' });
          
          const checkpoints = await instance.listCheckpoints();
          expect(checkpoints).toHaveLength(1);
          expect(checkpoints[0].visibility).toBe('PRIVATE');
        });
      });

      it('should filter checkpoints by access level', async () => {
        const stub = getSaveObject('edge-checkpoint-visibility-3');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 创建多个不同 visibility 的 checkpoints
          const ref1 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
          })).ref;
          await instance.createCheckpoint(ref1, { name: 'private', visibility: 'PRIVATE' });
          
          const ref2 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' },
          })).ref;
          await instance.createCheckpoint(ref2, { name: 'public', visibility: 'PUBLIC' });
          
          // owner 能看到所有
          const ownerCheckpoints = await instance.listCheckpoints('owner');
          expect(ownerCheckpoints).toHaveLength(2);
          
          // public 只能看到 PUBLIC 的
          const publicCheckpoints = await instance.listCheckpoints('public');
          expect(publicCheckpoints).toHaveLength(1);
          expect(publicCheckpoints[0].name).toBe('public');
        });
      });

      it('should get single checkpoint by ref', async () => {
        const stub = getSaveObject('edge-checkpoint-visibility-4');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          await instance.createCheckpoint(result.ref, { name: 'my-cp', description: 'test desc', visibility: 'PUBLIC' });
          
          const checkpoint = await instance.getCheckpoint(result.ref);
          expect(checkpoint).not.toBeNull();
          expect(checkpoint!.ref).toBe(result.ref);
          expect(checkpoint!.name).toBe('my-cp');
          expect(checkpoint!.description).toBe('test desc');
          expect(checkpoint!.visibility).toBe('PUBLIC');
          
          // Non-existent ref returns null
          const nonExistent = await instance.getCheckpoint('nonexistent-ref');
          expect(nonExistent).toBeNull();
        });
      });

      it('should update checkpoint visibility', async () => {
        const stub = getSaveObject('edge-checkpoint-visibility-5');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          await instance.createCheckpoint(result.ref, { visibility: 'PRIVATE' });
          
          // Update to PUBLIC
          const updated = await instance.updateCheckpointVisibility(result.ref, 'PUBLIC');
          expect(updated).toBe(true);
          
          const checkpoint = await instance.getCheckpoint(result.ref);
          expect(checkpoint!.visibility).toBe('PUBLIC');
          
          // Update non-existent returns false
          const notUpdated = await instance.updateCheckpointVisibility('nonexistent', 'PUBLIC');
          expect(notUpdated).toBe(false);
        });
      });
    });

    describe('delete operation edge cases', () => {
      it('should handle delete of non-existent quad gracefully', async () => {
        const stub = getSaveObject('edge-delete-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 删除不存在的 quad
          const result = await applyOperation(instance, {
            type: 'delete',
            quad: { subject: '<http://nonexistent>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          expect(result.success).toBe(true);
        });
      });

      it('should delete correct quad when multiple quads exist', async () => {
        const stub = getSaveObject('edge-delete-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          await applyOperations(instance, [
            { type: 'insert', quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v1', graph: '' } },
            { type: 'insert', quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v2', graph: '' } },
          ]);
          
          let quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(2);
          
          // 只删除 v1
          await applyOperation(instance, {
            type: 'delete',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v1', graph: '' },
          });
          
          quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(1);
          expect(quads[0].object).toBe('v2');
        });
      });
    });

    describe('batch operation edge cases', () => {
      it('should handle empty batch-insert', async () => {
        const stub = getSaveObject('edge-batch-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const result = await applyOperation(instance, {
            type: 'batch-insert',
            quads: [],
          });
          
          expect(result.success).toBe(true);
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(0);
        });
      });

      it('should handle batch-insert with duplicates', async () => {
        const stub = getSaveObject('edge-batch-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const sameQuad = { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' };
          
          await applyOperation(instance, {
            type: 'batch-insert',
            quads: [sameQuad, sameQuad, sameQuad],
          });
          
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(1); // 重复的应该只保留一个
        });
      });

      it('should handle empty batch-delete', async () => {
        const stub = getSaveObject('edge-batch-3');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          
          const result = await applyOperation(instance, {
            type: 'batch-delete',
            quads: [],
          });
          
          expect(result.success).toBe(true);
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(1); // 原数据应该还在
        });
      });
    });

    describe('history edge cases', () => {
      it('should respect limit parameter', async () => {
        const stub = getSaveObject('edge-history-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 创建 5 个操作
          for (let i = 0; i < 5; i++) {
            await applyOperation(instance, {
              type: 'insert',
              quad: { subject: `<http://s${i}>`, predicate: '<http://p>', object: `v${i}`, graph: '' },
            });
          }
          
          const limited = await instance.getHistory(3);
          expect(limited).toHaveLength(3);
          
          const all = await instance.getHistory(10);
          expect(all).toHaveLength(5);
        });
      });

      it('should return history in descending order', async () => {
        const stub = getSaveObject('edge-history-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const ref1 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'first', graph: '' },
          })).ref;
          
          const ref2 = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'second', graph: '' },
          })).ref;
          
          const history = await instance.getHistory(10);
          
          expect(history[0].ref).toBe(ref2); // 最新的在前
          expect(history[1].ref).toBe(ref1);
        });
      });
    });

    describe('clear edge cases', () => {
      it('should clear all data but preserve metadata', async () => {
        const stub = getSaveObject('edge-clear-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 添加数据
          const result = await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s>', predicate: '<http://p>', object: 'v', graph: '' },
          });
          await instance.createCheckpoint(result.ref);
          
          // 清空
          await instance.clear();
          
          // 验证数据被清空
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(0);
          
          const history = await instance.getHistory(10);
          expect(history).toHaveLength(0);
          
          const checkpoints = await instance.listCheckpoints();
          expect(checkpoints).toHaveLength(0);
          
          // 元数据应该保留
          const meta = await instance.getMetadata();
          expect(meta).not.toBeNull();
          expect(meta!.userId).toBe('user-1');
        });
      });

      it('should be able to continue operations after clear', async () => {
        const stub = getSaveObject('edge-clear-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://s1>', predicate: '<http://p>', object: 'v1', graph: '' },
          });
          
          await instance.clear();
          
          // clear 后 cachedRef 仍然有效，但 refExists 检查会失败
          // 需要从 root 重新开始
          const result = await instance.syncOperations('root', [{
            operation: { type: 'insert', quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' } },
            ref: await generateRef('root', { type: 'insert', quad: { subject: '<http://s2>', predicate: '<http://p>', object: 'v2', graph: '' } }),
          }]);
          
          expect(result.success).toBe(true);
          
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(1);
          expect(quads[0].object).toBe('v2');
        });
      });
    });

    describe('refExists edge cases', () => {
      it('should always return true for ROOT_REF', async () => {
        const stub = getSaveObject('edge-ref-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const exists = await instance.refExists('root');
          expect(exists).toBe(true);
        });
      });

      it('should return false for random string', async () => {
        const stub = getSaveObject('edge-ref-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          const exists = await instance.refExists('random1234567890');
          expect(exists).toBe(false);
        });
      });
    });

    describe('complex fork scenarios', () => {
      it('should handle deep fork from early version', async () => {
        const stub = getSaveObject('edge-fork-1');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 创建 A -> B -> C -> D 链
          const refA = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://A>', predicate: '<http://p>', object: 'A', graph: '' },
          })).ref;
          
          const refB = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://B>', predicate: '<http://p>', object: 'B', graph: '' },
          })).ref;
          
          const refC = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://C>', predicate: '<http://p>', object: 'C', graph: '' },
          })).ref;
          
          await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://D>', predicate: '<http://p>', object: 'D', graph: '' },
          });
          
          // 当前状态：A, B, C, D
          let quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(4);
          
          // 从 refA 分叉，添加 E
          const opE: Operation = {
            type: 'insert',
            quad: { subject: '<http://E>', predicate: '<http://p>', object: 'E', graph: '' },
          };
          const refE = await generateRef(refA, opE);
          
          const result = await instance.syncOperations(refA, [
            { operation: opE, ref: refE },
          ]);
          
          expect(result.success).toBe(true);
          
          // 当前状态应该是 A + E（从 refA 分叉，没有 B, C, D）
          quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(2);
          
          const subjects = quads.map(q => q.subject).sort();
          expect(subjects).toEqual(['<http://A>', '<http://E>']);
        });
      });

      it('should handle fork and then continue on original branch', async () => {
        const stub = getSaveObject('edge-fork-2');
        
        await runInDurableObject(stub, async (instance: CloudSaveObject) => {
          await instance.initialize('user-1', 'state-1');
          
          // 创建 A -> B
          const refA = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://A>', predicate: '<http://p>', object: 'A', graph: '' },
          })).ref;
          
          const refB = (await applyOperation(instance, {
            type: 'insert',
            quad: { subject: '<http://B>', predicate: '<http://p>', object: 'B', graph: '' },
          })).ref;
          
          // 从 refA 分叉，添加 C
          const opC: Operation = {
            type: 'insert',
            quad: { subject: '<http://C>', predicate: '<http://p>', object: 'C', graph: '' },
          };
          const refC = await generateRef(refA, opC);
          
          await instance.syncOperations(refA, [
            { operation: opC, ref: refC },
          ]);
          
          // 现在切回 refB 继续
          const opD: Operation = {
            type: 'insert',
            quad: { subject: '<http://D>', predicate: '<http://p>', object: 'D', graph: '' },
          };
          const refD = await generateRef(refB, opD);
          
          const result = await instance.syncOperations(refB, [
            { operation: opD, ref: refD },
          ]);
          
          expect(result.success).toBe(true);
          
          // 当前状态应该是 A + B + D（从 refB 继续，没有 C）
          const quads = await getCurrentQuads(instance);
          expect(quads).toHaveLength(3);
          
          const subjects = quads.map(q => q.subject).sort();
          expect(subjects).toEqual(['<http://A>', '<http://B>', '<http://D>']);
        });
      });
    });
  });
});
