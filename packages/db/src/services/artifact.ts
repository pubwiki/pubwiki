import { eq, and, inArray, asc, desc, sql, count, isNotNull } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { artifacts, tags, artifactTags, artifactVersions, artifactCommitTags, type Artifact, type ArtifactVersion as DbArtifactVersion, type NewArtifact, type NewArtifactVersion } from '../schema/artifacts';
import { TagService, type TagInfo } from './tag';
import { artifactVersionNodes, artifactVersionEdges, type NewArtifactVersionNode, type NewArtifactVersionEdge } from '../schema/artifact-version-graph';
import { nodeVersions } from '../schema/node-versions';
import type { NodeType } from '../schema/enums';
import { NodeVersionService, type SyncNodeVersionInput } from './node-version';
import { artifactStats, artifactFavs, artifactViews } from '../schema/stats';
import { projectArtifacts } from '../schema/projects';
import { user } from '../schema/auth';
import { articles } from '../schema/articles';
import type { ServiceResult } from './user';
import { NodeGraph } from '../utils/node-graph';
import type {
  ArtifactListItem,
  Pagination,
  ArtifactVersion,
  CreateArtifactMetadata,
  ArtifactEdgeDescriptor,
  ArtifactNodeContent,
  ArtifactLineageItem,
  CreateArtifactNode,
  ListArtifactsQuery,
  GetUserArtifactsQuery,
  PatchArtifactRequest,
  ListArtifactsResponse,
  GetArtifactGraphResponse,
  ArtifactNodeSummary,
  ArtifactEdge,
  UpdateArtifactMetadataRequest,
  UpdateArtifactMetadataResponse,
  UpdateVersionMetadataRequest,
  operations,
} from '@pubwiki/api';
import { computeArtifactCommit } from '@pubwiki/api';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { AclService, DiscoveryService } from './access-control';

// 重新导出供其他模块使用
export type { ArtifactListItem, Pagination, ArtifactLineageItem, CreateArtifactNode };

// 列表查询参数（排除 undefined）
export type ListArtifactsParams = NonNullable<ListArtifactsQuery>;

// 列表响应（直接使用 API 类型）
export type ListArtifactsResult = ListArtifactsResponse;

// 创建 artifact 的输入参数
export interface CreateArtifactInput {
  authorId: string;
  metadata: CreateArtifactMetadata;
  nodes: CreateArtifactNode[];
  edges: ArtifactEdgeDescriptor[];
}

// 创建 artifact 的返回结果
export interface CreateArtifactResult {
  artifact: ArtifactListItem;
}

// PATCH artifact 的返回结果（仅用于 graph 变更）
export interface PatchArtifactResult extends CreateArtifactResult {
  /** Always true since PATCH always creates a new version */
  versionCreated: true;
}

// Update artifact metadata input
export interface UpdateArtifactMetadataInput {
  artifactId: string;
  authorId: string;
  data: UpdateArtifactMetadataRequest;
}

// Update version metadata input
export interface UpdateVersionMetadataInput {
  artifactId: string;
  authorId: string;
  commitHash: string;
  data: UpdateVersionMetadataRequest;
}

// Delete artifact parameters
export interface DeleteArtifactParams {
  artifactId: operations['deleteArtifact']['parameters']['path']['artifactId'];
  userId: string; // from auth context
}

