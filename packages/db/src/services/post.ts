import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { projectPosts, type ProjectPost, type NewProjectPost } from '../schema/posts';
import { projects } from '../schema/projects';
import { discussions, discussionReplies, type NewDiscussion } from '../schema/discussions';
import { user } from '../schema/auth';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { resourceAcl } from '../schema/acl';
import type { ServiceError, ServiceResult } from './user';
import type {
  PostListItem,
  PostDetail,
  DiscussionDetail,
  CreatePostRequest,
  UpdatePostRequest,
  Pagination as PaginationInfo,
} from '@pubwiki/api';

// 重新导出类型
export type { PostListItem, PostDetail };

// 作者信息
interface AuthorInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// 列表查询参数
export interface ListPostsParams {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

// 列表响应
export interface ListPostsResult {
  posts: PostListItem[];
  pagination: PaginationInfo;
}

// 创建 Post 参数
export interface CreatePostParams {
  projectId: string;
  authorId: string;
  data: CreatePostRequest;
}

// 更新 Post 参数
export interface UpdatePostParams {
  postId: string;
  userId: string;
  data: UpdatePostRequest;
}

export class PostService {
  constructor(private db: Database) {}

  // 获取作者信息
  private async getAuthor(authorId: string): Promise<AuthorInfo | null> {
    const result = await this.db
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

  // 检查用户是否是 project 的 owner 或有写权限
  async isProjectMember(projectId: string, userId: string): Promise<ServiceResult<{ isOwner: boolean; isMaintainer: boolean }>> {
    try {
      // 获取 project 检查 owner
      const [project] = await this.db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        };
      }

      const isOwner = project.ownerId === userId;

      // 检查用户的 ACL 权限
      const userAcl = await this.db
        .select({ canWrite: resourceAcl.canWrite, canManage: resourceAcl.canManage })
        .from(resourceAcl)
        .where(and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projectId),
          eq(resourceAcl.userId, userId)
        ))
        .limit(1);

      const hasWritePermission = userAcl.length > 0 && (userAcl[0].canWrite || userAcl[0].canManage);

