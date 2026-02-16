import { eq, and, inArray, asc, desc, sql, count, isNotNull } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { artifacts, tags, artifactTags, artifactVersions, artifactCommitTags, type Artifact, type ArtifactVersion as DbArtifactVersion, type NewArtifact, type NewArtifactVersion } from '../schema/artifacts';
import { TagService, type TagInfo } from './tag';
import { artifactVersionNodes, artifactVersionEdges, type NewArtifactVersionNode, type NewArtifactVersionEdge } from '../schema/artifact-version-graph';
import { nodeVersions } from '../schema/node-versions';
import { saveContents } from '../schema/node-contents';
import type { ArtifactNodeType } from '../schema/enums';
import { NodeVersionService, type SyncNodeVersionInput } from './node-version';
import { SaveService } from './save';
import { artifactStats } from '../schema/stats';
import { user } from '../schema/auth';
import type { ServiceResult } from './user';
import type {
  ArtifactListItem,
  Pagination,
  ArtifactVersion,
  CreateArtifactMetadata,
  ArtifactEdgeDescriptor,
  ArtifactNodeContent,
  ArtifactLineageItem,
  CreateArtifactNode,
  CreateSaveInput,
  ListArtifactsQuery,
  GetUserArtifactsQuery,
  PatchArtifactRequest,
  ListArtifactsResponse,
  GetArtifactGraphResponse,
  ArtifactNodeSummary,
  ArtifactEdge,
} from '@pubwiki/api';
import { computeArtifactCommit } from '@pubwiki/api';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { resourceAcl, PUBLIC_USER_ID } from '../schema/acl';

// 重新导出供其他模块使用
export type { ArtifactListItem, Pagination, ArtifactLineageItem, CreateArtifactNode, CreateSaveInput };

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
  saves?: CreateSaveInput[];
}

// 创建 artifact 的返回结果
export interface CreateArtifactResult {
  artifact: ArtifactListItem;
}

// PATCH artifact 的返回结果
export interface PatchArtifactResult extends CreateArtifactResult {
  /** 是否创建了新版本（false 表示仅更新了 metadata） */
  versionCreated: boolean;
}

export class ArtifactService {
  constructor(private ctx: BatchContext) {}

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
  // createArtifact - Main Entry Point
  // ============================================================================

