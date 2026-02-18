import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  SaveService,
  NodeVersionService,
  BatchContext,
  user,
  nodeVersions,
  saveContents,
  stateContents,
  artifactVersions,
  artifacts,
  resourceDiscoveryControl,
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
    await db.delete(artifacts);
    await db.delete(user);

    // Create test user
    testUserId = await createTestUser();
  });

  describe('createRuntimeSave', () => {
    it('should reject save with non-existent stateNodeId', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();
      const fakeStateNodeCommit = 'fake-commit-that-does-not-exist';

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
        stateNodeCommit: fakeStateNodeCommit,
        artifactId,
        artifactCommit,
        quadsHash,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Try to create save with non-existent stateNodeId + stateNodeCommit
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        stateNodeCommit: fakeStateNodeCommit,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        title: 'Test Save',
        description: 'This should fail',
        isListed: false,
      });

      // Should fail because stateNodeId + stateNodeCommit does not exist
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BAD_REQUEST');
        expect(result.error.message).toContain('STATE node');
      }
    });

    it('should reject save with mismatched stateNodeCommit', async () => {
      const artifactId = crypto.randomUUID();
      const stateNodeId = crypto.randomUUID();

      // Create a real STATE node
      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');

      // Create artifact with the STATE node
      const artifactCommit = await createArtifact(artifactId, stateNodeId, stateNodeCommit);

      // Compute save contentHash with WRONG stateNodeCommit
      const wrongStateNodeCommit = 'wrong-commit-hash';
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        stateNodeCommit: wrongStateNodeCommit,
        artifactId,
        artifactCommit,
        quadsHash,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Try to create save with wrong stateNodeCommit
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        stateNodeCommit: wrongStateNodeCommit,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
        title: 'Test Save',
        description: 'This should fail',
        isListed: false,
      });

      // Should fail because stateNodeCommit does not match
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BAD_REQUEST');
        expect(result.error.message).toContain('STATE node');
      }
    });

    it('should create save successfully with valid stateNodeId and stateNodeCommit', async () => {
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
        stateNodeCommit,
        artifactId,
        artifactCommit,
        quadsHash,
        title: 'Test Save',
        description: null,
      });

      // Compute save commit
      const saveId = crypto.randomUUID();
      const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

      // Create save with valid stateNodeId + stateNodeCommit
      const result = await service.createRuntimeSave({
        saveId,
        stateNodeId,
        stateNodeCommit,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit,
        contentHash: saveContentHash,
        quadsHash,
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
      const stateNodeCommit = await createStateNode(stateNodeId, 'Game State');

      // Do NOT create artifact version

      // Compute save contentHash
      const quadsHash = 'abcd1234'.repeat(8);
      const saveContentHash = await computeContentHash({
        type: 'SAVE',
        stateNodeId,
        stateNodeCommit,
        artifactId,
        artifactCommit: fakeArtifactCommit,
        quadsHash,
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
        stateNodeCommit,
        commit: saveCommit,
        parent: null,
        authorId: testUserId,
        artifactId,
        artifactCommit: fakeArtifactCommit,
        contentHash: saveContentHash,
        quadsHash,
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
  });
});
