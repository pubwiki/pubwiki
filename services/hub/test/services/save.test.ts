import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  SaveService,
  NodeVersionService,
  AclService,
  DiscoveryService,
  BatchContext,
  user,
  nodeVersions,
  saveContents,
  stateContents,
  artifactVersions,
  artifacts,
  resourceDiscoveryControl,
  resourceAcl,
} from '@pubwiki/db';
import type { SyncNodeVersionInput } from '@pubwiki/db';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

describe('SaveService', () => {
  let db: ReturnType<typeof createDb>;
  let ctx: BatchContext;
  let service: SaveService;
  let testUserId: string;

  // Helper: create a test user directly in DB
  async function createTestUser(username = 'testuser'): Promise<string> {
    const now = new Date();
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      username,
      email: `${username}@test.com`,
      displayName: username,
      emailVerified: false,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
      displayUsername: username,
      bio: null,
      website: null,
      location: null,
      isVerified: false,
    });
    return userId;
  }

  // Helper: commit batch and reset context for next operation
  async function commitAndReset(): Promise<void> {
    await ctx.commit();
    ctx = new BatchContext(db);
    service = new SaveService(ctx);
  }

  // Helper: create a STATE node version
  async function createStateNode(stateNodeId: string, name: string, description?: string): Promise<string> {
    const content = { type: 'STATE' as const, name, description };
    const contentHash = await computeContentHash(content);
    const commit = await computeNodeCommit(stateNodeId, null, contentHash, 'STATE');

    const nodeVersionService = new NodeVersionService(ctx);
    const syncInput: SyncNodeVersionInput = {
      nodeId: stateNodeId,
      commit,
      parent: null,
      authorId: testUserId,
      sourceArtifactId: crypto.randomUUID(),
      type: 'STATE',
      contentHash,
      content,
      isListed: true,
      name: 'state-node',
    };
    await nodeVersionService.syncVersions([syncInput]);
    await commitAndReset();
    return commit;
  }

  // Helper: create an artifact with version
  async function createArtifact(artifactId: string, stateNodeId: string, stateNodeCommit: string): Promise<string> {
    const now = new Date().toISOString();

    // Create artifact
    await db.insert(artifacts).values({
      id: artifactId,
      authorId: testUserId,
      name: 'Test Artifact',
      description: null,
      license: null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    });

    // Compute artifact commit
    const nodes = [{ nodeId: stateNodeId, commit: stateNodeCommit }];
    const edges: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null }[] = [];
    const artifactCommit = await computeArtifactCommit(artifactId, null, nodes, edges);

    // Create artifact version
    await db.insert(artifactVersions).values({
      id: crypto.randomUUID(),
      artifactId,
      commitHash: artifactCommit,
      version: '1.0.0',
      changelog: null,
      entrypoint: null,
      createdAt: now,
    });

    // Create discovery control
    await db.insert(resourceDiscoveryControl).values({
      resourceType: 'artifact',
      resourceId: artifactId,
      isListed: true,
      createdAt: now,
      updatedAt: now,
    });

    return artifactCommit;
  }

  beforeEach(async () => {
    db = createDb(env.DB);
    ctx = new BatchContext(db);
    service = new SaveService(ctx);

    // Clean tables (reverse FK order)
    await db.delete(saveContents);
    await db.delete(stateContents);
    await db.delete(nodeVersions);
    await db.delete(artifactVersions);
    await db.delete(resourceDiscoveryControl);
    await db.delete(resourceAcl);
    await db.delete(artifacts);
    await db.delete(user);

    // Create test user
    testUserId = await createTestUser();
  });

  describe('createRuntimeSave', () => {
    it('should reject save with non-existent stateNodeId', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      // Create artifact without any STATE node
      const now = new Date().toISOString();
      await db.insert(artifacts).values({
        id: artifactId,
        authorId: testUserId,
        name: 'Test Artifact',
        description: null,
        license: null,
        thumbnailUrl: null,
        createdAt: now,
        updatedAt: now,
      });

      // Create artifact version
      const artifactCommit = await computeArtifactCommit(artifactId, null, [], []);
      await db.insert(artifactVersions).values({
        id: crypto.randomUUID(),
        artifactId,
        commitHash: artifactCommit,
        version: '1.0.0',
        changelog: null,
        entrypoint: null,
        createdAt: now,
      });

      // Compute save contentHash (using new schema with artifactId and artifactCommit)
      const quadsHash = 'abcd1234'.repeat(8); // 64 char hex hash placeholder
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Try to create save with non-existent stateNodeId
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        description: 'This should fail',
        isListed: false,
      });

      // Should fail because stateNodeId does not exist
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BAD_REQUEST');
        expect(result.error.message).toContain('STATE node');
      }
    });

    it('should create save successfully with valid stateNodeId', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      // Create a real STATE node
      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');

      // Create artifact with the STATE node
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Compute save contentHash
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Create save with valid stateNodeId
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        description: 'This should succeed',
        isListed: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.commit).toBe(saveCommit);
      }
    });

    it('should reject save with non-existent artifact version', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();
      const fakeArtifactCommit = 'fake-artifact-commit';

      // Create a real STATE node
      await createStateNode(stateNodeId, 'Game State');

      // Do NOT create artifact version

      // Compute save contentHash
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit: fakeArtifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Try to create save with non-existent artifact version
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit: fakeArtifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        description: 'This should fail',
        isListed: false,
      });

      // Should fail because artifact version does not exist
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BAD_REQUEST');
        expect(result.error.message).toContain('Artifact version');
      }
    });

    it('should create owner ACL record when creating save', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      // Create a real STATE node
      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');

      // Create artifact with the STATE node
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Compute save
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Create save
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        isListed: false,
      });

      expect(result.success).toBe(true);
      await commitAndReset();

      // Verify owner ACL record was created (uses 'node' type, created by syncVersions)
      const aclService = new AclService(ctx);
      const nodeRef = { type: 'node' as const, id: saveCommit };
      const canManage = await aclService.canManage(nodeRef, testUserId);
      const canWrite = await aclService.canWrite(nodeRef, testUserId);
      const canRead = await aclService.canRead(nodeRef, testUserId);

      expect(canManage).toBe(true);
      expect(canWrite).toBe(true);
      expect(canRead).toBe(true);
    });

    it('should NOT create public ACL for saves (inherits from artifact)', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        isListed: true,
      });

      await commitAndReset();

      // Verify NO public ACL was created (save should NOT have public read by itself)
      const aclService = new AclService(ctx);
      const nodeRef = { type: 'node' as const, id: saveCommit };
      const isPublic = await aclService.isPublic(nodeRef);
      expect(isPublic).toBe(false);
    });
  });

  describe('canReadSave', () => {
    // Helper to create a full save scenario
    async function createSaveScenario(opts: {
      saveIsListed?: boolean;
      artifactIsPublic?: boolean;
    }) {
      const { saveIsListed = false, artifactIsPublic = true } = opts;
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Set artifact public ACL if needed
      if (artifactIsPublic) {
        const aclCtx = new BatchContext(db);
        const aclService = new AclService(aclCtx);
        aclService.setPublic({ type: 'artifact', id: artifactId }, testUserId);
        await aclCtx.commit();
      }

      // Create save
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      ctx = new BatchContext(db);
      service = new SaveService(ctx);

      await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        isListed: saveIsListed,
      });

      await commitAndReset();

      return { saveCommit, artifactId };
    }

    it('should allow author to read their own save (even if isListed=false)', async () => {
      const { saveCommit } = await createSaveScenario({ saveIsListed: false });

      const canRead = await service.canReadSave(saveCommit, testUserId);
      expect(canRead).toBe(true);
    });

    it('should allow non-author to read save if artifact is public', async () => {
      const { saveCommit } = await createSaveScenario({
        saveIsListed: false,
        artifactIsPublic: true,
      });

      // Create another user
      const otherUserId = await createTestUser('otheruser');

      const canRead = await service.canReadSave(saveCommit, otherUserId);
      expect(canRead).toBe(true);
    });

    it('should deny non-author from reading save if artifact is private', async () => {
      const { saveCommit } = await createSaveScenario({
        saveIsListed: true,
        artifactIsPublic: false,
      });

      // Create another user
      const otherUserId = await createTestUser('otheruser');

      const canRead = await service.canReadSave(saveCommit, otherUserId);
      expect(canRead).toBe(false);
    });

    it('should allow anonymous user to read save if artifact is public', async () => {
      const { saveCommit } = await createSaveScenario({
        saveIsListed: false,
        artifactIsPublic: true,
      });

      // Anonymous user (undefined userId)
      const canRead = await service.canReadSave(saveCommit, undefined);
      expect(canRead).toBe(true);
    });

    it('should deny anonymous user from reading save if artifact is private', async () => {
      const { saveCommit } = await createSaveScenario({
        saveIsListed: true,
        artifactIsPublic: false,
      });

      const canRead = await service.canReadSave(saveCommit, undefined);
      expect(canRead).toBe(false);
    });

    it('should return false for non-existent save', async () => {
      const canRead = await service.canReadSave('non-existent-commit', testUserId);
      expect(canRead).toBe(false);
    });
  });

  describe('listSaves access control', () => {
    async function createSaveWithAccess(opts: {
      saveIsListed: boolean;
      artifactIsPublic: boolean;
      authorId: string;
      stateNodeId: string;
      artifactId: string;
      artifactCommit: string;
      title: string;
    }) {
      const { saveIsListed, authorId, stateNodeId, artifactId, artifactCommit, title } = opts;

      const quadsHash = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title,
        description: null,
      });
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      ctx = new BatchContext(db);
      service = new SaveService(ctx);

      await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title,
        isListed: saveIsListed,
      });

      await commitAndReset();

      return { saveCommit, saveId };
    }

    it('should show author all their saves regardless of isListed', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Artifact public/private doesn't affect listSaves

      // Create listed save
      await createSaveWithAccess({
        saveIsListed: true,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Listed Save',
      });

      // Create unlisted save
      await createSaveWithAccess({
        saveIsListed: false,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Unlisted Save',
      });

      // Author should see both saves when querying by stateNodeId
      const result = await service.listSaves({
        stateNodeId,
        userId: testUserId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.saves.length).toBe(2);
      }
    });

    it('should only show non-author listed saves', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Artifact public/private doesn't affect listSaves - only isListed matters

      // Create listed save
      await createSaveWithAccess({
        saveIsListed: true,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Listed Save',
      });

      // Create unlisted save
      await createSaveWithAccess({
        saveIsListed: false,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Unlisted Save',
      });

      // Create another user
      const otherUserId = await createTestUser('otheruser');

      // Other user should only see the listed save (regardless of artifact ACL)
      const result = await service.listSaves({
        stateNodeId,
        userId: otherUserId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.saves.length).toBe(1);
        expect(result.data.saves[0].title).toBe('Listed Save');
      }
    });

    it('should only show anonymous user listed saves', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Artifact public/private doesn't affect listSaves - only isListed matters

      // Create listed save
      await createSaveWithAccess({
        saveIsListed: true,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Listed Save',
      });

      // Create unlisted save
      await createSaveWithAccess({
        saveIsListed: false,
        artifactIsPublic: false,
        authorId: testUserId,
        stateNodeId,
        artifactId,
        artifactCommit,
        title: 'Unlisted Save',
      });

      // Anonymous user should only see the listed save (regardless of artifact ACL)
      const result = await service.listSaves({
        stateNodeId,
        userId: undefined,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.saves.length).toBe(1);
        expect(result.data.saves[0].title).toBe('Listed Save');
      }
    });
  });

  describe('deleteSave ACL cleanup', () => {
    it('should delete ACL and discovery control records when save is deleted', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Create save
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        artifactId,
        artifactCommit,
        quadsHash,
        saveEncoding: 'keyframe',
        parentCommit: null,
        title: 'Test Save',
        description: null,
      });
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      await service.createRuntimeSave({
        saveId,
        stateNodeId,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        saveEncoding: 'keyframe',
        title: 'Test Save',
        isListed: true,
      });

      await commitAndReset();

      // Verify ACL exists before delete (uses 'node' type)
      const aclService = new AclService(ctx);
      const nodeRef = { type: 'node' as const, id: saveCommit };
      let canManage = await aclService.canManage(nodeRef, testUserId);
      expect(canManage).toBe(true);

      // Delete save
      const deleteResult = await service.deleteSave(saveCommit, testUserId);
      expect(deleteResult.success).toBe(true);

      await commitAndReset();

      // Verify ACL was deleted
      canManage = await aclService.canManage(nodeRef, testUserId);
      expect(canManage).toBe(false);

      // Verify discovery control was deleted
      const discoveryService = new DiscoveryService(ctx);
      const isListed = await discoveryService.isListed(nodeRef);
      expect(isListed).toBe(false);
    });
  });
});
