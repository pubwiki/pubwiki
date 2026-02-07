import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type { Database } from '../client';
import { nodeVersions, nodeVersionRefs, type NodeVersion, type NewNodeVersion, type NewNodeVersionRef, type NodeVersionRefType } from '../schema/node-versions';
import { inputContents, promptContents, generatedContents, vfsContents, sandboxContents, loaderContents, stateContents, saveContents } from '../schema/node-contents';
import type { NodeType, VisibilityType } from '../schema/enums';
import type { ServiceError, ServiceResult } from './user';
import type { ArtifactNodeContent } from '@pubwiki/api';
import { computeNodeCommit } from '@pubwiki/api';

// ========================================================================
// Public types
// ========================================================================

/** Summary of a node version (without full content) */
export interface NodeVersionSummary {
  nodeId: string;
  commit: string;
  parent: string | null;
  authorId: string;
  authoredAt: string;
  type: NodeType;
  name: string | null;
  contentHash: string;
  message: string | null;
  tag: string | null;
  visibility: VisibilityType;
  sourceArtifactId: string;
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
  content: unknown;          // The actual content to store in the typed content table
  message?: string;
  tag?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
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

export class NodeVersionService {
  constructor(private db: Database) {}

  // ──────────────────────────────────────────
  // Query operations
  // ──────────────────────────────────────────

  /** Get all versions for a node (ordered by authored_at desc) */
  async getVersions(nodeId: string): Promise<ServiceResult<NodeVersionSummary[]>> {
    try {
      const versions = await this.db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.nodeId, nodeId))
        .orderBy(desc(nodeVersions.authoredAt));

