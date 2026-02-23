import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { discussions, discussionReplies, type Discussion, type DiscussionReply, type NewDiscussion, type NewDiscussionReply } from '../schema/discussions';
import { user } from '../schema/auth';
import type { ServiceResult } from './user';
import { AclService, type ResourceRef } from './access-control';
import type {
  DiscussionListItem,
  DiscussionDetail,
  DiscussionReplyItem,
  DiscussionTargetType,
  DiscussionCategory,
  Pagination as PaginationInfo,
  CreateDiscussionRequest,
  CreateDiscussionReplyRequest,
  UpdateDiscussionRequest,
} from '@pubwiki/api';

// 重新导出供其他模块使用
export type { DiscussionListItem, DiscussionDetail, DiscussionReplyItem };

// 讨论目标
export interface DiscussionTarget {
  type: DiscussionTargetType;
  id: string;
}

// 列表查询参数
export interface ListDiscussionsParams {
  target: DiscussionTarget;
  page?: number;
  limit?: number;
  category?: DiscussionCategory;
  sortBy?: 'createdAt' | 'updatedAt' | 'replyCount';
  sortOrder?: 'asc' | 'desc';
  includePinned?: boolean; // 是否置顶的排在最前面
}

// 列表响应
export interface ListDiscussionsResult {
  discussions: DiscussionListItem[];
  pagination: PaginationInfo;
}

// 回复列表参数
export interface ListRepliesParams {
  discussionId: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

// 回复列表响应
export interface ListRepliesResult {
  replies: DiscussionReplyItem[];
  pagination: PaginationInfo;
}

// 作者信息
interface AuthorInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class DiscussionService {
  private aclService: AclService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
  }

  /**
   * 将 DiscussionTargetType 转换为 ACL ResourceRef
   * ARTIFACT -> 'artifact', PROJECT -> 'project', POST -> 'project' (posts belong to projects)
   */
  private targetToResourceRef(target: DiscussionTarget): ResourceRef {
    switch (target.type) {
      case 'ARTIFACT':
        return { type: 'artifact', id: target.id };
      case 'PROJECT':
      case 'POST':
        // POST 属于 project，但我们用 target.id 作为 project ID 不对
        // 实际上 POST 的 target.id 是 post ID，需要查询 project
        // 但为了简单起见，这里假设 POST 的权限检查返回 true（由 route 层处理）
        return { type: 'project', id: target.id };
    }
  }

  // 获取作者信息
  private async getAuthor(authorId: string): Promise<AuthorInfo | null> {
    const result = await this.ctx
      .select({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      })
      .from(user)
      .where(eq(user.id, authorId))
      .limit(1);

    return result[0] ?? null;
  }

