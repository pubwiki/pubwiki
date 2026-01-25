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

  // ============ Checkpoint API 测试 ============

  describe('Checkpoint API', () => {
    let checkpointSaveId: string;
    let validRef: string;

    beforeAll(async () => {
      // 创建专门用于 checkpoint 测试的 save
      const createResponse = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Checkpoint Test Save' }),
      });
      const created = await createResponse.json() as CloudSave;
      checkpointSaveId = created.id;

      // 添加一个操作来创建有效的 ref
      const quad: Quad = {
        subject: 'http://example.org/checkpoint-test',
        predicate: 'http://example.org/value',
        object: 'test-value',
        graph: '',
      };
      const op: Operation = { type: 'insert', quad };
      validRef = await generateRef(ROOT_REF, op);

      await fetch(`${baseUrl}/saves/${checkpointSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseRef: ROOT_REF,
          operations: [{ operation: op, ref: validRef }],
        }),
      });
    });

    it('should create checkpoint on valid ref', async () => {
      const response = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: validRef,
          name: 'Test Checkpoint',
          description: 'Created for testing',
          visibility: 'PRIVATE',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { success: boolean; id: string };
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();
      expect(typeof data.id).toBe('string');
    });

    it('should list checkpoints with id field', async () => {
      const response = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { checkpoints: Array<{ id: string; ref: string; name: string }> };
      expect(data.checkpoints).toBeInstanceOf(Array);
      expect(data.checkpoints.length).toBeGreaterThanOrEqual(1);

      const created = data.checkpoints.find(cp => cp.ref === validRef);
      expect(created).toBeDefined();
      expect(created?.id).toBeDefined();
      expect(created?.name).toBe('Test Checkpoint');
    });

    it('should fail to create checkpoint with non-existent ref', async () => {
      const fakeRef = 'nonexistent1234567890abcdef';

      const response = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: fakeRef,
          name: 'Invalid Checkpoint',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain('does not exist');
    });

    it('should allow multiple checkpoints for same ref', async () => {
      // 创建另一个使用相同 ref 的 checkpoint
      const response = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: validRef,
          name: 'Another Checkpoint Same Ref',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json() as { success: boolean; id: string };
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();
    });

    it('should fail to create checkpoint with duplicate id', async () => {
      const customId = 'my-custom-checkpoint-id';

      // 创建第一个带自定义 ID 的 checkpoint
      const first = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: validRef,
          id: customId,
          name: 'First with custom ID',
        }),
      });
      expect(first.status).toBe(201);

      // 尝试创建相同 ID 的 checkpoint
      const response = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: validRef,
          id: customId,
          name: 'Duplicate ID Checkpoint',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as ApiError;
      expect(data.error).toContain('already exists');
    });

    it('should delete checkpoint by id', async () => {
      // 先创建一个新的 ref 和 checkpoint
      const quad: Quad = {
        subject: 'http://example.org/to-delete',
        predicate: 'http://example.org/value',
        object: 'delete-me',
        graph: '',
      };
      const op: Operation = { type: 'insert', quad };
      const refToDelete = await generateRef(validRef, op);

      // 先同步操作创建新的 ref
      await fetch(`${baseUrl}/saves/${checkpointSaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseRef: validRef,
          operations: [{ operation: op, ref: refToDelete }],
        }),
      });

      // 创建 checkpoint
      const createResponse = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: refToDelete,
          name: 'To Delete',
        }),
      });
      const created = await createResponse.json() as { id: string };
      const checkpointIdToDelete = created.id;

      // 删除 checkpoint by id
      const deleteResponse = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints/${checkpointIdToDelete}`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });

      expect(deleteResponse.status).toBe(204);

      // 确认已删除
      const listResponse = await fetch(`${baseUrl}/saves/${checkpointSaveId}/checkpoints`, {
        headers: { Cookie: sessionCookie },
      });
      const list = await listResponse.json() as { checkpoints: Array<{ id: string; ref: string }> };
      const deleted = list.checkpoints.find(cp => cp.id === checkpointIdToDelete);
      expect(deleted).toBeUndefined();
    });

    it('should create checkpoint on ROOT_REF', async () => {
      // 创建一个新的 save 来测试 ROOT_REF
      const createResponse = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'ROOT_REF Checkpoint Test' }),
      });
      const created = await createResponse.json() as CloudSave;

      const response = await fetch(`${baseUrl}/saves/${created.id}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: ROOT_REF,
          name: 'Initial State',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  // ============ Checkpoint 可见性测试 ============

  describe('Checkpoint Visibility', () => {
    let visibilitySaveId: string;
    let publicRef: string;
    let privateRef: string;
    let otherUserCookie: string;

    beforeAll(async () => {
      // 创建另一个用户
      const otherUsername = `checkpoint_other_${Date.now()}`;
      const result = await registerUser(baseUrl, otherUsername);
      otherUserCookie = result.sessionCookie;

      // 创建专门用于可见性测试的 save
      const createResponse = await fetch(`${baseUrl}/saves`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Visibility Test Save' }),
      });
      const created = await createResponse.json() as CloudSave;
      visibilitySaveId = created.id;

      // 创建两个 ref
      const quad1: Quad = {
        subject: 'http://example.org/public-data',
        predicate: 'http://example.org/value',
        object: 'public',
        graph: '',
      };
      const op1: Operation = { type: 'insert', quad: quad1 };
      publicRef = await generateRef(ROOT_REF, op1);

      await fetch(`${baseUrl}/saves/${visibilitySaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseRef: ROOT_REF,
          operations: [{ operation: op1, ref: publicRef }],
        }),
      });

      const quad2: Quad = {
        subject: 'http://example.org/private-data',
        predicate: 'http://example.org/value',
        object: 'private',
        graph: '',
      };
      const op2: Operation = { type: 'insert', quad: quad2 };
      privateRef = await generateRef(publicRef, op2);

      await fetch(`${baseUrl}/saves/${visibilitySaveId}/sync`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseRef: publicRef,
          operations: [{ operation: op2, ref: privateRef }],
        }),
      });

      // 创建 PUBLIC checkpoint
      await fetch(`${baseUrl}/saves/${visibilitySaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: publicRef,
          name: 'Public Checkpoint',
          visibility: 'PUBLIC',
        }),
      });

      // 创建 PRIVATE checkpoint
      await fetch(`${baseUrl}/saves/${visibilitySaveId}/checkpoints`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: privateRef,
          name: 'Private Checkpoint',
          visibility: 'PRIVATE',
        }),
      });
    });

    it('owner should see all checkpoints', async () => {
      const response = await fetch(`${baseUrl}/saves/${visibilitySaveId}/checkpoints`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { checkpoints: Array<{ ref: string }> };
      expect(data.checkpoints).toHaveLength(2);
    });

    it('other user should only see PUBLIC checkpoints', async () => {
      const response = await fetch(`${baseUrl}/saves/${visibilitySaveId}/checkpoints`, {
        headers: { Cookie: otherUserCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { checkpoints: Array<{ ref: string; name: string }> };
      expect(data.checkpoints).toHaveLength(1);
      expect(data.checkpoints[0].name).toBe('Public Checkpoint');
    });

    it('unauthenticated user should only see PUBLIC checkpoints', async () => {
      const response = await fetch(`${baseUrl}/saves/${visibilitySaveId}/checkpoints`);

      expect(response.status).toBe(200);
      const data = await response.json() as { checkpoints: Array<{ ref: string; name: string }> };
      expect(data.checkpoints).toHaveLength(1);
      expect(data.checkpoints[0].name).toBe('Public Checkpoint');
    });

    it('other user can export PUBLIC checkpoint ref', async () => {
      const response = await fetch(`${baseUrl}/saves/${visibilitySaveId}/export/${publicRef}`, {
        headers: { Cookie: otherUserCookie },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ref).toBe(publicRef);
    });

    it('other user cannot export PRIVATE checkpoint ref', async () => {
      const response = await fetch(`${baseUrl}/saves/${visibilitySaveId}/export/${privateRef}`, {
        headers: { Cookie: otherUserCookie },
      });

      expect(response.status).toBe(403);
    });
  });
});