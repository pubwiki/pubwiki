import { eq, and, or, inArray, notInArray, asc, desc, sql, count, isNotNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../client';
import { artifacts, tags, artifactTags, artifactVersions, artifactCommitTags, type Artifact, type Tag, type ArtifactVersion, type NewArtifact, type NewArtifactVersion } from '../schema/artifacts';
import { artifactVersionNodes, artifactVersionEdges, type NewArtifactVersionNode, type NewArtifactVersionEdge } from '../schema/artifact-version-graph';
import { nodeVersions, type NewNodeVersion } from '../schema/node-versions';
import { ARTIFACT_NODE_TYPES } from '../schema/enums';
import type { ArtifactNodeType } from '../schema/enums';
import { NodeVersionService, type SyncNodeVersionInput } from './node-version';
import { SaveService } from './save';
import { artifactStats, type ArtifactStats } from '../schema/stats';
import { user, type User } from '../schema/auth';
import { chunkArray } from '../utils';
import type { ServiceError, ServiceResult } from './user';
import type {
  ArtifactListItem,
  Pagination as PaginationInfo,
  ArtifactVersion as ArtifactVersionType,
  VisibilityType,
  CreateArtifactMetadata,
  ArtifactEdgeDescriptor,
  ArtifactNodeContent,
} from '@pubwiki/api';
import { computeArtifactCommit } from '@pubwiki/api';

// 谱系项（基于 derivativeOf 跳表计算，不再使用独立的 lineage 表）
export interface ArtifactLineageItem {
  artifactId: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  thumbnailUrl: string | null;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

// 重新导出供其他模块使用
export type { ArtifactListItem, PaginationInfo };

// 列表查询参数
export interface ListArtifactsParams {
  page?: number;
  limit?: number;
  tagInclude?: string[];  // tag slugs
  tagExclude?: string[];  // tag slugs
  sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'starCount';
  sortOrder?: 'asc' | 'desc';
}

// 列表响应
export interface ListArtifactsResult {
  artifacts: ArtifactListItem[];
  pagination: PaginationInfo;
}

// 完整的节点版本数据（非 STATE 节点包含完整内容，STATE 节点仅含 save 引用列表）
export interface CreateArtifactNode {
  nodeId: string;
  commit: string;
  parent?: string | null;
  type: ArtifactNodeType;
  name?: string;
  contentHash: string;
  content: ArtifactNodeContent;
  message?: string;
  tag?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  position?: { x: number; y: number };
  refs?: Array<{
    targetNodeId: string;
    targetCommit: string;
    refType: string;
  }>;
}

// 创建 Save 的输入（随 artifact 一起提交）
export interface CreateSaveInput {
  stateNodeId: string;     // 关联的 STATE 节点 ID
  commit: string;          // save 版本 commit hash
  contentHash: string;     // 内容指纹
  parent?: string | null;  // 父版本 commit hash
  title?: string;
  description?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
}

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
  constructor(private db: Database) {}

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

  // 创建或更新 artifact（使用 batch 保证原子性）
  // 通过检查 metadata.artifactId 是否存在于数据库中决定是创建还是更新
  // 前置条件：所有 nodes 中引用的 (nodeId, commit) 必须已通过 POST /nodes/:nodeId/sync 同步
  async createArtifact(input: CreateArtifactInput): Promise<ServiceResult<CreateArtifactResult>> {
    const { authorId, metadata, nodes, edges } = input;
    const artifactId = metadata.artifactId;

    try {
      // 先检查 artifactId 是否已存在于数据库中，决定是创建还是更新
      const existingArtifact = await this.db
        .select({ id: artifacts.id, authorId: artifacts.authorId, currentVersionId: artifacts.currentVersionId })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      const isUpdate = existingArtifact.length > 0;

      if (isUpdate) {
        // 更新模式：验证 owner 是当前用户
        if (existingArtifact[0].authorId !== authorId) {
          return {
            success: false,
            error: { code: 'FORBIDDEN', message: 'You do not have permission to update this artifact' },
          };
        }
      }

      // 确定 parentCommit：更新时为当前版本的 commitHash，创建时为 null
      let parentCommit: string | null = null;
      if (isUpdate && existingArtifact[0].currentVersionId) {
        const currentVersion = await this.db
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(eq(artifactVersions.id, existingArtifact[0].currentVersionId))
          .limit(1);
        if (currentVersion.length > 0) {
          parentCommit = currentVersion[0].commitHash;
        }
      }

      // 校验客户端传入的 commit hash（包含 artifactId 和 parentCommit 形成链状结构）
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

      // 获取作者信息（batch 前检查）
      const authorResult = await this.db
        .select({
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        })
        .from(user)
        .where(eq(user.id, authorId))
        .limit(1);

      if (authorResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      // 注意：节点类型验证已在 API 层完成，此处不再重复验证

      // 预先获取已存在的 tags
      const existingTagsMap = new Map<string, { id: string; name: string; slug: string; description: string | null; color: string | null }>();
      if (metadata.tags && metadata.tags.length > 0) {
        const existingTags = await this.db
          .select()
          .from(tags)
          .where(inArray(tags.slug, metadata.tags));
        
        for (const tag of existingTags) {
          existingTagsMap.set(tag.slug, {
            id: tag.id,
            name: tag.name,
            slug: tag.slug,
            description: tag.description,
            color: tag.color,
          });
        }
      }

      // 如果是更新操作，获取旧的 tags 用于后续减少使用计数
      const oldTagIds: string[] = [];
      if (isUpdate) {
        const oldTags = await this.db
          .select({ tagId: artifactTags.tagId })
          .from(artifactTags)
          .where(eq(artifactTags.artifactId, metadata.artifactId!));
        oldTagIds.push(...oldTags.map(t => t.tagId));
      }

      // 使用用户传入的 artifactId
      const versionId = crypto.randomUUID();

      // 收集所有批量操作的语句
      const batchOperations: BatchItem<"sqlite">[] = [];
      const processedTags: { id: string; name: string; slug: string; description: string | null; color: string | null }[] = [];
      const timestamp = Date.now();

      // 更新模式下，追加新版本（不删除旧版本）
      if (isUpdate) {
        // 检查 commitHash 是否重复（利用已有的 unique index）
        const existingVersion = await this.db
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

        // 增量更新 tags：计算新旧差异
        const currentTagIds = new Set(oldTagIds);
        const newTagSlugs = new Set(metadata.tags ?? []);
        
        // 获取当前 tags 的 slug → id 映射
        const currentTagSlugs = new Set<string>();
        if (oldTagIds.length > 0) {
          const currentTags = await this.db
            .select({ id: tags.id, slug: tags.slug })
            .from(tags)
            .where(inArray(tags.id, oldTagIds));
          for (const t of currentTags) {
            currentTagSlugs.add(t.slug);
          }
        }

        // 需要移除的 tags（在旧列表中但不在新列表中）
        const tagsToRemove = [...currentTagSlugs].filter(s => !newTagSlugs.has(s));
        // 需要添加的 tags（在新列表中但不在旧列表中）
        const tagsToAdd = [...newTagSlugs].filter(s => !currentTagSlugs.has(s));

        // 移除不再使用的 tags
        if (tagsToRemove.length > 0) {
          const tagsToRemoveRecords = await this.db
            .select({ id: tags.id })
            .from(tags)
            .where(inArray(tags.slug, tagsToRemove));
          for (const t of tagsToRemoveRecords) {
            batchOperations.push(
              this.db.delete(artifactTags).where(
                and(eq(artifactTags.artifactId, artifactId), eq(artifactTags.tagId, t.id))
              )
            );
            batchOperations.push(
              this.db.update(tags).set({ usageCount: sql`MAX(0, ${tags.usageCount} - 1)` }).where(eq(tags.id, t.id))
            );
          }
        }

        // 添加新 tags（逻辑在下面的 tags 处理中统一完成，这里只处理移除）
        // 将 tagsToAdd 作为需要处理的 tags
        if (metadata.tags) {
          metadata.tags = [...tagsToAdd];
        }
        
        // 更新 artifact 基本信息
        batchOperations.push(
          this.db.update(artifacts).set({
            name: metadata.name,
            description: metadata.description ?? null,
            visibility: metadata.visibility ?? 'PUBLIC',
            currentVersionId: versionId,
            thumbnailUrl: metadata.thumbnailUrl ?? null,
            license: metadata.license ?? null,
            repositoryUrl: metadata.repositoryUrl ?? null,
            updatedAt: new Date().toISOString(),
          }).where(eq(artifacts.id, artifactId))
        );
      } else {
        // 创建 artifact
        const newArtifact: NewArtifact = {
          id: artifactId,
          authorId,
          name: metadata.name,
          description: metadata.description ?? null,
          visibility: metadata.visibility ?? 'PUBLIC',
          currentVersionId: versionId,
          thumbnailUrl: metadata.thumbnailUrl ?? null,
          license: metadata.license ?? null,
          repositoryUrl: metadata.repositoryUrl ?? null,
          isArchived: false,
        };
        batchOperations.push(this.db.insert(artifacts).values(newArtifact));
      }

      // 创建版本
      const newVersion: NewArtifactVersion = {
        id: versionId,
        artifactId,
        version: metadata.version ?? null,
        commitHash: metadata.commit,
        changelog: metadata.changelog ?? null,
        publishedAt: new Date().toISOString(),
        entrypoint: metadata.entrypoint ?? null,
      };

      // 处理 commitTags：先清除同 artifact 中使用相同 tag 的旧关联，再创建新关联
      const commitTags = metadata.commitTags ?? [];
      if (commitTags.length > 0) {
        // 查找已存在的同名 tag（可能指向其他版本），删除旧关联
        const existingCommitTags = await this.db
          .select({ id: artifactCommitTags.id })
          .from(artifactCommitTags)
          .where(and(
            eq(artifactCommitTags.artifactId, artifactId),
            inArray(artifactCommitTags.tag, commitTags)
          ));
        for (const ct of existingCommitTags) {
          batchOperations.push(
            this.db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
          );
        }
      }

      batchOperations.push(this.db.insert(artifactVersions).values(newVersion));

      // 创建新的 commitTag 关联
      for (const tag of commitTags) {
        batchOperations.push(
          this.db.insert(artifactCommitTags).values({
            artifactId,
            commitHash: metadata.commit,
            tag,
          })
        );
      }

      // 校验所有 node type ∈ ARTIFACT_NODE_TYPES（拒绝 SAVE）
      for (const node of nodes) {
        if (!(ARTIFACT_NODE_TYPES as readonly string[]).includes(node.type)) {
          return {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid node type: ${node.type}. Must be one of: ${ARTIFACT_NODE_TYPES.join(', ')}`,
            },
          };
        }
      }

      // 同步非 STATE 类型的 node versions
      const nonStateNodes = nodes.filter(n => n.type !== 'STATE');
      if (nonStateNodes.length > 0) {
        const nodeVersionService = new NodeVersionService(this.db);
        const syncInputs: SyncNodeVersionInput[] = nonStateNodes.map(n => ({
          nodeId: n.nodeId,
          commit: n.commit,
          parent: n.parent ?? null,
          authorId: authorId,
          type: n.type,
          name: n.name,
          contentHash: n.contentHash,
          content: n.content,
          message: n.message,
          tag: n.tag,
          visibility: n.visibility,
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
      }

      // 创建随 artifact 一起提交的 saves（在 STATE node 验证之前）
      const saves = input.saves ?? [];
      if (saves.length > 0) {
        const saveService = new SaveService(this.db);
        // 为每个 save 查找对应的 state node commit
        const stateNodeMap = new Map<string, string>(); // stateNodeId → stateNodeCommit
        for (const node of nodes) {
          if (node.type === 'STATE') {
            stateNodeMap.set(node.nodeId, node.commit);
          }
        }

        for (const save of saves) {
          const stateNodeCommit = stateNodeMap.get(save.stateNodeId);
          if (!stateNodeCommit) {
            return {
              success: false,
              error: {
                code: 'BAD_REQUEST',
                message: `Save references state node ${save.stateNodeId} which is not in the graph`,
              },
            };
          }

          // 校验 save 对应的 state node 和 sandbox node 通过 loader node 相连
          // 即在图中存在路径: state node → loader node → sandbox node
          const stateNodeEdges = edges.filter(e => e.source === save.stateNodeId);
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
                message: `Save validation failed: state node ${save.stateNodeId} is not connected to any LOADER node`,
              },
            };
          }

          // 检查 loader 节点连接到 sandbox 节点
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
                message: `Save validation failed: state node ${save.stateNodeId} is not connected to a SANDBOX node through a LOADER node`,
              },
            };
          }

          const result = await saveService.createSave({
            stateNodeId: save.stateNodeId,
            stateNodeCommit,
            commit: save.commit,
            parent: save.parent ?? null,
            authorId,
            sourceArtifactId: artifactId,
            sourceArtifactCommit: metadata.commit,
            contentHash: save.contentHash,
            title: save.title,
            description: save.description,
            visibility: save.visibility,
          });

          if (!result.success) {
            return {
              success: false,
              error: { code: 'BAD_REQUEST', message: `Failed to create save: ${result.error.message}` },
            };
          }
        }
      }

      // STATE 类型的 node：验证引用的 SAVE commit 存在且权限合法，然后同步 STATE node 版本
      const stateNodes = nodes.filter(n => n.type === 'STATE');
      if (stateNodes.length > 0) {
        // 验证每个 STATE node 的 saves 引用
        for (const stateNode of stateNodes) {
          const saves = (stateNode.content as { saves?: string[] })?.saves;
          if (saves && saves.length > 0) {
            // 查询所有引用的 save 版本
            const saveVersions = await this.db
              .select({
                nodeId: nodeVersions.nodeId,
                commit: nodeVersions.commit,
                type: nodeVersions.type,
                authorId: nodeVersions.authorId,
                visibility: nodeVersions.visibility,
              })
              .from(nodeVersions)
              .where(inArray(nodeVersions.commit, saves));

            // 检查每个 save commit 是否存在
            const foundCommits = new Set(saveVersions.map(v => v.commit));
            const missingCommits = saves.filter(c => !foundCommits.has(c));
            if (missingCommits.length > 0) {
              return {
                success: false,
                error: {
                  code: 'BAD_REQUEST',
                  message: `STATE node ${stateNode.nodeId}: referenced SAVE commits not found: ${missingCommits.join(', ')}`,
                },
              };
            }

            // 验证引用的都是 SAVE 类型
            const nonSaveVersions = saveVersions.filter(v => v.type !== 'SAVE');
            if (nonSaveVersions.length > 0) {
              return {
                success: false,
                error: {
                  code: 'BAD_REQUEST',
                  message: `STATE node ${stateNode.nodeId}: referenced commits are not SAVE type: ${nonSaveVersions.map(v => v.commit).join(', ')}`,
                },
              };
            }

            // 权限检查：save 必须是当前用户创建的，或 visibility 为 PUBLIC/UNLISTED
            const inaccessibleSaves = saveVersions.filter(v =>
              v.authorId !== authorId && v.visibility === 'PRIVATE'
            );
            if (inaccessibleSaves.length > 0) {
              return {
                success: false,
                error: {
                  code: 'FORBIDDEN',
                  message: `STATE node ${stateNode.nodeId}: no permission to reference private SAVE commits: ${inaccessibleSaves.map(v => v.commit).join(', ')}`,
                },
              };
            }
          }
        }

        const nodeVersionService = new NodeVersionService(this.db);
        const stateInputs: SyncNodeVersionInput[] = stateNodes.map(n => ({
          nodeId: n.nodeId,
          commit: n.commit,
          parent: n.parent ?? null,
          authorId: authorId,
          type: n.type,
          name: n.name,
          contentHash: n.contentHash,
          content: n.content,
          message: n.message,
          tag: n.tag,
          visibility: n.visibility,
          sourceArtifactId: artifactId,
          refs: n.refs as SyncNodeVersionInput['refs'],
        }));

        const syncResult = await nodeVersionService.syncVersions(stateInputs);
        if (!syncResult.success) {
          return {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: `Failed to sync state nodes: ${syncResult.error.message}` },
          };
        }
      }

      // 验证 entrypoint 的 saveCommit 在对应 STATE node 的 saves 列表内
      if (metadata.entrypoint) {
        const { saveCommit, sandboxNodeId } = metadata.entrypoint;

        // 验证 sandboxNodeId 在图中且类型为 SANDBOX
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

        // 验证 saveCommit 存在于某个 STATE node 的 saves 列表中
        let saveCommitFound = false;
        for (const node of nodes) {
          if (node.type === 'STATE') {
            const stateSaves = (node.content as { saves?: string[] })?.saves;
            if (stateSaves && stateSaves.includes(saveCommit)) {
              saveCommitFound = true;
              break;
            }
          }
        }
        if (!saveCommitFound) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint saveCommit ${saveCommit} is not found in any STATE node's saves list` },
          };
        }
      }

      // 添加所有节点到 artifact_version_nodes
      for (const node of nodes) {
        const versionNode: NewArtifactVersionNode = {
          commitHash: metadata.commit,
          nodeId: node.nodeId,
          nodeCommit: node.commit,
          positionX: node.position?.x ?? null,
          positionY: node.position?.y ?? null,
        };
        batchOperations.push(this.db.insert(artifactVersionNodes).values(versionNode));
      }

      // 存储边到 artifact_version_edges 表
      for (const edge of edges) {
        const versionEdge: NewArtifactVersionEdge = {
          commitHash: metadata.commit,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        };
        batchOperations.push(this.db.insert(artifactVersionEdges).values(versionEdge));
      }

      // 处理 tags
      if (metadata.tags && metadata.tags.length > 0) {
        for (const tagSlug of metadata.tags) {
          const existingTag = existingTagsMap.get(tagSlug);

          if (!existingTag) {
            // 创建新 tag
            const newTagId = crypto.randomUUID();
            batchOperations.push(this.db.insert(tags).values({
              id: newTagId,
              name: tagSlug,
              slug: tagSlug,
              usageCount: 1,
            }));
            processedTags.push({ id: newTagId, name: tagSlug, slug: tagSlug, description: null, color: null });
            
            // 创建关联
            batchOperations.push(this.db.insert(artifactTags).values({
              artifactId,
              tagId: newTagId,
            }));
          } else {
            // 更新 tag 使用次数
            batchOperations.push(
              this.db
                .update(tags)
                .set({ usageCount: sql`${tags.usageCount} + 1` })
                .where(eq(tags.id, existingTag.id))
            );
            
            processedTags.push(existingTag);

            // 创建关联
            batchOperations.push(this.db.insert(artifactTags).values({
              artifactId,
              tagId: existingTag.id,
            }));
          }
        }
      }

      // 创建 stats 记录（仅在创建新 artifact 时）
      if (!isUpdate) {
        batchOperations.push(this.db.insert(artifactStats).values({
          artifactId,
          viewCount: 0,
          starCount: 0,
          forkCount: 0,
          downloadCount: 0,
        }));
      }

      // 使用 batch 执行所有操作（D1 的 batch 是事务性的）
      await this.db.batch(batchOperations as any);

      // 对于更新操作，获取现有的 stats 和 createdAt
      let existingStats = { viewCount: 0, starCount: 0, forkCount: 0, downloadCount: 0 };
      let existingCreatedAt = new Date().toISOString();
      if (isUpdate) {
        const statsResult = await this.db
          .select()
          .from(artifactStats)
          .where(eq(artifactStats.artifactId, artifactId))
          .limit(1);
        if (statsResult.length > 0) {
          existingStats = {
            viewCount: statsResult[0].viewCount,
            starCount: statsResult[0].starCount,
            forkCount: statsResult[0].forkCount,
            downloadCount: statsResult[0].downloadCount,
          };
        }
        
        const artifactResult = await this.db
          .select({ createdAt: artifacts.createdAt })
          .from(artifacts)
          .where(eq(artifacts.id, artifactId))
          .limit(1);
        if (artifactResult.length > 0) {
          existingCreatedAt = artifactResult[0].createdAt;
        }
      }

      // 返回创建/更新的 artifact
      const artifact: ArtifactListItem = {
        id: artifactId,
        name: metadata.name,
        description: metadata.description ?? null,
        visibility: metadata.visibility ?? 'PUBLIC',
        thumbnailUrl: metadata.thumbnailUrl ?? null,
        license: metadata.license ?? null,
        isArchived: false,
        createdAt: existingCreatedAt,
        updatedAt: new Date().toISOString(),
        author: authorResult[0],
        tags: processedTags,
        stats: existingStats,
      };

      return {
        success: true,
        data: {
          artifact,
        },
      };
    } catch (error) {
      console.error('Create artifact error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 获取公开 artifact 列表
  async listPublicArtifacts(params: ListArtifactsParams = {}): Promise<ServiceResult<ListArtifactsResult>> {
    const {
      page = 1,
      limit = 20,
      tagInclude,
      tagExclude,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建基础条件：只查询公开且未归档的 artifacts
      const baseConditions = [
        eq(artifacts.visibility, 'PUBLIC'),
        eq(artifacts.isArchived, false),
      ];

      // 标签过滤 - 需要子查询
      let artifactIdsFromTagInclude: string[] | null = null;
      let artifactIdsFromTagExclude: string[] | null = null;

      if (tagInclude && tagInclude.length > 0) {
        // 获取包含所有指定标签的 artifact IDs (AND 逻辑)
        const tagResults = await this.db
          .select({ artifactId: artifactTags.artifactId })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
          .where(inArray(tags.slug, tagInclude))
          .groupBy(artifactTags.artifactId)
          .having(sql`count(distinct ${tags.slug}) = ${tagInclude.length}`);

        artifactIdsFromTagInclude = tagResults.map(r => r.artifactId);
        
        // 如果没有匹配的 artifact，直接返回空结果
        if (artifactIdsFromTagInclude.length === 0) {
          return {
            success: true,
            data: {
              artifacts: [],
              pagination: {
                page: validPage,
                limit: validLimit,
                total: 0,
                totalPages: 0,
              },
            },
          };
        }
      }

      if (tagExclude && tagExclude.length > 0) {
        // 获取包含任意排除标签的 artifact IDs
        const excludeResults = await this.db
          .select({ artifactId: artifactTags.artifactId })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
          .where(inArray(tags.slug, tagExclude));

        artifactIdsFromTagExclude = [...new Set(excludeResults.map(r => r.artifactId))];
      }

      // 添加标签过滤条件
      if (artifactIdsFromTagInclude !== null) {
        baseConditions.push(inArray(artifacts.id, artifactIdsFromTagInclude));
      }
      if (artifactIdsFromTagExclude !== null && artifactIdsFromTagExclude.length > 0) {
        baseConditions.push(notInArray(artifacts.id, artifactIdsFromTagExclude));
      }

      // 计算总数
      const [countResult] = await this.db
        .select({ total: count() })
        .from(artifacts)
        .where(and(...baseConditions));

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序
      let orderClause;
      if (sortBy === 'viewCount' || sortBy === 'starCount') {
        // 需要 join stats 表进行排序
        const statsColumn = sortBy === 'viewCount' ? artifactStats.viewCount : artifactStats.starCount;
        orderClause = sortOrder === 'asc' ? asc(statsColumn) : desc(statsColumn);
      } else {
        const artifactColumn = sortBy === 'updatedAt' ? artifacts.updatedAt : artifacts.createdAt;
        orderClause = sortOrder === 'asc' ? asc(artifactColumn) : desc(artifactColumn);
      }

      // 查询 artifacts（带 author 和 stats）
      const artifactsQuery = this.db
        .select({
          artifact: artifacts,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.name,
            avatarUrl: user.image,
          },
          stats: artifactStats,
        })
        .from(artifacts)
        .innerJoin(user, eq(artifacts.authorId, user.id))
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
        const tagResults = await this.db
          .select({
            artifactId: artifactTags.artifactId,
            tag: {
              id: tags.id,
              name: tags.name,
              slug: tags.slug,
              description: tags.description,
              color: tags.color,
            },
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
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
        visibility: r.artifact.visibility,
        thumbnailUrl: r.artifact.thumbnailUrl,
        license: r.artifact.license,
        isArchived: r.artifact.isArchived,
        createdAt: r.artifact.createdAt,
        updatedAt: r.artifact.updatedAt,
        author: r.author,
        tags: tagsMap.get(r.artifact.id) || [],
        stats: r.stats ? {
          viewCount: r.stats.viewCount,
          starCount: r.stats.starCount,
          forkCount: r.stats.forkCount,
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
      const result = await this.db
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
      const [artifactRecord] = await this.db
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
        const [matchedVersion] = await this.db
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
        const [currentVersion] = await this.db
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

    // 查询当前 artifact 版本中所有节点的 derivativeOf，找到不同 sourceArtifactId
    const nvCurrent = this.db.$with('nv_current').as(
      this.db
        .select({
          nodeId: artifactVersionNodes.nodeId,
          nodeCommit: artifactVersionNodes.nodeCommit,
        })
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, versionCommitHash))
    );

    // 找到直接父 artifact IDs
    const parentIds = await this.db
      .with(nvCurrent)
      .selectDistinct({ sourceArtifactId: nodeVersions.sourceArtifactId })
      .from(nvCurrent)
      .innerJoin(
        nodeVersions,
        eq(nodeVersions.commit, nvCurrent.nodeCommit)
      )
      .where(
        and(
          isNotNull(nodeVersions.derivativeOf),
          sql`${nodeVersions.sourceArtifactId} != ${artifactId}`
        )
      );

    // 实际上 derivativeOf 指向的是另一个 commit，那个 commit 的 sourceArtifactId 才是父 artifact。
    // 但当前 node 的 sourceArtifactId 就是自己（因为是在 createArtifact 中传入的）。
    // 我们需要查 derivativeOf 指向的版本的 sourceArtifactId。

    // 重写：通过 join 获取 derivativeOf 目标版本的 sourceArtifactId
    const parentArtifactRows = await this.db
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

    const parentArtifactIds = parentArtifactRows.map(r => r.sourceArtifactId);
    if (parentArtifactIds.length === 0) return [];

    // 获取 artifact 详细信息
    const results = await this.fetchArtifactLineageDetails(parentArtifactIds);

    // 递归获取更深层的父代（使用 currentVersionId 解析 commitHash）
    if (maxDepth > 1) {
      for (const parentId of parentArtifactIds) {
        if (visited.has(parentId)) continue;
        const [parentArtifact] = await this.db
          .select({ currentVersionId: artifacts.currentVersionId })
          .from(artifacts)
          .where(eq(artifacts.id, parentId))
          .limit(1);
        if (parentArtifact?.currentVersionId) {
          const [parentVersion] = await this.db
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
    const childArtifactRows = await this.db
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
        const [childArtifact] = await this.db
          .select({ currentVersionId: artifacts.currentVersionId })
          .from(artifacts)
          .where(eq(artifacts.id, childId))
          .limit(1);
        if (childArtifact?.currentVersionId) {
          const [childVersion] = await this.db
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

    const rows = await this.db
      .select({
        id: artifacts.id,
        name: artifacts.name,
        visibility: artifacts.visibility,
        thumbnailUrl: artifacts.thumbnailUrl,
        authorId: user.id,
        authorUsername: user.username,
        authorDisplayName: user.name,
        authorAvatarUrl: user.image,
      })
      .from(artifacts)
      .innerJoin(user, eq(artifacts.authorId, user.id))
      .where(inArray(artifacts.id, artifactIds));

    return rows.map(r => ({
      artifactId: r.id,
      name: r.name,
      visibility: r.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED',
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
  ): Promise<ServiceResult<{ version: ArtifactVersionItem }>> {
    try {
      // 检查 artifact 存在且用户有权限
      const existingArtifact = await this.db
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
      const [targetVersion] = await this.db
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

      const batchOperations: BatchItem<"sqlite">[] = [];

      // 先删除该版本上已有的所有 tag
      batchOperations.push(
        this.db.delete(artifactCommitTags).where(
          eq(artifactCommitTags.commitHash, targetVersion.commitHash)
        )
      );

      // 如果设置了新 tags，先清除同 artifact 中使用相同 tag 的旧关联
      if (commitTags.length > 0) {
        const existingTags = await this.db
          .select({ id: artifactCommitTags.id })
          .from(artifactCommitTags)
          .where(and(
            eq(artifactCommitTags.artifactId, artifactId),
            inArray(artifactCommitTags.tag, commitTags),
          ));
        for (const ct of existingTags) {
          batchOperations.push(
            this.db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
          );
        }

        // 创建新的 tag 关联
        for (const tag of commitTags) {
          batchOperations.push(
            this.db.insert(artifactCommitTags).values({
              artifactId,
              commitHash: targetVersion.commitHash,
              tag,
            })
          );
        }
      }

      await this.db.batch(batchOperations as any);

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
      const result = await this.db
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

      return { success: true, data: { version: result[0].version } };
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
      const existingArtifact = await this.db
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
      const [baseVersion] = await this.db
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
        const [currentVersion] = await this.db
          .select({ commitHash: artifactVersions.commitHash })
          .from(artifactVersions)
          .where(eq(artifactVersions.id, existingArtifact[0].currentVersionId))
          .limit(1);
        if (currentVersion) {
          parentCommit = currentVersion.commitHash;
        }
      }

      // 获取 baseCommit 的完整节点列表
      const baseNodes = await this.db
        .select()
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, baseVersion.commitHash));

      // 获取 baseCommit 的完整边列表
      const baseEdges = await this.db
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
      const nodeVersionService = new NodeVersionService(this.db);

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

      // 获取当前 artifact 名称和 visibility 用作 fallback
      const currentArtifact = (await this.db.select({ name: artifacts.name, visibility: artifacts.visibility }).from(artifacts).where(eq(artifacts.id, artifactId)).limit(1))[0];
      const currentName = currentArtifact?.name ?? '';
      const currentVisibility = (currentArtifact?.visibility ?? 'PUBLIC') as VisibilityType;

      // 委托给 createArtifact 完成实际的版本创建（复用所有验证逻辑）
      const createResult = await this.createArtifact({
        authorId,
        metadata: {
          artifactId,
          commit: commit,
          parentCommit: parentCommit ?? undefined,
          name: metadata.name ?? currentName,
          description: metadata.description,
          visibility: metadata.visibility ?? currentVisibility,
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
    baseVersion: ArtifactVersion,
    metadata: PatchArtifactInput['metadata'],
  ): Promise<ServiceResult<PatchArtifactResult>> {
    try {
      const batchOperations: BatchItem<"sqlite">[] = [];

      // 更新 artifact 基本信息（仅更新提供了的字段）
      const artifactUpdate: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (metadata.name !== undefined) artifactUpdate.name = metadata.name;
      if (metadata.description !== undefined) artifactUpdate.description = metadata.description;
      if (metadata.visibility !== undefined) artifactUpdate.visibility = metadata.visibility;

      batchOperations.push(
        this.db.update(artifacts).set(artifactUpdate).where(eq(artifacts.id, artifactId))
      );

      // 更新版本元数据（仅更新提供了的字段）
      const versionUpdate: Record<string, unknown> = {};
      if (metadata.version !== undefined) versionUpdate.version = metadata.version;
      if (metadata.changelog !== undefined) versionUpdate.changelog = metadata.changelog;
      if (metadata.entrypoint !== undefined) {
        // 验证 entrypoint 的 saveCommit 在对应 STATE node 的 saves 列表内
        const { saveCommit, sandboxNodeId } = metadata.entrypoint;

        // 获取当前版本的节点
        const versionNodes = await this.db
          .select({ nodeId: artifactVersionNodes.nodeId, nodeCommit: artifactVersionNodes.nodeCommit })
          .from(artifactVersionNodes)
          .where(eq(artifactVersionNodes.commitHash, baseVersion.commitHash));

        // 获取每个节点的版本信息
        const nodeVersionService = new NodeVersionService(this.db);
        let sandboxFound = false;
        let saveCommitFound = false;

        for (const vn of versionNodes) {
          const versionDetail = await nodeVersionService.getVersion(vn.nodeCommit);
          if (!versionDetail.success) continue;

          const v = versionDetail.data;
          if (v.type === 'SANDBOX' && vn.nodeId === sandboxNodeId) {
            sandboxFound = true;
          }
          if (v.type === 'STATE') {
            const stateSaves = (v.content as { saves?: string[] })?.saves;
            if (stateSaves && stateSaves.includes(saveCommit)) {
              saveCommitFound = true;
            }
          }
        }

        if (!sandboxFound) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not a SANDBOX node in the current version` },
          };
        }
        if (!saveCommitFound) {
          return {
            success: false,
            error: { code: 'BAD_REQUEST', message: `Entrypoint saveCommit ${saveCommit} is not found in any STATE node's saves list in the current version` },
          };
        }

        versionUpdate.entrypoint = metadata.entrypoint;
      }

      if (Object.keys(versionUpdate).length > 0) {
        batchOperations.push(
          this.db.update(artifactVersions).set(versionUpdate).where(eq(artifactVersions.id, baseVersion.id))
        );
      }

      // 处理 commitTags
      if (metadata.commitTags !== undefined) {
        // 先删除该版本上已有的所有 tag
        batchOperations.push(
          this.db.delete(artifactCommitTags).where(
            eq(artifactCommitTags.commitHash, baseVersion.commitHash)
          )
        );

        if (metadata.commitTags.length > 0) {
          // 清除同 artifact 中使用相同 tag 的旧关联
          const existingTags = await this.db
            .select({ id: artifactCommitTags.id })
            .from(artifactCommitTags)
            .where(and(
              eq(artifactCommitTags.artifactId, artifactId),
              inArray(artifactCommitTags.tag, metadata.commitTags),
            ));
          for (const ct of existingTags) {
            batchOperations.push(
              this.db.delete(artifactCommitTags).where(eq(artifactCommitTags.id, ct.id))
            );
          }

          // 创建新的 tag 关联
          for (const tag of metadata.commitTags) {
            batchOperations.push(
              this.db.insert(artifactCommitTags).values({
                artifactId,
                commitHash: baseVersion.commitHash,
                tag,
              })
            );
          }
        }
      }

      await this.db.batch(batchOperations as any);

      // 获取更新后的信息用于返回
      const authorResult = await this.db
        .select({
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        })
        .from(user)
        .where(eq(user.id, authorId))
        .limit(1);

      const updatedArtifact = await this.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      // 获取 tags
      const tagResults = await this.db
        .select({
          tag: {
            id: tags.id,
            name: tags.name,
            slug: tags.slug,
            description: tags.description,
            color: tags.color,
          },
        })
        .from(artifactTags)
        .innerJoin(tags, eq(artifactTags.tagId, tags.id))
        .where(eq(artifactTags.artifactId, artifactId));

      const artifact: ArtifactListItem = {
        id: artifactId,
        name: updatedArtifact[0].name,
        description: updatedArtifact[0].description,
        visibility: updatedArtifact[0].visibility,
        thumbnailUrl: updatedArtifact[0].thumbnailUrl,
        license: updatedArtifact[0].license,
        isArchived: updatedArtifact[0].isArchived,
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
  ): Promise<ServiceResult<{ gcResult: { decremented: number; deleted: number } }>> {
    try {
      // 检查 artifact 存在且用户有权限
      const [existingArtifact] = await this.db
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
      const [targetVersion] = await this.db
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
      await this.db.update(artifactVersions)
        .set({ isWeak: true })
        .where(eq(artifactVersions.id, targetVersion.id));

      // 获取该版本关联的所有 node 版本
      const versionNodes = await this.db
        .select({
          nodeId: artifactVersionNodes.nodeId,
          nodeCommit: artifactVersionNodes.nodeCommit,
        })
        .from(artifactVersionNodes)
        .where(eq(artifactVersionNodes.commitHash, targetVersion.commitHash));

      // 获取每个 node 的 type 和 contentHash
      const nodeVersionService = new NodeVersionService(this.db);
      let decremented = 0;
      let deleted = 0;

      for (const vn of versionNodes) {
        const [nv] = await this.db
          .select({ type: nodeVersions.type, contentHash: nodeVersions.contentHash })
          .from(nodeVersions)
          .where(eq(nodeVersions.commit, vn.nodeCommit))
          .limit(1);

        if (!nv) continue;

        const result = await nodeVersionService.decrementContentRefCount(nv.type, nv.contentHash);
        if (result.decremented) decremented++;
        if (result.deleted) deleted++;
      }

      return {
        success: true,
        data: { gcResult: { decremented, deleted } },
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
      visibilityFilter = ['PUBLIC'],
    } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建基础条件：用户拥有的未归档 artifacts
      const baseConditions = [
        eq(artifacts.authorId, userId),
        eq(artifacts.isArchived, false),
      ];

      // 可见性过滤
      if (visibilityFilter.length > 0) {
        baseConditions.push(inArray(artifacts.visibility, visibilityFilter));
      }

      // 计算总数
      const [countResult] = await this.db
        .select({ total: count() })
        .from(artifacts)
        .where(and(...baseConditions));

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序
      let orderClause;
      if (sortBy === 'viewCount' || sortBy === 'starCount') {
        const statsColumn = sortBy === 'viewCount' ? artifactStats.viewCount : artifactStats.starCount;
        orderClause = sortOrder === 'asc' ? asc(statsColumn) : desc(statsColumn);
      } else {
        const artifactColumn = sortBy === 'updatedAt' ? artifacts.updatedAt : artifacts.createdAt;
        orderClause = sortOrder === 'asc' ? asc(artifactColumn) : desc(artifactColumn);
      }

      // 查询 artifacts（带 author 和 stats）
      const artifactsQuery = this.db
        .select({
          artifact: artifacts,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.name,
            avatarUrl: user.image,
          },
          stats: artifactStats,
        })
        .from(artifacts)
        .innerJoin(user, eq(artifacts.authorId, user.id))
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
        const tagResults = await this.db
          .select({
            artifactId: artifactTags.artifactId,
            tag: {
              id: tags.id,
              name: tags.name,
              slug: tags.slug,
              description: tags.description,
              color: tags.color,
            },
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
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
        visibility: r.artifact.visibility,
        thumbnailUrl: r.artifact.thumbnailUrl,
        license: r.artifact.license,
        isArchived: r.artifact.isArchived,
        createdAt: r.artifact.createdAt,
        updatedAt: r.artifact.updatedAt,
        author: r.author,
        tags: tagsMap.get(r.artifact.id) || [],
        stats: r.stats ? {
          viewCount: r.stats.viewCount,
          starCount: r.stats.starCount,
          forkCount: r.stats.forkCount,
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
}

// 用户 artifacts 查询参数
export interface ListUserArtifactsParams {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'starCount';
  sortOrder?: 'asc' | 'desc';
  // 权限控制：可以看到哪些可见性级别的 artifacts
  visibilityFilter?: VisibilityType[];
}

// 版本信息
export interface ArtifactVersionItem {
  id: string;
  version: string;
  commitHash: string;
  commitTags: string[];
  changelog: string | null;
  publishedAt: string | null;
  createdAt: string;
}

// PATCH artifact 输入参数
export interface PatchArtifactInput {
  authorId: string;
  metadata: {
    artifactId: string;
    baseCommit: string;
    commit?: string;  // 有 graph 变更时必须提供，metadata-only 更新时不需要
    name?: string;
    description?: string;
    visibility?: VisibilityType;
    version?: string;
    changelog?: string;
    commitTags?: string[];
    entrypoint?: { saveCommit: string; sandboxNodeId: string };
    addNodes?: CreateArtifactNode[];
    removeNodeIds?: string[];
    addEdges?: ArtifactEdgeDescriptor[];
    removeEdges?: ArtifactEdgeDescriptor[];
  };
  saves?: CreateSaveInput[];
}

// 谱系查询参数
export interface GetLineageParams {
  commit?: string;      // 指定版本的 commit hash，不传则使用 currentVersionId
  parentDepth?: number; // 向上追溯父代的深度，undefined 表示无限递归
  childDepth?: number;  // 向下追溯子代的深度，undefined 表示无限递归
}
