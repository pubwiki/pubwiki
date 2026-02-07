import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  NodeVersionService,
  user,
  session,
  account,
  nodeVersions,
  nodeVersionRefs,
  inputContents,
  promptContents,
  generatedContents,
  vfsContents,
  sandboxContents,
  loaderContents,
  stateContents,
  eq,
} from '@pubwiki/db';
import type { SyncNodeVersionInput } from '@pubwiki/db';
import { computeNodeCommit } from '@pubwiki/api';

describe('NodeVersionService', () => {
  let db: ReturnType<typeof createDb>;
  let service: NodeVersionService;
  let testUserId: string;

  // Helper: create a test user directly in DB
  async function createTestUser(username = 'testuser'): Promise<string> {
    const now = new Date();
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      username,
      email: `${username}@test.com`,
      name: username,
      emailVerified: false,
      image: null,
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

  // Helper: generate a deterministic content hash
  function makeContentHash(seed: string): string {
    return ('ch_' + seed).padEnd(40, '0');
  }

  // Helper: build a basic INPUT node version input (commit is computed deterministically)
  async function inputVersion(overrides: Partial<SyncNodeVersionInput> = {}): Promise<SyncNodeVersionInput> {
    const nodeId = overrides.nodeId ?? crypto.randomUUID();
    const parent = overrides.parent ?? null;
    const contentHash = overrides.contentHash ?? makeContentHash(crypto.randomUUID().slice(0, 8));
    const type = overrides.type ?? 'INPUT';
    const commit = await computeNodeCommit(nodeId, parent, contentHash, type);
    return {
      nodeId,
      commit,
      parent,
      authorId: overrides.authorId ?? testUserId,
      sourceArtifactId: overrides.sourceArtifactId ?? crypto.randomUUID(),
      type,
      contentHash,
      content: overrides.content ?? { blocks: [{ type: 'text', text: 'hello' }] },
      visibility: overrides.visibility ?? 'PUBLIC',
      name: overrides.name ?? 'test-node',
      message: overrides.message,
      tag: overrides.tag,
      refs: overrides.refs,
      authoredAt: overrides.authoredAt,
    };
  }

  beforeEach(async () => {
    db = createDb(env.DB);
    service = new NodeVersionService(db);

    // Clean tables (reverse FK order)
    await db.delete(nodeVersionRefs);
    await db.delete(nodeVersions);
    await db.delete(inputContents);
    await db.delete(promptContents);
    await db.delete(generatedContents);
    await db.delete(vfsContents);
    await db.delete(sandboxContents);
    await db.delete(loaderContents);
    await db.delete(stateContents);
    await db.delete(session);
    await db.delete(account);
    await db.delete(user);

    testUserId = await createTestUser();
  });

  // ========================================================================
  // syncVersions
  // ========================================================================
  describe('syncVersions', () => {
    it('should create a single version', async () => {
      const nodeId = crypto.randomUUID();
      const contentHash = makeContentHash('aaa');
      const v = await inputVersion({ nodeId, contentHash });

      const result = await service.syncVersions([v]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(1);
      expect(result.data.skipped).toBe(0);
      expect(result.data.errors).toHaveLength(0);

      // Verify row in nodeVersions
      const rows = await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, v.commit));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('INPUT');
      expect(rows[0].contentHash).toBe(contentHash);
    });

    it('should create multiple versions in one batch', async () => {
      const nodeId = crypto.randomUUID();
      const ch1 = makeContentHash('b01');
      const ch2 = makeContentHash('b02');
      const v1 = await inputVersion({ nodeId, contentHash: ch1 });
      const v2 = await inputVersion({ nodeId, parent: v1.commit, contentHash: ch2 });

      const result = await service.syncVersions([v1, v2]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(2);

      const rows = await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.nodeId, nodeId));
      expect(rows).toHaveLength(2);
    });

    it('should skip already existing versions (dedup)', async () => {
      const nodeId = crypto.randomUUID();
      const contentHash = makeContentHash('dup');
      const v = await inputVersion({ nodeId, contentHash });

      // First sync
      await service.syncVersions([v]);

      // Second sync with the same version
      const result = await service.syncVersions([v]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(0);
      expect(result.data.skipped).toBe(1);

      // Only one row should exist
      const rows = await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.nodeId, nodeId));
      expect(rows).toHaveLength(1);
    });

    it('should deduplicate content by content_hash and increment ref_count', async () => {
      const nodeId1 = crypto.randomUUID();
      const nodeId2 = crypto.randomUUID();
      const sharedHash = makeContentHash('shared');

      await service.syncVersions([
        await inputVersion({
          nodeId: nodeId1,
          contentHash: sharedHash,
          content: { blocks: [{ type: 'text', text: 'shared content' }] },
        }),
      ]);

      // Verify ref_count = 1
      const before = await db
        .select()
        .from(inputContents)
        .where(eq(inputContents.contentHash, sharedHash));
      expect(before).toHaveLength(1);
      expect(before[0].refCount).toBe(1);

      // Second version with same content hash (different node)
      await service.syncVersions([
        await inputVersion({
          nodeId: nodeId2,
          contentHash: sharedHash,
          content: { blocks: [{ type: 'text', text: 'shared content' }] },
        }),
      ]);

      // ref_count should now be 2
      const after = await db
        .select()
        .from(inputContents)
        .where(eq(inputContents.contentHash, sharedHash));
      expect(after).toHaveLength(1);
      expect(after[0].refCount).toBe(2);
    });

    it('should reject child visibility exceeding parent visibility', async () => {
      const nodeId = crypto.randomUUID();
      const parent = await inputVersion({
        nodeId,
        contentHash: makeContentHash('priv'),
        visibility: 'PRIVATE',
      });

      // Create a PRIVATE parent
      await service.syncVersions([parent]);

      // Attempt to create a PUBLIC child — should fail visibility validation
      const child = await inputVersion({
        nodeId,
        parent: parent.commit,
        contentHash: makeContentHash('pub'),
        visibility: 'PUBLIC',
      });
      const result = await service.syncVersions([child]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0]).toContain('visibility');
    });

    it('should allow equal or lower child visibility', async () => {
      const nodeId = crypto.randomUUID();
      const parent = await inputVersion({
        nodeId,
        contentHash: makeContentHash('pub1'),
        visibility: 'PUBLIC',
      });

      // Create a PUBLIC parent
      await service.syncVersions([parent]);

      // UNLISTED child of PUBLIC parent should succeed
      const child = await inputVersion({
        nodeId,
        parent: parent.commit,
        contentHash: makeContentHash('unl1'),
        visibility: 'UNLISTED',
      });
      const result = await service.syncVersions([child]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(0);
    });

    it('should create lineage refs for GENERATED versions', async () => {
      const inputNodeId = crypto.randomUUID();
      const genNodeId = crypto.randomUUID();

      // Create the input node first
      const inputV = await inputVersion({
        nodeId: inputNodeId,
        contentHash: makeContentHash('inp'),
      });
      await service.syncVersions([inputV]);

      // Create generated node with refs to input
      const genV = await inputVersion({
        nodeId: genNodeId,
        type: 'GENERATED',
        contentHash: makeContentHash('gen'),
        content: { blocks: [{ type: 'text', text: 'generated' }] },
        refs: [
          {
            targetCommit: inputV.commit,
            refType: 'input',
          },
        ],
      });
      await service.syncVersions([genV]);

      // Verify refs in DB
      const refs = await db
        .select()
        .from(nodeVersionRefs)
        .where(eq(nodeVersionRefs.sourceCommit, genV.commit));
      expect(refs).toHaveLength(1);
      expect(refs[0].targetCommit).toBe(inputV.commit);
      expect(refs[0].refType).toBe('input');
    });

    it('should store content in the correct typed table for each node type', async () => {
      const types: Array<{ type: SyncNodeVersionInput['type']; table: any; content: unknown }> = [
        { type: 'INPUT', table: inputContents, content: { blocks: [{ type: 'text', text: 'in' }] } },
        { type: 'PROMPT', table: promptContents, content: { blocks: [{ type: 'text', text: 'pr' }] } },
        { type: 'GENERATED', table: generatedContents, content: { blocks: [{ type: 'text', text: 'gen' }] } },
        { type: 'VFS', table: vfsContents, content: { projectId: 'proj1' } },
        { type: 'SANDBOX', table: sandboxContents, content: { entryFile: 'index.html' } },
        { type: 'LOADER', table: loaderContents, content: {} },
        { type: 'STATE', table: stateContents, content: { saves: ['commit1'] } },
      ];

      for (const { type, table, content } of types) {
        const hash = makeContentHash(type);
        const v = await inputVersion({
          nodeId: crypto.randomUUID(),
          type,
          contentHash: hash,
          content,
        });
        await service.syncVersions([v]);

        // Verify content in the correct table
        const rows = await db
          .select()
          .from(table)
          .where(eq(table.contentHash, hash));
        expect(rows).toHaveLength(1);
      }
    });

    it('should handle empty input array', async () => {
      const result = await service.syncVersions([]);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe(0);
      expect(result.data.skipped).toBe(0);
      expect(result.data.errors).toHaveLength(0);
    });

    it('should default visibility to PRIVATE when not specified', async () => {
      const nodeId = crypto.randomUUID();
      const contentHash = makeContentHash('def');
      const commit = await computeNodeCommit(nodeId, null, contentHash, 'INPUT');

      await service.syncVersions([
        {
          nodeId,
          commit,
          authorId: testUserId,
          sourceArtifactId: crypto.randomUUID(),
          type: 'INPUT',
          contentHash,
          content: { blocks: [] },
          // No visibility specified
        },
      ]);

      const rows = await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, commit));
      expect(rows).toHaveLength(1);
      expect(rows[0].visibility).toBe('PRIVATE');
    });
  });

  // ========================================================================
  // getVersions
  // ========================================================================
  describe('getVersions', () => {
    it('should return all versions for a node ordered by authoredAt desc', async () => {
      const nodeId = crypto.randomUUID();
      const v1 = await inputVersion({ nodeId, contentHash: makeContentHash('v01'), authoredAt: '2024-01-01T00:00:00Z' });
      const v2 = await inputVersion({ nodeId, parent: v1.commit, contentHash: makeContentHash('v02'), authoredAt: '2024-01-02T00:00:00Z' });
      const v3 = await inputVersion({ nodeId, parent: v2.commit, contentHash: makeContentHash('v03'), authoredAt: '2024-01-03T00:00:00Z' });

      await service.syncVersions([v1, v2, v3]);

      const result = await service.getVersions(nodeId);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toHaveLength(3);
      // Should be newest first
      expect(result.data[0].commit).toBe(v3.commit);
      expect(result.data[1].commit).toBe(v2.commit);
      expect(result.data[2].commit).toBe(v1.commit);
    });

    it('should return empty array for non-existent node', async () => {
      const result = await service.getVersions('non-existent-node');
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(0);
    });
  });

  // ========================================================================
  // getVersion
  // ========================================================================
  describe('getVersion', () => {
    it('should return version detail with content', async () => {
      const nodeId = crypto.randomUUID();
      const contentHash = makeContentHash('det');
      const blocks = [{ type: 'text', text: 'hello world' }];
      const v = await inputVersion({ nodeId, contentHash, content: { blocks } });

      await service.syncVersions([v]);

      const result = await service.getVersion(v.commit);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.nodeId).toBe(nodeId);
      expect(result.data.commit).toBe(v.commit);
      expect(result.data.contentHash).toBe(contentHash);
      expect(result.data.type).toBe('INPUT');
      // Content should be the API-shaped object with type discriminator, without DB-internal fields
      expect(result.data.content).toBeTruthy();
      const contentObj = result.data.content as Record<string, unknown>;
      expect(contentObj.type).toBe('INPUT');
      expect(contentObj.blocks).toEqual(blocks);
    });

    it('should return NOT_FOUND for non-existent version', async () => {
      const result = await service.getVersion('no-commit');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // getLatest
  // ========================================================================
  describe('getLatest', () => {
    it('should return the latest version by authoredAt', async () => {
      const nodeId = crypto.randomUUID();
      const vOld = await inputVersion({ nodeId, contentHash: makeContentHash('old'), authoredAt: '2024-01-01T00:00:00Z' });
      const vNew = await inputVersion({ nodeId, parent: vOld.commit, contentHash: makeContentHash('new'), authoredAt: '2024-06-01T00:00:00Z' });

      await service.syncVersions([vOld, vNew]);

      const result = await service.getLatest(nodeId);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).not.toBeNull();
      expect(result.data!.commit).toBe(vNew.commit);
      expect(result.data!.content).toBeTruthy();
    });

    it('should return null for non-existent node', async () => {
      const result = await service.getLatest('non-existent');
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBeNull();
    });
  });

  // ========================================================================
  // getChildren
  // ========================================================================
  describe('getChildren', () => {
    it('should return child versions (forks)', async () => {
      const nodeId = crypto.randomUUID();

      // Create parent
      const parentV = await inputVersion({ nodeId, contentHash: makeContentHash('par'), authoredAt: '2024-01-01T00:00:00Z' });
      await service.syncVersions([parentV]);

      // Create two children (fork)
      const ch1 = await inputVersion({ nodeId, parent: parentV.commit, contentHash: makeContentHash('ch1'), authoredAt: '2024-01-02T00:00:00Z' });
      const ch2 = await inputVersion({ nodeId, parent: parentV.commit, contentHash: makeContentHash('ch2'), authoredAt: '2024-01-03T00:00:00Z' });
      await service.syncVersions([ch1, ch2]);

      const result = await service.getChildren(parentV.commit);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(2);

      // Should be newest first
      const commits = result.data.map(v => v.commit);
      expect(commits[0]).toBe(ch2.commit);
      expect(commits[1]).toBe(ch1.commit);
    });

    it('should return empty for leaf versions', async () => {
      const nodeId = crypto.randomUUID();
      const v = await inputVersion({ nodeId, contentHash: makeContentHash('leaf') });

      await service.syncVersions([v]);

      const result = await service.getChildren(v.commit);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(0);
    });
  });

  // ========================================================================
  // getVersionRefs
  // ========================================================================
  describe('getVersionRefs', () => {
    it('should return all lineage refs for a version', async () => {
      const inputNodeId = crypto.randomUUID();
      const promptNodeId = crypto.randomUUID();
      const genNodeId = crypto.randomUUID();

      const inputV = await inputVersion({ nodeId: inputNodeId, contentHash: makeContentHash('ri1') });
      const promptV = await inputVersion({
        nodeId: promptNodeId,
        type: 'PROMPT',
        contentHash: makeContentHash('rp1'),
        content: { blocks: [{ type: 'text', text: 'prompt' }] },
      });

      // Create input and prompt first
      await service.syncVersions([inputV, promptV]);

      // Create generated with multiple refs
      const genV = await inputVersion({
        nodeId: genNodeId,
        type: 'GENERATED',
        contentHash: makeContentHash('rg1'),
        content: { blocks: [{ type: 'text', text: 'output' }] },
        refs: [
          { targetCommit: inputV.commit, refType: 'input' },
          { targetCommit: promptV.commit, refType: 'prompt' },
        ],
      });
      await service.syncVersions([genV]);

      const result = await service.getVersionRefs(genV.commit);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(2);

      const refTypes = result.data.map(r => r.refType).sort();
      expect(refTypes).toEqual(['input', 'prompt']);
    });

    it('should return empty for versions without refs', async () => {
      const nodeId = crypto.randomUUID();
      const v = await inputVersion({ nodeId, contentHash: makeContentHash('nrf') });

      await service.syncVersions([v]);

      const result = await service.getVersionRefs(v.commit);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(0);
    });
  });

  // ========================================================================
  // versionExists
  // ========================================================================
  describe('versionExists', () => {
    it('should return true for existing version', async () => {
      const nodeId = crypto.randomUUID();
      const v = await inputVersion({ nodeId, contentHash: makeContentHash('exi') });

      await service.syncVersions([v]);

      const exists = await service.versionExists(v.commit);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent version', async () => {
      const exists = await service.versionExists('no');
      expect(exists).toBe(false);
    });
  });

  // ========================================================================
  // filterExistingVersions
  // ========================================================================
  describe('filterExistingVersions', () => {
    it('should return set of existing commits', async () => {
      const nodeId = crypto.randomUUID();
      const v1 = await inputVersion({ nodeId, contentHash: makeContentHash('fe1') });
      const fakeCommit = 'nonexistent00000';

      await service.syncVersions([v1]);

      const existingSet = await service.filterExistingVersions([
        v1.commit,
        fakeCommit,
      ]);

      expect(existingSet.has(v1.commit)).toBe(true);
      expect(existingSet.has(fakeCommit)).toBe(false);
    });
  });

  // ========================================================================
  // Version tree structure
  // ========================================================================
  describe('version tree structure', () => {
    it('should support a linear chain of parent-child versions', async () => {
      const nodeId = crypto.randomUUID();
      const versions: SyncNodeVersionInput[] = [];
      for (let i = 0; i < 4; i++) {
        const v = await inputVersion({
          nodeId,
          parent: i > 0 ? versions[i - 1].commit : null,
          contentHash: makeContentHash(`t0${i + 1}`),
          authoredAt: `2024-01-0${i + 1}T00:00:00Z`,
        });
        versions.push(v);
      }

      // Build chain: v0 -> v1 -> v2 -> v3
      await service.syncVersions(versions);

      // Verify chain via getChildren
      const children0 = await service.getChildren(versions[0].commit);
      expect(children0.success && children0.data).toHaveLength(1);
      expect(children0.success && children0.data[0].commit).toBe(versions[1].commit);

      const children2 = await service.getChildren(versions[2].commit);
      expect(children2.success && children2.data).toHaveLength(1);
      expect(children2.success && children2.data[0].commit).toBe(versions[3].commit);

      // Root has parent null
      const allVersions = await service.getVersions(nodeId);
      if (allVersions.success) {
        const root = allVersions.data.find(v => v.commit === versions[0].commit);
        expect(root?.parent).toBeNull();
      }
    });

    it('should support forking (multiple children from one parent)', async () => {
      const nodeId = crypto.randomUUID();
      const rootV = await inputVersion({ nodeId, contentHash: makeContentHash('root'), authoredAt: '2024-01-01T00:00:00Z' });
      const fk1 = await inputVersion({ nodeId, parent: rootV.commit, contentHash: makeContentHash('fk1'), authoredAt: '2024-01-02T00:00:00Z' });
      const fk2 = await inputVersion({ nodeId, parent: rootV.commit, contentHash: makeContentHash('fk2'), authoredAt: '2024-01-03T00:00:00Z' });
      const fk3 = await inputVersion({ nodeId, parent: rootV.commit, contentHash: makeContentHash('fk3'), authoredAt: '2024-01-04T00:00:00Z' });

      await service.syncVersions([rootV, fk1, fk2, fk3]);

      const children = await service.getChildren(rootV.commit);
      expect(children.success).toBe(true);
      if (!children.success) return;
      expect(children.data).toHaveLength(3);
    });
  });

  // ========================================================================
  // Content type specifics
  // ========================================================================
  describe('typed content storage', () => {
    it('should store INPUT content with blocks and generationConfig', async () => {
      const hash = makeContentHash('tinp');
      const v = await inputVersion({
        nodeId: crypto.randomUUID(),
        contentHash: hash,
        type: 'INPUT',
        content: {
          blocks: [{ type: 'text', text: 'test input' }],
          generationConfig: { model: 'gpt-4', temperature: 0.7 },
          plainText: 'test input',
        },
      });
      await service.syncVersions([v]);

      const rows = await db
        .select()
        .from(inputContents)
        .where(eq(inputContents.contentHash, hash));
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks).toEqual([{ type: 'text', text: 'test input' }]);
      expect(rows[0].generationConfig).toEqual({ model: 'gpt-4', temperature: 0.7 });
      expect(rows[0].plainText).toBe('test input');
    });

    it('should store VFS content with projectId and file metadata', async () => {
      const hash = makeContentHash('tvfs');
      const v = await inputVersion({
        nodeId: crypto.randomUUID(),
        contentHash: hash,
        type: 'VFS',
        content: {
          projectId: 'proj-123',
          fileCount: 10,
          totalSize: 4096,
          fileTree: [
            { path: 'index.html', size: 1024 },
            { path: 'style.css', size: 512 },
          ],
        },
      });
      await service.syncVersions([v]);

      const rows = await db
        .select()
        .from(vfsContents)
        .where(eq(vfsContents.contentHash, hash));
      expect(rows).toHaveLength(1);
      expect(rows[0].projectId).toBe('proj-123');
      expect(rows[0].fileCount).toBe(10);
      expect(rows[0].totalSize).toBe(4096);
      expect(rows[0].fileTree).toHaveLength(2);
    });

    it('should store STATE content with saves reference list', async () => {
      const hash = makeContentHash('tsta');
      const v = await inputVersion({
        nodeId: crypto.randomUUID(),
        contentHash: hash,
        type: 'STATE',
        content: {
          saves: ['abc12345', 'def67890'],
        },
      });
      await service.syncVersions([v]);

      const rows = await db
        .select()
        .from(stateContents)
        .where(eq(stateContents.contentHash, hash));
      expect(rows).toHaveLength(1);
      expect(rows[0].saves).toEqual(['abc12345', 'def67890']);
    });

    it('should store GENERATED content with blocks', async () => {
      const hash = makeContentHash('tgen');
      const v = await inputVersion({
        nodeId: crypto.randomUUID(),
        contentHash: hash,
        type: 'GENERATED',
        content: {
          blocks: [{ type: 'text', text: 'AI response' }],
          plainText: 'AI response',
        },
      });
      await service.syncVersions([v]);

      const rows = await db
        .select()
        .from(generatedContents)
        .where(eq(generatedContents.contentHash, hash));
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks).toEqual([{ type: 'text', text: 'AI response' }]);
      expect(rows[0].plainText).toBe('AI response');
    });
  });

  // ========================================================================
  // Edge cases & tags
  // ========================================================================
  describe('edge cases', () => {
    it('should store message and tag metadata', async () => {
      const nodeId = crypto.randomUUID();
      const v = await inputVersion({
        nodeId,
        contentHash: makeContentHash('tag'),
        message: 'Initial version',
        tag: '1.0.0',
      });

      await service.syncVersions([v]);

      const rows = await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, v.commit));
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Initial version');
      expect(rows[0].tag).toBe('1.0.0');
    });

    it('should support cross-node version references', async () => {
      // Two separate nodes can have versions referencing each other
      const nodeA = crypto.randomUUID();
      const nodeB = crypto.randomUUID();

      const vA = await inputVersion({ nodeId: nodeA, contentHash: makeContentHash('xra') });
      await service.syncVersions([vA]);

      const vB = await inputVersion({
        nodeId: nodeB,
        type: 'GENERATED',
        contentHash: makeContentHash('xrb'),
        content: { blocks: [{ type: 'text', text: 'gen' }] },
        refs: [{ targetCommit: vA.commit, refType: 'input' }],
      });
      await service.syncVersions([vB]);

      const refs = await service.getVersionRefs(vB.commit);
      if (!refs.success) return;
      expect(refs.data).toHaveLength(1);
      expect(refs.data[0].targetNodeId).toBe(nodeA);
    });
  });
});