  /**
   * 创建或更新 artifact（使用 batch 保证原子性）
   * 通过检查 metadata.artifactId 是否存在于数据库中决定是创建还是更新
   */
  async createArtifact(input: CreateArtifactInput): Promise<ServiceResult<CreateArtifactResult>> {
    const { authorId, metadata, nodes, edges } = input;
    const artifactId = metadata.artifactId;

    try {
      // Step 1: Validate and prepare context (check permissions, verify commit hash, get author)
      const prepareResult = await this.prepareArtifactContext(artifactId, authorId, metadata, nodes, edges);
      if (!prepareResult.success) return prepareResult;
      const { isUpdate, author, versionId } = prepareResult.data;

      // Step 2: Validate and sync nodes (nodes must exist before version references them)
      const nodeResult = await this.validateAndSyncNodes(artifactId, authorId, metadata.commit, nodes, edges, input.saves ?? []);
      if (!nodeResult.success) return nodeResult;

      // Step 3: Validate entrypoint (depends on nodes being validated)
      const entrypointResult = this.validateEntrypoint(metadata.entrypoint, nodes, input.saves ?? []);
      if (!entrypointResult.success) return entrypointResult;

      // Step 4: Create or update artifact record (without currentVersionId for new artifacts)
      if (isUpdate) {
        const updateResult = await this.updateExistingArtifact(artifactId, metadata, versionId);
        if (!updateResult.success) return updateResult;
      } else {
        this.createNewArtifact(artifactId, authorId, metadata, versionId);
      }

      // Step 5: Create version record (artifact must exist first due to FK)
      this.createVersionRecord(artifactId, versionId, metadata);

      // Step 6: Store graph structure (version must exist, nodes already synced)
      this.storeGraphStructure(metadata.commit, nodes, edges);

      // Step 7: Process commit tags (version must exist)
      await this.processCommitTags(artifactId, metadata.commit, metadata.commitTags ?? []);

      // Step 8: Process tags
      const tagService = new TagService(this.ctx);
      const existingTagsMap = metadata.tags && metadata.tags.length > 0
        ? await tagService.fetchTagsBySlug(metadata.tags)
        : new Map<string, TagInfo>();
      const processedTags = await this.processTags(
        artifactId, isUpdate, metadata.tags ?? [], tagService, existingTagsMap
      );

      // Step 9: Create stats record (only for new artifacts)
      if (!isUpdate) {
        this.createStatsRecord(artifactId);
      }

      // Step 10: Build and return response
      const artifact = await this.buildArtifactResponse(
        artifactId, isUpdate, metadata, author, processedTags
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
   * Step 1: Validate permissions, compute parent commit, verify commit hash, get author info
   */
  private async prepareArtifactContext(
    artifactId: string,
    authorId: string,
    metadata: CreateArtifactMetadata,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
  ): Promise<ServiceResult<{
    isUpdate: boolean;
    parentCommit: string | null;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    versionId: string;
  }>> {
    // Check if artifact exists
    const existingArtifact = await this.ctx
      .select({ id: artifacts.id, authorId: artifacts.authorId, currentVersionId: artifacts.currentVersionId })
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);

    const isUpdate = existingArtifact.length > 0;

    // Verify ownership for updates
    if (isUpdate && existingArtifact[0].authorId !== authorId) {
      return {
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' },
      };
    }

    // Compute parentCommit (current version's commitHash for updates, null for creates)
    let parentCommit: string | null = null;
    if (isUpdate && existingArtifact[0].currentVersionId) {
      const currentVersion = await this.ctx
        .select({ commitHash: artifactVersions.commitHash })
        .from(artifactVersions)
        .where(eq(artifactVersions.id, existingArtifact[0].currentVersionId))
        .limit(1);
      if (currentVersion.length > 0) {
        parentCommit = currentVersion[0].commitHash;
      }
    }

    // Verify commit hash
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

    // Get author info
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

    return {
      success: true,
      data: {
        isUpdate,
        parentCommit,
        author: authorResult[0],
        versionId: crypto.randomUUID(),
      },
    };
  }

  /**
   * Step 2a: Update existing artifact (for update mode)
   */
  private async updateExistingArtifact(
    artifactId: string,
    metadata: CreateArtifactMetadata,
    versionId: string,
  ): Promise<ServiceResult<void>> {
    // Check for duplicate commit hash
    const existingVersion = await this.ctx
      .select({ id: artifactVersions.id })
      .from(artifactVersions)
      .where(and(
        eq(artifactVersions.artifactId, artifactId),
        eq(artifactVersions.commitHash, metadata.commit)
      ))
      .limit(1);

    if (existingVersion.length > 0) {
      return {
        success: false,
        error: { code: 'CONFLICT', message: `Version with commit ${metadata.commit} already exists for this artifact` },
      };
    }

    // Update artifact record
    this.ctx.modify(db =>
      db.update(artifacts).set({
        name: metadata.name,
        description: metadata.description ?? null,
        currentVersionId: versionId,
        thumbnailUrl: metadata.thumbnailUrl ?? null,
        license: metadata.license ?? null,
        repositoryUrl: metadata.repositoryUrl ?? null,
        updatedAt: new Date().toISOString(),
      }).where(eq(artifacts.id, artifactId))
    );

    // Update discovery control
    const isListed = metadata.isListed ?? true;
    this.ctx.modify(db =>
      db.update(resourceDiscoveryControl).set({ isListed }).where(
        and(
          eq(resourceDiscoveryControl.resourceType, 'artifact'),
          eq(resourceDiscoveryControl.resourceId, artifactId)
        )
      )
    );

    return { success: true, data: undefined };
  }

  /**
   * Step 2b: Create new artifact (for create mode)
   */
  private createNewArtifact(
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
      currentVersionId: versionId,
      thumbnailUrl: metadata.thumbnailUrl ?? null,
      license: metadata.license ?? null,
      repositoryUrl: metadata.repositoryUrl ?? null,
    };
    this.ctx.modify(db => db.insert(artifacts).values(newArtifact));

    // Create discovery control record
    const isListed = metadata.isListed ?? true;
    this.ctx.modify(db =>
      db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifactId,
        isListed,
      })
    );