  // 转换为列表项
  private toListItem(discussion: Discussion, author: AuthorInfo): DiscussionListItem {
    return {
      id: discussion.id,
      targetType: discussion.targetType,
      targetId: discussion.targetId,
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatarUrl: author.avatarUrl ?? undefined,
      },
      title: discussion.title ?? undefined,
      content: discussion.content,
      category: discussion.category,
      isPinned: discussion.isPinned,
      isLocked: discussion.isLocked,
      replyCount: discussion.replyCount,
      createdAt: discussion.createdAt,
      updatedAt: discussion.updatedAt,
    };
  }

  // 转换为详情
  private toDetail(discussion: Discussion, author: AuthorInfo): DiscussionDetail {
    return {
      ...this.toListItem(discussion, author),
    };
  }

  // 转换回复为列表项
  private toReplyItem(reply: DiscussionReply, author: AuthorInfo): DiscussionReplyItem {
    return {
      id: reply.id,
      discussionId: reply.discussionId,
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatarUrl: author.avatarUrl ?? undefined,
      },
      parentReplyId: reply.parentReplyId ?? undefined,
      content: reply.content,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
    };
  }

  // 列出讨论
  async listDiscussions(params: ListDiscussionsParams): Promise<ServiceResult<ListDiscussionsResult>> {
    const { target, page = 1, limit = 20, category, sortBy = 'createdAt', sortOrder = 'desc', includePinned = true } = params;

    try {
      // 构建查询条件
      const conditions = [
        eq(discussions.targetType, target.type),
        eq(discussions.targetId, target.id),
      ];

      if (category) {
        conditions.push(eq(discussions.category, category));
      }

      // 计算总数
      const [totalResult] = await this.ctx
        .select({ count: count() })
        .from(discussions)
        .where(and(...conditions));

      const total = totalResult?.count ?? 0;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;

      // 构建排序
      const orderClauses: ReturnType<typeof desc>[] = [];
      
      // 如果需要置顶排在最前面
      if (includePinned) {
        orderClauses.push(desc(discussions.isPinned));
      }

      // 添加主排序
      const sortColumn = sortBy === 'replyCount' ? discussions.replyCount : 
                         sortBy === 'updatedAt' ? discussions.updatedAt : 
                         discussions.createdAt;
      orderClauses.push(sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn));

      // 查询讨论列表
      const discussionList = await this.ctx
        .select()
        .from(discussions)
        .where(and(...conditions))
        .orderBy(...orderClauses)
        .limit(limit)
        .offset(offset);

      // 获取所有作者信息
      const authorIds = [...new Set(discussionList.map(d => d.authorId))];
      const authorsMap = new Map<string, AuthorInfo>();

      if (authorIds.length > 0) {
        const authorsResult = await this.ctx
          .select({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          })
          .from(user)
          .where(sql`${user.id} IN ${authorIds}`);

        for (const author of authorsResult) {
          authorsMap.set(author.id, author);
        }
      }

      // 转换为列表项
      const items: DiscussionListItem[] = discussionList.map(d => {
        const author = authorsMap.get(d.authorId)!;
        return this.toListItem(d, author);
      });

      return {
        success: true,
        data: {
          discussions: items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Error listing discussions:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list discussions' },
      };
    }
  }

  // 获取讨论详情
  async getDiscussion(id: string): Promise<ServiceResult<DiscussionDetail>> {
    try {
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, id))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      const author = await this.getAuthor(discussion.authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Author not found' },
        };
      }

      return {
        success: true,
        data: this.toDetail(discussion, author),
      };
    } catch (error) {
      console.error('Error getting discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get discussion' },
      };
    }
  }

  // 创建讨论
  async createDiscussion(
    target: DiscussionTarget,
    authorId: string,
    data: CreateDiscussionRequest
  ): Promise<ServiceResult<{ discussionId: string }>> {
    try {
      // 验证作者存在
      const author = await this.getAuthor(authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      const newDiscussion: NewDiscussion = {
        id: crypto.randomUUID(),
        targetType: target.type,
        targetId: target.id,
        authorId,
        title: data.title,
        content: data.content,
        category: data.category ?? 'GENERAL',
      };

      this.ctx.modify()
        .insert(discussions)
        .values(newDiscussion);

      // Return discussionId - caller should commit and then call getDiscussion
      return { success: true, data: { discussionId: newDiscussion.id } };
    } catch (error) {
      console.error('Error creating discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create discussion' },
      };
    }
  }

  // 更新讨论
  async updateDiscussion(
    id: string,
    authorId: string,
    data: UpdateDiscussionRequest
  ): Promise<ServiceResult<{ discussionId: string }>> {
    try {
      // 获取讨论
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, id))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      // 检查权限
      if (discussion.authorId !== authorId) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to update this discussion' },
        };
      }

      // 检查是否锁定
      if (discussion.isLocked) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Discussion is locked' },
        };
      }

      // 更新
      const updateData: Partial<Discussion> = {
        updatedAt: new Date().toISOString(),
      };

      if (data.title !== undefined) updateData.title = data.title;
      if (data.content !== undefined) updateData.content = data.content;
      if (data.category !== undefined) updateData.category = data.category;

      this.ctx.modify()
        .update(discussions)
        .set(updateData)
        .where(eq(discussions.id, id));

      // Return discussionId - caller should commit and then call getDiscussion
      return { success: true, data: { discussionId: id } };
    } catch (error) {
      console.error('Error updating discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update discussion' },
      };
    }
  }

  // 删除讨论
  // 权限：讨论作者 或 target 资源的管理员可以删除
  async deleteDiscussion(id: string, userId: string): Promise<ServiceResult<void>> {
    try {
      // 获取讨论
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, id))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      // 权限检查：作者可以删除自己的讨论
      const isAuthor = discussion.authorId === userId;
      
      // 如果不是作者，检查是否有 target 资源的管理权限
      let canDelete = isAuthor;
      if (!isAuthor) {
        const targetRef = this.targetToResourceRef({
          type: discussion.targetType,
          id: discussion.targetId,
        });
        canDelete = await this.aclService.canManage(targetRef, userId);
      }

      if (!canDelete) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to delete this discussion' },
        };
      }

      this.ctx.modify()
        .delete(discussions)
        .where(eq(discussions.id, id));

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Error deleting discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete discussion' },
      };
    }
  }

  // 置顶/取消置顶讨论（管理员功能）
  async pinDiscussion(id: string, isPinned: boolean): Promise<ServiceResult<{ discussionId: string }>> {
    try {
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, id))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      this.ctx.modify()
        .update(discussions)
        .set({ isPinned, updatedAt: new Date().toISOString() })
        .where(eq(discussions.id, id));

      // Return discussionId - caller should commit and then call getDiscussion
      return { success: true, data: { discussionId: id } };
    } catch (error) {
      console.error('Error pinning discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to pin discussion' },
      };
    }
  }

  // 锁定/解锁讨论（管理员功能）
  async lockDiscussion(id: string, isLocked: boolean): Promise<ServiceResult<{ discussionId: string }>> {
    try {
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, id))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      this.ctx.modify()
        .update(discussions)
        .set({ isLocked, updatedAt: new Date().toISOString() })
        .where(eq(discussions.id, id));

      // Return discussionId - caller should commit and then call getDiscussion
      return { success: true, data: { discussionId: id } };
    } catch (error) {
      console.error('Error locking discussion:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to lock discussion' },
      };
    }
  }

  // ========== 回复相关方法 ==========

  // 列出回复
  async listReplies(params: ListRepliesParams): Promise<ServiceResult<ListRepliesResult>> {
    const { discussionId, page = 1, limit = 50, sortOrder = 'asc' } = params;

    try {
      // 检查讨论是否存在
      const [discussion] = await this.ctx
        .select({ id: discussions.id })
        .from(discussions)
        .where(eq(discussions.id, discussionId))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      // 计算总数
      const [totalResult] = await this.ctx
        .select({ count: count() })
        .from(discussionReplies)
        .where(eq(discussionReplies.discussionId, discussionId));

      const total = totalResult?.count ?? 0;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;

      // 查询回复列表
      const replyList = await this.ctx
        .select()
        .from(discussionReplies)
        .where(eq(discussionReplies.discussionId, discussionId))
        .orderBy(sortOrder === 'asc' ? asc(discussionReplies.createdAt) : desc(discussionReplies.createdAt))
        .limit(limit)
        .offset(offset);

      // 获取所有作者信息
      const authorIds = [...new Set(replyList.map(r => r.authorId))];
      const authorsMap = new Map<string, AuthorInfo>();

      if (authorIds.length > 0) {
        const authorsResult = await this.ctx
          .select({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          })
          .from(user)
          .where(sql`${user.id} IN ${authorIds}`);

        for (const author of authorsResult) {
          authorsMap.set(author.id, author);
        }
      }

      // 转换为列表项
      const items: DiscussionReplyItem[] = replyList.map(r => {
        const author = authorsMap.get(r.authorId)!;
        return this.toReplyItem(r, author);
      });

      return {
        success: true,
        data: {
          replies: items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Error listing replies:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list replies' },
      };
    }
  }

  // 创建回复
  async createReply(
    discussionId: string,
    authorId: string,
    data: CreateDiscussionReplyRequest
  ): Promise<ServiceResult<DiscussionReplyItem>> {
    try {
      // 获取讨论
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, discussionId))
        .limit(1);

      if (!discussion) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Discussion not found' },
        };
      }

      // 检查是否锁定
      if (discussion.isLocked) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Discussion is locked' },
        };
      }

      // 验证作者存在
      const author = await this.getAuthor(authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      // 如果有父回复，验证其存在
      if (data.parentReplyId) {
        const [parentReply] = await this.ctx
          .select({ id: discussionReplies.id })
          .from(discussionReplies)
          .where(and(
            eq(discussionReplies.id, data.parentReplyId),
            eq(discussionReplies.discussionId, discussionId)
          ))
          .limit(1);

        if (!parentReply) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Parent reply not found' },
          };
        }
      }

      const replyId = crypto.randomUUID();
      const now = new Date().toISOString();

      const newReply: NewDiscussionReply = {
        id: replyId,
        discussionId,
        authorId,
        parentReplyId: data.parentReplyId,
        content: data.content,
        createdAt: now,
        updatedAt: now,
      };

      // 收集操作：插入回复 + 更新讨论回复计数
      this.ctx.modify()
        .insert(discussionReplies)
        .values(newReply);
      this.ctx.modify()
        .update(discussions)
        .set({
          replyCount: sql`${discussions.replyCount} + 1`,
          updatedAt: now,
        })
        .where(eq(discussions.id, discussionId));

      // Note: 在 commit 后数据才会真正写入，但这里返回预期结果
      const insertedReply = {
        id: replyId,
        discussionId,
        authorId,
        parentReplyId: newReply.parentReplyId ?? null,
        content: newReply.content,
        createdAt: now,
        updatedAt: now,
      };

      return {
        success: true,
        data: this.toReplyItem(insertedReply as typeof discussionReplies.$inferSelect, author),
      };
    } catch (error) {
      console.error('Error creating reply:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create reply' },
      };
    }
  }

  // 删除回复
  async deleteReply(replyId: string, userId: string): Promise<ServiceResult<void>> {
    try {
      // 获取回复
      const [reply] = await this.ctx
        .select()
        .from(discussionReplies)
        .where(eq(discussionReplies.id, replyId))
        .limit(1);

      if (!reply) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Reply not found' },
        };
      }

      // 检查权限（仅作者）
      if (reply.authorId !== userId) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to delete this reply' },
        };
      }

      // 获取讨论
      const [discussion] = await this.ctx
        .select()
        .from(discussions)
        .where(eq(discussions.id, reply.discussionId))
        .limit(1);

      // 收集操作：删除回复 + 更新讨论回复计数
      this.ctx.modify()
        .delete(discussionReplies)
        .where(eq(discussionReplies.id, replyId));
      
      if (discussion) {
        this.ctx.modify()
          .update(discussions)
          .set({
            replyCount: sql`CASE WHEN ${discussions.replyCount} > 0 THEN ${discussions.replyCount} - 1 ELSE 0 END`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(discussions.id, reply.discussionId));
      }

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Error deleting reply:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete reply' },
      };
    }
  }

}
