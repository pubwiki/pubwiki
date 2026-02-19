import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  ArtifactService,
  NodeVersionService,
  BatchContext,
  user,
  nodeVersions,
  saveContents,
  stateContents,
  artifactVersions,
  artifacts,
  resourceDiscoveryControl,
  artifactVersionNodes,
  artifactVersionEdges,
} from '@pubwiki/db';
import type { SyncNodeVersionInput, CreateArtifactNode } from '@pubwiki/db';
import type { ArtifactEdgeDescriptor } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash, computeArtifactCommit } from '@pubwiki/api';

describe('ArtifactService - SAVE node validation', () => {
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

  // Helper: commit batch and reset context
  async function commitAndReset(): Promise<BatchContext> {
    await ctx.commit();
    ctx = new BatchContext(db);
    return ctx;
  }

  // Helper: create a STATE node version and commit to DB
  async function createStateNodeInDb(stateNodeId: string, name: string, description?: string): Promise<string> {
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

  // Helper: create SANDBOX and LOADER nodes content
  async function createSandboxNode(nodeId: string): Promise<{ commit: string; contentHash: string; content: { type: 'SANDBOX'; entryFile: string } }> {
    const content = { type: 'SANDBOX' as const, entryFile: 'index.html' };
    const contentHash = await computeContentHash(content);
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'SANDBOX');
    return { commit, contentHash, content };
  }

  async function createLoaderNode(nodeId: string): Promise<{ commit: string; contentHash: string; content: { type: 'LOADER' } }> {
    const content = { type: 'LOADER' as const };
    const contentHash = await computeContentHash(content);
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'LOADER');
    return { commit, contentHash, content };
  }

  // Helper: create SAVE node data
  async function createSaveNode(
    stateNodeId: string,
    stateNodeCommit: string,
    artifactId: string,
    artifactCommit: string,
    title = 'Test Save',
  ): Promise<{ nodeId: string; commit: string; contentHash: string; content: { type: 'SAVE'; stateNodeId: string; stateNodeCommit: string; artifactId: string; artifactCommit: string; quadsHash: string; title: string; description: null } }> {
    const quadsHash = 'abcd1234'.repeat(8); // 64 char hex hash placeholder
    const content = {
      type: 'SAVE' as const,
      stateNodeId,
      stateNodeCommit,
      artifactId,
      artifactCommit,
      quadsHash,
      title,
      description: null,
    };
    const contentHash = await computeContentHash(content);
    const nodeId = crypto.randomUUID();
    const commit = await computeNodeCommit(nodeId, null, contentHash, 'SAVE');
    return { nodeId, commit, contentHash, content };
  }

  beforeEach(async () => {
    db = createDb(env.DB);
    ctx = new BatchContext(db);

    // Clean tables (reverse FK order)
    await db.delete(saveContents);
    await db.delete(stateContents);
    await db.delete(artifactVersionEdges);
    await db.delete(artifactVersionNodes);
    await db.delete(nodeVersions);
    await db.delete(artifactVersions);
    await db.delete(resourceDiscoveryControl);
    await db.delete(artifacts);
    await db.delete(user);

    // Create test user
    testUserId = await createTestUser();
  });

  it('should succeed when SAVE node references STATE node defined in same nodes array', async () => {
    // Create artifact with STATE, LOADER, SANDBOX, and SAVE nodes
    const artifactId = crypto.randomUUID();
    const stateNodeId = crypto.randomUUID();
    const sandboxNodeId = crypto.randomUUID();
    const loaderNodeId = crypto.randomUUID();

    // Create node data
    const stateContent = { type: 'STATE' as const, name: 'Game State' };
    const stateContentHash = await computeContentHash(stateContent);
    const stateNodeCommit = await computeNodeCommit(stateNodeId, null, stateContentHash, 'STATE');

    const sandboxData = await createSandboxNode(sandboxNodeId);
    const loaderData = await createLoaderNode(loaderNodeId);

    // Edges: STATE -> LOADER -> SANDBOX
    const edges: ArtifactEdgeDescriptor[] = [
      { source: stateNodeId, target: loaderNodeId },
      { source: loaderNodeId, target: sandboxNodeId },
    ];

    // Compute artifact commit (without SAVE node first, for SAVE content)
    const baseCommitNodes = [
      { nodeId: stateNodeId, commit: stateNodeCommit },
      { nodeId: sandboxNodeId, commit: sandboxData.commit },
      { nodeId: loaderNodeId, commit: loaderData.commit },
    ];
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: null,
      targetHandle: null,
    }));
    
    // First compute base commit without SAVE node (used in SAVE content to reference the artifact)
    const baseCommit = await computeArtifactCommit(artifactId, null, baseCommitNodes, commitEdges);

    // Create SAVE node data referencing the STATE node (uses baseCommit as the artifact commit it references)
    const saveData = await createSaveNode(stateNodeId, stateNodeCommit, artifactId, baseCommit);

    // Now compute final commit including the SAVE node
    const allCommitNodes = [
      ...baseCommitNodes,
      { nodeId: saveData.nodeId, commit: saveData.commit },
    ];
    const artifactCommit = await computeArtifactCommit(artifactId, null, allCommitNodes, commitEdges);

    const nodes: CreateArtifactNode[] = [
      {
        nodeId: stateNodeId,
        commit: stateNodeCommit,
        type: 'STATE',
        name: 'state',
        contentHash: stateContentHash,
        content: stateContent,
      },
      {
        nodeId: sandboxNodeId,
        commit: sandboxData.commit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxData.contentHash,
        content: sandboxData.content,
      },
      {
        nodeId: loaderNodeId,
        commit: loaderData.commit,
        type: 'LOADER',
        name: 'loader',
        contentHash: loaderData.contentHash,
        content: loaderData.content,
      },
      {
        nodeId: saveData.nodeId,
        commit: saveData.commit,
        type: 'SAVE',
        name: 'save',
        contentHash: saveData.contentHash,
        content: saveData.content,
      },
    ];

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Artifact with SAVE node',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    });

    expect(result.success).toBe(true);
  });

  it('should succeed when SAVE node references STATE node in the same artifact version', async () => {
    // Step 1: Create a STATE node in DB first (simulating a previously created STATE node)
    const existingStateNodeId = crypto.randomUUID();
    const existingStateNodeCommit = await createStateNodeInDb(existingStateNodeId, 'Existing Game State');

    // Step 2: Create artifact with SAVE referencing the existing STATE node
    const artifactId = crypto.randomUUID();
    const sandboxNodeId = crypto.randomUUID();
    const loaderNodeId = crypto.randomUUID();

    const sandboxData = await createSandboxNode(sandboxNodeId);
    const loaderData = await createLoaderNode(loaderNodeId);

    // For artifact to be valid, we need to include the existing STATE node in nodes array
    const existingStateContent = { type: 'STATE' as const, name: 'Existing Game State' };
    const existingStateContentHash = await computeContentHash(existingStateContent);

    // Edges: STATE -> LOADER -> SANDBOX
    const edges: ArtifactEdgeDescriptor[] = [
      { source: existingStateNodeId, target: loaderNodeId },
      { source: loaderNodeId, target: sandboxNodeId },
    ];

    // Compute base artifact commit (without SAVE node)
    const baseCommitNodes = [
      { nodeId: existingStateNodeId, commit: existingStateNodeCommit },
      { nodeId: sandboxNodeId, commit: sandboxData.commit },
      { nodeId: loaderNodeId, commit: loaderData.commit },
    ];
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: null,
      targetHandle: null,
    }));
    const baseCommit = await computeArtifactCommit(artifactId, null, baseCommitNodes, commitEdges);

    // Create SAVE node referencing the existing STATE node (uses baseCommit)
    const saveData = await createSaveNode(existingStateNodeId, existingStateNodeCommit, artifactId, baseCommit);

    // Compute final artifact commit including SAVE node
    const allCommitNodes = [
      ...baseCommitNodes,
      { nodeId: saveData.nodeId, commit: saveData.commit },
    ];
    const artifactCommit = await computeArtifactCommit(artifactId, null, allCommitNodes, commitEdges);

    const nodes: CreateArtifactNode[] = [
      {
        nodeId: existingStateNodeId,
        commit: existingStateNodeCommit,
        type: 'STATE',
        name: 'existing-state',
        contentHash: existingStateContentHash,
        content: existingStateContent,
      },
      {
        nodeId: sandboxNodeId,
        commit: sandboxData.commit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxData.contentHash,
        content: sandboxData.content,
      },
      {
        nodeId: loaderNodeId,
        commit: loaderData.commit,
        type: 'LOADER',
        name: 'loader',
        contentHash: loaderData.contentHash,
        content: loaderData.content,
      },
      {
        nodeId: saveData.nodeId,
        commit: saveData.commit,
        type: 'SAVE',
        name: 'save',
        contentHash: saveData.contentHash,
        content: saveData.content,
      },
    ];

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Artifact with SAVE referencing existing STATE',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    });

    expect(result.success).toBe(true);
  });

  it('should reject SAVE node with non-existent STATE node reference', async () => {
    // Create artifact with SAVE referencing a STATE node that doesn't exist
    const artifactId = crypto.randomUUID();
    const fakeStateNodeId = crypto.randomUUID();
    const fakeStateNodeCommit = 'fake-commit-that-does-not-exist';
    const sandboxNodeId = crypto.randomUUID();
    const loaderNodeId = crypto.randomUUID();

    const sandboxData = await createSandboxNode(sandboxNodeId);
    const loaderData = await createLoaderNode(loaderNodeId);

    // Edges: LOADER -> SANDBOX (no STATE edge since STATE doesn't exist)
    const edges: ArtifactEdgeDescriptor[] = [
      { source: loaderNodeId, target: sandboxNodeId },
    ];

    // Compute base artifact commit (only includes actual nodes that will be submitted)
    const baseCommitNodes = [
      { nodeId: sandboxNodeId, commit: sandboxData.commit },
      { nodeId: loaderNodeId, commit: loaderData.commit },
    ];
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: null,
      targetHandle: null,
    }));
    const baseCommit = await computeArtifactCommit(artifactId, null, baseCommitNodes, commitEdges);

    // Create SAVE node referencing the fake STATE node (uses baseCommit)
    const quadsHash = 'abcd1234'.repeat(8);
    const saveContent = {
      type: 'SAVE' as const,
      stateNodeId: fakeStateNodeId,
      stateNodeCommit: fakeStateNodeCommit,
      artifactId,
      artifactCommit: baseCommit,
      quadsHash,
      title: 'Test Save',
      description: null,
    };
    const saveContentHash = await computeContentHash(saveContent);
    const saveId = crypto.randomUUID();
    const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

    // Compute final artifact commit including SAVE node
    const allCommitNodes = [
      ...baseCommitNodes,
      { nodeId: saveId, commit: saveCommit },
    ];
    const artifactCommit = await computeArtifactCommit(artifactId, null, allCommitNodes, commitEdges);

    const nodes: CreateArtifactNode[] = [
      // No STATE node included - it doesn't exist
      {
        nodeId: sandboxNodeId,
        commit: sandboxData.commit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxData.contentHash,
        content: sandboxData.content,
      },
      {
        nodeId: loaderNodeId,
        commit: loaderData.commit,
        type: 'LOADER',
        name: 'loader',
        contentHash: loaderData.contentHash,
        content: loaderData.content,
      },
      {
        nodeId: saveId,
        commit: saveCommit,
        type: 'SAVE',
        name: 'save',
        contentHash: saveContentHash,
        content: saveContent,
      },
    ];

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Artifact with invalid SAVE reference',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    });

    // Should fail because the referenced STATE node is not in this artifact version
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BAD_REQUEST');
      expect(result.error.message).toContain('not present in this artifact version');
    }
  });

  it('should reject SAVE node with mismatched stateNodeCommit', async () => {
    // Create artifact with SAVE referencing a STATE node with wrong commit
    const artifactId = crypto.randomUUID();
    const stateNodeId = crypto.randomUUID();
    const sandboxNodeId = crypto.randomUUID();
    const loaderNodeId = crypto.randomUUID();

    // Create node data
    const stateContent = { type: 'STATE' as const, name: 'Game State' };
    const stateContentHash = await computeContentHash(stateContent);
    const stateNodeCommit = await computeNodeCommit(stateNodeId, null, stateContentHash, 'STATE');

    const sandboxData = await createSandboxNode(sandboxNodeId);
    const loaderData = await createLoaderNode(loaderNodeId);

    // Edges
    const edges: ArtifactEdgeDescriptor[] = [
      { source: stateNodeId, target: loaderNodeId },
      { source: loaderNodeId, target: sandboxNodeId },
    ];

    // Compute base artifact commit
    const baseCommitNodes = [
      { nodeId: stateNodeId, commit: stateNodeCommit },
      { nodeId: sandboxNodeId, commit: sandboxData.commit },
      { nodeId: loaderNodeId, commit: loaderData.commit },
    ];
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: null,
      targetHandle: null,
    }));
    const baseCommit = await computeArtifactCommit(artifactId, null, baseCommitNodes, commitEdges);

    // Create SAVE node with WRONG stateNodeCommit (uses baseCommit)
    const wrongStateNodeCommit = 'wrong-commit-hash';
    const quadsHash = 'abcd1234'.repeat(8);
    const saveContent = {
      type: 'SAVE' as const,
      stateNodeId,
      stateNodeCommit: wrongStateNodeCommit, // WRONG!
      artifactId,
      artifactCommit: baseCommit,
      quadsHash,
      title: 'Test Save',
      description: null,
    };
    const saveContentHash = await computeContentHash(saveContent);
    const saveId = crypto.randomUUID();
    const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

    // Compute final artifact commit including SAVE node
    const allCommitNodes = [
      ...baseCommitNodes,
      { nodeId: saveId, commit: saveCommit },
    ];
    const artifactCommit = await computeArtifactCommit(artifactId, null, allCommitNodes, commitEdges);

    const nodes: CreateArtifactNode[] = [
      {
        nodeId: stateNodeId,
        commit: stateNodeCommit,
        type: 'STATE',
        name: 'state',
        contentHash: stateContentHash,
        content: stateContent,
      },
      {
        nodeId: sandboxNodeId,
        commit: sandboxData.commit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxData.contentHash,
        content: sandboxData.content,
      },
      {
        nodeId: loaderNodeId,
        commit: loaderData.commit,
        type: 'LOADER',
        name: 'loader',
        contentHash: loaderData.contentHash,
        content: loaderData.content,
      },
      {
        nodeId: saveId,
        commit: saveCommit,
        type: 'SAVE',
        name: 'save',
        contentHash: saveContentHash,
        content: saveContent,
      },
    ];

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Artifact with mismatched SAVE commit',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    });

    // Should fail because stateNodeCommit doesn't match
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BAD_REQUEST');
      expect(result.error.message).toContain('stateNodeCommit');
    }
  });

  it('should reject SAVE node missing stateNodeId in content', async () => {
    const artifactId = crypto.randomUUID();
    const sandboxNodeId = crypto.randomUUID();
    const loaderNodeId = crypto.randomUUID();

    const sandboxData = await createSandboxNode(sandboxNodeId);
    const loaderData = await createLoaderNode(loaderNodeId);

    const edges: ArtifactEdgeDescriptor[] = [
      { source: loaderNodeId, target: sandboxNodeId },
    ];

    const baseCommitNodes = [
      { nodeId: sandboxNodeId, commit: sandboxData.commit },
      { nodeId: loaderNodeId, commit: loaderData.commit },
    ];
    const commitEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: null,
      targetHandle: null,
    }));
    const baseCommit = await computeArtifactCommit(artifactId, null, baseCommitNodes, commitEdges);

    // Create SAVE node with missing stateNodeId (uses baseCommit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidSaveContent: any = {
      type: 'SAVE' as const,
      // stateNodeId: missing!
      stateNodeCommit: 'some-commit',
      artifactId,
      artifactCommit: baseCommit,
      quadsHash: 'abcd1234'.repeat(8),
      title: 'Test Save',
      description: null,
    };
    const saveContentHash = await computeContentHash(invalidSaveContent);
    const saveId = crypto.randomUUID();
    const saveCommit = await computeNodeCommit(saveId, null, saveContentHash, 'SAVE');

    // Compute final artifact commit including SAVE node
    const allCommitNodes = [
      ...baseCommitNodes,
      { nodeId: saveId, commit: saveCommit },
    ];
    const artifactCommit = await computeArtifactCommit(artifactId, null, allCommitNodes, commitEdges);

    const nodes: CreateArtifactNode[] = [
      {
        nodeId: sandboxNodeId,
        commit: sandboxData.commit,
        type: 'SANDBOX',
        name: 'sandbox',
        contentHash: sandboxData.contentHash,
        content: sandboxData.content,
      },
      {
        nodeId: loaderNodeId,
        commit: loaderData.commit,
        type: 'LOADER',
        name: 'loader',
        contentHash: loaderData.contentHash,
        content: loaderData.content,
      },
      {
        nodeId: saveId,
        commit: saveCommit,
        type: 'SAVE',
        name: 'save',
        contentHash: saveContentHash,
        content: invalidSaveContent,
      },
    ];

    const artifactService = new ArtifactService(ctx);
    const result = await artifactService.createArtifact({
      authorId: testUserId,
      metadata: {
        artifactId,
        commit: artifactCommit,
        name: 'Artifact with invalid SAVE content',
        isListed: true,
        isPrivate: false,
      },
      nodes,
      edges,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BAD_REQUEST');
      expect(result.error.message).toContain('stateNodeId');
    }
  });
});
