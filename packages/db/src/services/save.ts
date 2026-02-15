import { eq, and, desc, count, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { nodeVersions } from '../schema/node-versions';
import { saveContents } from '../schema/node-contents';
import { artifactVersions } from '../schema/artifacts';
import { user } from '../schema/auth';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { NodeVersionService, type SyncNodeVersionInput } from './node-version';
import type { ServiceResult } from './user';
import { computeSaveId } from '@pubwiki/api';
import type { SaveDetail, Pagination } from '@pubwiki/api';

// 重新导出类型
export type { SaveDetail };

// 创建 Save 的参数
export interface CreateSaveParams {
  stateNodeId: string;
  stateNodeCommit: string;
  commit: string;
  parent?: string | null;
  authorId: string;
  sourceArtifactId: string;
  sourceArtifactCommit: string;
  contentHash: string;
  title?: string;
  description?: string;
  isListed?: boolean;
}

// 列表查询参数
export type ListSavesParams = {
  author?: string;
  page?: number;
  limit?: number;
} & (
  | { stateNodeId: string; stateNodeCommit: string; saveId?: undefined }
  | { saveId: string; stateNodeId?: undefined; stateNodeCommit?: undefined }
);

// 列表响应
export interface ListSavesResult {
  saves: SaveDetail[];
  pagination: Pagination;
}

export class SaveService {
  private nodeVersionService: NodeVersionService;

  constructor(private db: Database) {
    this.nodeVersionService = new NodeVersionService(db);
  }

  // 计算确定性 saveId，委托给 @pubwiki/api 的共享实现
  static computeSaveId = computeSaveId;

  // 创建存档（通过 NodeVersionService.syncVersions 创建 SAVE 类型 node version）
  async createSave(params: CreateSaveParams): Promise<ServiceResult<SaveDetail>> {
    const {
      stateNodeId,
      stateNodeCommit,
      commit,
      parent,
      authorId,
      sourceArtifactId,
      sourceArtifactCommit,
      contentHash,
      title,
      description,
      isListed = false,
    } = params;

    try {
      // 验证 sourceArtifactId + sourceArtifactCommit 对应的 artifact version 存在
      const [artifactVersion] = await this.db
        .select({ id: artifactVersions.id })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.artifactId, sourceArtifactId),
            eq(artifactVersions.commitHash, sourceArtifactCommit)
          )
        )
        .limit(1);

      if (!artifactVersion) {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Artifact version not found: ${sourceArtifactId}@${sourceArtifactCommit}` },
        };
      }

      // 计算确定性 saveId
      const saveId = await SaveService.computeSaveId(stateNodeId, stateNodeCommit, authorId, sourceArtifactId, sourceArtifactCommit);

      // 构建 sync input
      const syncInput: SyncNodeVersionInput = {
        nodeId: saveId,
        commit,
        parent: parent ?? undefined,
        authorId,
        sourceArtifactId,
        type: 'SAVE',
        contentHash,
        content: {
          type: 'SAVE',
          stateNodeId,
          stateNodeCommit,
          sourceArtifactCommit,
          title: title ?? null,
          description: description ?? null,
        },
        isListed,
      };

      const syncResult = await this.nodeVersionService.syncVersions([syncInput]);

      if (!syncResult.success) {
        return {
          success: false,
          error: syncResult.error,
        };
      }

      // 获取创建的 save 详情
      return this.getSave(commit);
    } catch (error) {
      console.error('Failed to create save:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create save' },
      };
    }
  }

  // 查询 SAVE 版本列表（按 stateNodeId+stateNodeCommit 或 saveId）
  async listSaves(params: ListSavesParams): Promise<ServiceResult<ListSavesResult>> {
    const { author, page = 1, limit = 20 } = params;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建过滤条件
      const conditions = [
        eq(nodeVersions.type, 'SAVE'),
      ];
      if (params.saveId) {
        conditions.push(eq(nodeVersions.nodeId, params.saveId));
      } else if (params.stateNodeId && params.stateNodeCommit) {
        conditions.push(eq(saveContents.stateNodeId, params.stateNodeId));
        conditions.push(eq(saveContents.stateNodeCommit, params.stateNodeCommit));
      }
      if (author) {
        conditions.push(eq(nodeVersions.authorId, author));
      }

      // 总数（需要 JOIN saveContents 因为条件引用了 saveContents.stateNodeId）
      const [countResult] = await this.db
        .select({ count: count() })
        .from(nodeVersions)
        .innerJoin(
          saveContents,
          eq(nodeVersions.contentHash, saveContents.contentHash)
        )
        .where(and(...conditions));

      const total = countResult?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 查询 SAVE 版本 + 内容 + 访问控制
      const rows = await this.db
        .select({
          saveId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          contentHash: nodeVersions.contentHash,
          isListed: resourceDiscoveryControl.isListed,
          // save content fields
          stateNodeId: saveContents.stateNodeId,
          stateNodeCommit: saveContents.stateNodeCommit,
          sourceArtifactCommit: saveContents.sourceArtifactCommit,
          title: saveContents.title,
          description: saveContents.description,
          createdAt: saveContents.createdAt,
        })
        .from(nodeVersions)
        .innerJoin(
          saveContents,
          eq(nodeVersions.contentHash, saveContents.contentHash)
        )
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'save'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
        .where(and(...conditions))
        .orderBy(desc(nodeVersions.authoredAt))
        .limit(validLimit)
        .offset(offset);

      const saves: SaveDetail[] = rows.map(r => ({
        saveId: r.saveId,
        commit: r.commit,
        parent: r.parent,
        authorId: r.authorId,
        authoredAt: r.authoredAt,
        stateNodeId: r.stateNodeId,
        stateNodeCommit: r.stateNodeCommit,
        sourceArtifactId: r.sourceArtifactId,
        sourceArtifactCommit: r.sourceArtifactCommit,
        title: r.title,
        description: r.description,
        isListed: r.isListed ?? false,
        createdAt: r.createdAt!,
      }));

      return {
        success: true,
        data: {
          saves,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Failed to list saves:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list saves' },
      };
    }
  }

  // 获取特定存档详情（commit 全局唯一）
  async getSave(commit: string): Promise<ServiceResult<SaveDetail>> {
    try {
      const [row] = await this.db
        .select({
          saveId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          sourceArtifactId: nodeVersions.sourceArtifactId,
          contentHash: nodeVersions.contentHash,
          isListed: resourceDiscoveryControl.isListed,
          stateNodeId: saveContents.stateNodeId,
          stateNodeCommit: saveContents.stateNodeCommit,
          sourceArtifactCommit: saveContents.sourceArtifactCommit,
          title: saveContents.title,
          description: saveContents.description,
          createdAt: saveContents.createdAt,
        })
        .from(nodeVersions)
        .innerJoin(
          saveContents,
          eq(nodeVersions.contentHash, saveContents.contentHash)
        )
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'save'),
            eq(resourceDiscoveryControl.resourceId, nodeVersions.commit)
          )
        )
        .where(
          and(
            eq(nodeVersions.commit, commit),
            eq(nodeVersions.type, 'SAVE')
          )
        )
        .limit(1);

      if (!row) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Save not found' },
        };
      }

      return {
        success: true,
        data: {
          saveId: row.saveId,
          commit: row.commit,
          parent: row.parent,
          authorId: row.authorId,
          authoredAt: row.authoredAt,
          stateNodeId: row.stateNodeId,
          stateNodeCommit: row.stateNodeCommit,
          sourceArtifactId: row.sourceArtifactId,
          sourceArtifactCommit: row.sourceArtifactCommit,
          title: row.title,
          description: row.description,
          isListed: row.isListed ?? false,
          createdAt: row.createdAt!,
        },
      };
    } catch (error) {
      console.error('Failed to get save by commit:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get save' },
      };
    }
  }

  // 删除存档（commit 全局唯一，仅作者可删）
  async deleteSave(
    commit: string,
    userId: string
  ): Promise<ServiceResult<{ r2Key: string }>> {
    try {
      // 查找 save
      const [save] = await this.db
        .select({
          authorId: nodeVersions.authorId,
          contentHash: nodeVersions.contentHash,
        })
        .from(nodeVersions)
        .where(
          and(
            eq(nodeVersions.commit, commit),
            eq(nodeVersions.type, 'SAVE')
          )
        )
        .limit(1);

      if (!save) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Save not found' },
        };
      }

      // 权限检查
      if (save.authorId !== userId) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the author can delete this save' },
        };
      }

      // 使用 batch 保证原子性：删除 node version + 减少 save_contents 引用计数
      await this.db.batch([
        this.db
          .delete(nodeVersions)
          .where(eq(nodeVersions.commit, commit)),
        this.db
          .update(saveContents)
          .set({
            refCount: sql`CASE WHEN ${saveContents.refCount} > 0 THEN ${saveContents.refCount} - 1 ELSE 0 END`,
          })
          .where(eq(saveContents.contentHash, save.contentHash)),
      ]);

      const r2Key = `saves/${commit}.bin`;

      return {
        success: true,
        data: { r2Key },
      };
    } catch (error) {
      console.error('Failed to delete save:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete save' },
      };
    }
  }

  // 获取 save 的 R2 存储 key（commit 全局唯一）
  getSaveDataKey(commit: string): string {
    return `saves/${commit}.bin`;
  }
}
