import { eq, and, desc, count } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { nodeVersions } from '../schema/node-versions';
import { saveContents } from '../schema/node-contents';
import { artifactVersions } from '../schema/artifacts';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { NodeVersionService, type SyncNodeVersionInput } from './node-version';
import type { ServiceResult } from './user';
import type { SaveDetail, Pagination } from '@pubwiki/api';

// 重新导出类型
export type { SaveDetail };

// User runtime save creation parameters (POST /saves)
export interface CreateRuntimeSaveParams {
  saveId: string;          // Client-provided saveId (freely chosen)
  stateNodeId: string;
  stateNodeCommit: string;
  commit: string;
  parent?: string | null;
  authorId: string;
  artifactId: string;
  artifactCommit: string;
  contentHash: string;
  quadsHash: string;       // Required: SHA-256 of quads.bin, computed and verified by caller
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

  constructor(private ctx: BatchContext) {
    this.nodeVersionService = new NodeVersionService(ctx);
  }

  /**
   * Create a user runtime save (SAVE type node version).
   * This is for POST /saves endpoint - saves created independently of artifact commits.
   * Returns only commit - caller should commit batch and then call getSave to get full detail.
   */
  async createRuntimeSave(params: CreateRuntimeSaveParams): Promise<ServiceResult<{ commit: string }>> {
    const {
      saveId,
      stateNodeId,
      stateNodeCommit,
      commit,
      parent,
      authorId,
      artifactId,
      artifactCommit,
      contentHash,
      quadsHash,
      title,
      description,
      isListed = false,
    } = params;

    try {
      // Validate stateNodeId + stateNodeCommit exists and is a STATE type node
      // Use NodeVersionService to check version existence and type
      const stateNodeResult = await this.nodeVersionService.getVersion(stateNodeCommit);
      if (!stateNodeResult.success) {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `STATE node not found: ${stateNodeId}@${stateNodeCommit}` },
        };
      }

      const stateNode = stateNodeResult.data;
      if (stateNode.nodeId !== stateNodeId) {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `STATE node commit ${stateNodeCommit} does not belong to node ${stateNodeId}` },
        };
      }

      if (stateNode.type !== 'STATE') {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Node ${stateNodeId}@${stateNodeCommit} is not a STATE node (got ${stateNode.type})` },
        };
      }

      // Validate artifactId + artifactCommit corresponds to an existing artifact version
      const [artifactVersionRow] = await this.ctx.select({ id: artifactVersions.id })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.artifactId, artifactId),
            eq(artifactVersions.commitHash, artifactCommit)
          )
        )
        .limit(1);

      if (!artifactVersionRow) {
        return {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Artifact version not found: ${artifactId}@${artifactCommit}` },
        };
      }

      // Build sync input for SAVE node
      const syncInput: SyncNodeVersionInput = {
        nodeId: saveId,
        commit,
        parent: parent ?? undefined,
        authorId,
        sourceArtifactId: artifactId,
        type: 'SAVE',
        contentHash,
        content: {
          type: 'SAVE',
          stateNodeId,
          stateNodeCommit,
          artifactId,
          artifactCommit,
          quadsHash,
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

      // Return commit - caller should commit batch and then call getSave
      return { success: true, data: { commit } };
    } catch (error) {
      console.error('Failed to create runtime save:', error);
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
      const [countResult] = await this.ctx.select({ count: count() })
        .from(nodeVersions)
        .innerJoin(
          saveContents,
          eq(nodeVersions.contentHash, saveContents.contentHash)
        )
        .where(and(...conditions));

      const total = countResult?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 查询 SAVE 版本 + 内容 + 访问控制
      const rows = await this.ctx.select({
          saveId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          contentHash: nodeVersions.contentHash,
          isListed: resourceDiscoveryControl.isListed,
          // save content fields
          stateNodeId: saveContents.stateNodeId,
          stateNodeCommit: saveContents.stateNodeCommit,
          artifactId: saveContents.artifactId,
          artifactCommit: saveContents.artifactCommit,
          quadsHash: saveContents.quadsHash,
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
        artifactId: r.artifactId,
        artifactCommit: r.artifactCommit,
        quadsHash: r.quadsHash,
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
      const [row] = await this.ctx.select({
          saveId: nodeVersions.nodeId,
          commit: nodeVersions.commit,
          parent: nodeVersions.parent,
          authorId: nodeVersions.authorId,
          authoredAt: nodeVersions.authoredAt,
          contentHash: nodeVersions.contentHash,
          isListed: resourceDiscoveryControl.isListed,
          stateNodeId: saveContents.stateNodeId,
          stateNodeCommit: saveContents.stateNodeCommit,
          artifactId: saveContents.artifactId,
          artifactCommit: saveContents.artifactCommit,
          quadsHash: saveContents.quadsHash,
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
          artifactId: row.artifactId,
          artifactCommit: row.artifactCommit,
          quadsHash: row.quadsHash,
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

  // Delete a save (commit is globally unique, only author can delete).
  // Returns quadsHash for potential R2 cleanup. Caller should coordinate with
  // garbage collection to determine when R2 objects can be safely deleted.
  async deleteSave(
    commit: string,
    userId: string
  ): Promise<ServiceResult<{ quadsHash: string }>> {
    try {
      // 查找 save 并获取 quadsHash
      const [save] = await this.ctx.select({
          authorId: nodeVersions.authorId,
          contentHash: nodeVersions.contentHash,
          quadsHash: saveContents.quadsHash,
        })
        .from(nodeVersions)
        .innerJoin(saveContents, eq(nodeVersions.contentHash, saveContents.contentHash))
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

      // Delete the node version. Content cleanup is handled by GC via LEFT JOIN.
      this.ctx.modify(db =>
        db.delete(nodeVersions)
          .where(eq(nodeVersions.commit, commit))
      );

      return {
        success: true,
        data: { quadsHash: save.quadsHash },
      };
    } catch (error) {
      console.error('Failed to delete save:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete save' },
      };
    }
  }

}