export class ArtifactService {
  private readonly aclService: AclService;
  private readonly discoveryService: DiscoveryService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
    this.discoveryService = new DiscoveryService(ctx);
  }

  /**
   * 计算 artifact version 的确定性 commit hash（链状结构）。
   * 委托给 @pubwiki/api 的 computeArtifactCommit 共享实现。
   * 客户端必须使用相同算法计算 commit，服务端校验一致性。
   */
  static async computeCommitHash(
    artifactId: string,
    parentCommit: string | null,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
  ): Promise<string> {
    return computeArtifactCommit(
      artifactId,
      parentCommit,
      nodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })),
      edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    );
  }

  // ============================================================================
  // createArtifact - Main Entry Point (Pure Insert Semantics)
  // ============================================================================

  /**
   * Create a new artifact (pure insert semantics).
   * 
   * This operation is IDEMPOTENT via optimistic locking:
   * - Uses ON CONFLICT DO NOTHING for all inserts
   * - Detects conflicts via meta.changes check at commit time
   * - If artifactId already exists, returns 409 Conflict
   * 
   * For updating existing artifacts:
   * - Use patchArtifact() for graph changes
   * - Use updateArtifactMetadata() for metadata changes
   */
  async createArtifact(input: CreateArtifactInput): Promise<ServiceResult<CreateArtifactResult>> {
    const { authorId, metadata, nodes, edges } = input;
    const artifactId = metadata.artifactId;

    try {
      // Step 1: Verify commit hash (for new artifacts, parentCommit is always null)
      const parentCommit: string | null = null;
      const expectedCommit = await ArtifactService.computeCommitHash(artifactId, parentCommit, nodes, edges);
      if (metadata.commit !== expectedCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Commit hash mismatch: expected ${expectedCommit}, got ${metadata.commit}. Client must compute commit using (artifactId + parentCommit + nodes + edges).`,
          },
        };
      }

      // Step 2: Get author info
      const authorResult = await this.ctx
        .select({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        })
        .from(user)
        .where(eq(user.id, authorId))
        .limit(1);

      if (authorResult.length === 0) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Author not found' } };
      }
      const author = authorResult[0];
      const versionId = crypto.randomUUID();

      // Step 3: Build and validate graph structure using NodeGraph abstraction
      const graph = NodeGraph.fromArrays(nodes, edges);
      const validationResult = graph.validate(metadata.entrypoint);
      if (!validationResult.success) return validationResult;

      // Determine privacy: default to false (public)
      const isPrivate = metadata.isPrivate ?? false;

      // Step 4: Sync nodes (nodes must exist before version references them)
      // Pass isPrivate to ensure node ACLs match artifact's privacy setting
      const nodeResult = await this.syncNodes(artifactId, authorId, nodes, isPrivate);
      if (!nodeResult.success) return nodeResult;

      // Step 5: Create artifact record (uses optimistic lock to detect conflicts)
      this.createArtifactRecord(artifactId, authorId, metadata, versionId);

      // Step 6: Create version record (artifact must exist first due to FK)
      this.createVersionRecord(artifactId, versionId, metadata);

      // Step 7: Store graph structure (version must exist, nodes already synced)
      this.storeGraphStructure(metadata.commit, nodes, edges);

      // Step 8: Process commit tags (version must exist)
      await this.processCommitTags(artifactId, metadata.commit, metadata.commitTags ?? []);

      // Step 9: Process tags
      let processedTags: TagInfo[] = [];
      const tagSlugs = metadata.tags ?? [];
      if (tagSlugs.length > 0) {
        const tagService = new TagService(this.ctx);
        const existingTagsMap = await tagService.fetchTagsBySlug(tagSlugs);
        const result = await tagService.setTags(artifactId, tagSlugs, existingTagsMap);
        processedTags = result.processedTags;
      }

      // Step 10: Create stats record
      this.createStatsRecord(artifactId);

      // Step 11: Build and return response
      const artifact = await this.buildArtifactResponse(
        artifactId, metadata, author, processedTags
      );

      return { success: true, data: { artifact } };
    } catch (error) {
      console.error('Create artifact error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  // ============================================================================
  // createArtifact - Private Helper Methods
  // ============================================================================

  /**
   * Create new artifact record.
   * Uses AclService and DiscoveryService for proper abstraction.
   * 
   * Uses ON CONFLICT DO NOTHING with optimistic lock to detect conflicts.
   * If artifact already exists, the optimistic lock will fail at commit time.
   */
  private createArtifactRecord(
    artifactId: string,
    authorId: string,
    metadata: CreateArtifactMetadata,
    versionId: string,
  ): void {
    const newArtifact: NewArtifact = {
      id: artifactId,
      authorId,
      name: metadata.name,
      description: metadata.description ?? null,
      latestVersion: versionId,
      thumbnailUrl: metadata.thumbnailUrl ?? null,
      license: metadata.license ?? null,
    };
    this.ctx.modify({ expectAffected: 1, lockMsg: `Artifact ${artifactId} already exists` })
      .insert(artifacts).values(newArtifact).onConflictDoNothing();

    // Create discovery control record using DiscoveryService
    const isListed = metadata.isListed ?? true;
    const artifactRef = { type: 'artifact' as const, id: artifactId };
    this.discoveryService.create(artifactRef, isListed);

    // Create owner ACL (manage + write + read) using AclService
    this.aclService.grantOwner(artifactRef, authorId);

    // Create public read ACL if not private
    // isPrivate: true means only owner and authorized users can access
    // isPrivate: false (default) means everyone can read
    const isPrivate = metadata.isPrivate ?? false;
    if (!isPrivate) {
      this.aclService.setPublic(artifactRef, authorId);
    }
  }

  /**
   * Step 3: Create version record
   * 
   * Uses ON CONFLICT DO NOTHING with optimistic lock to detect conflicts.
   * If version with same commitHash already exists, the optimistic lock will fail at commit time.
   */
  private createVersionRecord(
    artifactId: string,
    versionId: string,
    metadata: CreateArtifactMetadata,
  ): void {
    const newVersion: NewArtifactVersion = {
      id: versionId,
      artifactId,
      version: metadata.version ?? null,
      commitHash: metadata.commit,
      changelog: metadata.changelog ?? null,
      publishedAt: new Date().toISOString(),
      entrypoint: metadata.entrypoint ?? null,
    };
    this.ctx.modify({ expectAffected: 1, lockMsg: `Version with commit ${metadata.commit} already exists` })
      .insert(artifactVersions).values(newVersion).onConflictDoNothing();
  }

  /**
   * Step 4: Process commit tags (clear old tags with same name, create new associations)
   */
  private async processCommitTags(
    artifactId: string,
    commitHash: string,
    commitTags: string[],
  ): Promise<void> {
    if (commitTags.length === 0) return;

    // Find and delete existing tags with same names
    const existingCommitTags = await this.ctx.select({ id: artifactCommitTags.id })
      .from(artifactCommitTags)
      .where(and(
        eq(artifactCommitTags.artifactId, artifactId),
        inArray(artifactCommitTags.tag, commitTags)
      ));

    for (const ct of existingCommitTags) {
      this.ctx.modify().delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id));
    }

    // Create new commit tag associations
    for (const tag of commitTags) {
      this.ctx.modify().insert(artifactCommitTags).values({ artifactId, commitHash, tag });
    }
  }

  /**
   * Sync all nodes to node_versions table.
   * Validation is now handled by NodeGraph abstraction before this method is called.
   * 
   * @param isPrivate - Whether the artifact (and its nodes) should be private
   */
  private async syncNodes(
    artifactId: string,
    authorId: string,
    nodes: CreateArtifactNode[],
    isPrivate: boolean,
  ): Promise<ServiceResult<void>> {
    const nodeVersionService = new NodeVersionService(this.ctx);

    // Sync all nodes together
    // SAVE nodes now have all required fields in their content (stateNodeCommit, artifactId, artifactCommit)
    const syncInputs: SyncNodeVersionInput[] = nodes.map(n => ({
      nodeId: n.nodeId,
      commit: n.commit,
      parent: n.parent ?? null,
      authorId,
      type: n.type,
      name: n.name,
      contentHash: n.contentHash,
      content: n.content,
      message: n.message,
      tag: n.tag,
      isListed: n.isListed,
      isPrivate,  // Pass artifact's privacy setting to node versions
      sourceArtifactId: artifactId,
      refs: n.refs as SyncNodeVersionInput['refs'],
    }));

    const syncResult = await nodeVersionService.syncVersions(syncInputs);
    if (!syncResult.success) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Failed to sync node versions: ${syncResult.error.message}` },
      };
    }

    if (syncResult.data.errors.length > 0) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: `Node sync errors: ${syncResult.data.errors.join('; ')}` },
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Update permission for original nodes in an artifact version.
   * Only affects nodes where sourceArtifactId matches the given artifactId.
   * 
   * Uses one-way relaxation: only private->public is allowed without forking.
   * 
   * @param artifactId - The artifact ID to match sourceArtifactId
   * @param commitHash - The artifact version commit hash
   * @param isPrivate - Target privacy state (only false is meaningful here)
   * @param authorId - Author ID for ACL operations
   */
  private async updateOriginalNodesPermission(
    artifactId: string,
    commitHash: string,
    isPrivate: boolean,
    authorId: string,
  ): Promise<void> {
    const nodeVersionService = new NodeVersionService(this.ctx);

    // Get only the original node versions (sourceArtifactId matches) in this artifact version
    const originalNodeCommits = await nodeVersionService.nodesCreatedBy(artifactId, commitHash);

    // Update permission for each original node
    for (const commit of originalNodeCommits) {
      await nodeVersionService.updatePermission(
        commit,
        isPrivate,
        authorId,
        artifactId,
      );
    }
  }

  /**
   * Cascade discovery (isListed) change to all node versions from this artifact.
   * This ensures that when an artifact's isListed status changes, all its
   * original node versions are updated accordingly.
   * 
   * @param artifactId - The artifact ID to match sourceArtifactId
   * @param isListed - The new isListed state
   */
  private async cascadeDiscoveryToNodes(
    artifactId: string,
    isListed: boolean,
  ): Promise<void> {
    const nodeVersionService = new NodeVersionService(this.ctx);
    const commits = await nodeVersionService.nodesCreatedBy(artifactId);

    // Update discovery control for each node
    for (const commit of commits) {
      const nodeRef = { type: 'node' as const, id: commit };
      this.discoveryService.setListed(nodeRef, isListed);
    }
  }

  /**
   * Step 7: Store graph structure (nodes and edges)
   */
  private storeGraphStructure(
    commitHash: string,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
  ): void {
    // Store nodes
    for (const node of nodes) {
      const versionNode: NewArtifactVersionNode = {
        commitHash,
        nodeId: node.nodeId,
        nodeCommit: node.commit,
        positionX: node.position?.x ?? null,
        positionY: node.position?.y ?? null,
      };
      this.ctx.modify().insert(artifactVersionNodes).values(versionNode).onConflictDoNothing();
    }

    // Store edges
    for (const edge of edges) {
      const versionEdge: NewArtifactVersionEdge = {
        commitHash,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      };
      this.ctx.modify().insert(artifactVersionEdges).values(versionEdge).onConflictDoNothing();
    }
  }

  /**
   * Step 9: Create stats record (only for new artifacts)
   */
  private createStatsRecord(artifactId: string): void {
    this.ctx.modify().insert(artifactStats).values({
      artifactId,
      viewCount: 0,
      favCount: 0,
      refCount: 0,
      downloadCount: 0,
    }).onConflictDoNothing();
  }

  /**
   * Step 10: Build artifact response with stats and timestamps
   */
  private async buildArtifactResponse(
    artifactId: string,
    metadata: CreateArtifactMetadata,
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null },
    processedTags: TagInfo[],
  ): Promise<ArtifactListItem> {
    const existingStats = { viewCount: 0, favCount: 0, refCount: 0, downloadCount: 0 };
    const existingCreatedAt = new Date().toISOString();

    return {
      id: artifactId,
      name: metadata.name,
      description: metadata.description ?? null,
      isListed: metadata.isListed ?? true,
      thumbnailUrl: metadata.thumbnailUrl ?? null,
      license: metadata.license ?? null,
      createdAt: existingCreatedAt,
      updatedAt: new Date().toISOString(),
      author,
      tags: processedTags,
      stats: existingStats,
    };
  }

  // ============================================================================
  // Other Public Methods
  // ============================================================================

  // 创建或更新 artifact（使用 batch 保证原子性）
  async listPublicArtifacts(params: ListArtifactsParams = {}): Promise<ServiceResult<ListArtifactsResult>> {
    const {
      page = 1,
      limit = 20,
      'tag.include': tagInclude,
      'tag.exclude': tagExclude,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params ?? {};

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建基础条件：只查询 listed 的 artifacts
      const baseConditions = [
        eq(resourceDiscoveryControl.isListed, true),
      ];

      // 标签过滤 - 使用 EXISTS/NOT EXISTS 子查询，避免先查出所有 ID 再用 IN
      // 这样数据库优化器可以利用索引，而不是在内存中处理大量 ID 列表

      if (tagInclude && tagInclude.length > 0) {
        // tagInclude: AND 逻辑 - artifact 必须包含所有指定的标签
        // 使用相关子查询：检查匹配到的不同标签数量是否等于要求的数量
        baseConditions.push(
          sql`(
            SELECT count(DISTINCT ${tags.slug})
            FROM ${artifactTags}
            INNER JOIN ${tags} ON ${artifactTags.tagSlug} = ${tags.slug}
            WHERE ${artifactTags.artifactId} = ${artifacts.id}
              AND ${tags.slug} IN (${sql.join(tagInclude.map(t => sql`${t}`), sql`, `)})
          ) = ${tagInclude.length}`
        );
      }

      if (tagExclude && tagExclude.length > 0) {
        // tagExclude: OR 逻辑 - artifact 不能包含任意排除的标签
        // 使用 NOT EXISTS 子查询
        baseConditions.push(
          sql`NOT EXISTS (
            SELECT 1
            FROM ${artifactTags}
            INNER JOIN ${tags} ON ${artifactTags.tagSlug} = ${tags.slug}
            WHERE ${artifactTags.artifactId} = ${artifacts.id}
              AND ${tags.slug} IN (${sql.join(tagExclude.map(t => sql`${t}`), sql`, `)})
          )`
        );
      }

      // 计算总数
      const [countResult] = await this.ctx
        .select({ total: count() })
        .from(artifacts)
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifacts.id)
          )
        )
        .where(and(...baseConditions));

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序 - 使用映射表避免硬编码
      const sortColumnMap = {
        createdAt: artifacts.createdAt,
        updatedAt: artifacts.updatedAt,
        viewCount: artifactStats.viewCount,
        favCount: artifactStats.favCount,
      } as const;
      const sortColumn = sortColumnMap[sortBy as keyof typeof sortColumnMap];
      const orderClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      // 查询 artifacts（带 author、stats 和 discovery control）
      const artifactsQuery = this.ctx.select({
          artifact: artifacts,
          discoveryControl: resourceDiscoveryControl,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
          stats: artifactStats,
        })
        .from(artifacts)
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifacts.id)
          )
        )
        .leftJoin(artifactStats, eq(artifacts.id, artifactStats.artifactId))
        .where(and(...baseConditions))
        .orderBy(orderClause)
        .limit(validLimit)
        .offset(offset);

      const artifactResults = await artifactsQuery;

      // 获取所有 artifact 的 tags
      const artifactIds = artifactResults.map(r => r.artifact.id);
      const tagsMap = new Map<string, ArtifactListItem['tags']>();

      if (artifactIds.length > 0) {
        const tagResults = await this.ctx
          .select({
            artifactId: artifactTags.artifactId,
            tag: {
              slug: tags.slug,
              name: tags.name,
              description: tags.description,
              color: tags.color,
            },
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          const existing = tagsMap.get(row.artifactId) || [];
          existing.push(row.tag);
          tagsMap.set(row.artifactId, existing);
        }
      }

      // 组装结果
      const resultArtifacts: ArtifactListItem[] = artifactResults.map(r => ({
        id: r.artifact.id,
        name: r.artifact.name,
        description: r.artifact.description,
        isListed: r.discoveryControl.isListed,
        thumbnailUrl: r.artifact.thumbnailUrl,
        license: r.artifact.license,
        createdAt: r.artifact.createdAt,
        updatedAt: r.artifact.updatedAt,
        author: r.author,
        tags: tagsMap.get(r.artifact.id) || [],
        stats: r.stats ? {
          viewCount: r.stats.viewCount,
          favCount: r.stats.favCount,
          refCount: r.stats.refCount,
          downloadCount: r.stats.downloadCount,
        } : undefined,
      }));

      return {
        success: true,
        data: {
          artifacts: resultArtifacts,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('List artifacts error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 获取 artifact（包含权限检查信息）
  async getArtifactById(artifactId: string): Promise<ServiceResult<{
    artifact: Artifact;
    author: { id: string; username: string };
  }>> {
    try {
      const result = await this.ctx
        .select({
          artifact: artifacts,
          author: {
            id: user.id,
            username: user.username,
          },
        })
        .from(artifacts)
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (result.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        };
      }

      return {
        success: true,
        data: result[0],
      };
    } catch (error) {
      console.error('Get artifact error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 获取 artifact 的谱系信息（基于 derivativeOf 跳表遍历）
  async getArtifactLineage(
    artifactId: string,
    params: GetLineageParams = {}
  ): Promise<ServiceResult<{
    parents: ArtifactLineageItem[];
    children: ArtifactLineageItem[];
  }>> {
    const { commit, parentDepth = 1, childDepth = 1 } = params;

    try {
      // 检查 artifact 是否存在，同时获取 latestVersion
      const [artifactRecord] = await this.ctx
        .select({ id: artifacts.id, latestVersion: artifacts.latestVersion })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!artifactRecord) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        };
      }

      // 确定要查询的版本 commit hash
      let versionCommitHash: string | null = null;
      if (commit) {
        // 验证 commit hash 存在
        const [matchedVersion] = await this.ctx
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(and(
            eq(artifactVersions.artifactId, artifactId),
            eq(artifactVersions.commitHash, commit)
          ))
          .limit(1);
        if (!matchedVersion) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: `Version with commit ${commit} not found` },
          };
        }
        versionCommitHash = matchedVersion.commitHash;
      } else if (artifactRecord.latestVersion) {
        const [currentVersion] = await this.ctx
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(eq(artifactVersions.id, artifactRecord.latestVersion))
          .limit(1);
        versionCommitHash = currentVersion?.commitHash ?? null;
      }

      if (!versionCommitHash) {
        return { success: true, data: { parents: [], children: [] } };
      }

      // 获取父 artifacts
      const parents = await this.getLineageParents(
        artifactId,
        versionCommitHash,
        parentDepth,
        new Set<string>()
      );

      // 获取子 artifacts
      const children = await this.getLineageChildren(
        artifactId,
        versionCommitHash,
        childDepth,
        new Set<string>()
      );

      return {
        success: true,
        data: { parents, children },
      };
    } catch (error) {
      console.error('Get artifact lineage error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 沿 derivativeOf 跳表获取父 artifacts
  private async getLineageParents(
    artifactId: string,
    versionCommitHash: string,
    maxDepth: number,
    visited: Set<string>
  ): Promise<ArtifactLineageItem[]> {
    if (maxDepth <= 0 || visited.has(artifactId)) return [];
    visited.add(artifactId);

    // 查询当前 artifact 版本中所有节点的 derivativeOf，找到指向的 sourceArtifactId
    // 重写：通过 join 获取 derivativeOf 目标版本的 sourceArtifactId
    const parentArtifactRows = await this.ctx
      .selectDistinct({ sourceArtifactId: sql<string>`nv_parent.source_artifact_id` })
      .from(artifactVersionNodes)
      .innerJoin(
        nodeVersions,
        eq(nodeVersions.commit, artifactVersionNodes.nodeCommit)
      )
      .innerJoin(
        sql`node_versions as nv_parent`,
        sql`nv_parent.commit = ${nodeVersions.derivativeOf}`
      )
      .where(
        and(
          eq(artifactVersionNodes.commitHash, versionCommitHash),
          isNotNull(nodeVersions.derivativeOf),
          sql`nv_parent.source_artifact_id != ${artifactId}`
        )
      );

    const parentArtifactIds = parentArtifactRows.map((r: { sourceArtifactId: string }) => r.sourceArtifactId);
    if (parentArtifactIds.length === 0) return [];

    // 获取 artifact 详细信息
    const results = await this.fetchArtifactLineageDetails(parentArtifactIds);

    // 递归获取更深层的父代（使用 latestVersion 解析 commitHash）
    if (maxDepth > 1) {
      for (const parentId of parentArtifactIds) {
        if (visited.has(parentId)) continue;
        const [parentArtifact] = await this.ctx
          .select({ latestVersion: artifacts.latestVersion })
          .from(artifacts)
          .where(eq(artifacts.id, parentId))
          .limit(1);
        if (parentArtifact?.latestVersion) {
          const [parentVersion] = await this.ctx
            .select({ commitHash: artifactVersions.commitHash })
            .from(artifactVersions)
            .where(eq(artifactVersions.id, parentArtifact.latestVersion))
            .limit(1);
          if (parentVersion) {
            const ancestors = await this.getLineageParents(parentId, parentVersion.commitHash, maxDepth - 1, visited);
            results.push(...ancestors);
          }
        }
      }
    }

    return results;
  }

  // 查找子 artifacts（其他 artifact 的节点 derivativeOf 指向当前 artifact 的节点）
  private async getLineageChildren(
    artifactId: string,
    versionCommitHash: string,
    maxDepth: number,
    visited: Set<string>
  ): Promise<ArtifactLineageItem[]> {
    if (maxDepth <= 0 || visited.has(artifactId)) return [];
    visited.add(artifactId);

    // 找到当前 artifact 版本中的所有节点 commit
    // 然后找到 derivativeOf 指向这些 commit 的其他节点版本，它们的 sourceArtifactId 就是子 artifact
    const childArtifactRows = await this.ctx
      .selectDistinct({ sourceArtifactId: sql<string>`nv_child.source_artifact_id` })
      .from(artifactVersionNodes)
      .innerJoin(
        sql`node_versions as nv_child`,
        sql`nv_child.derivative_of = ${artifactVersionNodes.nodeCommit}`
      )
      .where(
        and(
          eq(artifactVersionNodes.commitHash, versionCommitHash),
          sql`nv_child.source_artifact_id != ${artifactId}`
        )
      );

    const childArtifactIds = childArtifactRows.map(r => r.sourceArtifactId);
    if (childArtifactIds.length === 0) return [];

    const results = await this.fetchArtifactLineageDetails(childArtifactIds);

    // 递归获取更深层的子代（使用 latestVersion 解析 commitHash）
    if (maxDepth > 1) {
      for (const childId of childArtifactIds) {
        if (visited.has(childId)) continue;
        const [childArtifact] = await this.ctx
          .select({ latestVersion: artifacts.latestVersion })
          .from(artifacts)
          .where(eq(artifacts.id, childId))
          .limit(1);
        if (childArtifact?.latestVersion) {
          const [childVersion] = await this.ctx
            .select({ commitHash: artifactVersions.commitHash })
            .from(artifactVersions)
            .where(eq(artifactVersions.id, childArtifact.latestVersion))
            .limit(1);
          if (childVersion) {
            const descendants = await this.getLineageChildren(childId, childVersion.commitHash, maxDepth - 1, visited);
            results.push(...descendants);
          }
        }
      }
    }

    return results;
  }

  // 批量获取 artifact 详情（用于谱系展示）
  private async fetchArtifactLineageDetails(artifactIds: string[]): Promise<ArtifactLineageItem[]> {
    if (artifactIds.length === 0) return [];

    const rows = await this.ctx
      .select({
        id: artifacts.id,
        name: artifacts.name,
        isListed: resourceDiscoveryControl.isListed,
        thumbnailUrl: artifacts.thumbnailUrl,
        authorId: user.id,
        authorUsername: user.username,
        authorDisplayName: user.displayName,
        authorAvatarUrl: user.avatarUrl,
      })
      .from(artifacts)
      .innerJoin(user, eq(artifacts.authorId, user.id))
      .leftJoin(
        resourceDiscoveryControl,
        and(
          eq(resourceDiscoveryControl.resourceType, 'artifact'),
          eq(resourceDiscoveryControl.resourceId, artifacts.id)
        )
      )
      .where(inArray(artifacts.id, artifactIds));

    return rows.map(r => ({
      artifactId: r.id,
      name: r.name,
      isListed: r.isListed ?? false,
      thumbnailUrl: r.thumbnailUrl,
      author: {
        id: r.authorId,
        username: r.authorUsername,
        displayName: r.authorDisplayName,
        avatarUrl: r.authorAvatarUrl,
      },
    }));
  }

  // ============================================================================
  // updateArtifactMetadata - Metadata-only updates (no graph changes)
  // ============================================================================

  /**
   * Update artifact metadata without creating a new version (unless privacy changes).
   * 
   * Privacy change behavior:
   * - private → public: Direct ACL update (one-way relaxation rule)
   * - public → private: Fork all nodes as private, create new version with auto-generated changelog
   *                     Also cascades privacy to all related articles
   */
  async updateArtifactMetadata(
    input: UpdateArtifactMetadataInput
  ): Promise<ServiceResult<UpdateArtifactMetadataResponse>> {
    const { artifactId, authorId, data } = input;

    try {
      // Step 1: Verify artifact exists and user has permission
      const [existingArtifact] = await this.ctx
        .select({
          id: artifacts.id,
          authorId: artifacts.authorId,
          latestVersion: artifacts.latestVersion,
          name: artifacts.name,
        })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!existingArtifact) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }

      if (existingArtifact.authorId !== authorId) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' } };
      }

      // Step 2: Prepare update fields
      const updateFields: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (data.name !== undefined) {
        updateFields.name = data.name;
      }
      if (data.description !== undefined) {
        updateFields.description = data.description;
      }
      if (data.thumbnailUrl !== undefined) {
        updateFields.thumbnailUrl = data.thumbnailUrl;
      }
      if (data.license !== undefined) {
        updateFields.license = data.license;
      }

      // Handle latestVersion change (must verify version exists)
      if (data.latestVersion !== undefined) {
        const [targetVersion] = await this.ctx
          .select({ id: artifactVersions.id })
          .from(artifactVersions)
          .where(and(
            eq(artifactVersions.artifactId, artifactId),
            eq(artifactVersions.id, data.latestVersion)
          ))
          .limit(1);
        if (!targetVersion) {
          return { success: false, error: { code: 'NOT_FOUND', message: `Version ${data.latestVersion} not found` } };
        }
        updateFields.latestVersion = data.latestVersion;
      }

      // Step 3: Update discovery control (isListed)
      const artifactRef = { type: 'artifact' as const, id: artifactId };
      if (data.isListed !== undefined) {
        const currentDiscovery = await this.discoveryService.get(artifactRef);
        if (currentDiscovery && currentDiscovery.isListed !== data.isListed) {
          this.discoveryService.setListed(artifactRef, data.isListed);
          
          // Cascade isListed change to all node versions from this artifact
          await this.cascadeDiscoveryToNodes(artifactId, data.isListed);
        }
      }

      // Step 4: Handle privacy changes
      let versionCreated = false;
      let newCommit: string | undefined;

      if (data.isPrivate !== undefined) {
        const currentIsPublic = await this.aclService.isPublic(artifactRef);
        const currentIsPrivate = !currentIsPublic;
        const newIsPrivate = data.isPrivate;

        if (newIsPrivate !== currentIsPrivate) {
          if (newIsPrivate) {
            // public → private: Fork nodes and create new version
            const forkResult = await this.forkToPrivateVersion(
              artifactId,
              authorId,
              existingArtifact.latestVersion
            );
            if (!forkResult.success) return forkResult;
            
            versionCreated = true;
            newCommit = forkResult.data.commit;
            updateFields.latestVersion = forkResult.data.versionId;

            // Cascade privacy to related articles
            await this.cascadePrivacyToArticles(artifactId);
          } else {
            // private → public: Direct ACL update (one-way relaxation)
            this.aclService.setPublic(artifactRef, authorId);
            
            // Update original node versions' ACL to public
            if (existingArtifact.latestVersion) {
              const [latestVersionRecord] = await this.ctx
                .select({ commitHash: artifactVersions.commitHash })
                .from(artifactVersions)
                .where(eq(artifactVersions.id, existingArtifact.latestVersion))
                .limit(1);
              if (latestVersionRecord) {
                await this.updateOriginalNodesPermission(
                  artifactId,
                  latestVersionRecord.commitHash,
                  false,
                  authorId
                );
              }
            }
          }
        }
      }

      // Step 5: Update tags if provided
      if (data.tags !== undefined) {
        const tagService = new TagService(this.ctx);
        // Use syncTags which handles diff computation and maintains usage counts
        await tagService.syncTags(artifactId, data.tags);
      }

      // Step 6: Apply artifact record updates
      if (Object.keys(updateFields).length > 1) { // More than just updatedAt
        this.ctx.modify().update(artifacts).set(updateFields).where(eq(artifacts.id, artifactId));
      }

      return {
        success: true,
        data: {
          versionCreated,
          commit: newCommit,
        },
      };
    } catch (error) {
      console.error('Update artifact metadata error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * Fork all nodes in the latest version to private versions and create a new artifact version.
   * Used when changing artifact privacy from public to private.
   * 
   * This method is idempotent via optimistic locking:
   * - forkAsPrivate returns existing commit if already forked
   * - Version creation uses ON CONFLICT DO NOTHING + expectAffected=1
   * - Concurrent requests will get OptimisticLockError, handled by caller
   */
  private async forkToPrivateVersion(
    artifactId: string,
    authorId: string,
    latestVersionId: string | null
  ): Promise<ServiceResult<{ commit: string; versionId: string }>> {
    if (!latestVersionId) {
      return { success: false, error: { code: 'BAD_REQUEST', message: 'No existing version to fork' } };
    }

    // Get the latest version's commit hash
    const [latestVersion] = await this.ctx
      .select({ commitHash: artifactVersions.commitHash })
      .from(artifactVersions)
      .where(eq(artifactVersions.id, latestVersionId))
      .limit(1);

    if (!latestVersion) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Latest version not found' } };
    }

    // Get all nodes and edges in the latest version
    const versionNodes = await this.ctx
      .select({
        nodeId: artifactVersionNodes.nodeId,
        nodeCommit: artifactVersionNodes.nodeCommit,
        positionX: artifactVersionNodes.positionX,
        positionY: artifactVersionNodes.positionY,
      })
      .from(artifactVersionNodes)
      .where(eq(artifactVersionNodes.commitHash, latestVersion.commitHash));

    const versionEdges = await this.ctx
      .select({
        sourceNodeId: artifactVersionEdges.sourceNodeId,
        targetNodeId: artifactVersionEdges.targetNodeId,
        sourceHandle: artifactVersionEdges.sourceHandle,
        targetHandle: artifactVersionEdges.targetHandle,
      })
      .from(artifactVersionEdges)
      .where(eq(artifactVersionEdges.commitHash, latestVersion.commitHash));

    // Fork each node to a private version
    const nodeVersionService = new NodeVersionService(this.ctx);
    // Use a minimal type that has only the fields needed for commit computation and graph storage
    const forkedNodes: Array<{
      nodeId: string;
      commit: string;
      position?: { x: number; y: number };
    }> = [];

    for (const vn of versionNodes) {
      // Fork the node as private
      const forkResult = await nodeVersionService.forkAsPrivate(
        vn.nodeCommit,
        authorId,
        artifactId
      );

      if (!forkResult.success) {
        return { success: false, error: forkResult.error };
      }

      forkedNodes.push({
        nodeId: vn.nodeId,
        commit: forkResult.data.commit,
        position: vn.positionX !== null && vn.positionY !== null
          ? { x: vn.positionX, y: vn.positionY }
          : undefined,
      });
    }

    // Compute new commit hash (only needs nodeId and commit)
    const edges: ArtifactEdgeDescriptor[] = versionEdges.map(e => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    }));

    const newCommit = await computeArtifactCommit(
      artifactId,
      latestVersion.commitHash,
      forkedNodes.map(n => ({ nodeId: n.nodeId, commit: n.commit })),
      edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    );

    // Create new version record (uses optimistic lock to detect concurrent forks)
    const newVersionId = crypto.randomUUID();
    const newVersion: NewArtifactVersion = {
      id: newVersionId,
      artifactId,
      version: null,
      commitHash: newCommit,
      changelog: 'Visibility changed from public to private',
      publishedAt: new Date().toISOString(),
      entrypoint: null,
    };
    this.ctx.modify({ expectAffected: 1, lockMsg: `Fork version ${newCommit} already exists` })
      .insert(artifactVersions).values(newVersion).onConflictDoNothing();

    // Store graph structure (nodes and edges)
    for (const node of forkedNodes) {
      const versionNode: NewArtifactVersionNode = {
        commitHash: newCommit,
        nodeId: node.nodeId,
        nodeCommit: node.commit,
        positionX: node.position?.x ?? null,
        positionY: node.position?.y ?? null,
      };
      this.ctx.modify().insert(artifactVersionNodes).values(versionNode).onConflictDoNothing();
    }

    for (const edge of edges) {
      const versionEdge: NewArtifactVersionEdge = {
        commitHash: newCommit,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      };
      this.ctx.modify().insert(artifactVersionEdges).values(versionEdge).onConflictDoNothing();
    }

    // Update artifact's ACL to private
    const artifactRef = { type: 'artifact' as const, id: artifactId };
    this.aclService.setPrivate(artifactRef);

    return {
      success: true,
      data: { commit: newCommit, versionId: newVersionId },
    };
  }

  /**
   * Cascade privacy change to all articles associated with an artifact.
   * When an artifact becomes private, all its articles should also become private.
   */
  private async cascadePrivacyToArticles(artifactId: string): Promise<void> {
    // Get all articles associated with this artifact
    const relatedArticles = await this.ctx
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.artifactId, artifactId));

    // Update each article's ACL to private
    for (const article of relatedArticles) {
      const articleRef = { type: 'article' as const, id: article.id };
      this.aclService.setPrivate(articleRef);
    }
  }

  // ============================================================================
  // updateVersionMetadata - Update metadata for a specific version
  // ============================================================================

  /**
   * Update metadata for a specific artifact version.
   * Replaces the old updateCommitTags method with more complete functionality.
   */
  async updateVersionMetadata(
    input: UpdateVersionMetadataInput
  ): Promise<ServiceResult<{ version: ArtifactVersion }>> {
    const { artifactId, authorId, commitHash, data } = input;

    try {
      // Verify artifact exists and user has permission
      const [existingArtifact] = await this.ctx
        .select({ id: artifacts.id, authorId: artifacts.authorId })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!existingArtifact) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }

      if (existingArtifact.authorId !== authorId) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' } };
      }

      // Find the target version
      const [targetVersion] = await this.ctx
        .select()
        .from(artifactVersions)
        .where(and(
          eq(artifactVersions.artifactId, artifactId),
          eq(artifactVersions.commitHash, commitHash),
        ))
        .limit(1);

      if (!targetVersion) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Version with commit ${commitHash} not found` } };
      }

      // Prepare update fields
      const updateFields: Record<string, unknown> = {};

      if (data.version !== undefined) {
        updateFields.version = data.version;
      }
      if (data.changelog !== undefined) {
        updateFields.changelog = data.changelog;
      }
      if (data.entrypoint !== undefined) {
        updateFields.entrypoint = data.entrypoint;
      }

      // Update version record if any fields changed
      if (Object.keys(updateFields).length > 0) {
        this.ctx.modify().update(artifactVersions)
          .set(updateFields)
          .where(eq(artifactVersions.id, targetVersion.id));
      }

      // Handle commit tags (replace semantics)
      let finalCommitTags: string[] = [];
      if (data.commitTags !== undefined) {
        // Delete all existing tags for this version
        this.ctx.modify().delete(artifactCommitTags).where(
          eq(artifactCommitTags.commitHash, targetVersion.commitHash)
        );

        // If new tags provided, clear same-named tags from other versions and create new associations
        if (data.commitTags.length > 0) {
          const existingTags = await this.ctx
            .select({ id: artifactCommitTags.id })
            .from(artifactCommitTags)
            .where(and(
              eq(artifactCommitTags.artifactId, artifactId),
              inArray(artifactCommitTags.tag, data.commitTags),
            ));

          for (const ct of existingTags) {
            this.ctx.modify().delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id));
          }

          for (const tag of data.commitTags) {
            this.ctx.modify().insert(artifactCommitTags).values({
              artifactId,
              commitHash: targetVersion.commitHash,
              tag,
            }).onConflictDoNothing();
          }
          finalCommitTags = data.commitTags;
        }
      } else {
        // If commitTags not provided, fetch existing tags
        const existingCommitTags = await this.ctx
          .select({ tag: artifactCommitTags.tag })
          .from(artifactCommitTags)
          .where(eq(artifactCommitTags.commitHash, targetVersion.commitHash));
        finalCommitTags = existingCommitTags.map(ct => ct.tag);
      }

      return {
        success: true,
        data: {
          version: {
            id: targetVersion.id,
            version: data.version ?? targetVersion.version ?? '',
            commitHash: targetVersion.commitHash,
            commitTags: finalCommitTags,
            changelog: data.changelog ?? targetVersion.changelog,
            publishedAt: targetVersion.publishedAt,
            createdAt: targetVersion.createdAt,
          },
        },
      };
    } catch (error) {
      console.error('Update version metadata error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * 通过 commitTag 查询版本（用于 graph 路由的 version 解析）
   */
  async getVersionByTag(
    artifactId: string,
    commitTag: string,
  ): Promise<ServiceResult<{ version: ArtifactVersion }>> {
    try {
      const result = await this.ctx
        .select({ version: artifactVersions })
        .from(artifactCommitTags)
        .innerJoin(artifactVersions, eq(artifactCommitTags.commitHash, artifactVersions.commitHash))
        .where(and(
          eq(artifactCommitTags.artifactId, artifactId),
          eq(artifactCommitTags.tag, commitTag),
        ))
        .limit(1);

      if (result.length === 0) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Version with tag "${commitTag}" not found` } };
      }

      const dbVersion = result[0].version;
      return {
        success: true,
        data: {
          version: {
            id: dbVersion.id,
            version: dbVersion.version ?? '',
            commitHash: dbVersion.commitHash,
            changelog: dbVersion.changelog,
            publishedAt: dbVersion.publishedAt,
            createdAt: dbVersion.createdAt,
          },
        },
      };
    } catch (error) {
      console.error('Get version by tag error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * Apply incremental patch to create a new artifact version (PATCH semantics).
   * 
   * This method ONLY handles graph changes (add/remove nodes/edges).
   * Metadata updates (name, description, isListed, isPrivate, tags) should be done
   * through updateArtifactMetadata().
   * 
   * The version metadata (version, changelog, commitTags, entrypoint) is associated
   * with the new version being created.
   */
  async patchArtifact(input: PatchArtifactInput): Promise<ServiceResult<PatchArtifactResult>> {
    const { authorId, metadata } = input;
    const artifactId = metadata.artifactId;

    try {
      // Step 1: Verify artifact exists and user has permission
      const [existingArtifact] = await this.ctx
        .select({ id: artifacts.id, authorId: artifacts.authorId, latestVersion: artifacts.latestVersion, name: artifacts.name })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!existingArtifact) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }

      if (existingArtifact.authorId !== authorId) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' } };
      }

      // Step 2: Validate baseCommit exists
      const [baseVersion] = await this.ctx
        .select()
        .from(artifactVersions)
        .where(and(
          eq(artifactVersions.artifactId, artifactId),
          eq(artifactVersions.commitHash, metadata.baseCommit),
        ))
        .limit(1);

      if (!baseVersion) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Base version with commit ${metadata.baseCommit} not found` } };
      }

      // Step 3: commit is required
      const commit = metadata.commit;

      // Step 4: Use baseCommit as parentCommit (tree structure - versions branch from their base)
      const parentCommit = metadata.baseCommit;

      // Step 5: Build merged graph using NodeGraph.fromPatch
      const graphResult = await NodeGraph.fromPatch(this.ctx, baseVersion.commitHash, {
        addNodes: metadata.addNodes,
        removeNodeIds: metadata.removeNodeIds,
        addEdges: metadata.addEdges,
        removeEdges: metadata.removeEdges,
      });
      if (!graphResult.success) return graphResult;
      const graph = graphResult.data;

      // Step 6: Validate merged graph
      const validationResult = graph.validate(metadata.entrypoint);
      if (!validationResult.success) return validationResult;

      // Step 7: Get merged nodes and edges
      const mergedNodes = [...graph.nodes];
      const mergedEdges = [...graph.edges];

      // Step 8: Verify commit hash
      const expectedCommit = await ArtifactService.computeCommitHash(
        artifactId, parentCommit, mergedNodes, mergedEdges
      );
      if (commit !== expectedCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Commit hash mismatch: expected ${expectedCommit}, got ${commit}. Client must compute commit using (artifactId + parentCommit + merged nodes + merged edges).`,
          },
        };
      }

      // Step 9: Get current privacy setting (graph changes don't modify privacy)
      const artifactRef = { type: 'artifact' as const, id: artifactId };
      const currentIsPublic = await this.aclService.isPublic(artifactRef);
      const currentIsPrivate = !currentIsPublic;

      // Step 10: Get current isListed setting (graph changes don't modify discovery)
      const currentDiscoveryRecord = await this.discoveryService.get(artifactRef);
      const currentIsListed = currentDiscoveryRecord?.isListed ?? true;

      // Step 11: Sync nodes (preserving current privacy setting)
      const nodeResult = await this.syncNodes(artifactId, authorId, mergedNodes, currentIsPrivate);
      if (!nodeResult.success) return nodeResult;

      // Step 12: Create new version record (uses optimistic lock to detect conflicts)
      const versionId = crypto.randomUUID();
      this.createVersionRecord(artifactId, versionId, {
        artifactId,
        commit,
        name: existingArtifact.name,  // Keep existing name
        isListed: currentIsListed,
        isPrivate: currentIsPrivate,  // Preserve current privacy setting
        version: metadata.version,
        changelog: metadata.changelog,
        commitTags: metadata.commitTags,
        entrypoint: metadata.entrypoint,
      });

      // Step 14: Update artifact's latestVersion
      this.ctx.modify().update(artifacts).set({
        latestVersion: versionId,
        updatedAt: new Date().toISOString(),
      }).where(eq(artifacts.id, artifactId));

      // Step 15: Store graph structure
      this.storeGraphStructure(commit, mergedNodes, mergedEdges);

      // Step 16: Process commit tags
      await this.processCommitTags(artifactId, commit, metadata.commitTags ?? []);

      // Step 17: Build response
      const author = await this.ctx
        .select({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        })
        .from(user)
        .where(eq(user.id, authorId))
        .limit(1);

      const authorInfo = author[0] ?? { id: authorId, username: 'unknown', displayName: null, avatarUrl: null };

      // Get existing tags for the artifact
      const existingTags = await this.ctx
        .select({ slug: tags.slug, name: tags.name })
        .from(tags)
        .innerJoin(artifactTags, eq(tags.slug, artifactTags.tagSlug))
        .where(eq(artifactTags.artifactId, artifactId));

      const existingStats = await this.ctx
        .select()
        .from(artifactStats)
        .where(eq(artifactStats.artifactId, artifactId))
        .limit(1);

      const stats = existingStats[0] ?? { viewCount: 0, favCount: 0, refCount: 0, downloadCount: 0 };

      const artifact: ArtifactListItem = {
        id: artifactId,
        name: existingArtifact.name,
        author: {
          id: authorInfo.id,
          username: authorInfo.username,
          displayName: authorInfo.displayName,
          avatarUrl: authorInfo.avatarUrl,
        },
        tags: existingTags.map(t => ({ slug: t.slug, name: t.name })),
        stats: {
          viewCount: stats.viewCount,
          favCount: stats.favCount,
          refCount: stats.refCount,
          downloadCount: stats.downloadCount,
        },
        isListed: currentIsListed,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        success: true,
        data: { artifact, versionCreated: true },
      };
    } catch (error) {
      console.error('Patch artifact error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  // 获取用户的 artifact 列表
  async listUserArtifacts(
    userId: string,
    params: ListUserArtifactsParams = {}
  ): Promise<ServiceResult<ListArtifactsResult>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      viewerId,
    } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    // 判断是否为自己查看自己
    const isSelf = viewerId === userId;

    try {
      // 构建基础条件：用户拥有的 artifacts
      const baseConditions = [
        eq(artifacts.authorId, userId),
      ];

      // 如果不是自己查看自己，只查询 isListed = true 的
      if (!isSelf) {
        baseConditions.push(eq(resourceDiscoveryControl.isListed, true));
      }

      // 计算总数
      // 注意：使用 INNER JOIN resourceDiscoveryControl，因为 createArtifact 会同时创建 discovery control 记录
      // 如果用 LEFT JOIN + WHERE isListed=true，会过滤掉 isListed=NULL 的行，效果等同于 INNER JOIN 但语义不清晰
      const [countResult] = await this.ctx
        .select({ total: count() })
        .from(artifacts)
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifacts.id)
          )
        )
        .where(and(...baseConditions));

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序
      const sortColumnMap = {
        ...artifactStats,
        ...artifacts,
      };
      const sortColumn = sortColumnMap[sortBy];
      const orderClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      // 查询 artifacts（带 author、stats 和 discovery control）
      // 注意：resourceDiscoveryControl 使用 INNER JOIN（每个 artifact 都有对应记录）
      //       artifactStats 使用 LEFT JOIN（stats 记录可能不存在，虽然 createArtifact 会创建）
      const artifactsQuery = this.ctx.select({
          artifact: artifacts,
          isListed: resourceDiscoveryControl.isListed,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
          stats: artifactStats,
        })
        .from(artifacts)
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .innerJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifacts.id)
          )
        )
        .leftJoin(artifactStats, eq(artifacts.id, artifactStats.artifactId))
        .where(and(...baseConditions))
        .orderBy(orderClause)
        .limit(validLimit)
        .offset(offset);

      const artifactResults = await artifactsQuery;

      // 获取所有 artifact 的 tags
      const artifactIds = artifactResults.map(r => r.artifact.id);
      const tagsMap = new Map<string, ArtifactListItem['tags']>();

      if (artifactIds.length > 0) {
        const tagResults = await this.ctx
          .select({
            artifactId: artifactTags.artifactId,
            tag: {
              slug: tags.slug,
              name: tags.name,
              description: tags.description,
              color: tags.color,
            },
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          const existing = tagsMap.get(row.artifactId) || [];
          existing.push(row.tag);
          tagsMap.set(row.artifactId, existing);
        }
      }

      // 组装结果
      const resultArtifacts: ArtifactListItem[] = artifactResults.map(r => ({
        id: r.artifact.id,
        name: r.artifact.name,
        description: r.artifact.description,
        isListed: r.isListed ?? false,
        thumbnailUrl: r.artifact.thumbnailUrl,
        license: r.artifact.license,
        createdAt: r.artifact.createdAt,
        updatedAt: r.artifact.updatedAt,
        author: r.author,
        tags: tagsMap.get(r.artifact.id) || [],
        stats: r.stats ? {
          viewCount: r.stats.viewCount,
          favCount: r.stats.favCount,
          refCount: r.stats.refCount,
          downloadCount: r.stats.downloadCount,
        } : undefined,
      }));

      return {
        success: true,
        data: {
          artifacts: resultArtifacts,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('List user artifacts error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  /**
   * 获取 artifact 的节点图结构
   * @param artifactId artifact ID
   * @param versionQuery 版本查询参数：commitHash、commitTag 或 'latest'
   */
  async getArtifactGraph(
    artifactId: string,
    versionQuery?: string,
  ): Promise<ServiceResult<GetArtifactGraphResponse>> {
    try {
      const nodeVersionService = new NodeVersionService(this.ctx);

      // 获取指定版本或最新版本
      let version: DbArtifactVersion | undefined;

      if (versionQuery && versionQuery !== 'latest') {
        // 先尝试按 commitHash 查询
        const [byHash] = await this.ctx
          .select()
          .from(artifactVersions)
          .where(
            and(
              eq(artifactVersions.artifactId, artifactId),
              eq(artifactVersions.commitHash, versionQuery)
            )
          )
          .limit(1);

        if (byHash) {
          version = byHash;
        } else {
          // 尝试按 commitTag 查询
          const [byTag] = await this.ctx
            .select({ version: artifactVersions })
            .from(artifactCommitTags)
            .innerJoin(artifactVersions, eq(artifactCommitTags.commitHash, artifactVersions.commitHash))
            .where(
              and(
                eq(artifactCommitTags.artifactId, artifactId),
                eq(artifactCommitTags.tag, versionQuery)
              )
            )
            .limit(1);

          if (byTag) {
            version = byTag.version;
          }
        }
      } else {
        // 获取最新版本
        const [latest] = await this.ctx
          .select()
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, artifactId))
          .orderBy(desc(artifactVersions.createdAt))
          .limit(1);

        version = latest;
      }

      if (!version) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact version not found' } };
      }

      // 获取 artifact_version_nodes
      const versionNodes = await this.ctx
        .select()
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, version.commitHash));

      // 获取每个节点的版本信息和内容
      const nodes: ArtifactNodeSummary[] = [];
      for (const vn of versionNodes) {
        const versionDetail = await nodeVersionService.getVersion(vn.nodeCommit);
        if (versionDetail.success) {
          const v = versionDetail.data;
          nodes.push({
            id: vn.nodeId,
            type: v.type as NodeType,
            commit: v.commit,
            contentHash: v.contentHash,
            name: v.name,
            position: vn.positionX != null && vn.positionY != null
              ? { x: vn.positionX, y: vn.positionY }
              : undefined,
            content: v.content as ArtifactNodeContent,
          });
        }
      }

      // 获取 artifact_version_edges
      const versionEdges = await this.ctx
        .select()
        .from(artifactVersionEdges)
        .where(eq(artifactVersionEdges.commitHash, version.commitHash));

      const edges: ArtifactEdge[] = versionEdges.map(e => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));

      // 查询该版本的 commitTags
      const versionCommitTags = await this.ctx
        .select({ tag: artifactCommitTags.tag })
        .from(artifactCommitTags)
        .where(eq(artifactCommitTags.commitHash, version.commitHash));

      return {
        success: true,
        data: {
          nodes,
          edges,
          version: {
            id: version.id,
            commitHash: version.commitHash,
            commitTags: versionCommitTags.map(t => t.tag),
            version: version.version ?? '',
            createdAt: version.createdAt,
            entrypoint: version.entrypoint ?? undefined,
          },
        },
      };
    } catch (error) {
      console.error('Get artifact graph error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * Delete an artifact and all related data.
   * - Cascade deletes all associated articles
   * - Removes project_artifacts associations
   * - Deletes all versions and graph data
   * - Cleans up R2 storage (VFS files, homepage)
   * - Does NOT delete shared node_versions
   * 
   * @param r2Bucket - Optional R2 bucket for cleaning up VFS files
   */
  async deleteArtifact(
    params: DeleteArtifactParams,
    r2Bucket?: R2Bucket
  ): Promise<ServiceResult<void>> {
    const { artifactId, userId } = params;
    const artifactRef = { type: 'artifact' as const, id: artifactId };

    try {
      // Step 1: Check artifact exists
      const [existing] = await this.ctx.select({ id: artifacts.id })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!existing) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        };
      }

      // Step 2: Check manage permission
      const canManage = await this.aclService.canManage(artifactRef, userId);
      if (!canManage) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'No permission to delete this artifact' },
        };
      }

      // Step 3: Get all associated articles and delete them (cascade)
      const associatedArticles = await this.ctx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.artifactId, artifactId));

      for (const article of associatedArticles) {
        // Use internal delete that skips permission check since we already verified manage permission
        const articleRef = { type: 'article' as const, id: article.id };
        this.ctx.modify().delete(articles).where(eq(articles.id, article.id));
        this.aclService.deleteAllAcls(articleRef);
        this.discoveryService.delete(articleRef);
      }

      // Step 4: Remove project_artifacts associations (not deleting projects)
      this.ctx.modify().delete(projectArtifacts).where(eq(projectArtifacts.artifactId, artifactId));

      // Step 5: Get all version commits for R2 cleanup
      const versionCommits = await this.ctx
        .select({ commitHash: artifactVersions.commitHash })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifactId));

      // Step 6: Get VFS node commits for R2 cleanup
      const vfsCommits: string[] = [];
      for (const { commitHash } of versionCommits) {
        const nodes = await this.ctx
          .select({ nodeCommit: artifactVersionNodes.nodeCommit })
          .from(artifactVersionNodes)
          .innerJoin(nodeVersions, eq(artifactVersionNodes.nodeCommit, nodeVersions.commit))
          .where(
            and(
              eq(artifactVersionNodes.commitHash, commitHash),
              eq(nodeVersions.type, 'VFS')
            )
          );
        vfsCommits.push(...nodes.map(n => n.nodeCommit));
      }

      // Step 7: Delete version graph data (edges and nodes)
      for (const { commitHash } of versionCommits) {
        this.ctx.modify().delete(artifactVersionEdges).where(eq(artifactVersionEdges.commitHash, commitHash));
        this.ctx.modify().delete(artifactVersionNodes).where(eq(artifactVersionNodes.commitHash, commitHash));
      }

      // Step 8: Delete artifact versions
      this.ctx.modify().delete(artifactVersions).where(eq(artifactVersions.artifactId, artifactId));

      // Step 9: Delete commit tags
      this.ctx.modify().delete(artifactCommitTags).where(eq(artifactCommitTags.artifactId, artifactId));

      // Step 10: Delete artifact tags
      this.ctx.modify().delete(artifactTags).where(eq(artifactTags.artifactId, artifactId));

      // Step 11: Delete stats
      this.ctx.modify().delete(artifactStats).where(eq(artifactStats.artifactId, artifactId));

      // Step 12: Delete favs
      this.ctx.modify().delete(artifactFavs).where(eq(artifactFavs.artifactId, artifactId));

      // Step 13: Delete views
      this.ctx.modify().delete(artifactViews).where(eq(artifactViews.artifactId, artifactId));

      // Step 14: Delete artifact record
      this.ctx.modify().delete(artifacts).where(eq(artifacts.id, artifactId));

      // Step 15: Delete ACL records
      this.aclService.deleteAllAcls(artifactRef);

      // Step 16: Delete discovery control record
      this.discoveryService.delete(artifactRef);

      // Step 17: Clean up R2 storage (VFS files and homepage)
      if (r2Bucket) {
        // Delete VFS tar.gz files
        for (const commit of vfsCommits) {
          try {
            await r2Bucket.delete(`vfs/${commit}.tar.gz`);
          } catch (e) {
            console.warn(`Failed to delete VFS file for commit ${commit}:`, e);
          }
        }

        // Delete homepage HTML
        try {
          await r2Bucket.delete(`homepage/${artifactId}.html`);
        } catch (e) {
          console.warn(`Failed to delete homepage for artifact ${artifactId}:`, e);
        }
      }

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete artifact' },
      };
    }
  }
}

// 用户 artifacts 查询参数（基于 API 类型 + 内部参数）
export type ListUserArtifactsParams = GetUserArtifactsQuery & {
  /** 查看者 ID：如果是自己查看自己，可以看到所有资源 */
  viewerId?: string;
};

// 版本信息（重新导出 API 类型，保持向后兼容）
export type { ArtifactVersion } from '@pubwiki/api';
export type ArtifactVersionItem = ArtifactVersion;

// PATCH artifact 输入参数（基于 API 类型 + 内部参数）
export type PatchArtifactInput = {
  authorId: string;
  metadata: PatchArtifactRequest;
};

// 谱系查询参数
export interface GetLineageParams {
  commit?: string;      // 指定版本的 commit hash，不传则使用 latestVersion
  parentDepth?: number; // 向上追溯父代的深度，undefined 表示无限递归
  childDepth?: number;  // 向下追溯子代的深度，undefined 表示无限递归
}
