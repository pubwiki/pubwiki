/**
 * Tests for artifact tree-structured version control.
 * 
 * Verifies:
 * 1. patchArtifact uses baseCommit as parentCommit (tree structure)
 * 2. updateArtifactMetadata can modify latestVersion pointer
 * 3. Multiple branches can be created from the same base version
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  ArtifactService,
  BatchContext,
  user,
  artifactVersions,
  artifacts,
  eq,
  nodeVersions,
  resourceDiscoveryControl,
  artifactVersionNodes,
  artifactVersionEdges,
  artifactStats,
  resourceAcl,
} from '@pubwiki/db';
import type { CreateArtifactNode } from '@pubwiki/db';
import type { ArtifactEdgeDescriptor } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

describe('Artifact Tree-Structured Version Control', () => {
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

  // Helper to create a SANDBOX node (simplest node type with proper content structure)
  async function createSandboxNode(name: string): Promise<{
    nodeId: string;
    commit: string;
    contentHash: string;
    content: { type: 'SANDBOX'; entryFile: string };
  }> {
    const nodeId = `node-${name}-${crypto.randomUUID()}`;
    const content = { type: 'SANDBOX' as const, entryFile: `${name}.html` };
    const contentHash = await computeContentHash(content);
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'SANDBOX');
    return { nodeId, commit, contentHash, content };
  }

  // Helper to create a minimal artifact
  async function createMinimalArtifact(artifactId: string, sandboxNode: {
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
    
    // For new artifact, parentCommit is null
    const commitNodes = nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }));
    const artifactCommit = await computeArtifactCommit(artifactId, null, commitNodes, commitEdges);

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

  describe('patchArtifact uses baseCommit as parentCommit', () => {
    it('should compute commit hash using baseCommit, not latestVersion', async () => {
      // Create initial artifact with v1
      const artifactId = `artifact-${crypto.randomUUID()}`;
      const sandboxNode1 = await createSandboxNode('sandbox1');
      const v1Commit = await createMinimalArtifact(artifactId, sandboxNode1);

      // Reset context for patch
      ctx = new BatchContext(db);

      // Create v2 based on v1
      const sandboxNode2 = await createSandboxNode('sandbox2');
      const v2Nodes: CreateArtifactNode[] = [
        {
          nodeId: sandboxNode1.nodeId,
          commit: sandboxNode1.commit,
          type: 'SANDBOX',
          name: 'sandbox1',
          contentHash: sandboxNode1.contentHash,
          content: sandboxNode1.content,
        },
        {
          nodeId: sandboxNode2.nodeId,
          commit: sandboxNode2.commit,
          type: 'SANDBOX',
          name: 'sandbox2',
          contentHash: sandboxNode2.contentHash,
          content: sandboxNode2.content,
        },
      ];
      const v2Edges: ArtifactEdgeDescriptor[] = [];
      
      // Compute v2 commit with v1 as parent (tree structure)
      const commitNodes = v2Nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
      const commitEdges = v2Edges.map(e => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      }));
      const v2Commit = await computeArtifactCommit(artifactId, v1Commit, commitNodes, commitEdges);

      const service = new ArtifactService(ctx);
      const patchResult = await service.patchArtifact({
        authorId: testUserId,
        metadata: {
          artifactId,
          baseCommit: v1Commit,
          commit: v2Commit,
          addNodes: [v2Nodes[1]],  // Add sandbox2
        },
      });

      expect(patchResult.success).toBe(true);
      await ctx.commit();

      // Verify the commit was accepted (would fail if using wrong parentCommit)
      ctx = new BatchContext(db);
      const graphResult = await new ArtifactService(ctx).getArtifactGraph(artifactId, v2Commit);
      expect(graphResult.success).toBe(true);
      if (graphResult.success) {
        expect(graphResult.data.nodes).toHaveLength(2);
      }
    });

    it('should allow creating branches from the same base version', async () => {
      // Create initial artifact with v1
      const artifactId = `artifact-${crypto.randomUUID()}`;
      const sandboxNode1 = await createSandboxNode('sandbox1');
      const v1Commit = await createMinimalArtifact(artifactId, sandboxNode1);

      // Create branch A from v1
      ctx = new BatchContext(db);
      const sandboxNodeA = await createSandboxNode('branchA');
      const branchANodes: CreateArtifactNode[] = [
        {
          nodeId: sandboxNode1.nodeId,
          commit: sandboxNode1.commit,
          type: 'SANDBOX',
          name: 'sandbox1',
          contentHash: sandboxNode1.contentHash,
          content: sandboxNode1.content,
        },
        {
          nodeId: sandboxNodeA.nodeId,
          commit: sandboxNodeA.commit,
          type: 'SANDBOX',
          name: 'branchA',
          contentHash: sandboxNodeA.contentHash,
          content: sandboxNodeA.content,
        },
      ];
      const branchACommitNodes = branchANodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
      const branchACommit = await computeArtifactCommit(artifactId, v1Commit, branchACommitNodes, []);

      const serviceA = new ArtifactService(ctx);
      const resultA = await serviceA.patchArtifact({
        authorId: testUserId,
        metadata: {
          artifactId,
          baseCommit: v1Commit,
          commit: branchACommit,
          addNodes: [branchANodes[1]],
        },
      });
      expect(resultA.success).toBe(true);
      await ctx.commit();

      // Create branch B from v1 (same base as branch A)
      ctx = new BatchContext(db);
      const sandboxNodeB = await createSandboxNode('branchB');
      const branchBNodes: CreateArtifactNode[] = [
        {
          nodeId: sandboxNode1.nodeId,
          commit: sandboxNode1.commit,
          type: 'SANDBOX',
          name: 'sandbox1',
          contentHash: sandboxNode1.contentHash,
          content: sandboxNode1.content,
        },
        {
          nodeId: sandboxNodeB.nodeId,
          commit: sandboxNodeB.commit,
          type: 'SANDBOX',
          name: 'branchB',
          contentHash: sandboxNodeB.contentHash,
          content: sandboxNodeB.content,
        },
      ];
      const branchBCommitNodes = branchBNodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
      const branchBCommit = await computeArtifactCommit(artifactId, v1Commit, branchBCommitNodes, []);

      const serviceB = new ArtifactService(ctx);
      const resultB = await serviceB.patchArtifact({
        authorId: testUserId,
        metadata: {
          artifactId,
          baseCommit: v1Commit,
          commit: branchBCommit,
          addNodes: [branchBNodes[1]],
        },
      });
      expect(resultB.success).toBe(true);
      await ctx.commit();

      // Both branches should exist
      ctx = new BatchContext(db);
      const service = new ArtifactService(ctx);
      
      const graphA = await service.getArtifactGraph(artifactId, branchACommit);
      expect(graphA.success).toBe(true);
      if (graphA.success) {
        expect(graphA.data.nodes.find(n => n.name === 'branchA')).toBeDefined();
      }
      
      const graphB = await service.getArtifactGraph(artifactId, branchBCommit);
      expect(graphB.success).toBe(true);
      if (graphB.success) {
        expect(graphB.data.nodes.find(n => n.name === 'branchB')).toBeDefined();
      }
    });
  });

  describe('updateArtifactMetadata latestVersion', () => {
    it('should allow setting latestVersion to any existing version', async () => {
      // Create initial artifact
      const artifactId = `artifact-${crypto.randomUUID()}`;
      const sandboxNode1 = await createSandboxNode('sandbox1');
      const v1Commit = await createMinimalArtifact(artifactId, sandboxNode1);

      // Create v2
      ctx = new BatchContext(db);
      const sandboxNode2 = await createSandboxNode('sandbox2');
      const v2Nodes: CreateArtifactNode[] = [
        {
          nodeId: sandboxNode1.nodeId,
          commit: sandboxNode1.commit,
          type: 'SANDBOX',
          name: 'sandbox1',
          contentHash: sandboxNode1.contentHash,
          content: sandboxNode1.content,
        },
        {
          nodeId: sandboxNode2.nodeId,
          commit: sandboxNode2.commit,
          type: 'SANDBOX',
          name: 'sandbox2',
          contentHash: sandboxNode2.contentHash,
          content: sandboxNode2.content,
        },
      ];
      const v2CommitNodes = v2Nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit }));
      const v2Commit = await computeArtifactCommit(artifactId, v1Commit, v2CommitNodes, []);

      let service = new ArtifactService(ctx);
      await service.patchArtifact({
        authorId: testUserId,
        metadata: {
          artifactId,
          baseCommit: v1Commit,
          commit: v2Commit,
          addNodes: [v2Nodes[1]],
        },
      });
      await ctx.commit();

      // Get version IDs using drizzle
      ctx = new BatchContext(db);
      const versions = await ctx.select({
        id: artifactVersions.id,
        commitHash: artifactVersions.commitHash,
      })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifactId))
        .orderBy(artifactVersions.createdAt);
      
      expect(versions).toHaveLength(2);
      const v1VersionId = versions[0].id;
      const v2VersionId = versions[1].id;

      // Current latestVersion should be v2
      const [artifactBefore] = await ctx.select({ latestVersion: artifacts.latestVersion })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);
      expect(artifactBefore?.latestVersion).toBe(v2VersionId);

      // Set latestVersion back to v1
      ctx = new BatchContext(db);
      service = new ArtifactService(ctx);
      const updateResult = await service.updateArtifactMetadata({
        artifactId,
        authorId: testUserId,
        data: { latestVersion: v1VersionId },
      });
      expect(updateResult.success).toBe(true);
      await ctx.commit();

      // Verify latestVersion changed
      ctx = new BatchContext(db);
      const [artifactAfter] = await ctx.select({ latestVersion: artifacts.latestVersion })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);
      expect(artifactAfter?.latestVersion).toBe(v1VersionId);
    });

    it('should reject non-existent version ID', async () => {
      const artifactId = `artifact-${crypto.randomUUID()}`;
      const sandboxNode = await createSandboxNode('sandbox');
      await createMinimalArtifact(artifactId, sandboxNode);

      ctx = new BatchContext(db);
      const service = new ArtifactService(ctx);
      const result = await service.updateArtifactMetadata({
        artifactId,
        authorId: testUserId,
        data: { latestVersion: 'non-existent-version-id' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject version ID from different artifact', async () => {
      // Create two artifacts
      const artifactId1 = `artifact-1-${crypto.randomUUID()}`;
      const artifactId2 = `artifact-2-${crypto.randomUUID()}`;
      const sandboxNode1 = await createSandboxNode('sandbox1');
      const sandboxNode2 = await createSandboxNode('sandbox2');
      
      await createMinimalArtifact(artifactId1, sandboxNode1);
      ctx = new BatchContext(db);
      await createMinimalArtifact(artifactId2, sandboxNode2);

      // Get version ID from artifact2 using drizzle
      ctx = new BatchContext(db);
      const [version2] = await ctx.select({ id: artifactVersions.id })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifactId2))
        .limit(1);

      // Try to set artifact1's latestVersion to artifact2's version
      ctx = new BatchContext(db);
      const service = new ArtifactService(ctx);
      const result = await service.updateArtifactMetadata({
        artifactId: artifactId1,
        authorId: testUserId,
        data: { latestVersion: version2.id },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
