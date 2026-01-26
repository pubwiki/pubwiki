import { eq, and, or, inArray, notInArray, asc, desc, sql, count } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../client';
import { artifacts, tags, artifactTags, artifactVersions, type Artifact, type Tag, type ArtifactVersion, type NewArtifact, type NewArtifactVersion, type StoredEdge } from '../schema/artifacts';
import { artifactNodes, artifactNodeVersions, artifactNodeRefs, type NewArtifactNode, type NewArtifactNodeVersion, type NewArtifactNodeRef } from '../schema/nodes';
import { artifactLineage, type ArtifactLineage } from '../schema/lineage';
import { artifactStats, type ArtifactStats } from '../schema/stats';
import { user, type User } from '../schema/auth';
import { chunkArray } from '../utils';
import type { ServiceError, ServiceResult } from './user';
import type {
  ArtifactListItem,
  Pagination as PaginationInfo,
  ArtifactVersion as ArtifactVersionType,
  ArtifactLineageItem,
  ArtifactType,
  VisibilityType,
  LineageType,
  CreateArtifactMetadata,
  ArtifactDescriptor,
  ArtifactNodeDescriptor,
  ArtifactEdgeDescriptor,
  ArtifactNodeType,
} from '@pubwiki/api';

// 重新导出供其他模块使用
export type { ArtifactListItem, PaginationInfo, ArtifactLineageItem };

// 列表查询参数
export interface ListArtifactsParams {
  page?: number;
  limit?: number;
  typeInclude?: ArtifactType[];
  typeExclude?: ArtifactType[];
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

// 节点内容输入
export interface CreateArtifactNodeContent {
  content: unknown; // JSON 格式的节点内容
  contentHash: string; // 用于生成 commitHash
}

// 创建 artifact 的输入参数
export interface CreateArtifactInput {
  authorId: string;
  metadata: CreateArtifactMetadata;
  descriptor: ArtifactDescriptor;
  nodeContents: Map<string, CreateArtifactNodeContent>; // nodeId -> content
}

// 创建 artifact 的返回结果
export interface CreateArtifactResult {
  artifact: ArtifactListItem;
}

export class ArtifactService {
  constructor(private db: Database) {}