    // Create owner ACL (manage + write + read)
    this.ctx.modify(db =>
      db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifactId,
        userId: authorId,
        canRead: true,
        canWrite: true,
        canManage: true,
        grantedBy: authorId,
      })
    );

    // Create public read ACL
    this.ctx.modify(db =>
      db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifactId,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy: authorId,
      })
    );
  }

  /**
   * Step 3: Create version record
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
    this.ctx.modify(db => db.insert(artifactVersions).values(newVersion));
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
      this.ctx.modify(db =>
        db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
      );
    }

    // Create new commit tag associations
    for (const tag of commitTags) {
      this.ctx.modify(db =>
        db.insert(artifactCommitTags).values({ artifactId, commitHash, tag })
      );
    }
  }

  /**
   * Step 5: Sync all nodes and create saves.
   */
  private async validateAndSyncNodes(
    artifactId: string,
    authorId: string,
    commitHash: string,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
    saves: CreateSaveInput[],
  ): Promise<ServiceResult<void>> {
    const nodeVersionService = new NodeVersionService(this.ctx);

    // Step 1: Create saves first (they will be referenced by STATE nodes)
    if (saves.length > 0) {
      const saveResult = await this.createSaves(artifactId, authorId, commitHash, nodes, edges, saves);
      if (!saveResult.success) return saveResult;
    }

    // Step 2: Sync all nodes together
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
   * Create saves that are submitted with the artifact
   */
  private async createSaves(
    artifactId: string,
    authorId: string,
    commitHash: string,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
    saves: CreateSaveInput[],
  ): Promise<ServiceResult<void>> {
    const saveService = new SaveService(this.ctx);

    // Build state node map: stateNodeId → stateNodeCommit (from nodes array)
    const stateNodeMap = new Map<string, string>();
    for (const node of nodes) {
      if (node.type === 'STATE') {
        stateNodeMap.set(node.nodeId, node.commit);
      }
    }

    // Cache for graph connectivity validation results (same stateNodeId may be referenced by multiple saves)
    const connectivityCache = new Map<string, ServiceResult<void>>();

    // Cache for DB-fetched STATE node commits (same stateNodeId may be referenced by multiple saves)
    const dbStateNodeCache = new Map<string, string | null>();

    for (const save of saves) {
      let stateNodeCommit = stateNodeMap.get(save.stateNodeId);

      // If not found in nodes array, try to find in database
      if (!stateNodeCommit) {
        // Check cache first
        if (dbStateNodeCache.has(save.stateNodeId)) {
          stateNodeCommit = dbStateNodeCache.get(save.stateNodeId) ?? undefined;
        } else {
          // Query database for existing STATE node
          const dbStateNode = await this.ctx.select({
            commit: nodeVersions.commit,
            type: nodeVersions.type,
          })
            .from(nodeVersions)
            .where(eq(nodeVersions.nodeId, save.stateNodeId))
            .orderBy(desc(nodeVersions.authoredAt))
            .limit(1);

          if (dbStateNode.length > 0 && dbStateNode[0].type === 'STATE') {
            stateNodeCommit = dbStateNode[0].commit;
            dbStateNodeCache.set(save.stateNodeId, stateNodeCommit);
          } else {
            dbStateNodeCache.set(save.stateNodeId, null);
          }
        }
      }

      if (!stateNodeCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Save references state node ${save.stateNodeId} which is not in the graph and does not exist in the database`,
          },
        };
      }

      // Validate graph connectivity: state node → loader node → sandbox node (with caching)
      let validationResult = connectivityCache.get(save.stateNodeId);
      if (!validationResult) {
        validationResult = this.validateSaveGraphConnectivity(save.stateNodeId, nodes, edges);
        connectivityCache.set(save.stateNodeId, validationResult);
      }
      if (!validationResult.success) return validationResult;

      const result = await saveService.createSave({
        stateNodeId: save.stateNodeId,
        stateNodeCommit,
        commit: save.commit,
        parent: save.parent ?? null,
        authorId,
        sourceArtifactId: artifactId,
        sourceArtifactCommit: commitHash,
        contentHash: save.contentHash,
        title: save.title,
        description: save.description,
        isListed: save.isListed,
        // Skip validation since both artifact version and STATE node will be created in the same transaction
        skipValidation: true,
      });

      if (!result.success) {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Failed to create save: ${result.error.message}` },
        };
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Validate that state node is connected to sandbox through loader
   */
  private validateSaveGraphConnectivity(
    stateNodeId: string,
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[],
  ): ServiceResult<void> {
    // Find loader nodes connected to state node
    const stateNodeEdges = edges.filter(e => e.source === stateNodeId);
    const loaderNodeIds = new Set<string>();
    for (const e of stateNodeEdges) {
      const targetNode = nodes.find(n => n.nodeId === e.target);
      if (targetNode && targetNode.type === 'LOADER') {
        loaderNodeIds.add(e.target);
      }
    }

    if (loaderNodeIds.size === 0) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Save validation failed: state node ${stateNodeId} is not connected to any LOADER node`,
        },
      };
    }

    // Check loader nodes connect to sandbox
    let hasSandboxConnection = false;
    for (const loaderId of loaderNodeIds) {
      const loaderEdges = edges.filter(e => e.source === loaderId);
      for (const le of loaderEdges) {
        const targetNode = nodes.find(n => n.nodeId === le.target);
        if (targetNode && targetNode.type === 'SANDBOX') {
          hasSandboxConnection = true;
          break;
        }
      }
      if (hasSandboxConnection) break;
    }

    if (!hasSandboxConnection) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Save validation failed: state node ${stateNodeId} is not connected to a SANDBOX node through a LOADER node`,
        },
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Step 6: Validate entrypoint references
   * 
   * @param entrypoint - The entrypoint configuration
   * @param nodes - All nodes in the artifact
   * @param saves - All saves being created with this artifact
   */
  private validateEntrypoint(
    entrypoint: CreateArtifactMetadata['entrypoint'],
    nodes: CreateArtifactNode[],
    saves: CreateSaveInput[],
  ): ServiceResult<void> {
    if (!entrypoint) {
      return { success: true, data: undefined };
    }

    const { saveCommit, sandboxNodeId } = entrypoint;

    // Verify sandboxNodeId exists and is SANDBOX type
    const sandboxNode = nodes.find(n => n.nodeId === sandboxNodeId);
    if (!sandboxNode) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not in the graph` },
      };
    }
    if (sandboxNode.type !== 'SANDBOX') {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not a SANDBOX node (got ${sandboxNode.type})` },
      };
    }

    // Verify saveCommit is in the saves array
    const saveFound = saves.find(s => s.commit === saveCommit);
    if (!saveFound) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: `Entrypoint saveCommit ${saveCommit} is not found in the saves array` },
      };
    }

    // Verify the save references a STATE node in this artifact
    const stateNodeIds = new Set(nodes.filter(n => n.type === 'STATE').map(n => n.nodeId));
    if (!stateNodeIds.has(saveFound.stateNodeId)) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: `Entrypoint save references state node ${saveFound.stateNodeId} which is not in the graph` },
      };
    }

    return { success: true, data: undefined };
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
      this.ctx.modify(db => db.insert(artifactVersionNodes).values(versionNode));
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
      this.ctx.modify(db => db.insert(artifactVersionEdges).values(versionEdge));
    }
  }

  /**
   * Step 8: Process tags using TagService
   */
  private async processTags(
    artifactId: string,
    isUpdate: boolean,
    tagSlugs: string[],
    tagService: TagService,
    existingTagsMap: Map<string, TagInfo>,
  ): Promise<TagInfo[]> {
    if (tagSlugs.length === 0) {
      return [];
    }

    if (isUpdate) {
      const syncResult = await tagService.syncTags(artifactId, tagSlugs, existingTagsMap);
      return syncResult.processedTags;
    } else {
      const setResult = await tagService.setTags(artifactId, tagSlugs, existingTagsMap);
      return setResult.processedTags;
    }
  }

  /**
   * Step 9: Create stats record (only for new artifacts)
   */
  private createStatsRecord(artifactId: string): void {
    this.ctx.modify(db => db.insert(artifactStats).values({
      artifactId,
      viewCount: 0,
      favCount: 0,
      refCount: 0,
      downloadCount: 0,
    }));
  }

  /**
   * Step 10: Build artifact response with stats and timestamps
   */
  private async buildArtifactResponse(
    artifactId: string,
    isUpdate: boolean,
    metadata: CreateArtifactMetadata,
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null },
    processedTags: TagInfo[],
  ): Promise<ArtifactListItem> {
    let existingStats = { viewCount: 0, favCount: 0, refCount: 0, downloadCount: 0 };
    let existingCreatedAt = new Date().toISOString();

    if (isUpdate) {
      const statsResult = await this.ctx
        .select()
        .from(artifactStats)
        .where(eq(artifactStats.artifactId, artifactId))
        .limit(1);
      if (statsResult.length > 0) {
        existingStats = {
          viewCount: statsResult[0].viewCount,
          favCount: statsResult[0].favCount,
          refCount: statsResult[0].refCount,
          downloadCount: statsResult[0].downloadCount,
        };
      }

      const artifactResult = await this.ctx
        .select({ createdAt: artifacts.createdAt })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);
      if (artifactResult.length > 0) {
        existingCreatedAt = artifactResult[0].createdAt;
      }
    }

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
      // 检查 artifact 是否存在，同时获取 currentVersionId
      const [artifactRecord] = await this.ctx
        .select({ id: artifacts.id, currentVersionId: artifacts.currentVersionId })
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
      } else if (artifactRecord.currentVersionId) {
        const [currentVersion] = await this.ctx
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(eq(artifactVersions.id, artifactRecord.currentVersionId))
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

    // 递归获取更深层的父代（使用 currentVersionId 解析 commitHash）
    if (maxDepth > 1) {
      for (const parentId of parentArtifactIds) {
        if (visited.has(parentId)) continue;
        const [parentArtifact] = await this.ctx
          .select({ currentVersionId: artifacts.currentVersionId })
          .from(artifacts)
          .where(eq(artifacts.id, parentId))
          .limit(1);
        if (parentArtifact?.currentVersionId) {
          const [parentVersion] = await this.ctx
            .select({ commitHash: artifactVersions.commitHash })
            .from(artifactVersions)
            .where(eq(artifactVersions.id, parentArtifact.currentVersionId))
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

    // 递归获取更深层的子代（使用 currentVersionId 解析 commitHash）
    if (maxDepth > 1) {
      for (const childId of childArtifactIds) {
        if (visited.has(childId)) continue;
        const [childArtifact] = await this.ctx
          .select({ currentVersionId: artifacts.currentVersionId })
          .from(artifacts)
          .where(eq(artifacts.id, childId))
          .limit(1);
        if (childArtifact?.currentVersionId) {
          const [childVersion] = await this.ctx
            .select({ commitHash: artifactVersions.commitHash })
            .from(artifactVersions)
            .where(eq(artifactVersions.id, childArtifact.currentVersionId))
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

  /**
   * 更新 commitTags：设置指定 commit 上的标签列表（替换语义）
   * 如果某个 tag 已存在于同 artifact 的其他版本上，先从那个版本移除（override 语义）
   */
  async updateCommitTags(
    artifactId: string,
    authorId: string,
    commitHash: string,
    commitTags: string[],
  ): Promise<ServiceResult<{ version: ArtifactVersion }>> {
    try {
      // 检查 artifact 存在且用户有权限
      const existingArtifact = await this.ctx
        .select({ id: artifacts.id, authorId: artifacts.authorId })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (existingArtifact.length === 0) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }

      if (existingArtifact[0].authorId !== authorId) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' } };
      }

      // 查找目标版本
      const [targetVersion] = await this.ctx.select()
        .from(artifactVersions)
        .where(and(
          eq(artifactVersions.artifactId, artifactId),
          eq(artifactVersions.commitHash, commitHash),
        ))
        .limit(1);

      if (!targetVersion) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Version with commit ${commitHash} not found` } };
      }

      // 先删除该版本上已有的所有 tag
      this.ctx.modify(db =>
        db.delete(artifactCommitTags).where(
          eq(artifactCommitTags.commitHash, targetVersion.commitHash)
        )
      );

      // 如果设置了新 tags，先清除同 artifact 中使用相同 tag 的旧关联
      if (commitTags.length > 0) {
        const existingTags = await this.ctx.select({ id: artifactCommitTags.id })
          .from(artifactCommitTags)
          .where(and(
            eq(artifactCommitTags.artifactId, artifactId),
            inArray(artifactCommitTags.tag, commitTags),
          ));
        for (const ct of existingTags) {
          this.ctx.modify(db =>
            db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
          );
        }

        // 创建新的 tag 关联
        for (const tag of commitTags) {
          this.ctx.modify(db =>
            db.insert(artifactCommitTags).values({
              artifactId,
              commitHash: targetVersion.commitHash,
              tag,
            })
          );
        }
      }

      return {
        success: true,
        data: {
          version: {
            id: targetVersion.id,
            version: targetVersion.version ?? '',
            commitHash: targetVersion.commitHash,
            commitTags: commitTags,
            changelog: targetVersion.changelog,
            publishedAt: targetVersion.publishedAt,
            createdAt: targetVersion.createdAt,
          },
        },
      };
    } catch (error) {
      console.error('Update commit tags error:', error);
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
   * 基于已有 commit 和增量补丁创建新版本（PATCH 语义）
   * 
   * 两种模式：
   * 1. 有 graph 变更（addNodes/removeNodeIds/addEdges/removeEdges）+ commit：
   *    合并 graph，校验 commit hash，创建新 artifact version
   * 2. 仅 metadata 变更（无 graph 变更，无 commit）：
   *    直接更新 baseCommit 版本的 metadata（version, changelog, commitTags, entrypoint 等）
   *    和 artifact 的基本信息（name, description, visibility 等），不创建新版本
   */
  async patchArtifact(input: PatchArtifactInput): Promise<ServiceResult<PatchArtifactResult>> {
    const { authorId, metadata } = input;
    const artifactId = metadata.artifactId;

    try {
      // 检查 artifact 存在且用户有权限
      const existingArtifact = await this.ctx
        .select({ id: artifacts.id, authorId: artifacts.authorId, currentVersionId: artifacts.currentVersionId })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (existingArtifact.length === 0) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }

      if (existingArtifact[0].authorId !== authorId) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' } };
      }

      // 获取 baseCommit 对应的版本
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

      // 判断是否为 metadata-only 更新（无 graph 变更且无 commit）
      const hasGraphChanges = (metadata.addNodes && metadata.addNodes.length > 0)
        || (metadata.removeNodeIds && metadata.removeNodeIds.length > 0)
        || (metadata.addEdges && metadata.addEdges.length > 0)
        || (metadata.removeEdges && metadata.removeEdges.length > 0);

      if (!hasGraphChanges && !metadata.commit) {
        // metadata-only 更新：直接更新 baseVersion 和 artifact 信息
        return await this.patchArtifactMetadataOnly(artifactId, authorId, baseVersion, metadata);
      }

      // 有 graph 变更时，commit 是必须的
      if (!metadata.commit) {
        return { success: false, error: { code: 'BAD_REQUEST', message: 'commit is required when graph changes are provided' } };
      }

      const commit = metadata.commit;

      // 确定 parentCommit：当前最新版本的 commitHash（保持链状结构）
      let parentCommit: string | null = null;
      if (existingArtifact[0].currentVersionId) {
        const [currentVersion] = await this.ctx
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(eq(artifactVersions.id, existingArtifact[0].currentVersionId))
          .limit(1);
        if (currentVersion) {
          parentCommit = currentVersion.commitHash;
        }
      }

      // 获取 baseCommit 的完整节点列表
      const baseNodes = await this.ctx
        .select()
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, baseVersion.commitHash));

      // 获取 baseCommit 的完整边列表
      const baseEdges = await this.ctx
        .select()
        .from(artifactVersionEdges)
        .where(eq(artifactVersionEdges.commitHash, baseVersion.commitHash));

      // 应用节点补丁
      const removeNodeIds = new Set(metadata.removeNodeIds ?? []);
      const addNodesMap = new Map<string, CreateArtifactNode>();
      for (const node of metadata.addNodes ?? []) {
        addNodesMap.set(node.nodeId, node);
      }

      // 构建合并后的节点列表
      const mergedNodes: CreateArtifactNode[] = [];
      const nodeVersionService = new NodeVersionService(this.ctx);

      for (const bn of baseNodes) {
        if (removeNodeIds.has(bn.nodeId)) continue; // 被删除的节点

        if (addNodesMap.has(bn.nodeId)) {
          // 被更新的节点：使用 patch 中的新数据
          mergedNodes.push(addNodesMap.get(bn.nodeId)!);
          addNodesMap.delete(bn.nodeId);
        } else {
          // 保持不变的节点：从 base version 中获取完整数据
          const versionDetail = await nodeVersionService.getVersion(bn.nodeCommit);
          if (!versionDetail.success) {
            return { success: false, error: { code: 'INTERNAL_ERROR', message: `Failed to get node version: ${bn.nodeId}@${bn.nodeCommit}` } };
          }
          const v = versionDetail.data;
          mergedNodes.push({
            nodeId: bn.nodeId,
            commit: bn.nodeCommit,
            type: v.type as ArtifactNodeType,
            name: v.name ?? undefined,
            contentHash: v.contentHash,
            content: v.content!,
            position: bn.positionX != null && bn.positionY != null
              ? { x: bn.positionX, y: bn.positionY }
              : undefined,
          });
        }
      }

      // 添加新节点（不在 base 中的）
      for (const [, node] of addNodesMap) {
        mergedNodes.push(node);
      }

      // 应用边补丁
      const removeEdgeKeys = new Set(
        (metadata.removeEdges ?? []).map(e => `${e.source}:${e.target}`)
      );

      const mergedEdges: ArtifactEdgeDescriptor[] = [];
      for (const be of baseEdges) {
        const key = `${be.sourceNodeId}:${be.targetNodeId}`;
        if (removeEdgeKeys.has(key)) continue;
        mergedEdges.push({
          source: be.sourceNodeId,
          target: be.targetNodeId,
          sourceHandle: be.sourceHandle ?? undefined,
          targetHandle: be.targetHandle ?? undefined,
        });
      }
      for (const edge of metadata.addEdges ?? []) {
        mergedEdges.push(edge);
      }

      // 校验 commit hash
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

      // 获取当前 artifact 名称用作 fallback
      const currentArtifact = (await this.ctx.select({ name: artifacts.name }).from(artifacts).where(eq(artifacts.id, artifactId)).limit(1))[0];
      const currentName = currentArtifact?.name ?? '';

      // 获取当前发现控制作为 fallback
      const currentDiscoveryControl = await this.ctx
        .select({ isListed: resourceDiscoveryControl.isListed })
        .from(resourceDiscoveryControl)
        .where(
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifactId)
          )
        )
        .limit(1);
      const currentIsListed = currentDiscoveryControl[0]?.isListed ?? true;

      // 委托给 createArtifact 完成实际的版本创建（复用所有验证逻辑）
      const createResult = await this.createArtifact({
        authorId,
        metadata: {
          artifactId,
          commit: commit,
          parentCommit: parentCommit ?? undefined,
          name: metadata.name ?? currentName,
          description: metadata.description,
          isListed: metadata.isListed ?? currentIsListed,
          version: metadata.version,
          changelog: metadata.changelog,
          commitTags: metadata.commitTags,
          entrypoint: metadata.entrypoint,
        },
        nodes: mergedNodes,
        edges: mergedEdges,
        saves: input.saves,
      });
      if (!createResult.success) return createResult;
      return { success: true, data: { ...createResult.data, versionCreated: true } };
    } catch (error) {
      console.error('Patch artifact error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * Metadata-only 更新：直接更新 baseVersion 的元数据和 artifact 基本信息，不创建新版本
   */
  private async patchArtifactMetadataOnly(
    artifactId: string,
    authorId: string,
    baseVersion: DbArtifactVersion,
    metadata: PatchArtifactInput['metadata'],
  ): Promise<ServiceResult<PatchArtifactResult>> {
    try {
      // 更新 artifact 基本信息（仅更新提供了的字段）
      const artifactUpdate: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (metadata.name !== undefined) artifactUpdate.name = metadata.name;
      if (metadata.description !== undefined) artifactUpdate.description = metadata.description;

      this.ctx.modify(db =>
        db.update(artifacts).set(artifactUpdate).where(eq(artifacts.id, artifactId))
      );

      // 更新发现控制（如果提供了）
      if (metadata.isListed !== undefined) {
        this.ctx.modify(db =>
          db.update(resourceDiscoveryControl).set({ isListed: metadata.isListed }).where(
            and(
              eq(resourceDiscoveryControl.resourceType, 'artifact'),
              eq(resourceDiscoveryControl.resourceId, artifactId)
            )
          )
        );
      }

      // 更新版本元数据（仅更新提供了的字段）
      const versionUpdate: Record<string, unknown> = {};
      if (metadata.version !== undefined) versionUpdate.version = metadata.version;
      if (metadata.changelog !== undefined) versionUpdate.changelog = metadata.changelog;
      if (metadata.entrypoint !== undefined) {
        // 验证 entrypoint
        const { saveCommit, sandboxNodeId } = metadata.entrypoint;

        // 获取当前版本的节点
        const versionNodes = await this.ctx.select({ nodeId: artifactVersionNodes.nodeId, nodeCommit: artifactVersionNodes.nodeCommit })
          .from(artifactVersionNodes)
          .where(eq(artifactVersionNodes.commitHash, baseVersion.commitHash));

        // 获取当前版本中的 STATE 节点 ID 集合
        const stateNodeIds = new Set<string>();
        const nodeVersionService = new NodeVersionService(this.ctx);
        let sandboxFound = false;

        for (const vn of versionNodes) {
          const versionDetail = await nodeVersionService.getVersion(vn.nodeCommit);
          if (!versionDetail.success) continue;

          const v = versionDetail.data;
          if (v.type === 'SANDBOX' && vn.nodeId === sandboxNodeId) {
            sandboxFound = true;
          }
          if (v.type === 'STATE') {
            stateNodeIds.add(vn.nodeId);
          }
        }

        if (!sandboxFound) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not a SANDBOX node in the current version` },
          };
        }

        // 验证 saveCommit 是否引用了当前版本中的某个 STATE 节点
        // 查询 save_contents 表获取该 saveCommit 对应的 stateNodeId
        const saveContentResult = await this.ctx.select({ stateNodeId: saveContents.stateNodeId })
          .from(saveContents)
          .innerJoin(nodeVersions, eq(nodeVersions.contentHash, saveContents.contentHash))
          .where(eq(nodeVersions.commit, saveCommit))
          .limit(1);

        if (saveContentResult.length === 0) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint saveCommit ${saveCommit} is not found` },
          };
        }

        const saveStateNodeId = saveContentResult[0].stateNodeId;
        if (!stateNodeIds.has(saveStateNodeId)) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint saveCommit ${saveCommit} references state node ${saveStateNodeId} which is not in the current artifact version` },
          };
        }

        versionUpdate.entrypoint = metadata.entrypoint;
      }

      if (Object.keys(versionUpdate).length > 0) {
        this.ctx.modify(db =>
          db.update(artifactVersions).set(versionUpdate).where(eq(artifactVersions.id, baseVersion.id))
        );
      }

      // 处理 commitTags
      if (metadata.commitTags !== undefined) {
        // 先删除该版本上已有的所有 tag
        this.ctx.modify(db =>
          db.delete(artifactCommitTags).where(
            eq(artifactCommitTags.commitHash, baseVersion.commitHash)
          )
        );

        if (metadata.commitTags.length > 0) {
          // 清除同 artifact 中使用相同 tag 的旧关联
          const existingTags = await this.ctx.select({ id: artifactCommitTags.id })
            .from(artifactCommitTags)
            .where(and(
              eq(artifactCommitTags.artifactId, artifactId),
              inArray(artifactCommitTags.tag, metadata.commitTags),
            ));
          for (const ct of existingTags) {
            this.ctx.modify(db =>
              db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
            );
          }

          // 创建新的 tag 关联
          for (const tag of metadata.commitTags) {
            this.ctx.modify(db =>
              db.insert(artifactCommitTags).values({
                artifactId,
                commitHash: baseVersion.commitHash,
                tag,
              })
            );
          }
        }
      }

      // 获取更新后的信息用于返回
      const authorResult = await this.ctx.select({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        })
        .from(user)
        .where(eq(user.id, authorId))
        .limit(1);

      const updatedArtifact = await this.ctx.select()
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      // 获取发现控制
      const discoveryControlResult = await this.ctx.select({ isListed: resourceDiscoveryControl.isListed })
        .from(resourceDiscoveryControl)
        .where(
          and(
            eq(resourceDiscoveryControl.resourceType, 'artifact'),
            eq(resourceDiscoveryControl.resourceId, artifactId)
          )
        )
        .limit(1);

      // 获取 tags
      const tagResults = await this.ctx.select({
          tag: {
            slug: tags.slug,
            name: tags.name,
            description: tags.description,
            color: tags.color,
          },
        })
        .from(artifactTags)
        .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
        .where(eq(artifactTags.artifactId, artifactId));

      const artifact: ArtifactListItem = {
        id: artifactId,
        name: updatedArtifact[0].name,
        description: updatedArtifact[0].description,
        isListed: discoveryControlResult[0]?.isListed ?? true,
        thumbnailUrl: updatedArtifact[0].thumbnailUrl,
        license: updatedArtifact[0].license,
        createdAt: updatedArtifact[0].createdAt,
        updatedAt: updatedArtifact[0].updatedAt,
        author: authorResult[0],
        tags: tagResults.map(r => r.tag),
      };

      return { success: true, data: { artifact, versionCreated: false } };
    } catch (error) {
      console.error('Patch artifact metadata-only error:', error);
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    }
  }

  /**
   * 将一个 artifact 版本标记为 weak（不可逆操作）。
   * weak 版本不对 node 产生引用计数。
   * 标记为 weak 时：decrement 关联 node 内容的 refCount，GC refCount=0 的内容。
   */
  async markVersionWeak(
    artifactId: string,
    authorId: string,
    commitHash: string,
  ): Promise<ServiceResult<{ gcResult: { processedCount: number } }>> {
    try {
      // 检查 artifact 存在且用户有权限
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

      // 查找目标版本
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

      // weak 标记是不可逆的，已经是 weak 的版本不能再次标记
      if (targetVersion.isWeak) {
        return { success: false, error: { code: 'BAD_REQUEST', message: 'Version is already marked as weak. This operation is irreversible.' } };
      }

      // 更新 isWeak 标记
      this.ctx.modify(db =>
        db.update(artifactVersions)
          .set({ isWeak: true })
          .where(eq(artifactVersions.id, targetVersion.id))
      );

      // 获取该版本关联的所有 node 版本
      const versionNodes = await this.ctx.select({
          nodeId: artifactVersionNodes.nodeId,
          nodeCommit: artifactVersionNodes.nodeCommit,
        })
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, targetVersion.commitHash));

      // 获取每个 node 的 type 和 contentHash，并收集 decrementContentRefCount 操作
      const nodeVersionService = new NodeVersionService(this.ctx);
      let processedCount = 0;

      for (const vn of versionNodes) {
        const [nv] = await this.ctx.select({ type: nodeVersions.type, contentHash: nodeVersions.contentHash })
          .from(nodeVersions)
          .where(eq(nodeVersions.commit, vn.nodeCommit))
          .limit(1);

        if (!nv) continue;

        // This collects the decrement operation into BatchContext
        nodeVersionService.decrementContentRefCount(nv.type, nv.contentHash);
        processedCount++;
      }

      return {
        success: true,
        data: { gcResult: { processedCount } },
      };
    } catch (error) {
      console.error('Mark version weak error:', error);
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
            type: v.type as ArtifactNodeType,
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
  saves?: CreateSaveInput[];
};

// 谱系查询参数
export interface GetLineageParams {
  commit?: string;      // 指定版本的 commit hash，不传则使用 currentVersionId
  parentDepth?: number; // 向上追溯父代的深度，undefined 表示无限递归
  childDepth?: number;  // 向下追溯子代的深度，undefined 表示无限递归
}