      return {
        success: true,
        data: {
          isOwner,
          // 向后兼容：有写权限等价于原来的 isMaintainer
          isMaintainer: hasWritePermission,
        },
      };
    } catch (error) {
      console.error('Failed to check project membership:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check project membership' },
      };
    }
  }

  // 转换为列表项
  private toListItem(post: ProjectPost, author: AuthorInfo, replyCount: number = 0): PostListItem {
    return {
      id: post.id,
      projectId: post.projectId,
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatarUrl: author.avatarUrl ?? undefined,
      },
      discussionId: post.discussionId ?? undefined,
      title: post.title,
      content: post.content,
      coverUrls: post.coverUrls ? JSON.parse(post.coverUrls) : undefined,
      isPinned: post.isPinned,
      replyCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  // 转换为详情
  private toDetail(post: ProjectPost, author: AuthorInfo, discussion?: DiscussionDetail | null, replyCount: number = 0): PostDetail {
    return {
      ...this.toListItem(post, author, replyCount),
      discussion: discussion ?? undefined,
    };
  }

  // 获取 project 的 posts 列表
  async listPosts(projectId: string, params: ListPostsParams = {}): Promise<ServiceResult<ListPostsResult>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 检查 project 是否存在
      const [project] = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        };
      }

      // 获取总数
      const countResult = await this.db
        .select({ count: count() })
        .from(projectPosts)
        .where(eq(projectPosts.projectId, projectId));

      const total = countResult[0]?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序（置顶的排在最前）
      const orderColumn = sortBy === 'updatedAt' ? projectPosts.updatedAt : projectPosts.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // 获取 posts（置顶优先）
      const postRows = await this.db
        .select({
          post: projectPosts,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        })
        .from(projectPosts)
        .leftJoin(user, eq(projectPosts.authorId, user.id))
        .where(eq(projectPosts.projectId, projectId))
        .orderBy(desc(projectPosts.isPinned), orderFn(orderColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取每个 post 关联的 discussion 的回复数
      const postIds = postRows.map(r => r.post.id);
      const discussionIds = postRows.filter(r => r.post.discussionId).map(r => r.post.discussionId!);
      
      let replyCountMap = new Map<string, number>();
      if (discussionIds.length > 0) {
        const replyCounts = await this.db
          .select({
            discussionId: discussions.id,
            replyCount: discussions.replyCount,
          })
          .from(discussions)
          .where(sql`${discussions.id} IN (${sql.join(discussionIds.map(id => sql`${id}`), sql`, `)})`);

        replyCountMap = new Map(replyCounts.map(r => [r.discussionId, r.replyCount]));
      }

      const posts: PostListItem[] = postRows
        .filter(row => row.author)
        .map(row => {
          const replyCount = row.post.discussionId ? (replyCountMap.get(row.post.discussionId) ?? 0) : 0;
          return this.toListItem(row.post, row.author!, replyCount);
        });

      return {
        success: true,
        data: {
          posts,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Error listing posts:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list posts' },
      };
    }
  }

  // 获取单个 post 详情
  async getPost(projectId: string, postId: string): Promise<ServiceResult<PostDetail>> {
    try {
      // 获取 post 及其作者
      const [result] = await this.db
        .select({
          post: projectPosts,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        })
        .from(projectPosts)
        .leftJoin(user, eq(projectPosts.authorId, user.id))
        .where(and(
          eq(projectPosts.projectId, projectId),
          eq(projectPosts.id, postId)
        ))
        .limit(1);

      if (!result || !result.author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Post not found' },
        };
      }

      // 获取关联的 discussion 详情
      let discussionDetail: DiscussionDetail | null = null;
      let replyCount = 0;
      if (result.post.discussionId) {
        const [discussion] = await this.db
          .select({
            id: discussions.id,
            targetType: discussions.targetType,
            targetId: discussions.targetId,
            authorId: discussions.authorId,
            title: discussions.title,
            content: discussions.content,
            category: discussions.category,
            isPinned: discussions.isPinned,
            isLocked: discussions.isLocked,
            replyCount: discussions.replyCount,
            createdAt: discussions.createdAt,
            updatedAt: discussions.updatedAt,
          })
          .from(discussions)
          .where(eq(discussions.id, result.post.discussionId))
          .limit(1);

        if (discussion) {
          replyCount = discussion.replyCount;
          const discussionAuthor = await this.getAuthor(discussion.authorId);
          if (discussionAuthor) {
            discussionDetail = {
              id: discussion.id,
              targetType: discussion.targetType,
              targetId: discussion.targetId,
              author: {
                id: discussionAuthor.id,
                username: discussionAuthor.username,
                displayName: discussionAuthor.displayName ?? undefined,
                avatarUrl: discussionAuthor.avatarUrl ?? undefined,
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
        }
      }

      return {
        success: true,
        data: this.toDetail(result.post, result.author, discussionDetail, replyCount),
      };
    } catch (error) {
      console.error('Error getting post:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get post' },
      };
    }
  }

  // 创建 post（同时创建关联的 discussion）
  async createPost(params: CreatePostParams): Promise<ServiceResult<PostDetail>> {
    const { projectId, authorId, data } = params;

    try {
      // 检查 project 是否存在
      const [project] = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        };
      }

      // 检查作者是否存在
      const author = await this.getAuthor(authorId);
      if (!author) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Author not found' },
        };
      }

      // 使用 batch 来保证原子性：先创建 discussion，再创建 post
      const postId = crypto.randomUUID();
      const discussionId = crypto.randomUUID();

      // 创建 discussion（以 POST 为目标类型）
      const newDiscussion: NewDiscussion = {
        id: discussionId,
        targetType: 'POST',
        targetId: postId,
        authorId,
        title: data.title, // 使用 post 标题作为 discussion 标题
        content: '', // Discussion 内容为空，因为内容在 post 中
        category: 'GENERAL',
      };

      // 创建 post
      const newPost: NewProjectPost = {
        id: postId,
        projectId,
        authorId,
        discussionId,
        title: data.title,
        content: data.content,
        coverUrls: data.coverUrls ? JSON.stringify(data.coverUrls) : null,
        isPinned: false,
      };

      // 使用 batch 执行原子操作
      await this.db.batch([
        this.db.insert(discussions).values(newDiscussion),
        this.db.insert(projectPosts).values(newPost),
      ]);

      // 获取创建的 post 详情
      return this.getPost(projectId, postId);
    } catch (error) {
      console.error('Error creating post:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create post' },
      };
    }
  }

  // 更新 post
  async updatePost(projectId: string, postId: string, userId: string, data: UpdatePostRequest): Promise<ServiceResult<PostDetail>> {
    try {
      // 获取现有 post
      const [existingPost] = await this.db
        .select()
        .from(projectPosts)
        .where(and(
          eq(projectPosts.projectId, projectId),
          eq(projectPosts.id, postId)
        ))
        .limit(1);

      if (!existingPost) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Post not found' },
        };
      }

      // 检查权限：作者可以更新标题、内容、封面；owner/maintainer 可以额外设置置顶
      const isAuthor = existingPost.authorId === userId;
      const memberResult = await this.isProjectMember(projectId, userId);
      
      if (!memberResult.success) {
        return memberResult;
      }

      const { isOwner, isMaintainer } = memberResult.data;
      const canUpdate = isAuthor || isOwner || isMaintainer;
      const canPin = isOwner || isMaintainer;

      if (!canUpdate) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to update this post' },
        };
      }

      // 如果尝试设置置顶但没有权限
      if (data.isPinned !== undefined && !canPin) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only owner or maintainer can pin/unpin posts' },
        };
      }

      // 构建更新对象
      const updateData: Partial<ProjectPost> = {
        updatedAt: new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19),
      };

      if (data.title !== undefined) updateData.title = data.title;
      if (data.content !== undefined) updateData.content = data.content;
      if (data.coverUrls !== undefined) updateData.coverUrls = JSON.stringify(data.coverUrls);
      if (data.isPinned !== undefined && canPin) updateData.isPinned = data.isPinned;

      // 使用 batch 原子更新 post 和关联的 discussion
      if (data.title !== undefined && existingPost.discussionId) {
        // 同时更新 post 和 discussion
        await this.db.batch([
          this.db
            .update(projectPosts)
            .set(updateData)
            .where(eq(projectPosts.id, postId)),
          this.db
            .update(discussions)
            .set({ 
              title: data.title,
              updatedAt: updateData.updatedAt,
            })
            .where(eq(discussions.id, existingPost.discussionId)),
        ]);
      } else {
        // 只更新 post
        await this.db
          .update(projectPosts)
          .set(updateData)
          .where(eq(projectPosts.id, postId));
      }

      // 返回更新后的 post 详情
      return this.getPost(projectId, postId);
    } catch (error) {
      console.error('Error updating post:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update post' },
      };
    }
  }

  // 删除 post（同时删除关联的 discussion）
  async deletePost(projectId: string, postId: string, userId: string): Promise<ServiceResult<void>> {
    try {
      // 获取现有 post
      const [existingPost] = await this.db
        .select()
        .from(projectPosts)
        .where(and(
          eq(projectPosts.projectId, projectId),
          eq(projectPosts.id, postId)
        ))
        .limit(1);

      if (!existingPost) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Post not found' },
        };
      }

      // 检查权限：作者、owner 或 maintainer 可以删除
      const isAuthor = existingPost.authorId === userId;
      const memberResult = await this.isProjectMember(projectId, userId);
      
      if (!memberResult.success) {
        return memberResult;
      }

      const { isOwner, isMaintainer } = memberResult.data;
      const canDelete = isAuthor || isOwner || isMaintainer;

      if (!canDelete) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to delete this post' },
        };
      }

      // 使用 batch 原子删除 post 和关联的 discussion
      if (existingPost.discussionId) {
        // 删除 post、discussion 和回复
        await this.db.batch([
          this.db.delete(discussionReplies).where(eq(discussionReplies.discussionId, existingPost.discussionId)),
          this.db.delete(projectPosts).where(eq(projectPosts.id, postId)),
          this.db.delete(discussions).where(eq(discussions.id, existingPost.discussionId)),
        ]);
      } else {
        // 只删除 post
        await this.db.delete(projectPosts).where(eq(projectPosts.id, postId));
      }

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Error deleting post:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete post' },
      };
    }
  }

  // 获取 project 信息（用于权限检查）
  async getProject(projectId: string): Promise<ServiceResult<{ id: string; ownerId: string; isListed: boolean }>> {
    try {
      const result = await this.db
        .select({
          id: projects.id,
          ownerId: projects.ownerId,
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(projects)
        .leftJoin(
          resourceDiscoveryControl,
          and(
            eq(resourceDiscoveryControl.resourceType, 'project'),
            eq(resourceDiscoveryControl.resourceId, projects.id)
          )
        )
        .where(eq(projects.id, projectId))
        .limit(1);

      const row = result[0];
      if (!row) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        };
      }

      return {
        success: true,
        data: {
          id: row.id,
          ownerId: row.ownerId,
          isListed: row.isListed ?? false,
        },
      };
    } catch (error) {
      console.error('Error getting project:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get project' },
      };
    }
  }
}