      return {
        success: true,
        data: versions.map(this.toSummary),
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
      const versionResult = await this.db
        .select()
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
      const versionResult = await this.db
        .select()
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
      const children = await this.db
        .select()
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
      const refs = await this.db
        .select({
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
   * For each version:
   * 1. Check if it already exists (skip if so)
   * 2. Validate parent exists (if specified)
   * 3. Validate visibility inheritance
   * 4. Upsert content to typed content table (ref_count managed)
   * 5. Insert node_versions record
   * 6. Insert lineage refs (if any)
   */
  async syncVersions(inputs: SyncNodeVersionInput[]): Promise<ServiceResult<SyncResult>> {
    const result: SyncResult = { created: 0, skipped: 0, errors: [] };

    try {
      for (const input of inputs) {
        try {
          // Check if already exists (commit is globally unique)
          const existing = await this.db
            .select({ commit: nodeVersions.commit })
            .from(nodeVersions)
            .where(eq(nodeVersions.commit, input.commit))
            .limit(1);

          if (existing.length > 0) {
            result.skipped++;
            continue;
          }

          // Validate client-computed commit hash
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

          // Validate visibility inheritance
          if (input.parent && input.visibility) {
            const parentVersion = await this.db
              .select({ visibility: nodeVersions.visibility })
              .from(nodeVersions)
              .where(eq(nodeVersions.commit, input.parent))
              .limit(1);

            if (parentVersion.length > 0) {
              const valid = this.validateVisibility(input.visibility, parentVersion[0].visibility);
              if (!valid) {
                result.errors.push(
                  `Version ${input.commit}: visibility ${input.visibility} exceeds parent visibility ${parentVersion[0].visibility}`
                );
                continue;
              }
            }
          }

          // Upsert content to typed content table
          await this.upsertContent(input.type, input.contentHash, input.content);

          // Compute derivativeOf (skip-list pointer for cross-artifact lineage)
          let derivativeOf: string | null = null;
          if (input.parent) {
            const parentVersion = await this.db
              .select({
                sourceArtifactId: nodeVersions.sourceArtifactId,
                derivativeOf: nodeVersions.derivativeOf,
                commit: nodeVersions.commit,
              })
              .from(nodeVersions)
              .where(eq(nodeVersions.commit, input.parent))
              .limit(1);

            if (parentVersion.length > 0) {
              const parent = parentVersion[0];
              if (parent.sourceArtifactId !== input.sourceArtifactId) {
                // Parent comes from a different artifact
                derivativeOf = parent.commit;
              } else {
                // Inherit parent's skip-list pointer
                derivativeOf = parent.derivativeOf;
              }
            }
          }

          // Insert node version
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
            visibility: input.visibility ?? 'PRIVATE',
          };

          await this.db.insert(nodeVersions).values(newVersion);

          // Insert lineage refs
          if (input.refs && input.refs.length > 0) {
            const refValues: NewNodeVersionRef[] = input.refs.map(ref => ({
              sourceCommit: input.commit,
              targetCommit: ref.targetCommit,
              refType: ref.refType,
            }));

            await this.db.insert(nodeVersionRefs).values(refValues);
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
    const result = await this.db
      .select({ commit: nodeVersions.commit })
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
    const existingSet = new Set<string>();

    // Process in batches to avoid SQL parameter limits
    const batchSize = 50;
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize);

      for (const commit of batch) {
        const exists = await this.versionExists(commit);
        if (exists) {
          existingSet.add(commit);
        }
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
      visibility: v.visibility as VisibilityType,
      sourceArtifactId: v.sourceArtifactId,
      derivativeOf: v.derivativeOf,
    };
  }

  /** Get content from the typed content table, injecting the `type` discriminator */
  private async getContent(type: NodeType, contentHash: string): Promise<ArtifactNodeContent | undefined> {
    const table = getContentTable(type);
    const result = await this.db
      .select()
      .from(table)
      .where(eq(table.contentHash, contentHash))
      .limit(1);

    if (result.length === 0) return undefined;

    // DB content 表不含 type 判别字段（type 存储在 node_versions 上），
    // 但 API 的 ArtifactNodeContent 是以 type 为 discriminator 的联合类型，
    // 需要在此注入 type 使结构匹配。
    const { contentHash: _hash, refCount: _rc, createdAt: _ca, ...contentFields } = result[0];
    return { type, ...contentFields } as ArtifactNodeContent;
  }

  /**
   * Upsert content into the typed content table.
   * If content_hash already exists, increment ref_count.
   * Otherwise insert new row.
   */
  private async upsertContent(type: NodeType, contentHash: string, content: unknown): Promise<void> {
    const table = getContentTable(type);
    const data = content as Record<string, unknown>;

    // Check if already exists
    const existing = await this.db
      .select({ contentHash: table.contentHash })
      .from(table)
      .where(eq(table.contentHash, contentHash))
      .limit(1);

    if (existing.length > 0) {
      // Increment ref_count
      await this.db
        .update(table)
        .set({ refCount: sql`${table.refCount} + 1` })
        .where(eq(table.contentHash, contentHash));
      return;
    }

    // Insert new content based on type
    switch (type) {
      case 'INPUT':
        await this.db.insert(inputContents).values({
          contentHash,
          blocks: data.blocks as unknown[],
          generationConfig: data.generationConfig as Record<string, unknown> | undefined,
          plainText: data.plainText as string | undefined,
          reftagNames: data.reftagNames as string[] | undefined,
        });
        break;

      case 'PROMPT':
        await this.db.insert(promptContents).values({
          contentHash,
          blocks: data.blocks as unknown[],
          plainText: data.plainText as string | undefined,
          reftagNames: data.reftagNames as string[] | undefined,
        });
        break;

      case 'GENERATED':
        await this.db.insert(generatedContents).values({
          contentHash,
          blocks: data.blocks as unknown[],
          plainText: data.plainText as string | undefined,
        });
        break;

      case 'VFS':
        await this.db.insert(vfsContents).values({
          contentHash,
          projectId: data.projectId as string,
          mounts: data.mounts as unknown[] | undefined,
          fileCount: data.fileCount as number | undefined,
          totalSize: data.totalSize as number | undefined,
          fileTree: data.fileTree as Array<{ path: string; size: number; mimeType?: string }> | undefined,
        });
        break;

      case 'SANDBOX':
        await this.db.insert(sandboxContents).values({
          contentHash,
          entryFile: data.entryFile as string | undefined,
        });
        break;

      case 'LOADER':
        await this.db.insert(loaderContents).values({
          contentHash,
        });
        break;

      case 'STATE':
        await this.db.insert(stateContents).values({
          contentHash,
          saves: data.saves as string[] | undefined,
        });
        break;

      case 'SAVE':
        await this.db.insert(saveContents).values({
          contentHash,
          stateNodeId: data.stateNodeId as string,
          stateNodeCommit: data.stateNodeCommit as string,
          sourceArtifactCommit: data.sourceArtifactCommit as string,
          title: data.title as string | undefined,
          description: data.description as string | undefined,
        });
        break;
    }
  }

  /** Validate visibility inheritance: child visibility ≤ parent visibility */
  private validateVisibility(childVis: string, parentVis: string): boolean {
    const levels: Record<string, number> = {
      'PRIVATE': 0,
      'UNLISTED': 1,
      'PUBLIC': 2,
    };

    const childLevel = levels[childVis] ?? 0;
    const parentLevel = levels[parentVis] ?? 0;

    return childLevel <= parentLevel;
  }

  /**
   * Decrement the refCount of a content row. If refCount reaches 0, delete the row.
   * Returns { decremented: boolean, deleted: boolean }.
   */
  async decrementContentRefCount(type: NodeType, contentHash: string): Promise<{ decremented: boolean; deleted: boolean }> {
    const table = getContentTable(type);

    // Check current refCount
    const [existing] = await this.db
      .select({ refCount: table.refCount })
      .from(table)
      .where(eq(table.contentHash, contentHash))
      .limit(1);

    if (!existing) {
      return { decremented: false, deleted: false };
    }

    const newRefCount = existing.refCount - 1;

    if (newRefCount <= 0) {
      // Delete the content row
      await this.db.delete(table).where(eq(table.contentHash, contentHash));
      return { decremented: true, deleted: true };
    } else {
      // Decrement ref_count
      await this.db
        .update(table)
        .set({ refCount: sql`${table.refCount} - 1` })
        .where(eq(table.contentHash, contentHash));
      return { decremented: true, deleted: false };
    }
  }

}
