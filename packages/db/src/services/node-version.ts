import { eq, and, desc, sql, lt, or, inArray } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { nodeVersions, nodeVersionRefs, type NodeVersion, type NewNodeVersion, type NewNodeVersionRef, type NodeVersionRefType } from '../schema/node-versions';
import { inputContents, promptContents, generatedContents, vfsContents, sandboxContents, loaderContents, stateContents, saveContents } from '../schema/node-contents';
import type { NodeType } from '../schema/enums';
import type { ServiceResult } from './user';
import type { ArtifactNodeContent, ContentBlock, NodeVersionSummary as ApiNodeVersionSummary } from '@pubwiki/api';
import { computeNodeCommit } from '@pubwiki/api';
import { AclService } from './access-control';

// ========================================================================
// Extended types (API types + internal fields)
// ========================================================================

/** Summary of a node version (API type + internal fields) */
export interface NodeVersionSummary extends ApiNodeVersionSummary {
  /** Source artifact that created this version */
  sourceArtifactId: string;
  /** Parent version this was derived from (for fork tracking) */
  derivativeOf: string | null;
}

/** Full detail of a node version including content */
export interface NodeVersionDetail extends NodeVersionSummary {
  content?: ArtifactNodeContent;
}

/** Input for creating/syncing a node version */
export interface SyncNodeVersionInput {
  nodeId: string;
  commit: string;
  parent?: string | null;
  authorId: string;
  authoredAt?: string;
  type: NodeType;
  name?: string;
  contentHash: string;
  content: ArtifactNodeContent;  // The actual content to store in the typed content table
  message?: string;
  tag?: string;
  isListed?: boolean;
  /** 
   * Whether this node version should be private.
   * If true, only owner and authorized users can access.
   * If false or undefined, the node version is public.
   */
  isPrivate?: boolean;
  sourceArtifactId: string;  // 创建该版本的 artifact ID
  // For GENERATED nodes: lineage refs
  refs?: Array<{
    targetCommit: string;
    refType: NodeVersionRefType;
  }>;
}

/** Result of a sync operation */
export interface SyncResult {
  created: number;
  skipped: number;   // Already existed
  errors: string[];
}

// ========================================================================
// Content table helpers
// ========================================================================

/** Extract plain text from content blocks (for full-text search indexing) */
function extractPlainText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'TextBlock'; value: string } => b.type === 'TextBlock')
    .map(b => b.value)
    .join('\n');
}

/** Extract reftag names from content blocks (for reference tracking) */
function extractReftagNames(blocks: ContentBlock[]): string[] {
  return blocks
    .filter((b): b is { type: 'RefTagBlock'; name: string } => b.type === 'RefTagBlock')
    .map(b => b.name);
}

