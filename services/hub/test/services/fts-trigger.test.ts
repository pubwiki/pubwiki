import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  BatchContext,
  ArtifactService,
  user,
  artifacts,
  nodeVersions,
  artifactVersions,
  artifactVersionNodes,
  artifactVersionEdges,
  artifactStats,
  resourceAcl,
  resourceDiscoveryControl,
} from '@pubwiki/db';
import type { CreateArtifactNode } from '@pubwiki/db';
import type { ArtifactEdgeDescriptor } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

/**
 * Test to verify FTS triggers don't interfere with optimistic lock checks.
 * 
 * Problem: SQLite FTS5 INSERT triggers affect the changes() count,
 * causing OptimisticLockError even when the INSERT succeeds.
 * 
 * Solution: Use 'searchable' flag - only UPDATE trigger when searchable=1,
 * which fires AFTER optimistic lock validation passes.
 */
describe('FTS trigger isolation', () => {
  let db: ReturnType<typeof createDb>;
  let testUserId: string;

  // Helper: create a test user directly in DB
  async function createTestUser(username = 'ftsTestUser'): Promise<string> {
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

  // Helper: create simple artifact input with valid commit
  async function createSimpleArtifactInput(artifactId: string) {
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
        name: 'FTS Test Artifact',
        description: 'Testing FTS trigger isolation',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    };
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

    // Create test user
    testUserId = await createTestUser();
  });

  it('should create artifact without OptimisticLockError', async () => {
    const ctx = new BatchContext(db);
    const service = new ArtifactService(ctx);

    const input = await createSimpleArtifactInput('test-artifact-fts-1');
    const result = await service.createArtifact(input);

    expect(result.success).toBe(true);

    // This should NOT throw OptimisticLockError
    // Before the fix, FTS INSERT trigger affected changes() count
    await expect(ctx.commit()).resolves.not.toThrow();

    // Verify artifact was created
    const artifact = await env.DB.prepare(
      'SELECT id, name, searchable FROM artifacts WHERE id = ?'
    ).bind('test-artifact-fts-1').first();
    expect(artifact).not.toBeNull();
    expect(artifact?.name).toBe('FTS Test Artifact');
    // searchable should be 1 (set in batch, triggers FTS indexing)
    expect(artifact?.searchable).toBe(1);

    // FTS should be indexed
    const fts = await env.DB.prepare(
      'SELECT * FROM artifacts_fts WHERE id = ?'
    ).bind('test-artifact-fts-1').first();
    expect(fts).not.toBeNull();
    expect(fts?.name).toBe('FTS Test Artifact');
  });

  it('should index artifact in FTS immediately after creation', async () => {
    const ctx = new BatchContext(db);
    const service = new ArtifactService(ctx);

    const input = await createSimpleArtifactInput('test-artifact-fts-2');
    const result = await service.createArtifact(input);

    expect(result.success).toBe(true);
    await ctx.commit();

    // After commit, artifact should already be in FTS (searchable=1 is set in batch)
    const fts = await env.DB.prepare(
      'SELECT * FROM artifacts_fts WHERE id = ?'
    ).bind('test-artifact-fts-2').first();
    expect(fts).not.toBeNull();
    expect(fts?.name).toBe('FTS Test Artifact');
  });

  it('should update FTS when metadata changes on searchable artifact', async () => {
    const ctx = new BatchContext(db);
    const service = new ArtifactService(ctx);

    const input = await createSimpleArtifactInput('test-artifact-fts-3');
    const result = await service.createArtifact(input);

    expect(result.success).toBe(true);
    await ctx.commit();

    // Set searchable to index in FTS
    await env.DB.prepare(
      'UPDATE artifacts SET searchable = 1 WHERE id = ?'
    ).bind('test-artifact-fts-3').run();

    // Check FTS has original values
    const original = await env.DB.prepare(
      'SELECT name, description FROM artifacts_fts WHERE id = ?'
    ).bind('test-artifact-fts-3').first();
    expect(original?.name).toBe('FTS Test Artifact');

    // Update metadata
    await env.DB.prepare(
      'UPDATE artifacts SET name = ?, description = ? WHERE id = ?'
    ).bind('Updated Name', 'Updated description', 'test-artifact-fts-3').run();

    // Check FTS has updated values
    const updated = await env.DB.prepare(
      'SELECT name, description FROM artifacts_fts WHERE id = ?'
    ).bind('test-artifact-fts-3').first();
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.description).toBe('Updated description');
  });
});
