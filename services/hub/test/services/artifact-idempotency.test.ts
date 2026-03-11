/**
 * Tests for ArtifactService.createArtifact and patchArtifact idempotency.
 * 
 * Verifies that:
 * 1. Creating an artifact with a new artifactId succeeds
 * 2. Attempting to create an artifact with an existing artifactId causes batch rollback
 * 3. The conflict detection works via D1 UNIQUE constraint violation (batch rollback)
 * 4. Batch rollback leaves NO orphan records (versions, nodes, edges, stats, ACL)
 * 5. patchArtifact with duplicate commitHash rolls back without corrupting latestVersion
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  ArtifactService,
  BatchContext,
  user,
  nodeVersions,
  artifactVersions,
  artifacts,
  resourceDiscoveryControl,
  artifactVersionNodes,
  artifactVersionEdges,
  artifactStats,
  resourceAcl,
  eq,
  and,
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

  it('should throw UNIQUE constraint error when creating artifact with existing artifactId', async () => {
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

    // Commit should throw due to UNIQUE constraint violation (batch rollback)
    await expect(ctx2.commit()).rejects.toThrow('UNIQUE constraint failed');
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

    // Should fail due to UNIQUE constraint violation on artifacts.id (batch rollback)
    await expect(ctx2.commit()).rejects.toThrow('UNIQUE constraint failed');
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

  it('UNIQUE constraint error should mention the constraint', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    // First creation
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input);
    await ctx1.commit();

    // Second creation - should fail with UNIQUE constraint violation
    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    await artifactService2.createArtifact(input);

    try {
      await ctx2.commit();
      expect.fail('Should have thrown UNIQUE constraint error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('UNIQUE constraint failed');
    }
  });

  it('should leave NO orphan records when batch rollback occurs on duplicate createArtifact', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    // First creation: succeed
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input);
    await ctx1.commit();

    // Snapshot record counts after first successful creation
    const versionsBefore = await db.select().from(artifactVersions);
    const nodeVersionsBefore = await db.select().from(nodeVersions);
    const versionNodesBefore = await db.select().from(artifactVersionNodes);
    const versionEdgesBefore = await db.select().from(artifactVersionEdges);
    const statsBefore = await db.select().from(artifactStats);
    const aclBefore = await db.select().from(resourceAcl);
    const discoveryBefore = await db.select().from(resourceDiscoveryControl);

    // Second creation: should fail with UNIQUE constraint (batch rollback)
    const ctx2 = new BatchContext(db);
    const artifactService2 = new ArtifactService(ctx2);
    await artifactService2.createArtifact(input);
    await expect(ctx2.commit()).rejects.toThrow('UNIQUE constraint failed');

    // Verify NO orphan records were created — counts must be identical
    const versionsAfter = await db.select().from(artifactVersions);
    expect(versionsAfter.length).toBe(versionsBefore.length);

    const nodeVersionsAfter = await db.select().from(nodeVersions);
    expect(nodeVersionsAfter.length).toBe(nodeVersionsBefore.length);

    const versionNodesAfter = await db.select().from(artifactVersionNodes);
    expect(versionNodesAfter.length).toBe(versionNodesBefore.length);

    const versionEdgesAfter = await db.select().from(artifactVersionEdges);
    expect(versionEdgesAfter.length).toBe(versionEdgesBefore.length);

    const statsAfter = await db.select().from(artifactStats);
    expect(statsAfter.length).toBe(statsBefore.length);

    const aclAfter = await db.select().from(resourceAcl);
    expect(aclAfter.length).toBe(aclBefore.length);

    const discoveryAfter = await db.select().from(resourceDiscoveryControl);
    expect(discoveryAfter.length).toBe(discoveryBefore.length);

    // Verify original artifact is untouched
    const [originalArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
    expect(originalArtifact).toBeDefined();
    expect(originalArtifact.name).toBe('Test Artifact');
  });
});

describe('ArtifactService.patchArtifact - idempotency', () => {
  let db: ReturnType<typeof createDb>;
  let testUserId: string;

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

  async function createSandboxNode(name: string) {
    const nodeId = `node-${name}-${crypto.randomUUID()}`;
    const content = { type: 'SANDBOX' as const, entryFile: `${name}.html` };
    const contentHash = await computeContentHash(content);
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'SANDBOX');
    return { nodeId, commit, contentHash, content };
  }

  async function createInitialArtifact(artifactId: string, sandboxNode: {
    nodeId: string;
    commit: string;
    contentHash: string;
    content: { type: 'SANDBOX'; entryFile: string };
  }): Promise<string> {
    const nodes: CreateArtifactNode[] = [{
      nodeId: sandboxNode.nodeId,
      commit: sandboxNode.commit,
      type: 'SANDBOX',
      name: 'sandbox',
      contentHash: sandboxNode.contentHash,
      content: sandboxNode.content,
    }];
    const edges: ArtifactEdgeDescriptor[] = [];

    const commitNodes = nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }));
    const artifactCommit = await computeArtifactCommit(artifactId, null, commitNodes, commitEdges);

    const ctx = new BatchContext(db);
    const service = new ArtifactService(ctx);
    const result = await service.createArtifact({
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
    });
    expect(result.success).toBe(true);
    await ctx.commit();
    return artifactCommit;
  }

  beforeEach(async () => {
    db = createDb(env.DB);

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

    testUserId = await createTestUser();
  });

  it('should throw UNIQUE constraint error when patchArtifact produces duplicate commitHash', async () => {
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const sandboxNode1 = await createSandboxNode('sandbox1');
    const v1Commit = await createInitialArtifact(artifactId, sandboxNode1);

    // Create v2 by adding a new node
    const sandboxNode2 = await createSandboxNode('sandbox2');
    const v2AddNode: CreateArtifactNode = {
      nodeId: sandboxNode2.nodeId,
      commit: sandboxNode2.commit,
      type: 'SANDBOX',
      name: 'sandbox2',
      contentHash: sandboxNode2.contentHash,
      content: sandboxNode2.content,
    };

    // Compute v2 commit (includes both nodes)
    const v2MergedNodes = [
      { nodeId: sandboxNode1.nodeId, commit: sandboxNode1.commit },
      { nodeId: sandboxNode2.nodeId, commit: sandboxNode2.commit },
    ];
    const v2Commit = await computeArtifactCommit(artifactId, v1Commit, v2MergedNodes, []);

    // First patch: succeed
    const ctx1 = new BatchContext(db);
    const service1 = new ArtifactService(ctx1);
    const result1 = await service1.patchArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        baseCommit: v1Commit,
        commit: v2Commit,
        addNodes: [v2AddNode],
      },
    });
    expect(result1.success).toBe(true);
    await ctx1.commit();

    // Second patch: same base + same changes = same commitHash → UNIQUE constraint violation
    const ctx2 = new BatchContext(db);
    const service2 = new ArtifactService(ctx2);
    const result2 = await service2.patchArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        baseCommit: v1Commit,
        commit: v2Commit,
        addNodes: [v2AddNode],
      },
    });
    expect(result2.success).toBe(true);

    // Commit should fail due to UNIQUE constraint on (artifactId, commitHash)
    await expect(ctx2.commit()).rejects.toThrow('UNIQUE constraint failed');
  });

  it('should leave NO orphan records and preserve latestVersion on duplicate patchArtifact', async () => {
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const sandboxNode1 = await createSandboxNode('sandbox1');
    const v1Commit = await createInitialArtifact(artifactId, sandboxNode1);

    // Create v2
    const sandboxNode2 = await createSandboxNode('sandbox2');
    const v2AddNode: CreateArtifactNode = {
      nodeId: sandboxNode2.nodeId,
      commit: sandboxNode2.commit,
      type: 'SANDBOX',
      name: 'sandbox2',
      contentHash: sandboxNode2.contentHash,
      content: sandboxNode2.content,
    };
    const v2MergedNodes = [
      { nodeId: sandboxNode1.nodeId, commit: sandboxNode1.commit },
      { nodeId: sandboxNode2.nodeId, commit: sandboxNode2.commit },
    ];
    const v2Commit = await computeArtifactCommit(artifactId, v1Commit, v2MergedNodes, []);

    // First patch: succeed
    const ctx1 = new BatchContext(db);
    const service1 = new ArtifactService(ctx1);
    await service1.patchArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        baseCommit: v1Commit,
        commit: v2Commit,
        addNodes: [v2AddNode],
      },
    });
    await ctx1.commit();

    // Snapshot state after successful v2 patch
    const [artifactBeforeRetry] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
    const v2LatestVersion = artifactBeforeRetry.latestVersion;

    const versionsBefore = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));
    const nodeVersionsBefore = await db.select().from(nodeVersions);
    const versionNodesBefore = await db.select().from(artifactVersionNodes);
    const versionEdgesBefore = await db.select().from(artifactVersionEdges);

    // Duplicate patch: same base + same changes = same commitHash → must fail
    const ctx2 = new BatchContext(db);
    const service2 = new ArtifactService(ctx2);
    await service2.patchArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        baseCommit: v1Commit,
        commit: v2Commit,
        addNodes: [v2AddNode],
      },
    });
    await expect(ctx2.commit()).rejects.toThrow('UNIQUE constraint failed');

    // Verify NO orphan records — counts must be identical
    const versionsAfter = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));
    expect(versionsAfter.length).toBe(versionsBefore.length);

    const nodeVersionsAfter = await db.select().from(nodeVersions);
    expect(nodeVersionsAfter.length).toBe(nodeVersionsBefore.length);

    const versionNodesAfter = await db.select().from(artifactVersionNodes);
    expect(versionNodesAfter.length).toBe(versionNodesBefore.length);

    const versionEdgesAfter = await db.select().from(artifactVersionEdges);
    expect(versionEdgesAfter.length).toBe(versionEdgesBefore.length);

    // CRITICAL: latestVersion must NOT be corrupted
    // Before the fix, the batch would commit the UPDATE to artifacts.latestVersion
    // pointing to a new UUID that has no corresponding artifact_versions row.
    const [artifactAfterRetry] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
    expect(artifactAfterRetry.latestVersion).toBe(v2LatestVersion);

    // Verify the latestVersion still references a valid version record
    const [validVersion] = await db.select().from(artifactVersions).where(
      and(
        eq(artifactVersions.artifactId, artifactId),
        eq(artifactVersions.id, artifactAfterRetry.latestVersion!),
      )
    );
    expect(validVersion).toBeDefined();
  });
});
