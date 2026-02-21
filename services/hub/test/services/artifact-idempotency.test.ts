/**
 * Tests for ArtifactService.createArtifact idempotency.
 * 
 * Verifies that:
 * 1. Creating an artifact with a new artifactId succeeds
 * 2. Attempting to create an artifact with an existing artifactId returns 409 Conflict
 * 3. The conflict detection works via optimistic locking (ON CONFLICT DO NOTHING + expectAffected=1)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  ArtifactService,
  BatchContext,
  OptimisticLockError,
  user,
  nodeVersions,
  artifactVersions,
  artifacts,
  resourceDiscoveryControl,
  artifactVersionNodes,
  artifactVersionEdges,
  artifactStats,
  resourceAcl,
} from '@pubwiki/db';
import type { CreateArtifactNode } from '@pubwiki/db';
import type { ArtifactEdgeDescriptor } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

describe('ArtifactService.createArtifact - idempotency', () => {
  let db: ReturnType<typeof createDb>;
  let ctx: BatchContext;
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

  // Helper: create simple artifact input
  async function createSimpleArtifactInput(artifactId: string) {
    // Create a simple SANDBOX node
    const sandboxNodeId = crypto.randomUUID();
    const sandboxContent = { type: 'SANDBOX' as const, entryFile: 'index.html' };
    const sandboxContentHash = await computeContentHash(sandboxContent);
    const sandboxCommit = await computeNodeCommit(sandboxNodeId, null, sandboxContentHash, 'SANDBOX');

    const nodes: CreateArtifactNode[] = [
      {
        nodeId: sandboxNodeId,
        commit: sandboxCommit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxContentHash,
        content: sandboxContent,
      },
    ];
    const edges: ArtifactEdgeDescriptor[] = [];

    // Compute artifact commit
    const commitNodes = nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }));
    const artifactCommit = await computeArtifactCommit(artifactId, null, commitNodes, commitEdges);

    return {
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Test Artifact',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    };
  }

  beforeEach(async () => {
    db = createDb(env.DB);
    ctx = new BatchContext(db);

    // Clean tables (reverse FK order)
    await db.delete(resourceAcl);
    await db.delete(resourceDiscoveryControl);
    await db.delete(artifactStats);
    await db.delete(artifactVersionEdges);
    await db.delete(artifactVersionNodes);
    await db.delete(nodeVersions);
    await db.delete(artifactVersions);
    await db.delete(artifacts);
    await db.delete(user);

    // Create test user
    testUserId = await createTestUser();
  });

  it('should successfully create a new artifact', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifact.id).toBe(artifactId);
    }

    // Commit should succeed
    await expect(ctx.commit()).resolves.toBeUndefined();

    // Verify artifact exists in DB
    const dbArtifact = await db.select().from(artifacts).where((await import('@pubwiki/db')).eq(artifacts.id, artifactId));
    expect(dbArtifact.length).toBe(1);
    expect(dbArtifact[0].name).toBe('Test Artifact');
  });

  it('should throw OptimisticLockError when creating artifact with existing artifactId', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    // First creation: should succeed
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    const result1 = await artifactService1.createArtifact(input);
    expect(result1.success).toBe(true);
    await ctx1.commit();

    // Second creation with same artifactId: should fail at commit time
    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    
    // The service method itself succeeds (it just queues operations)
    const result2 = await artifactService2.createArtifact(input);
    expect(result2.success).toBe(true);

    // But commit should throw OptimisticLockError
    await expect(ctx2.commit()).rejects.toThrow(OptimisticLockError);
  });

  it('should detect duplicate artifactId even with different content', async () => {
    const artifactId = crypto.randomUUID();
    
    // First creation with original content
    const input1 = await createSimpleArtifactInput(artifactId);
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input1);
    await ctx1.commit();

    // Second creation with same artifactId but different content/nodes
    const sandboxNodeId2 = crypto.randomUUID();
    const sandboxContent2 = { type: 'SANDBOX' as const, entryFile: 'main.html' };
    const sandboxContentHash2 = await computeContentHash(sandboxContent2);
    const sandboxCommit2 = await computeNodeCommit(sandboxNodeId2, null, sandboxContentHash2, 'SANDBOX');

    const nodes2: CreateArtifactNode[] = [
      {
        nodeId: sandboxNodeId2,
        commit: sandboxCommit2,
        type: 'SANDBOX',
        name: 'different-sandbox',
        contentHash: sandboxContentHash2,
        content: sandboxContent2,
      },
    ];

    const commitNodes2 = nodes2.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
    const artifactCommit2 = await computeArtifactCommit(artifactId, null, commitNodes2, []);

    const input2 = {
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit2,
        name: 'Different Artifact',
        isListed: true,
        isPrivate: false,
      },
      nodes: nodes2,
      edges: [] as ArtifactEdgeDescriptor[],
    };

    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    await artifactService2.createArtifact(input2);

    // Should fail due to duplicate artifactId
    await expect(ctx2.commit()).rejects.toThrow(OptimisticLockError);
  });

  it('should allow creating different artifacts with different artifactIds', async () => {
    const artifactId1 = crypto.randomUUID();
    const artifactId2 = crypto.randomUUID();

    // Create first artifact
    const input1 = await createSimpleArtifactInput(artifactId1);
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input1);
    await ctx1.commit();

    // Create second artifact with different ID
    const input2 = await createSimpleArtifactInput(artifactId2);
    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    await artifactService2.createArtifact(input2);
    
    // Should succeed
    await expect(ctx2.commit()).resolves.toBeUndefined();

    // Verify both exist
    const allArtifacts = await db.select().from(artifacts);
    expect(allArtifacts.length).toBe(2);
  });

  it('OptimisticLockError should contain meaningful message', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    // First creation
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input);
    await ctx1.commit();

    // Second creation - should fail
    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    await artifactService2.createArtifact(input);

    try {
      await ctx2.commit();
      expect.fail('Should have thrown OptimisticLockError');
    } catch (error) {
      expect(error).toBeInstanceOf(OptimisticLockError);
      const lockError = error as OptimisticLockError;
      expect(lockError.msg).toContain(artifactId);
      expect(lockError.msg).toContain('already exists');
    }
  });
});