/** Map node type to its content table */
function getContentTable(type: NodeType) {
  switch (type) {
    case 'INPUT': return inputContents;
    case 'PROMPT': return promptContents;
    case 'GENERATED': return generatedContents;
    case 'VFS': return vfsContents;
    case 'SANDBOX': return sandboxContents;
    case 'LOADER': return loaderContents;
    case 'STATE': return stateContents;
    case 'SAVE': return saveContents;
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
}

// ========================================================================
// NodeVersionService
// ========================================================================
// All node-related operations should be performed through this service.
// Direct access to node_versions table is not permitted without using this service.
export class NodeVersionService {
  private readonly aclService: AclService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
  }

  // ──────────────────────────────────────────
  // Query operations
  // ──────────────────────────────────────────

  /** Get versions for a node with cursor-based pagination (ordered by authored_at desc) */
  async getVersions(
    nodeId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<ServiceResult<{ versions: NodeVersionSummary[]; nextCursor: string | null }>> {
    try {
      const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);

      const conditions = [eq(nodeVersions.nodeId, nodeId)];

      // Decode cursor: "authoredAt|commit" for stable ordering
      if (options?.cursor) {
        const sep = options.cursor.indexOf('|');
        if (sep > 0) {
          const cursorAt = options.cursor.slice(0, sep);
          const cursorCommit = options.cursor.slice(sep + 1);
          // authoredAt < cursorAt OR (authoredAt = cursorAt AND commit < cursorCommit)
          conditions.push(
            or(
              lt(nodeVersions.authoredAt, cursorAt),
              and(
                eq(nodeVersions.authoredAt, cursorAt),
                lt(nodeVersions.commit, cursorCommit)
              )
            )!
          );
        }
      }

      // Fetch one extra to determine if there's a next page
      const versions = await this.ctx.select()
        .from(nodeVersions)
        .where(and(...conditions))
        .orderBy(desc(nodeVersions.authoredAt), desc(nodeVersions.commit))
        .limit(limit + 1);

      let nextCursor: string | null = null;
      if (versions.length > limit) {
        versions.pop();
        const last = versions[versions.length - 1];
        nextCursor = `${last.authoredAt}|${last.commit}`;
      }

      return {
        success: true,
        data: {
          versions: versions.map(this.toSummary),
          nextCursor,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to get versions: ${error}` },
      };
    }
  }

  /** Get a specific version by commit hash (globally unique) */
  async getVersion(commit: string): Promise<ServiceResult<NodeVersionDetail>> {
    try {
      const versionResult = await this.ctx.select()
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, commit))
        .limit(1);

      if (versionResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Version ${commit} not found` },
        };
      }

      const version = versionResult[0];
      const content = await this.getContent(version.type, version.contentHash);

      return {
        success: true,
        data: {
          ...this.toSummary(version),
          content,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to get version: ${error}` },
      };
    }
  }

  /** Get the latest version for a node */
  async getLatest(nodeId: string): Promise<ServiceResult<NodeVersionDetail | null>> {
    try {
      const versionResult = await this.ctx.select()
        .from(nodeVersions)
        .where(eq(nodeVersions.nodeId, nodeId))
        .orderBy(desc(nodeVersions.authoredAt))
        .limit(1);

      if (versionResult.length === 0) {
        return { success: true, data: null };
      }

      const version = versionResult[0];
      const content = await this.getContent(version.type, version.contentHash);

      return {
        success: true,
        data: {
          ...this.toSummary(version),
          content,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to get latest version: ${error}` },
      };
    }
  }

  /** Get children versions (commits whose parent is the given commit) */
  async getChildren(commit: string): Promise<ServiceResult<NodeVersionSummary[]>> {
    try {
      const children = await this.ctx.select()
        .from(nodeVersions)
        .where(eq(nodeVersions.parent, commit))
        .orderBy(desc(nodeVersions.authoredAt));

      return {
        success: true,
        data: children.map(this.toSummary),
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to get children: ${error}` },
      };
    }
  }

  /** Get version refs (lineage references) for a version */
  async getVersionRefs(commit: string): Promise<ServiceResult<Array<{
    targetNodeId: string;
    targetCommit: string;
    refType: NodeVersionRefType;
  }>>> {
    try {
      const refs = await this.ctx.select({
          targetNodeId: nodeVersions.nodeId,
          targetCommit: nodeVersionRefs.targetCommit,
          refType: nodeVersionRefs.refType,
        })
        .from(nodeVersionRefs)
        .innerJoin(nodeVersions, eq(nodeVersions.commit, nodeVersionRefs.targetCommit))
        .where(eq(nodeVersionRefs.sourceCommit, commit));

      return {
        success: true,
        data: refs,
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to get version refs: ${error}` },
      };
    }
  }

  // ──────────────────────────────────────────
  // Sync operations (single upload entry point)
  // ──────────────────────────────────────────

  /**
   * Batch sync local versions to cloud.
   * This is the ONLY entry point for creating node versions.
   * 
   * This operation is IDEMPOTENT - calling it multiple times with the same
   * inputs will produce the same result. Already-existing versions are skipped
   * before content upsert to prevent refCount inflation.
   * 
   * For each version:
   * 1. Validate commit hash matches computeNodeCommit()
   * 2. Deduplicate by commit within the batch
   * 3. Skip versions that already exist in database
   * 4. Upsert content to typed content table (refCount managed)
   * 5. Insert node_versions record (onConflictDoNothing)
   * 6. Insert lineage refs if any (onConflictDoNothing)
   * 
   * Note: All writes are collected into BatchContext, not executed immediately.
   * The caller (route layer) is responsible for calling ctx.commit().
   */
  async syncVersions(inputs: SyncNodeVersionInput[]): Promise<ServiceResult<SyncResult>> {
    const result: SyncResult = { created: 0, skipped: 0, errors: [] };

    try {
      // ========== Phase 1: Validate all inputs and deduplicate by commit ==========
      
      // Use Map to validate and deduplicate in one pass (keeps first occurrence)
      const validatedInputMap = new Map<string, SyncNodeVersionInput>();
      for (const input of inputs) {
        // Skip duplicates
        if (validatedInputMap.has(input.commit)) {
          continue;
        }

        const expectedCommit = await computeNodeCommit(
          input.nodeId,
          input.parent ?? null,
          input.contentHash,
          input.type,
        );
        if (input.commit !== expectedCommit) {
          result.errors.push(
            `Version for node ${input.nodeId}: commit hash mismatch: expected ${expectedCommit}, got ${input.commit}. ` +
            `Client must compute commit using computeNodeCommit(nodeId, parent, contentHash, type).`
          );
          continue;
        }
        validatedInputMap.set(input.commit, input);
      }

      // Batch query existing commits to filter out already-existing versions
      const commits = [...validatedInputMap.keys()];
      const existingVersions = commits.length > 0
        ? await this.ctx.select({ commit: nodeVersions.commit })
            .from(nodeVersions)
            .where(inArray(nodeVersions.commit, commits))
        : [];

      // Remove existing versions from map
      for (const v of existingVersions) {
        validatedInputMap.delete(v.commit);
        result.skipped++;
      }

      const newInputs = [...validatedInputMap.values()];

      // ========== Phase 2: Batch upsert unique contents ==========
      
      // Collect unique contentHashes and their contents
      const contentMap = new Map<string, ArtifactNodeContent>();
      for (const input of newInputs) {
        contentMap.set(input.contentHash, input.content);
      }

      // Upsert all unique contents
      for (const [contentHash, content] of contentMap) {
        this.upsertContent(contentHash, content);
      }

      // ========== Phase 3: Prepare parent info for derivativeOf ==========
      
      // Batch query parent versions for derivativeOf computation
      const parentCommits = newInputs
        .map(i => i.parent)
        .filter((p): p is string => p != null);
      const parentVersions = parentCommits.length > 0
        ? await this.ctx.select({
            commit: nodeVersions.commit,
            sourceArtifactId: nodeVersions.sourceArtifactId,
            derivativeOf: nodeVersions.derivativeOf,
          })
            .from(nodeVersions)
            .where(inArray(nodeVersions.commit, parentCommits))
        : [];
      const parentMap = new Map(parentVersions.map(p => [p.commit, p]));

      // ========== Phase 4: Create node versions ==========
      
      for (const input of newInputs) {
        try {
          // Compute derivativeOf (skip-list pointer for cross-artifact lineage)
          let derivativeOf: string | null = null;
          if (input.parent) {
            const parent = parentMap.get(input.parent);
            if (parent) {
              if (parent.sourceArtifactId !== input.sourceArtifactId) {
                // Parent comes from a different artifact
                derivativeOf = parent.commit;
              } else {
                // Inherit parent's skip-list pointer
                derivativeOf = parent.derivativeOf;
              }
            }
          }

          // Prepare node version record
          const newVersion: NewNodeVersion = {
            nodeId: input.nodeId,
            commit: input.commit,
            parent: input.parent ?? null,
            authorId: input.authorId,
            authoredAt: input.authoredAt ?? new Date().toISOString(),
            type: input.type,
            name: input.name ?? null,
            contentHash: input.contentHash,
            sourceArtifactId: input.sourceArtifactId,
            derivativeOf,
            message: input.message ?? null,
            tag: input.tag ?? null,
          };

          // Collect node version insert (idempotent with onConflictDoNothing)
          this.ctx.modify(db =>
            db.insert(nodeVersions)
              .values(newVersion)
              .onConflictDoNothing()
          );

          // Create ACL for node version
          // Node ACL is based on commit hash (the version identifier)
          const nodeRef = { type: 'node' as const, id: input.commit };
          this.aclService.grantOwner(nodeRef, input.authorId);
          
          // Set public access if not private
          if (!input.isPrivate) {
            this.aclService.setPublic(nodeRef, input.authorId);
          }

          // Collect lineage refs insert (idempotent)
          if (input.refs && input.refs.length > 0) {
            const refValues: NewNodeVersionRef[] = input.refs.map(ref => ({
              sourceCommit: input.commit,
              targetCommit: ref.targetCommit,
              refType: ref.refType,
            }));
            this.ctx.modify(db =>
              db.insert(nodeVersionRefs)
                .values(refValues)
                .onConflictDoNothing()
            );
          }

          result.created++;
        } catch (error) {
          result.errors.push(`Version ${input.commit} for node ${input.nodeId}: ${error}`);
        }
      }

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Sync failed: ${error}` },
      };
    }
  }

  /**
   * Check if a specific version exists on cloud
   */
  async versionExists(commit: string): Promise<boolean> {
    const result = await this.ctx.select({ commit: nodeVersions.commit })
      .from(nodeVersions)
      .where(eq(nodeVersions.commit, commit))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Batch check which versions already exist
   */
  async filterExistingVersions(
    commits: string[]
  ): Promise<Set<string>> {
    if (commits.length === 0) {
      return new Set();
    }

    // Process in batches to avoid SQL parameter limits
    const existingSet = new Set<string>();
    const batchSize = 50;
    
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize);
      const existing = await this.ctx.select({ commit: nodeVersions.commit })
        .from(nodeVersions)
        .where(inArray(nodeVersions.commit, batch));
      
      for (const row of existing) {
        existingSet.add(row.commit);
      }
    }

    return existingSet;
  }

  // ──────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────

  /** Convert DB row to summary */
  private toSummary(v: NodeVersion): NodeVersionSummary {
    return {
      nodeId: v.nodeId,
      commit: v.commit,
      parent: v.parent,
      authorId: v.authorId,
      authoredAt: v.authoredAt,
      type: v.type,
      name: v.name,
      contentHash: v.contentHash,
      message: v.message,
      tag: v.tag,
      sourceArtifactId: v.sourceArtifactId,
      derivativeOf: v.derivativeOf,
      // Node 默认不可发现，实际访问控制由 ACL 决定
      // TODO: 后续可从 resource_discovery_control 表获取
      isListed: false,
    };
  }

  /** Get content from the typed content table, injecting the `type` discriminator */
  private async getContent(type: NodeType, contentHash: string): Promise<ArtifactNodeContent | undefined> {
    const table = getContentTable(type);
    const result = await this.ctx.select()
      .from(table)
      .where(eq(table.contentHash, contentHash))
      .limit(1);

    if (result.length === 0) return undefined;

    // DB content 表不含 type 判别字段（type 存储在 node_versions 上），
    // 但 API 的 ArtifactNodeContent 是以 type 为 discriminator 的联合类型，
    // 需要在此注入 type 使结构匹配。
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contentHash: _contentHash, refCount: _refCount, createdAt: _createdAt, ...contentFields } = result[0];
    return { type, ...contentFields } as ArtifactNodeContent;
  }

  /**
   * Upsert content into the typed content table.
   * Uses ON CONFLICT to increment ref_count if content already exists.
   * 
   * WARNING: This is NOT idempotent - calling multiple times for the same
   * contentHash will increment refCount each time. Callers must ensure
   * this is only called once per content (e.g., by checking existence first).
   * 
   * Note: This collects the operation into BatchContext, not executed immediately.
   * 
   * For SAVE nodes, the content is expected to have additional fields
   * (stateNodeCommit, sourceArtifactCommit) populated by artifact.ts.
   */
  private upsertContent(contentHash: string, content: ArtifactNodeContent): void {
    // Using type narrowing via the discriminated union's `type` field
    switch (content.type) {
      case 'INPUT': {
        const blocks = content.blocks;
        this.ctx.modify(db =>
          db.insert(inputContents)
            .values({
              contentHash,
              blocks,
              generationConfig: content.generationConfig,
              plainText: extractPlainText(blocks),
              reftagNames: extractReftagNames(blocks),
            })
            .onConflictDoUpdate({
              target: inputContents.contentHash,
              set: { refCount: sql`${inputContents.refCount} + 1` },
            })
        );
        break;
      }

      case 'PROMPT': {
        const blocks = content.blocks;
        this.ctx.modify(db =>
          db.insert(promptContents)
            .values({
              contentHash,
              blocks,
              plainText: extractPlainText(blocks),
              reftagNames: extractReftagNames(blocks),
            })
            .onConflictDoUpdate({
              target: promptContents.contentHash,
              set: { refCount: sql`${promptContents.refCount} + 1` },
            })
        );
        break;
      }

      case 'GENERATED':
        this.ctx.modify(db =>
          db.insert(generatedContents)
            .values({
              contentHash,
              blocks: content.blocks,
              // GENERATED blocks are MessageBlock[], not ContentBlock[], so no plainText extraction
              plainText: undefined,
            })
            .onConflictDoUpdate({
              target: generatedContents.contentHash,
              set: { refCount: sql`${generatedContents.refCount} + 1` },
            })
        );
        break;

      case 'VFS':
        this.ctx.modify(db =>
          db.insert(vfsContents)
            .values({
              contentHash,
              filesHash: content.filesHash,
              mounts: content.mounts,
              fileCount: content.fileCount,
              totalSize: content.totalSize,
              fileTree: content.fileTree,
            })
            .onConflictDoUpdate({
              target: vfsContents.contentHash,
              set: { refCount: sql`${vfsContents.refCount} + 1` },
            })
        );
        break;

      case 'SANDBOX':
        this.ctx.modify(db =>
          db.insert(sandboxContents)
            .values({
              contentHash,
              entryFile: content.entryFile,
            })
            .onConflictDoUpdate({
              target: sandboxContents.contentHash,
              set: { refCount: sql`${sandboxContents.refCount} + 1` },
            })
        );
        break;

      case 'LOADER':
        this.ctx.modify(db =>
          db.insert(loaderContents)
            .values({
              contentHash,
            })
            .onConflictDoUpdate({
              target: loaderContents.contentHash,
              set: { refCount: sql`${loaderContents.refCount} + 1` },
            })
        );
        break;

      case 'STATE':
        this.ctx.modify(db =>
          db.insert(stateContents)
            .values({
              contentHash,
              name: content.name,
              description: content.description,
            })
            .onConflictDoUpdate({
              target: stateContents.contentHash,
              set: { refCount: sql`${stateContents.refCount} + 1` },
            })
        );
        break;

      case 'SAVE':
        this.ctx.modify(db =>
          db.insert(saveContents)
            .values({
              contentHash,
              stateNodeId: content.stateNodeId,
              stateNodeCommit: content.stateNodeCommit,
              artifactId: content.artifactId,
              artifactCommit: content.artifactCommit,
              quadsHash: content.quadsHash,
              title: content.title,
              description: content.description,
            })
            .onConflictDoUpdate({
              target: saveContents.contentHash,
              set: { refCount: sql`${saveContents.refCount} + 1` },
            })
        );
        break;
    }
  }

  /**
   * Decrement the refCount of a content row. If refCount reaches 0, delete the row.
   * Returns { decremented: boolean, deleted: boolean }.
   * 
   * Note: This collects operations into BatchContext, not executed immediately.
   * The actual deletion check happens at commit time.
   */
  decrementContentRefCount(type: NodeType, contentHash: string): void {
    const table = getContentTable(type);

    // Use a single update that decrements refCount
    // The actual cleanup of zero-refCount rows should be done by a separate garbage collection process
    this.ctx.modify(db =>
      db.update(table)
        .set({ refCount: sql`${table.refCount} - 1` })
        .where(eq(table.contentHash, contentHash))
    );
  }

  /**
   * Fork a node version as private.
   * 
   * Creates a new node version with the same content but private ACL.
   * Used when changing artifact privacy from public to private.
   * The new version's commit is computed based on the new parent relationship.
   * 
   * @param sourceCommit - The commit hash of the version to fork
   * @param authorId - Author ID for the new version
   * @param sourceArtifactId - The artifact that owns this fork
   * @returns The new commit hash
   */
  async forkAsPrivate(
    sourceCommit: string,
    authorId: string,
    sourceArtifactId: string,
  ): Promise<ServiceResult<{ commit: string }>> {
    try {
      // Get the source version
      const [sourceVersion] = await this.ctx.select()
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, sourceCommit))
        .limit(1);

      if (!sourceVersion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Node version ${sourceCommit} not found` },
        };
      }

      // Compute new commit hash (with sourceCommit as parent)
      const newCommit = await computeNodeCommit(
        sourceVersion.nodeId,
        sourceCommit,  // The forked version's parent is the source
        sourceVersion.contentHash,
        sourceVersion.type,
      );

      // Check if this commit already exists
      const [existing] = await this.ctx.select({ commit: nodeVersions.commit })
        .from(nodeVersions)
        .where(eq(nodeVersions.commit, newCommit))
        .limit(1);

      if (existing) {
        // Already exists, return the existing commit
        return { success: true, data: { commit: newCommit } };
      }

      // Compute derivativeOf (skip-list pointer)
      // Since we're forking from a different artifact context, use sourceCommit
      const derivativeOf = sourceVersion.sourceArtifactId !== sourceArtifactId
        ? sourceCommit
        : sourceVersion.derivativeOf;

      // Create new node version record
      const newVersion: NewNodeVersion = {
        nodeId: sourceVersion.nodeId,
        commit: newCommit,
        parent: sourceCommit,
        authorId,
        authoredAt: new Date().toISOString(),
        type: sourceVersion.type,
        name: sourceVersion.name,
        contentHash: sourceVersion.contentHash,
        sourceArtifactId,
        derivativeOf,
        message: 'Forked to private',
        tag: null,
      };

      this.ctx.modify(db =>
        db.insert(nodeVersions)
          .values(newVersion)
          .onConflictDoNothing()
      );

      // Increment content refCount (same content, new reference)
      this.incrementContentRefCount(sourceVersion.type, sourceVersion.contentHash);

      // Create ACL for the new node version (private)
      const nodeRef = { type: 'node' as const, id: newCommit };
      this.aclService.grantOwner(nodeRef, authorId);
      // Don't set public access - this is a private fork

      // Copy lineage refs if any
      const sourceRefs = await this.ctx.select()
        .from(nodeVersionRefs)
        .where(eq(nodeVersionRefs.sourceCommit, sourceCommit));

      if (sourceRefs.length > 0) {
        const refValues: NewNodeVersionRef[] = sourceRefs.map(ref => ({
          sourceCommit: newCommit,
          targetCommit: ref.targetCommit,
          refType: ref.refType,
        }));
        this.ctx.modify(db =>
          db.insert(nodeVersionRefs)
            .values(refValues)
            .onConflictDoNothing()
        );
      }

      return { success: true, data: { commit: newCommit } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to fork node version: ${error}` },
      };
    }
  }

  /**
   * Increment content refCount when a new node version references it.
   */
  private incrementContentRefCount(type: NodeType, contentHash: string): void {
    const table = getContentTable(type);
    this.ctx.modify(db =>
      db.update(table)
        .set({ refCount: sql`${table.refCount} + 1` })
        .where(eq(table.contentHash, contentHash))
    );
  }

  /**
   * Update permission for a node version (one-way relaxation).
   * 
   * Node version permissions follow one-way relaxation rule:
   * - private -> public: allowed, directly update ACL
   * - public -> private: NOT allowed on existing commit, must create new version
   * 
   * This method only handles the private -> public case.
   * For public -> private, caller should create a new node version with the desired privacy.
   * 
   * @param commit - The node version commit hash
   * @param isPrivate - Target privacy state (only false is meaningful)
   * @param authorId - Author ID for ACL operations
   * @param sourceArtifactId - The artifact that owns this node (for validation)
   */
  async updatePermission(
    commit: string,
    isPrivate: boolean,
    authorId: string,
    sourceArtifactId: string,
  ): Promise<ServiceResult<void>> {
    // Get the node version to verify ownership
    const [version] = await this.ctx.select({
        sourceArtifactId: nodeVersions.sourceArtifactId,
      })
      .from(nodeVersions)
      .where(eq(nodeVersions.commit, commit))
      .limit(1);

    if (!version) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Node version ${commit} not found` } };
    }

    // Only allow updating original nodes (created by this artifact)
    if (version.sourceArtifactId !== sourceArtifactId) {
      return { success: false, error: { code: 'FORBIDDEN', message: 'Cannot update permission of referenced node' } };
    }

    const nodeRef = { type: 'node' as const, id: commit };

    if (isPrivate) {
      // public -> private: not allowed via this method
      // Caller should create a new node version instead
      const currentIsPublic = await this.aclService.isPublic(nodeRef);
      if (currentIsPublic) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Cannot change node version from public to private. Create a new version instead.',
          },
        };
      }
      // Already private, no-op
    } else {
      // private -> public: allowed (one-way relaxation)
      this.aclService.setPublic(nodeRef, authorId);
    }

    return { success: true, data: undefined };
  }

}