  // 生成 commit hash (SHA-256 前8位)
  private async generateCommitHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 8);
  }

  // 创建或更新 artifact（使用 batch 保证原子性）
  // 通过检查 metadata.artifactId 是否存在于数据库中决定是创建还是更新
  async createArtifact(input: CreateArtifactInput): Promise<ServiceResult<CreateArtifactResult>> {
    const { authorId, metadata, descriptor, nodeContents } = input;
    const artifactId = metadata.artifactId;

    try {
      // 检查 artifactId 是否已存在于数据库中，决定是创建还是更新
      const existingArtifact = await this.db
        .select({ id: artifacts.id, authorId: artifacts.authorId })
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

        // 检查更新后的 slug 是否与其他 artifact 冲突（排除自身）
        const slugConflict = await this.db
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(and(
            eq(artifacts.authorId, authorId),
            eq(artifacts.slug, metadata.slug),
            sql`${artifacts.id} != ${artifactId}`
          ))
          .limit(1);

        if (slugConflict.length > 0) {
          return {
            success: false,
            error: { code: 'CONFLICT', message: 'Artifact with this slug already exists' },
          };
        }
      } else {
        // 创建操作：检查 slug 是否已存在（同一用户下）- batch 前检查
        const slugConflict = await this.db
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(and(eq(artifacts.authorId, authorId), eq(artifacts.slug, metadata.slug)))
          .limit(1);

        if (slugConflict.length > 0) {
          return {
            success: false,
            error: { code: 'CONFLICT', message: 'Artifact with this slug already exists' },
          };
        }
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

      // 预先收集外部节点信息（batch 前检查）
      const externalNodeInfos = new Map<string, {
        artifactId: string;
        nodeVersionId: string;
        artifactVisibility: string;
      }>();

      for (const nodeDesc of descriptor.nodes) {
        if (nodeDesc.external) {
          const externalNodeResult = await this.db
            .select({
              node: artifactNodes,
              artifact: artifacts,
            })
            .from(artifactNodes)
            .innerJoin(artifacts, eq(artifactNodes.artifactId, artifacts.id))
            .where(eq(artifactNodes.id, nodeDesc.id))
            .limit(1);

          if (externalNodeResult.length === 0) {
            return {
              success: false,
              error: { code: 'NOT_FOUND', message: `External node ${nodeDesc.id} not found` },
            };
          }

          const externalNode = externalNodeResult[0];

          // 检查 visibility 权限
          if (externalNode.artifact.visibility === 'PRIVATE') {
            if ((metadata.visibility ?? 'PUBLIC') !== 'PRIVATE') {
              return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Cannot reference PRIVATE artifact from non-PRIVATE artifact' },
              };
            }
          }

          // 获取外部节点的最新版本
          const externalVersionResult = await this.db
            .select()
            .from(artifactNodeVersions)
            .where(eq(artifactNodeVersions.nodeId, nodeDesc.id))
            .orderBy(desc(artifactNodeVersions.createdAt))
            .limit(1);

          if (externalVersionResult.length === 0) {
            return {
              success: false,
              error: { code: 'NOT_FOUND', message: `External node ${nodeDesc.id} has no versions` },
            };
          }

          externalNodeInfos.set(nodeDesc.id, {
            artifactId: externalNode.artifact.id,
            nodeVersionId: externalVersionResult[0].id,
            artifactVisibility: externalNode.artifact.visibility,
          });
        }
      }

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

      // 验证内部节点 ID 不存在于数据库中（防止 ID 冲突）
      // 更新模式下，排除属于当前 artifact 的节点（这些节点会被更新而不是冲突）
      const internalNodeIds = descriptor.nodes
        .filter(n => !n.external)
        .map(n => n.id);
      
      if (internalNodeIds.length > 0) {
        const existingNodesQuery = this.db
          .select({ id: artifactNodes.id, artifactId: artifactNodes.artifactId })
          .from(artifactNodes)
          .where(inArray(artifactNodes.id, internalNodeIds));
        
        const existingNodes = await existingNodesQuery;
        
        // 过滤出不属于当前 artifact 的冲突节点
        const conflictingNodes = existingNodes.filter(n => n.artifactId !== artifactId);
        
        if (conflictingNodes.length > 0) {
          const conflictingIds = conflictingNodes.map(n => n.id);
          return {
            success: false,
            error: { code: 'CONFLICT', message: `Node IDs already exist in other artifacts: ${conflictingIds.join(', ')}` },
          };
        }
      }

      // 生成 artifact version 的 commit hash
      const versionContent = JSON.stringify({
        metadata,
        descriptor,
        timestamp: Date.now(),
      });
      const artifactCommitHash = await this.generateCommitHash(versionContent);

      // 直接使用用户传入的 ID 存储 edges
      const storedEdges: StoredEdge[] = descriptor.edges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

      // 收集所有批量操作的语句
      const batchOperations: BatchItem<"sqlite">[] = [];
      const processedTags: { id: string; name: string; slug: string; description: string | null; color: string | null }[] = [];
      const timestamp = Date.now();

      // 更新模式下，先删除旧数据
      if (isUpdate) {
        // 删除旧的 artifact_versions（会级联删除 artifact_node_refs）
        batchOperations.push(this.db.delete(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)));
        // 删除旧的 artifact_nodes（会级联删除 artifact_node_versions 和 artifact_node_files）
        batchOperations.push(this.db.delete(artifactNodes).where(eq(artifactNodes.artifactId, artifactId)));
        // 删除旧的 artifact_tags 关联
        batchOperations.push(this.db.delete(artifactTags).where(eq(artifactTags.artifactId, artifactId)));
        // 删除旧的 artifact_lineage（作为 child 的）
        batchOperations.push(this.db.delete(artifactLineage).where(eq(artifactLineage.childArtifactId, artifactId)));
        
        // 减少旧 tags 的使用计数
        for (const oldTagId of oldTagIds) {
          batchOperations.push(
            this.db
              .update(tags)
              .set({ usageCount: sql`MAX(0, ${tags.usageCount} - 1)` })
              .where(eq(tags.id, oldTagId))
          );
        }
        
        // 更新 artifact 基本信息
        batchOperations.push(
          this.db.update(artifacts).set({
            type: metadata.type,
            name: metadata.name,
            slug: metadata.slug,
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
          type: metadata.type,
          name: metadata.name,
          slug: metadata.slug,
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
        version: metadata.version,
        commitHash: artifactCommitHash,
        changelog: metadata.changelog ?? null,
        isPrerelease: metadata.isPrerelease ?? false,
        publishedAt: new Date().toISOString(),
        edges: storedEdges,
      };
      batchOperations.push(this.db.insert(artifactVersions).values(newVersion));

      // 收集用于批量创建 lineage 的父 artifact IDs（去重）
      const parentArtifactIds = new Set<string>();

      // 处理 descriptor 中的节点
      for (const nodeDesc of descriptor.nodes) {
        if (nodeDesc.external) {
          const externalInfo = externalNodeInfos.get(nodeDesc.id)!;

          // 创建外部引用记录
          const newRef: NewArtifactNodeRef = {
            id: crypto.randomUUID(),
            artifactVersionId: versionId,
            externalNodeId: nodeDesc.id,
            externalArtifactId: externalInfo.artifactId,
            externalNodeVersionId: externalInfo.nodeVersionId,
          };
          batchOperations.push(this.db.insert(artifactNodeRefs).values(newRef));

          // 记录需要创建 lineage 的父 artifact
          parentArtifactIds.add(externalInfo.artifactId);
        } else {
          // 内部节点 - 直接使用用户传入的 ID
          const nodeId = nodeDesc.id;

          // 创建节点（包含 position 信息和 originalRef）
          const newNode: NewArtifactNode = {
            id: nodeId,
            artifactId,
            type: nodeDesc.type!,
            name: nodeDesc.name ?? null,
            positionX: nodeDesc.position?.x ?? null,
            positionY: nodeDesc.position?.y ?? null,
            originalNodeId: nodeDesc.originalRef?.nodeId ?? null,
            originalCommit: nodeDesc.originalRef?.commit ?? null,
          };
          batchOperations.push(this.db.insert(artifactNodes).values(newNode));

          // 获取该节点的内容
          const nodeContent = nodeContents.get(nodeId);
          const contentHash = nodeContent?.contentHash ?? await this.generateCommitHash(nodeId);
          const nodeCommitHash = await this.generateCommitHash(contentHash + timestamp);

          // 创建节点版本（现在内容直接存储在数据库中）
          const nodeVersionId = crypto.randomUUID();
          const newNodeVersion: NewArtifactNodeVersion = {
            id: nodeVersionId,
            nodeId: nodeId,
            commitHash: nodeCommitHash,
            contentHash,
            content: nodeContent ? JSON.stringify(nodeContent.content) : null,
          };
          batchOperations.push(this.db.insert(artifactNodeVersions).values(newNodeVersion));
        }
      }

      // 批量创建 lineage DEPENDS_ON 关系
      for (const parentArtifactId of parentArtifactIds) {
        batchOperations.push(this.db.insert(artifactLineage).values({
          id: crypto.randomUUID(),
          childArtifactId: artifactId,
          parentArtifactId: parentArtifactId,
          lineageType: 'DEPENDS_ON',
        }));
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
        type: metadata.type,
        name: metadata.name,
        slug: metadata.slug,
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
      typeInclude,
      typeExclude,
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

      // 类型过滤
      if (typeInclude && typeInclude.length > 0) {
        baseConditions.push(inArray(artifacts.type, typeInclude));
      }
      if (typeExclude && typeExclude.length > 0) {
        baseConditions.push(notInArray(artifacts.type, typeExclude));
      }

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
        type: r.artifact.type,
        name: r.artifact.name,
        slug: r.artifact.slug,
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

  // 获取 artifact 的谱系信息（支持递归查询多代）
  async getArtifactLineage(
    artifactId: string,
    params: GetLineageParams = {}
  ): Promise<ServiceResult<{
    parents: ArtifactLineageItem[];
    children: ArtifactLineageItem[];
  }>> {
    const { parentDepth, childDepth } = params;

    try {
      // 检查 artifact 是否存在
      const artifactCheck = await this.db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (artifactCheck.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        };
      }

      // 递归获取父 artifacts
      const parents = await this.getParentLineageRecursive(
        artifactId,
        null, // 起始节点的 parentId 为 null
        parentDepth,
        1,
        new Set<string>() // 防止循环引用
      );

      // 递归获取子 artifacts
      const children = await this.getChildLineageRecursive(
        artifactId,
        null, // 起始节点的 parentId（实际是子节点来源）为 null
        childDepth,
        1,
        new Set<string>() // 防止循环引用
      );

      return {
        success: true,
        data: {
          parents,
          children,
        },
      };
    } catch (error) {
      console.error('Get artifact lineage error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 递归获取父谱系
  private async getParentLineageRecursive(
    artifactId: string,
    parentId: string | null,
    maxDepth: number | undefined,
    currentDepth: number,
    visited: Set<string>
  ): Promise<ArtifactLineageItem[]> {
    // 深度检查
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return [];
    }

    // 防止循环引用
    if (visited.has(artifactId)) {
      return [];
    }
    visited.add(artifactId);

    // 获取直接父 artifacts
    const parentsResult = await this.db
      .select({
        lineage: artifactLineage,
        artifact: artifacts,
        author: {
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        },
      })
      .from(artifactLineage)
      .innerJoin(artifacts, eq(artifactLineage.parentArtifactId, artifacts.id))
      .innerJoin(user, eq(artifacts.authorId, user.id))
      .where(eq(artifactLineage.childArtifactId, artifactId));

    const results: ArtifactLineageItem[] = [];

    for (const r of parentsResult) {
      // 当前层级的 item
      const item: ArtifactLineageItem = {
        id: r.lineage.id,
        lineageType: r.lineage.lineageType,
        description: r.lineage.description,
        parentId: parentId, // 指向请求 artifact 或上一层的 artifact
        createdAt: r.lineage.createdAt,
        artifact: {
          id: r.artifact.id,
          name: r.artifact.name,
          slug: r.artifact.slug,
          type: r.artifact.type,
          visibility: r.artifact.visibility,
          thumbnailUrl: r.artifact.thumbnailUrl,
          author: r.author,
        },
      };
      results.push(item);

      // 递归获取更上层的父代
      const ancestorResults = await this.getParentLineageRecursive(
        r.artifact.id,
        r.artifact.id, // 子代的 parentId 指向当前 artifact
        maxDepth,
        currentDepth + 1,
        visited
      );
      results.push(...ancestorResults);
    }

    return results;
  }

  // 递归获取子谱系
  private async getChildLineageRecursive(
    artifactId: string,
    sourceId: string | null,
    maxDepth: number | undefined,
    currentDepth: number,
    visited: Set<string>
  ): Promise<ArtifactLineageItem[]> {
    // 深度检查
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return [];
    }

    // 防止循环引用
    if (visited.has(artifactId)) {
      return [];
    }
    visited.add(artifactId);

    // 获取直接子 artifacts
    const childrenResult = await this.db
      .select({
        lineage: artifactLineage,
        artifact: artifacts,
        author: {
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        },
      })
      .from(artifactLineage)
      .innerJoin(artifacts, eq(artifactLineage.childArtifactId, artifacts.id))
      .innerJoin(user, eq(artifacts.authorId, user.id))
      .where(eq(artifactLineage.parentArtifactId, artifactId));

    const results: ArtifactLineageItem[] = [];

    for (const r of childrenResult) {
      // 当前层级的 item
      const item: ArtifactLineageItem = {
        id: r.lineage.id,
        lineageType: r.lineage.lineageType,
        description: r.lineage.description,
        parentId: sourceId, // 指向请求 artifact 或上一层的 artifact
        createdAt: r.lineage.createdAt,
        artifact: {
          id: r.artifact.id,
          name: r.artifact.name,
          slug: r.artifact.slug,
          type: r.artifact.type,
          visibility: r.artifact.visibility,
          thumbnailUrl: r.artifact.thumbnailUrl,
          author: r.author,
        },
      };
      results.push(item);

      // 递归获取更下层的子代
      const descendantResults = await this.getChildLineageRecursive(
        r.artifact.id,
        r.artifact.id, // 孙代的 parentId 指向当前 artifact
        maxDepth,
        currentDepth + 1,
        visited
      );
      results.push(...descendantResults);
    }

    return results;
  }

  // 获取用户的 artifact 列表
  async listUserArtifacts(
    userId: string,
    params: ListUserArtifactsParams = {}
  ): Promise<ServiceResult<ListArtifactsResult>> {
    const {
      page = 1,
      limit = 20,
      typeInclude,
      typeExclude,
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

      // 类型过滤
      if (typeInclude && typeInclude.length > 0) {
        baseConditions.push(inArray(artifacts.type, typeInclude));
      }
      if (typeExclude && typeExclude.length > 0) {
        baseConditions.push(notInArray(artifacts.type, typeExclude));
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
        type: r.artifact.type,
        name: r.artifact.name,
        slug: r.artifact.slug,
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
  typeInclude?: ArtifactType[];
  typeExclude?: ArtifactType[];
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
  changelog: string | null;
  isPrerelease: boolean;
  publishedAt: string | null;
  createdAt: string;
}

// 谱系查询参数
export interface GetLineageParams {
  parentDepth?: number; // 向上追溯父代的深度，undefined 表示无限递归
  childDepth?: number;  // 向下追溯子代的深度，undefined 表示无限递归
}
