import { eq, and, desc, lt, or, inArray } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { nodeVersions, nodeVersionRefs, type NewNodeVersion, type NewNodeVersionRef, type NodeVersionRefType } from '../schema/node-versions';
import { artifactVersionNodes } from '../schema/artifact-version-graph';
import { inputContents, promptContents, generatedContents, vfsContents, sandboxContents, loaderContents, stateContents, saveContents } from '../schema/node-contents';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import type { NodeType } from '../schema/enums';
import type { ServiceResult } from './user';
import type { ArtifactNodeContent, ContentBlock, NodeVersionSummary as ApiNodeVersionSummary } from '@pubwiki/api';
import { computeNodeCommit, computeContentHash } from '@pubwiki/api';
import { AclService, DiscoveryService } from './access-control';

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
  metadata?: Record<string, string> | null;
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
  private readonly discoveryService: DiscoveryService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
    this.discoveryService = new DiscoveryService(ctx);
  }

  // ──────────────────────────────────────────
  // Query operations
  // ──────────────────────────────────────────

  /**
   * Get all node version commits created by a specific artifact.
   * Queries nodes where sourceArtifactId matches the given artifactId.
   * 
   * @param artifactId - The artifact ID to match sourceArtifactId
   * @param artifactCommit - Optional artifact version commit hash. When provided,
   *                         only returns nodes in that specific artifact version.
   * @returns Array of node version commits
   */
  async nodesCreatedBy(artifactId: string, artifactCommit?: string): Promise<string[]> {
    if (artifactCommit) {
      // Get original nodes in a specific artifact version
      const nodes = await this.ctx
        .select({ commit: artifactVersionNodes.nodeCommit })
        .from(artifactVersionNodes)
        .innerJoin(
          nodeVersions,
          eq(nodeVersions.commit, artifactVersionNodes.nodeCommit)
        )
        .where(
          and(
            eq(artifactVersionNodes.commitHash, artifactCommit),
            eq(nodeVersions.sourceArtifactId, artifactId)
          )
        );
      return nodes.map(n => n.commit);
    } else {
      // Get all nodes created by this artifact (across all versions)
      const nodes = await this.ctx
        .select({ commit: nodeVersions.commit })
        .from(nodeVersions)
        .where(eq(nodeVersions.sourceArtifactId, artifactId));
      return nodes.map(n => n.commit);
    }
  }

  /** Get versions for a node with cursor-based pagination (ordered by authored_at desc) */
  async getVersions(
    nodeId: string,
    options?: { cursor?: string; limit?: number; viewerId?: string }
  ): Promise<ServiceResult<{ versions: NodeVersionSummary[]; nextCursor: string | null }>> {
    try {
      const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
      const viewerId = options?.viewerId;

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

      // Filter by isListed: only listed versions are visible to non-authors
      // Authors can see all their versions (listed or not)
      if (viewerId) {
        // Can see: listed OR authored by self
        conditions.push(
          or(
            eq(resourceDiscoveryControl.isListed, true),
            eq(nodeVersions.authorId, viewerId)
          )!
        );
      } else {
        // Anonymous users can only see listed versions
        conditions.push(eq(resourceDiscoveryControl.isListed, true));
      }

      // Fetch one extra to determine if there's a next page
      // Join with resource_discovery_control to get isListed
      const versions = await this.ctx
        .select({
          nodeId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          type: nodeVersions.type,
          name: nodeVersions.name,
          contentHash: nodeVersions.contentHash,
          message: nodeVersions.message,
          tag: nodeVersions.tag,
          metadata: nodeVersions.metadata,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          derivativeOf: nodeVersions.derivativeOf,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(nodeVersions)
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'node'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
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
          versions: versions.map(v => ({
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
            metadata: v.metadata,
            sourceArtifactId: v.sourceArtifactId,
            derivativeOf: v.derivativeOf,
            isListed: v.isListed ?? false,
          })),
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
      const versionResult = await this.ctx
        .select({
          nodeId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          type: nodeVersions.type,
          name: nodeVersions.name,
          contentHash: nodeVersions.contentHash,
          message: nodeVersions.message,
          tag: nodeVersions.tag,
          metadata: nodeVersions.metadata,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          derivativeOf: nodeVersions.derivativeOf,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(nodeVersions)
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'node'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
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
          nodeId: version.nodeId,
          commit: version.commit,
          parent: version.parent,
          authorId: version.authorId,
          authoredAt: version.authoredAt,
          type: version.type,
          name: version.name,
          contentHash: version.contentHash,
          message: version.message,
          tag: version.tag,
          metadata: version.metadata,
          sourceArtifactId: version.sourceArtifactId,
          derivativeOf: version.derivativeOf,
          isListed: version.isListed ?? false,
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
      const versionResult = await this.ctx
        .select({
          nodeId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          type: nodeVersions.type,
          name: nodeVersions.name,
          contentHash: nodeVersions.contentHash,
          message: nodeVersions.message,
          tag: nodeVersions.tag,
          metadata: nodeVersions.metadata,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          derivativeOf: nodeVersions.derivativeOf,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(nodeVersions)
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'node'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
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
          nodeId: version.nodeId,
          commit: version.commit,
          parent: version.parent,
          authorId: version.authorId,
          authoredAt: version.authoredAt,
          type: version.type,
          name: version.name,
          contentHash: version.contentHash,
          message: version.message,
          tag: version.tag,
          metadata: version.metadata,
          sourceArtifactId: version.sourceArtifactId,
          derivativeOf: version.derivativeOf,
          isListed: version.isListed ?? false,
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
      const children = await this.ctx
        .select({
          nodeId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          type: nodeVersions.type,
          name: nodeVersions.name,
          contentHash: nodeVersions.contentHash,
          message: nodeVersions.message,
          tag: nodeVersions.tag,
          metadata: nodeVersions.metadata,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          derivativeOf: nodeVersions.derivativeOf,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(nodeVersions)
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'node'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
        .where(eq(nodeVersions.parent, commit))
        .orderBy(desc(nodeVersions.authoredAt));

      return {
        success: true,
        data: children.map(v => ({
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
          isListed: v.isListed ?? false,
        })),
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
   * inputs will produce the same result. Content inserts use ON CONFLICT DO NOTHING
   * so duplicate content is safely ignored.
   * 
   * For each version:
   * 1. Validate commit hash matches computeNodeCommit()
   * 2. Deduplicate by commit within the batch
   * 3. Skip versions that already exist in database
   * 4. Insert content to typed content table (ON CONFLICT DO NOTHING)
   * 5. Insert node_versions record (ON CONFLICT DO NOTHING)
   * 6. Insert lineage refs if any (ON CONFLICT DO NOTHING)
   * 
   * Note: All writes are collected into BatchContext, not executed immediately.
   * The caller (route layer) is responsible for calling ctx.commit().
   */
  async syncVersions(inputs: SyncNodeVersionInput[]): Promise<ServiceResult<SyncResult>> {
    const result: SyncResult = { created: 0, skipped: 0, errors: [] };

    try {
      // ========== Phase 1: Deduplicate, skip existing, then validate ==========
      
      // Deduplicate by commit within the batch (keeps first occurrence)
      const deduplicatedMap = new Map<string, SyncNodeVersionInput>();
      for (const input of inputs) {
        if (!deduplicatedMap.has(input.commit)) {
          deduplicatedMap.set(input.commit, input);
        }
      }

      // Batch query existing commits FIRST to skip already-existing versions
      // before running expensive hash validation. This is correct because existing
      // versions were already validated when they were first created.
      const allCommits = [...deduplicatedMap.keys()];
      const existingVersions = allCommits.length > 0
        ? await this.ctx.select({ commit: nodeVersions.commit })
            .from(nodeVersions)
            .where(inArray(nodeVersions.commit, allCommits))
        : [];

      const existingCommitSet = new Set(existingVersions.map(v => v.commit));
      for (const commit of existingCommitSet) {
        deduplicatedMap.delete(commit);
        result.skipped++;
      }

      // Validate only NEW versions (not yet in DB)
      const validatedInputMap = new Map<string, SyncNodeVersionInput>();
      for (const input of deduplicatedMap.values()) {
        // Validate contentHash matches content
        const expectedContentHash = await computeContentHash(input.content);
        if (input.contentHash !== expectedContentHash) {
          // Log diagnostic info for debugging content hash mismatches
          console.error(`[syncVersions] contentHash mismatch for node ${input.nodeId} (type: ${input.type}):`);
          console.error(`  expected: ${expectedContentHash}`);
          console.error(`  received: ${input.contentHash}`);
          console.error(`  content keys: ${JSON.stringify(Object.keys(input.content))}`);
          console.error(`  content: ${JSON.stringify(input.content).substring(0, 500)}`);
          result.errors.push(
            `Version for node ${input.nodeId}: contentHash mismatch: expected ${expectedContentHash}, got ${input.contentHash}. ` +
            `Client must compute contentHash using computeContentHash(content).`
          );
          continue;
        }

        // Validate commit matches hash(nodeId, parent, contentHash, type, metadata)
        const expectedCommit = await computeNodeCommit(
          input.nodeId,
          input.parent ?? null,
          input.contentHash,
          input.type,
          input.metadata,
        );
        if (input.commit !== expectedCommit) {
          result.errors.push(
            `Version for node ${input.nodeId}: commit hash mismatch: expected ${expectedCommit}, got ${input.commit}. ` +
            `Client must compute commit using computeNodeCommit(nodeId, parent, contentHash, type, metadata).`
          );
          continue;
        }
        validatedInputMap.set(input.commit, input);
      }

      const newInputs = [...validatedInputMap.values()];

      // ========== Phase 2: Batch insert unique contents ==========
      
      // Collect unique contentHashes and their contents
      const contentMap = new Map<string, ArtifactNodeContent>();
      for (const input of newInputs) {
        contentMap.set(input.contentHash, input.content);
      }

      // Insert all unique contents
      for (const [contentHash, content] of contentMap) {
        this.insertContent(contentHash, content);
      }

      // ========== Phase 3: Validate and prepare parent info ==========
      
      // Build a map from commit to input for intra-batch validation
      const batchInputMap = new Map(newInputs.map(i => [i.commit, i]));
      
      // Batch query parent versions for existence check and derivativeOf computation
      const parentCommits = newInputs
        .map(i => i.parent)
        .filter((p): p is string => p != null);
      
      // Filter out parents that are in the same batch (they will be created in this sync)
      const externalParentCommits = parentCommits.filter(p => !batchInputMap.has(p));
      
      const parentVersions = externalParentCommits.length > 0
        ? await this.ctx.select({
            commit: nodeVersions.commit,
            nodeId: nodeVersions.nodeId,
            sourceArtifactId: nodeVersions.sourceArtifactId,
            derivativeOf: nodeVersions.derivativeOf,
          })
            .from(nodeVersions)
            .where(inArray(nodeVersions.commit, externalParentCommits))
        : [];
      const parentMap = new Map(parentVersions.map(p => [p.commit, p]));
      
      // Validate parent commits: must exist and have matching nodeId
      const invalidInputs = new Set<string>();
      for (const input of newInputs) {
        if (!input.parent) continue;
        
        // Check if parent is in the same batch
        const batchParent = batchInputMap.get(input.parent);
        if (batchParent) {
          // Validate nodeId matches
          if (batchParent.nodeId !== input.nodeId) {
            result.errors.push(
              `Version ${input.commit} for node ${input.nodeId}: parent commit ${input.parent} belongs to different node ${batchParent.nodeId}`
            );
            invalidInputs.add(input.commit);
          }
          continue;
        }
        
        // Check if parent exists in database
        const dbParent = parentMap.get(input.parent);
        if (!dbParent) {
          result.errors.push(
            `Version ${input.commit} for node ${input.nodeId}: parent commit ${input.parent} does not exist`
          );
          invalidInputs.add(input.commit);
          continue;
        }
        
        // Validate nodeId matches
        if (dbParent.nodeId !== input.nodeId) {
          result.errors.push(
            `Version ${input.commit} for node ${input.nodeId}: parent commit ${input.parent} belongs to different node ${dbParent.nodeId}`
          );
          invalidInputs.add(input.commit);
        }
      }
      
      // Remove invalid inputs from processing
      if (invalidInputs.size > 0) {
        const validInputs = newInputs.filter(i => !invalidInputs.has(i.commit));
        newInputs.length = 0;
        newInputs.push(...validInputs);
      }

      // ========== Phase 4: Create node versions ==========
      
      for (const input of newInputs) {
        try {
          // Compute derivativeOf (skip-list pointer for cross-artifact lineage)
          let derivativeOf: string | null = null;
          if (input.parent) {
            // Check if parent is in the same batch
            const batchParent = batchInputMap.get(input.parent);
            if (batchParent) {
              if (batchParent.sourceArtifactId !== input.sourceArtifactId) {
                // Parent comes from a different artifact
                derivativeOf = batchParent.commit;
              }
              // else: same artifact, derivativeOf stays null (will be computed when parent is processed)
            } else {
              // Parent exists in database
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
            metadata: input.metadata ?? null,
          };

          // Collect node version insert (idempotent with onConflictDoNothing)
          this.ctx.modify()
            .insert(nodeVersions)
            .values(newVersion)
            .onConflictDoNothing();

          // Create ACL for node version
          // Node ACL is based on commit hash (the version identifier)
          const nodeRef = { type: 'node' as const, id: input.commit };
          this.aclService.grantOwner(nodeRef, input.authorId);
          
          // Set public access if not private
          if (!input.isPrivate) {
            this.aclService.setPublic(nodeRef, input.authorId);
          }

          // Create discovery control record for the node version
          // Inherits isListed from input (typically from source artifact)
          this.discoveryService.create(nodeRef, input.isListed ?? false);

          // Collect lineage refs insert (idempotent)
          if (input.refs && input.refs.length > 0) {
            const refValues: NewNodeVersionRef[] = input.refs.map(ref => ({
              sourceCommit: input.commit,
              targetCommit: ref.targetCommit,
              refType: ref.refType,
            }));
            this.ctx.modify()
              .insert(nodeVersionRefs)
              .values(refValues)
              .onConflictDoNothing();
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
     
    const { contentHash: _contentHash, createdAt: _createdAt, ...contentFields } = result[0];

    return { type, ...contentFields } as ArtifactNodeContent;
  }

  /**
   * Insert content into the typed content table.
   * Uses ON CONFLICT DO NOTHING for idempotency - content is content-addressed,
   * so if it already exists, it's guaranteed to be identical.
   * 
   * This operation is IDEMPOTENT - calling multiple times with the same
   * contentHash will only insert once; subsequent calls are no-ops.
   * 
   * Note: This collects the operation into BatchContext, not executed immediately.
   * 
   * For SAVE nodes, the content is expected to have additional fields
   * (sourceArtifactCommit) populated by artifact.ts.
   */
  private insertContent(contentHash: string, content: ArtifactNodeContent): void {
    // Using type narrowing via the discriminated union's `type` field
    switch (content.type) {
      case 'INPUT': {
        const blocks = content.blocks;
        this.ctx.modify()
          .insert(inputContents)
          .values({
            contentHash,
            blocks,
            generationConfig: content.generationConfig,
            plainText: extractPlainText(blocks),
            reftagNames: extractReftagNames(blocks),
          })
          .onConflictDoNothing();
        break;
      }

      case 'PROMPT': {
        const blocks = content.blocks;
        this.ctx.modify()
          .insert(promptContents)
          .values({
            contentHash,
            blocks,
            plainText: extractPlainText(blocks),
            reftagNames: extractReftagNames(blocks),
          })
          .onConflictDoNothing();
        break;
      }

      case 'GENERATED':
        this.ctx.modify()
          .insert(generatedContents)
          .values({
            contentHash,
            blocks: content.blocks,
            // GENERATED blocks are MessageBlock[], not ContentBlock[], so no plainText extraction
            plainText: undefined,
          })
          .onConflictDoNothing();
        break;

      case 'VFS':
        this.ctx.modify()
          .insert(vfsContents)
          .values({
            contentHash,
            filesHash: content.filesHash,
            mounts: content.mounts,
            fileCount: content.fileCount,
            totalSize: content.totalSize,
            fileTree: content.fileTree,
          })
          .onConflictDoNothing();
        break;

      case 'SANDBOX':
        this.ctx.modify()
          .insert(sandboxContents)
          .values({
            contentHash,
            entryFile: content.entryFile,
          })
          .onConflictDoNothing();
        break;

      case 'LOADER':
        this.ctx.modify()
          .insert(loaderContents)
          .values({
            contentHash,
          })
          .onConflictDoNothing();
        break;

      case 'STATE':
        this.ctx.modify()
          .insert(stateContents)
          .values({
            contentHash,
            name: content.name,
            description: content.description,
          })
          .onConflictDoNothing();
        break;

      case 'SAVE':
        this.ctx.modify()
          .insert(saveContents)
          .values({
            contentHash,
            stateNodeId: content.stateNodeId,
            artifactId: content.artifactId,
            artifactCommit: content.artifactCommit,
            quadsHash: content.quadsHash,
            saveEncoding: content.saveEncoding,
            parentCommit: content.parentCommit ?? null,
            title: content.title,
            description: content.description,
          })
          .onConflictDoNothing();
        break;
    }
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
        sourceVersion.metadata,
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
        metadata: sourceVersion.metadata,
      };

      this.ctx.modify()
        .insert(nodeVersions)
        .values(newVersion)
        .onConflictDoNothing();

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
        this.ctx.modify()
          .insert(nodeVersionRefs)
          .values(refValues)
          .onConflictDoNothing();
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
