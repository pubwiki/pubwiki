/**
 * Tests for FTS5 triggers interaction with optimistic locking.
 * 
 * Bug description:
 * When FTS5 INSERT triggers fire on artifact creation, they affect the 
 * SQLite changes() count, causing OptimisticLockError to be thrown even
 * though the INSERT succeeded.
 * 
 * The fix involves using a `searchable` flag that gets set AFTER the
 * optimistic lock check passes, with the FTS UPDATE trigger only firing
 * when searchable changes to 1.
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
} from '@pubwiki/db';
import type { CreateArtifactNode } from '@pubwiki/db';
import type { ArtifactEdgeDescriptor } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

describe('ArtifactService - FTS5 triggers vs optimistic locking', () => {
  let db: ReturnType<typeof createDb>;
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
        name: 'Test Artifact',
        description: 'A test artifact for FTS',
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

    // Also clean FTS table
    await env.DB.prepare('DELETE FROM artifacts_fts').run();

    // Create test user
    testUserId = await createTestUser();
  });

  it('should create artifact without OptimisticLockError despite FTS triggers', async () => {
    // This test verifies the fix for the FTS trigger interference bug.
    // Before the fix, the FTS INSERT trigger would cause changes() to return > 1,
    // which would fail the optimistic lock check (expectAffected: 1).
    
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    const ctx = new BatchContext(db);
    const artifactService = new ArtifactService(ctx);
    
    const result = await artifactService.createArtifact(input);
    expect(result.success).toBe(true);

    // This is the critical assertion - commit should NOT throw OptimisticLockError
    // Before fix: this would throw because FTS INSERT trigger affected changes() count
    // After fix: this should succeed because FTS sync happens via UPDATE trigger on searchable field
    await expect(ctx.commit()).resolves.toBeUndefined();

    // Verify artifact was actually created
    const dbArtifact = await db.select().from(artifacts).where((await import('@pubwiki/db')).eq(artifacts.id, artifactId));
    expect(dbArtifact.length).toBe(1);
    expect(dbArtifact[0].name).toBe('Test Artifact');
  });

  it('should index artifact in FTS immediately after creation', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    const ctx = new BatchContext(db);
    const artifactService = new ArtifactService(ctx);
    
    await artifactService.createArtifact(input);
    await ctx.commit();

    // After commit, artifact should already be indexed in FTS
    // (searchable = 1 is set in the same batch as creation)
    const search = await env.DB.prepare(
      "SELECT * FROM artifacts_fts WHERE artifacts_fts MATCH 'Test'"
    ).all();
    expect(search.results.length).toBe(1);
  });

  it('should update FTS when artifact metadata changes', async () => {
    const artifactId = crypto.randomUUID();
    const input = await createSimpleArtifactInput(artifactId);

    // Create and commit artifact (searchable=1 is set automatically)
    const ctx1 = new BatchContext(db);
    const artifactService1 = new ArtifactService(ctx1);
    await artifactService1.createArtifact(input);
    await ctx1.commit();

    // Verify initial FTS content - should not match 'UniqueNewName' yet
    const initialSearch = await env.DB.prepare(
      "SELECT * FROM artifacts_fts WHERE artifacts_fts MATCH 'UniqueNewName'"
    ).all();
    expect(initialSearch.results.length).toBe(0);

    // Update artifact name
    await env.DB.prepare("UPDATE artifacts SET name = 'UniqueNewName' WHERE id = ?").bind(artifactId).run();

    // FTS should reflect the new name (UPDATE trigger should fire)
    const afterUpdate = await env.DB.prepare(
      "SELECT * FROM artifacts_fts WHERE artifacts_fts MATCH 'UniqueNewName'"
    ).all();
    expect(afterUpdate.results.length).toBe(1);
  });
});
