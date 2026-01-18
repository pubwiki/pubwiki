import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { registerUser } from './helpers';
import { ROOT_REF, generateRef } from '@pubwiki/rdfsync';
import type {
  CloudSave,
  ApiError,
  SyncOperationsRequest,
  SyncOperationsResponse,
  VersionHistoryResponse,
} from '@pubwiki/api';
import type { Operation, Quad } from '@pubwiki/rdfsync';

describe('E2E: Saves API', () => {
  let worker: Unstable_DevWorker;
  let baseUrl: string;
  let sessionCookie: string;
  let testUserId: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;

    // 创建测试用户并获取 session cookie
    const username = `save_test_${Date.now()}`;
    const result = await registerUser(baseUrl, username);
    sessionCookie = result.sessionCookie;
    testUserId = result.userId;
  });

  afterAll(async () => {
    await worker.stop();
  });

  // ============ CRUD 测试 ============

  describe('Save CRUD Operations', () => {
    let createdSaveId: string;

    it('should create a new save', async () => {
      const response = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'E2E Test Save',
          description: 'Created for e2e testing',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as CloudSave;
      expect(data.id).toBeDefined();
      expect(data.name).toBe('E2E Test Save');
      expect(data.description).toBe('Created for e2e testing');
      expect(data.userId).toBe(testUserId);
      // currentRef 在创建时可能为 null（D1 索引表），实际 ROOT_REF 在 DO 中
      // 这是预期行为，因为 D1 只存索引，DO 存实际数据

      createdSaveId = data.id;
    });

    it('should list saves', async () => {
      const response = await fetch(`${baseUrl}/saves`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { saves: CloudSave[] };
      expect(data.saves).toBeInstanceOf(Array);
      expect(data.saves.length).toBeGreaterThanOrEqual(1);
      
      const testSave = data.saves.find(s => s.id === createdSaveId);
      expect(testSave).toBeDefined();
      expect(testSave?.name).toBe('E2E Test Save');
    });

    it('should delete save', async () => {
      // 先创建一个要删除的 save
      const createResponse = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'To be deleted' }),
      });
      const created = await createResponse.json() as CloudSave;

      // 删除
      const deleteResponse = await fetch(`${baseUrl}/saves/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      expect(deleteResponse.status).toBe(204);

      // 确认已删除，通过获取列表检查
      const listResponse = await fetch(`${baseUrl}/saves`, {
        headers: { Cookie: sessionCookie },
      });
      const list = await listResponse.json() as { saves: CloudSave[] };
      const deleted = list.saves.find(s => s.id === created.id);
      expect(deleted).toBeUndefined();
    });
  });

  // ============ 可验证同步测试 ============

  describe('Verifiable Sync Operations', () => {
    let syncSaveId: string;

    beforeAll(async () => {
      // 创建专门用于同步测试的 save
      const response = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Sync Test Save' }),
      });
      const data = await response.json() as CloudSave;
      syncSaveId = data.id;
    });

    it('should sync operations successfully', async () => {
      const quad: Quad = {
        subject: 'http://example.org/subject1',
        predicate: 'http://example.org/predicate1',
        object: 'value1',
        graph: '',
      };
      const operation: Operation = { type: 'insert', quad };
      const expectedRef = await generateRef(ROOT_REF, operation);

      const syncRequest: SyncOperationsRequest = {
        baseRef: ROOT_REF,
        operations: [{ operation, ref: expectedRef }],
      };

      const response = await fetch(`${baseUrl}/saves/${syncSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequest),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as SyncOperationsResponse;
      expect(data.success).toBe(true);
      expect(data.finalRef).toBe(expectedRef);
      expect(data.affectedCount).toBe(1);
    });

    it('should chain multiple operations correctly', async () => {
      // 先获取当前 ref（通过 history API）
      const historyResponse = await fetch(`${baseUrl}/saves/${syncSaveId}/history?limit=1`, {
        headers: { Cookie: sessionCookie },
      });
      const historyData = await historyResponse.json() as VersionHistoryResponse;
      // 如果有历史记录，取最新的，否则用 ROOT_REF
      const latestRef = historyData.versions.length > 0 ? historyData.versions[0].ref : ROOT_REF;

      // 创建链式操作
      const quad1: Quad = {
        subject: 'http://example.org/subject2',
        predicate: 'http://example.org/name',
        object: 'Entity 2',
        graph: '',
      };
      const quad2: Quad = {
        subject: 'http://example.org/subject3',
        predicate: 'http://example.org/name',
        object: 'Entity 3',
        graph: '',
      };

      const op1: Operation = { type: 'insert', quad: quad1 };
      const op2: Operation = { type: 'insert', quad: quad2 };

      const ref1 = await generateRef(latestRef, op1);
      const ref2 = await generateRef(ref1, op2);

      const syncRequest: SyncOperationsRequest = {
        baseRef: latestRef,
        operations: [
          { operation: op1, ref: ref1 },
          { operation: op2, ref: ref2 },
        ],
      };

      const response = await fetch(`${baseUrl}/saves/${syncSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequest),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as SyncOperationsResponse;
      expect(data.success).toBe(true);
      expect(data.finalRef).toBe(ref2);
      expect(data.affectedCount).toBe(2);
    });

    it('should fail with UNKNOWN_BASE_REF for invalid baseRef', async () => {
      const quad: Quad = {
        subject: 'http://example.org/subject',
        predicate: 'http://example.org/predicate',
        object: 'value',
        graph: '',
      };
      const operation: Operation = { type: 'insert', quad };
      const fakeBaseRef = 'abcdef1234567890';
      const expectedRef = await generateRef(fakeBaseRef, operation);

      const syncRequest: SyncOperationsRequest = {
        baseRef: fakeBaseRef,
        operations: [{ operation, ref: expectedRef }],
      };

      const response = await fetch(`${baseUrl}/saves/${syncSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequest),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as SyncOperationsResponse;
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNKNOWN_BASE_REF');
    });

    it('should fail with REF_MISMATCH for wrong expectedRef', async () => {
      // 获取当前 ref（通过 history API）
      const historyResponse = await fetch(`${baseUrl}/saves/${syncSaveId}/history?limit=1`, {
        headers: { Cookie: sessionCookie },
      });
      const historyData = await historyResponse.json() as VersionHistoryResponse;
      const latestRef = historyData.versions.length > 0 ? historyData.versions[0].ref : ROOT_REF;

      const quad: Quad = {
        subject: 'http://example.org/mismatch',
        predicate: 'http://example.org/test',
        object: 'value',
        graph: '',
      };
      const operation: Operation = { type: 'insert', quad };

      const syncRequest: SyncOperationsRequest = {
        baseRef: latestRef,
        operations: [{ operation, ref: 'wrongref123456' }],
      };

      const response = await fetch(`${baseUrl}/saves/${syncSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequest),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as SyncOperationsResponse;
      expect(data.success).toBe(false);
      expect(data.error).toBe('REF_MISMATCH');
    });
  });

  // ============ 版本历史测试 ============

  describe('Version History', () => {
    let historySaveId: string;

    beforeAll(async () => {
      // 创建专门用于历史测试的 save
      const createResponse = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'History Test Save' }),
      });
      const created = await createResponse.json() as CloudSave;
      historySaveId = created.id;

      // 添加几个操作来创建版本历史
      let currentRef = ROOT_REF;
      for (let i = 1; i <= 3; i++) {
        const quad: Quad = {
          subject: `http://example.org/item${i}`,
          predicate: 'http://example.org/value',
          object: `value${i}`,
          graph: '',
        };
        const op: Operation = { type: 'insert', quad };
        const ref = await generateRef(currentRef, op);

        await fetch(`${baseUrl}/saves/${historySaveId}/sync`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            baseRef: currentRef,
            operations: [{ operation: op, ref }],
          }),
        });

        currentRef = ref;
      }
    });

    it('should get version history', async () => {
      const response = await fetch(`${baseUrl}/saves/${historySaveId}/history`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as VersionHistoryResponse;
      expect(data.versions).toHaveLength(3);

      // 验证每个版本都有必要的字段
      for (const version of data.versions) {
        expect(version.ref).toBeDefined();
        expect(version.timestamp).toBeDefined();
      }
    });

    it('should respect limit parameter', async () => {
      const response = await fetch(`${baseUrl}/saves/${historySaveId}/history?limit=2`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as VersionHistoryResponse;
      expect(data.versions).toHaveLength(2);
    });
  });

  // ============ 权限测试 ============

  describe('Access Control', () => {
    let otherUserCookie: string;
    let privateSaveId: string;

    beforeAll(async () => {
      // 创建另一个用户
      const otherUsername = `other_user_${Date.now()}`;
      const result = await registerUser(baseUrl, otherUsername);
      otherUserCookie = result.sessionCookie;

      // 第一个用户创建一个 save
      const response = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Private Save' }),
      });
      const data = await response.json() as CloudSave;
      privateSaveId = data.id;
    });

    it('should deny access to other user save', async () => {
      // 使用 GET /saves/:saveId/history 测试访问控制
      const response = await fetch(`${baseUrl}/saves/${privateSaveId}/history`, {
        headers: { Cookie: otherUserCookie },
      });

      expect(response.status).toBe(403);
      const data = await response.json() as ApiError;
      expect(data.error).toBe('Access denied');
    });

    it('should deny sync to other user save', async () => {
      const quad: Quad = {
        subject: 'http://example.org/hacker',
        predicate: 'http://example.org/attempt',
        object: 'malicious',
        graph: '',
      };
      const op: Operation = { type: 'insert', quad };
      const ref = await generateRef(ROOT_REF, op);

      const response = await fetch(`${baseUrl}/saves/${privateSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: otherUserCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseRef: ROOT_REF,
          operations: [{ operation: op, ref }],
        }),
      });

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/saves`);
      expect(response.status).toBe(401);
    });
  });
});
