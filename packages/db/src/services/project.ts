import { eq, and, asc, desc, sql, count, inArray } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { projects, projectArtifacts, projectRoles, projectPages, type Project } from '../schema/projects';
import { projectPosts } from '../schema/posts';
import { discussions, discussionReplies } from '../schema/discussions';
import { artifacts, tags, artifactTags } from '../schema/artifacts';
import { artifactStats } from '../schema/stats';
import { user, type User } from '../schema/auth';
import type { ServiceResult } from './user';
import type {
  ProjectListItem,
  ProjectDetail,
  ProjectArtifact as ProjectArtifactItem,
  UserProjectListItem,
  CreateProjectMetadata,
  CreateProjectRole,
  ProjectPage as ProjectPageItem,
  ProjectPageDetail,
  operations,
} from '@pubwiki/api';
import { resourceDiscoveryControl } from '../schema/discovery-control';
import { resourceAcl, PUBLIC_USER_ID } from '../schema/acl';
import { AclService, DiscoveryService } from './access-control';

// 重新导出供其他模块使用
export type { ProjectListItem, ProjectDetail, ProjectArtifactItem, UserProjectListItem, CreateProjectMetadata, ProjectPageItem, ProjectPageDetail };

// ============================================================================
// 类型定义：从 API operations 提取查询参数和响应类型
// ============================================================================

// listProjects 查询参数和响应
export type ListProjectsParams = operations['listProjects']['parameters']['query'];
export type ListProjectsResult = operations['listProjects']['responses']['200']['content']['application/json'];

// getUserProjects 查询参数和响应（服务层增加 viewerId 用于权限判断）
type GetUserProjectsQuery = NonNullable<operations['getUserProjects']['parameters']['query']>;
export type ListUserProjectsParams = GetUserProjectsQuery & {
  viewerId?: string;  // 服务层扩展：查看者 ID，用于判断是否能看到私有资源
};
export type ListUserProjectsResult = operations['getUserProjects']['responses']['200']['content']['application/json'];

// listProjectArtifacts 查询参数和响应
export type ListProjectArtifactsParams = NonNullable<operations['listProjectArtifacts']['parameters']['query']>;
export type ListProjectArtifactsResult = operations['listProjectArtifacts']['responses']['200']['content']['application/json'];

// linkArtifactToProject 请求体（服务层增加 projectId 和 userId）
type LinkArtifactRequestBody = operations['linkArtifactToProject']['requestBody']['content']['application/json'];
export type LinkArtifactToProjectParams = LinkArtifactRequestBody & {
  projectId: string;  // 服务层需要，API 从 path 获取
  userId: string;     // 服务层需要，用于权限检查
};

// 创建 project 参数
export interface CreateProjectParams {
  ownerId: string;
  metadata: CreateProjectMetadata;
}

// Delete project parameters
export interface DeleteProjectParams {
  projectId: operations['deleteProject']['parameters']['path']['projectId'];
  userId: string; // from auth context
}

export class ProjectService {
  private readonly aclService: AclService;
  private readonly discoveryService: DiscoveryService;

  constructor(private ctx: BatchContext) {
    this.aclService = new AclService(ctx);
    this.discoveryService = new DiscoveryService(ctx);
  }

  // 拓扑排序角色，确保父角色在子角色之前
  // 使用 name 作为唯一标识符
  // 如果存在循环引用，抛出错误
  private topologicalSortRoles(roles: CreateProjectRole[]): CreateProjectRole[] {
    const result: CreateProjectRole[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>(); // 正在访问的节点，用于检测循环
    const roleMap = new Map(roles.map(r => [r.name, r]));

    const visit = (role: CreateProjectRole): void => {
      if (visited.has(role.name)) return;
      
      // 检测循环引用
      if (visiting.has(role.name)) {
        throw new Error(`Circular reference detected in roles: role "${role.name}" is part of a cycle`);
      }
      
      visiting.add(role.name);

      // 如果有父角色，先访问父角色
      if (role.parentName) {
        const parent = roleMap.get(role.parentName);
        if (parent) {
          visit(parent);
        }
      }

      visiting.delete(role.name);
      visited.add(role.name);
      result.push(role);
    };

    for (const role of roles) {
      visit(role);
    }

    return result;
  }

  // 获取公开 project 列表
  async listPublicProjects(params: ListProjectsParams = {}): Promise<ServiceResult<ListProjectsResult>> {
    const {
      page = 1,
      limit = 20,
      topic,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建基础条件：只查询公开（有 PUBLIC_USER_ID ACL）且 isListed=true 且未归档的 projects
      const baseConditions = [
        eq(resourceDiscoveryControl.resourceType, 'project'),
        eq(resourceDiscoveryControl.isListed, true),
        eq(resourceAcl.userId, PUBLIC_USER_ID),
        eq(projects.isArchived, false),
      ];

      // Topic 过滤
      if (topic) {
        baseConditions.push(eq(projects.topic, topic));
      }

      // 获取总数
      const countResult = await this.ctx
        .select({ count: count() })
        .from(projects)
        .innerJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'project'),
          eq(resourceDiscoveryControl.resourceId, projects.id)
        ))
        .innerJoin(resourceAcl, and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projects.id),
          eq(resourceAcl.userId, PUBLIC_USER_ID)
        ))
        .where(and(...baseConditions));

      const total = countResult[0]?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序
      const orderColumn = sortBy === 'updatedAt' ? projects.updatedAt : projects.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // 获取 project 列表（关联 owner）
      const projectRows = await this.ctx
        .select({
          id: projects.id,
          name: projects.name,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          isListed: resourceDiscoveryControl.isListed,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.displayName,
          ownerAvatarUrl: user.avatarUrl,
        })
        .from(projects)
        .innerJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'project'),
          eq(resourceDiscoveryControl.resourceId, projects.id)
        ))
        .innerJoin(resourceAcl, and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projects.id),
          eq(resourceAcl.userId, PUBLIC_USER_ID)
        ))
        .innerJoin(user, eq(projects.ownerId, user.id))
        .where(and(...baseConditions))
        .orderBy(orderFn(orderColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取每个 project 的 artifact 数量
      const projectIds = projectRows.map(p => p.id);
      
      const artifactCounts: Record<string, number> = {};

      if (projectIds.length > 0) {
        // 获取 artifact 数量
        const artifactResults = await this.ctx
          .select({
            projectId: projectArtifacts.projectId,
            count: count(),
          })
          .from(projectArtifacts)
          .where(sql`${projectArtifacts.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(projectArtifacts.projectId);

        for (const r of artifactResults) {
          artifactCounts[r.projectId] = r.count;
        }
      }

      // 组装结果
      const projectList: ProjectListItem[] = projectRows.map(row => ({
        id: row.id,
        name: row.name,
        topic: row.topic,
        description: row.description,
        license: row.license,
        coverUrls: row.coverUrls ? JSON.parse(row.coverUrls) : [],
        isListed: row.isListed ?? true,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        owner: {
          id: row.ownerId,
          username: row.ownerUsername ?? '',
          displayName: row.ownerDisplayName,
          avatarUrl: row.ownerAvatarUrl,
        },
        artifactCount: artifactCounts[row.id] ?? 0,
      }));

      return {
        success: true,
        data: {
          projects: projectList,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Failed to list projects:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list projects',
        },
      };
    }
  }

  // 根据 ID 获取 project
  async getProjectById(projectId: string): Promise<ServiceResult<{ project: Project; owner: User }>> {
    try {
      const result = await this.ctx
        .select()
        .from(projects)
        .innerJoin(user, eq(projects.ownerId, user.id))
        .where(eq(projects.id, projectId))
        .limit(1);

      if (result.length === 0 || !result[0].projects) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
          },
        };
      }

      return {
        success: true,
        data: {
          project: result[0].projects,
          owner: result[0].user!,
        },
      };
    } catch (error) {
      console.error('Failed to get project:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get project',
        },
      };
    }
  }

  // 检查用户是否有项目的写权限（替代原来的 isMaintainer）
  async hasWritePermission(projectId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.ctx
        .select({ canWrite: resourceAcl.canWrite, canManage: resourceAcl.canManage })
        .from(resourceAcl)
        .where(and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projectId),
          eq(resourceAcl.userId, userId)
        ))
        .limit(1);

      return result.length > 0 && (result[0].canWrite || result[0].canManage);
    } catch (error) {
      console.error('Failed to check write permission:', error);
      return false;
    }
  }

  // 获取 project 详情（包含 maintainers, artifacts, roles, pages）
  async getProjectDetails(projectId: string): Promise<ServiceResult<ProjectDetail>> {
    try {
      // 1. 获取 project 基本信息和 owner
      const projectResult = await this.ctx
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          homepageId: projects.homepageId,
          isListed: resourceDiscoveryControl.isListed,
          isArchived: projects.isArchived,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.displayName,
          ownerAvatarUrl: user.avatarUrl,
        })
        .from(projects)
        .leftJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'project'),
          eq(resourceDiscoveryControl.resourceId, projects.id)
        ))
        .innerJoin(user, eq(projects.ownerId, user.id))
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResult.length === 0) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
          },
        };
      }

      const project = projectResult[0];

      // 检查 project 是否有 PUBLIC_USER_ID ACL
      await this.ctx
        .select({ resourceId: resourceAcl.resourceId })
        .from(resourceAcl)
        .where(and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projectId),
          eq(resourceAcl.userId, PUBLIC_USER_ID)
        ))
        .limit(1);

      // 2. 获取 roles
      const roleRows = await this.ctx
        .select({
          id: projectRoles.id,
          name: projectRoles.name,
          description: projectRoles.description,
          parentRoleId: projectRoles.parentRoleId,
          isLeaf: projectRoles.isLeaf,
          createdAt: projectRoles.createdAt,
        })
        .from(projectRoles)
        .where(eq(projectRoles.projectId, projectId));

      // 4. 获取 pages（按 order 排序，不包含内容）
      const pageRows = await this.ctx
        .select({
          id: projectPages.id,
          name: projectPages.name,
          icon: projectPages.icon,
          order: projectPages.order,
          createdAt: projectPages.createdAt,
          updatedAt: projectPages.updatedAt,
        })
        .from(projectPages)
        .where(eq(projectPages.projectId, projectId))
        .orderBy(asc(projectPages.order));

      // 5. 获取关联的 artifacts（包含角色信息）
      const artifactRelations = await this.ctx
        .select({
          artifactId: projectArtifacts.artifactId,
          roleId: projectArtifacts.roleId,
          isOfficial: projectArtifacts.isOfficial,
          relationCreatedAt: projectArtifacts.createdAt,
          // Artifact 基本信息
          id: artifacts.id,
          name: artifacts.name,
          description: artifacts.description,
          isListed: resourceDiscoveryControl.isListed,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
          authorId: artifacts.authorId,
          // Author 信息
          authorUsername: user.username,
          authorDisplayName: user.displayName,
          authorAvatarUrl: user.avatarUrl,
        })
        .from(projectArtifacts)
        .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
        .leftJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'artifact'),
          eq(resourceDiscoveryControl.resourceId, artifacts.id)
        ))
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .where(eq(projectArtifacts.projectId, projectId));

      // 创建 role 映射
      const roleMap = new Map(roleRows.map(r => [r.id, r]));

      // 6. 获取 artifacts 的 tags 和 stats
      const artifactIds = artifactRelations.map(a => a.id);
      
      const tagsMap: Record<string, { slug: string; name: string; description: string | null; color: string | null }[]> = {};
      const statsMap: Record<string, { viewCount: number; starCount: number; forkCount: number; downloadCount: number }> = {};

      if (artifactIds.length > 0) {
        // 获取 tags
        const tagResults = await this.ctx
          .select({
            artifactId: artifactTags.artifactId,
            tagSlug: tags.slug,
            tagName: tags.name,
            tagDescription: tags.description,
            tagColor: tags.color,
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          if (!tagsMap[row.artifactId]) {
            tagsMap[row.artifactId] = [];
          }
          tagsMap[row.artifactId].push({
            slug: row.tagSlug,
            name: row.tagName,
            description: row.tagDescription,
            color: row.tagColor,
          });
        }

        // 获取 stats
        const statsResults = await this.ctx
          .select()
          .from(artifactStats)
          .where(inArray(artifactStats.artifactId, artifactIds));

        for (const row of statsResults) {
          statsMap[row.artifactId] = {
            viewCount: row.viewCount,
            starCount: row.favCount,
            forkCount: row.refCount,
            downloadCount: row.downloadCount,
          };
        }
      }

      // 构建 artifacts 列表
      const projectArtifactItems: ProjectArtifactItem[] = artifactRelations.map(a => ({
        artifact: {
          id: a.id,
          name: a.name,
          description: a.description,
          isListed: a.isListed ?? false,
          thumbnailUrl: a.thumbnailUrl,
          license: a.license,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          author: {
            id: a.authorId,
            username: a.authorUsername ?? '',
            displayName: a.authorDisplayName,
            avatarUrl: a.authorAvatarUrl,
          },
          tags: tagsMap[a.id] ?? [],
          stats: statsMap[a.id],
        },
        role: a.roleId ? roleMap.get(a.roleId) : undefined,
        isOfficial: a.isOfficial,
        createdAt: a.relationCreatedAt,
      }));

      return {
        success: true,
        data: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          topic: project.topic,
          description: project.description,
          license: project.license,
          coverUrls: project.coverUrls ? JSON.parse(project.coverUrls) : [],
          isListed: project.isListed ?? false,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          owner: {
            id: project.ownerId,
            username: project.ownerUsername ?? '',
            displayName: project.ownerDisplayName,
            avatarUrl: project.ownerAvatarUrl,
          },
          artifacts: projectArtifactItems,
          roles: roleRows,
          pages: pageRows,
          homepageId: project.homepageId,
        },
      };
    } catch (error) {
      console.error('Failed to get project details:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get project details',
        },
      };
    }
  }

  // 获取用户拥有的 project 列表
  async listUserProjects(
    userId: string,
    params: ListUserProjectsParams = {}
  ): Promise<ServiceResult<ListUserProjectsResult>> {
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
      // 构建排序
      const orderColumn = projects[sortBy];
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // 获取用户 own 的 projects
      const ownedConditions = [
        eq(projects.ownerId, userId),
        eq(projects.isArchived, false),
      ];
      // 如果不是自己查看自己，只查询 isListed = true 的
      if (!isSelf) {
        ownedConditions.push(eq(resourceDiscoveryControl.isListed, true));
      }

      // 获取总数
      // 注意：使用 INNER JOIN resourceDiscoveryControl，因为 createProject 会同时创建 discovery control 记录
      // 如果用 LEFT JOIN + WHERE isListed=true，会过滤掉 isListed=NULL 的行，效果等同于 INNER JOIN 但语义不清晰
      const countResult = await this.ctx
        .select({ count: count() })
        .from(projects)
        .innerJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'project'),
          eq(resourceDiscoveryControl.resourceId, projects.id)
        ))
        .where(and(...ownedConditions));

      const total = countResult[0]?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      if (total === 0) {
        return {
          success: true,
          data: {
            projects: [],
            pagination: {
              page: validPage,
              limit: validLimit,
              total: 0,
              totalPages: 0,
            },
          },
        };
      }

      // 获取 project 列表（关联 owner 和 discovery control）
      // 注意：resourceDiscoveryControl 使用 INNER JOIN（每个 project 都有对应记录）
      const projectRows = await this.ctx
        .select({
          id: projects.id,
          name: projects.name,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          isListed: resourceDiscoveryControl.isListed,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.displayName,
          ownerAvatarUrl: user.avatarUrl,
        })
        .from(projects)
        .innerJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'project'),
          eq(resourceDiscoveryControl.resourceId, projects.id)
        ))
        .innerJoin(user, eq(projects.ownerId, user.id))
        .where(and(...ownedConditions))
        .orderBy(orderFn(orderColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取每个 project 的 artifact 数量
      const projectIds = projectRows.map(p => p.id);
      
      const artifactCounts: Record<string, number> = {};

      if (projectIds.length > 0) {
        // 获取 artifact 数量
        const artifactResults = await this.ctx
          .select({
            projectId: projectArtifacts.projectId,
            count: count(),
          })
          .from(projectArtifacts)
          .where(sql`${projectArtifacts.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(projectArtifacts.projectId);

        for (const r of artifactResults) {
          artifactCounts[r.projectId] = r.count;
        }
      }

      // 组装结果
      const projectList: UserProjectListItem[] = projectRows.map(row => ({
        id: row.id,
        name: row.name,
        topic: row.topic,
        description: row.description,
        license: row.license,
        coverUrls: row.coverUrls ? JSON.parse(row.coverUrls) : [],
        isListed: row.isListed ?? false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        owner: {
          id: row.ownerId,
          username: row.ownerUsername ?? '',
          displayName: row.ownerDisplayName,
          avatarUrl: row.ownerAvatarUrl,
        },
        artifactCount: artifactCounts[row.id] ?? 0,
      }));

      return {
        success: true,
        data: {
          projects: projectList,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Failed to list user projects:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list user projects',
        },
      };
    }
  }

  /**
   * Create a project with all related records.
   * Returns the projectId after collecting all writes into batch.
   * The caller should commit the batch and then call getProjectDetails to get the full detail.
   */
  async createProject(params: CreateProjectParams): Promise<ServiceResult<{ projectId: string }>> {
    const { ownerId, metadata } = params;

    try {
      // === 验证阶段（batch 前检查）===
      
      // 验证至少有一个 role
      if (!metadata.roles || metadata.roles.length === 0) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'At least one role is required',
          },
        };
      }

      // 验证 role name 唯一性
      const roleNames = metadata.roles.map(r => r.name);
      const uniqueRoleNames = new Set(roleNames);
      if (roleNames.length !== uniqueRoleNames.size) {
        const duplicates = roleNames.filter((name, index) => roleNames.indexOf(name) !== index);
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Duplicate role names are not allowed: ${[...new Set(duplicates)].join(', ')}`,
          },
        };
      }

      // 检查 slug 是否已存在
      const existingProject = await this.ctx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, metadata.slug))
        .limit(1);

      if (existingProject.length > 0) {
        return {
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'A project with this slug already exists',
          },
        };
      }

      // 验证 artifacts（如果提供）
      if (metadata.artifacts && metadata.artifacts.length > 0) {
        const artifactIds = metadata.artifacts.map(a => a.artifactId);
        const existingArtifacts = await this.ctx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(inArray(artifacts.id, artifactIds));

        if (existingArtifacts.length !== artifactIds.length) {
          const foundIds = new Set(existingArtifacts.map(a => a.id));
          const missingIds = artifactIds.filter(id => !foundIds.has(id));
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Artifacts not found: ${missingIds.join(', ')}`,
            },
          };
        }

        // 验证 roleName 引用有效且是叶子角色（将在后面验证 isLeaf）
        for (const artifact of metadata.artifacts) {
          if (!uniqueRoleNames.has(artifact.roleName)) {
            return {
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: `Role "${artifact.roleName}" not found for artifact ${artifact.artifactId}`,
              },
            };
          }
        }
      }

      // 验证 roles 的树结构（使用 name 作为标识）
      const roleNameSet = new Set(metadata.roles.map(r => r.name));
      for (const role of metadata.roles) {
        if (role.parentName && !roleNameSet.has(role.parentName)) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Parent role "${role.parentName}" not found for role "${role.name}"`,
            },
          };
        }
      }

      // 按拓扑顺序排序 roles
      let sortedRoles: CreateProjectRole[];
      try {
        sortedRoles = this.topologicalSortRoles(metadata.roles);
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'Invalid role hierarchy',
          },
        };
      }

      // 验证 homepageIndex（如果提供）
      if (metadata.homepageIndex !== undefined && metadata.homepageIndex !== null) {
        if (!metadata.pages || metadata.homepageIndex >= metadata.pages.length) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'homepageIndex is out of range',
            },
          };
        }
      }

      // === 准备阶段：生成所有 ID ===
      const projectId = crypto.randomUUID();
      
      // 生成 page IDs 并确定 homepageId
      const pageIds: string[] = [];
      let homepageId: string | null = null;
      if (metadata.pages && metadata.pages.length > 0) {
        for (let i = 0; i < metadata.pages.length; i++) {
          const pageId = crypto.randomUUID();
          pageIds.push(pageId);
          if (metadata.homepageIndex !== undefined && i === metadata.homepageIndex) {
            homepageId = pageId;
          }
        }
      }
      
      // 生成 role IDs 并建立 name -> realId 映射
      const nameToRealId = new Map<string, string>();
      const parentNames = new Set(metadata.roles.filter(r => r.parentName).map(r => r.parentName!));
      
      for (const role of sortedRoles) {
        const roleId = crypto.randomUUID();
        nameToRealId.set(role.name, roleId);
      }

      // 验证 artifacts 关联的角色是叶子角色
      if (metadata.artifacts && metadata.artifacts.length > 0) {
        for (const artifact of metadata.artifacts) {
          if (parentNames.has(artifact.roleName)) {
            return {
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: `Role "${artifact.roleName}" is not a leaf role. Artifacts can only be linked to leaf roles.`,
              },
            };
          }
        }
      }

      // === 收集写操作到 BatchContext ===

      // 1. 创建 project
      this.ctx.modify(db => db.insert(projects).values({
        id: projectId,
        ownerId,
        name: metadata.name,
        slug: metadata.slug,
        topic: metadata.topic,
        description: metadata.description,
        license: metadata.license,
        coverUrls: metadata.coverUrls ? JSON.stringify(metadata.coverUrls) : null,
        homepageId, // 直接设置，因为我们已经知道 page ID
      }));

      // 1.1 创建发现控制记录 using DiscoveryService
      const isListed = metadata.isListed ?? true;
      const projectRef = { type: 'project' as const, id: projectId };
      this.discoveryService.create(projectRef, isListed);

      // 创建 owner ACL using AclService
      this.aclService.grantOwner(projectRef, ownerId);

      // 默认创建公开读取 ACL using AclService
      this.aclService.setPublic(projectRef, ownerId);

      // 2. 创建 pages（如果提供）
      if (metadata.pages && metadata.pages.length > 0) {
        for (let i = 0; i < metadata.pages.length; i++) {
          const page = metadata.pages[i];
          this.ctx.modify(db => db.insert(projectPages).values({
            id: pageIds[i],
            projectId,
            name: page.name,
            icon: page.icon,
            content: page.content,
            order: i,
          }));
        }
      }

      // 3. 创建 roles
      for (const role of sortedRoles) {
        const roleId = nameToRealId.get(role.name)!;
        const parentRoleId = role.parentName ? nameToRealId.get(role.parentName) : null;
        const isLeaf = !parentNames.has(role.name);
        
        this.ctx.modify(db => db.insert(projectRoles).values({
          id: roleId,
          projectId,
          name: role.name,
          description: role.description,
          parentRoleId,
          isLeaf,
        }));
      }

      // 4. 关联 artifacts（如果提供），设置 isOfficial = true
      if (metadata.artifacts && metadata.artifacts.length > 0) {
        for (const artifact of metadata.artifacts) {
          const roleId = nameToRealId.get(artifact.roleName)!;
          this.ctx.modify(db => db.insert(projectArtifacts).values({
            projectId,
            artifactId: artifact.artifactId,
            roleId,
            isOfficial: true,
          }));
        }
      }

      // Return the projectId - caller should commit and then call getProjectDetails
      return {
        success: true,
        data: { projectId },
      };
    } catch (error) {
      console.error('Failed to create project:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create project',
        },
      };
    }
  }

  // 获取 project page 详情（包含内容）
  async getProjectPage(projectId: string, pageId: string): Promise<ServiceResult<ProjectPageDetail>> {
    try {
      // 获取 page 详情
      const [page] = await this.ctx
        .select({
          id: projectPages.id,
          projectId: projectPages.projectId,
          name: projectPages.name,
          icon: projectPages.icon,
          content: projectPages.content,
          order: projectPages.order,
          createdAt: projectPages.createdAt,
          updatedAt: projectPages.updatedAt,
        })
        .from(projectPages)
        .where(and(
          eq(projectPages.projectId, projectId),
          eq(projectPages.id, pageId)
        ))
        .limit(1);

      if (!page) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Page not found',
          },
        };
      }

      return {
        success: true,
        data: page,
      };
    } catch (error) {
      console.error('Failed to get project page:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get project page',
        },
      };
    }
  }

  // 获取 project 中的 artifact 列表
  async listProjectArtifacts(
    projectId: string,
    params: ListProjectArtifactsParams = {}
  ): Promise<ServiceResult<ListProjectArtifactsResult>> {
    const {
      page = 1,
      limit = 20,
      roleId,
      isOfficial,
      sortOrder = 'desc',
    } = params;

    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 验证 project 存在
      const projectExists = await this.ctx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectExists.length === 0) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
          },
        };
      }

      // 构建过滤条件
      const conditions = [eq(projectArtifacts.projectId, projectId)];
      
      if (roleId !== undefined) {
        if (roleId === null) {
          conditions.push(sql`${projectArtifacts.roleId} IS NULL`);
        } else {
          conditions.push(eq(projectArtifacts.roleId, roleId));
        }
      }
      
      if (isOfficial !== undefined) {
        conditions.push(eq(projectArtifacts.isOfficial, isOfficial));
      }

      const whereClause = and(...conditions);

      // 获取总数
      const [{ total }] = await this.ctx
        .select({ total: count() })
        .from(projectArtifacts)
        .where(whereClause);

      const totalPages = Math.ceil(total / validLimit);

      // 获取 artifacts（默认按关联创建时间排序）
      const orderFn = sortOrder === 'asc' ? asc : desc;

      const artifactRelations = await this.ctx
        .select({
          artifactId: projectArtifacts.artifactId,
          roleId: projectArtifacts.roleId,
          isOfficial: projectArtifacts.isOfficial,
          relationCreatedAt: projectArtifacts.createdAt,
          // Artifact 基本信息
          id: artifacts.id,
          name: artifacts.name,
          description: artifacts.description,
          isListed: resourceDiscoveryControl.isListed,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
          authorId: artifacts.authorId,
          // Author 信息
          authorUsername: user.username,
          authorDisplayName: user.displayName,
          authorAvatarUrl: user.avatarUrl,
        })
        .from(projectArtifacts)
        .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
        .leftJoin(resourceDiscoveryControl, and(
          eq(resourceDiscoveryControl.resourceType, 'artifact'),
          eq(resourceDiscoveryControl.resourceId, artifacts.id)
        ))
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .where(whereClause)
        .orderBy(orderFn(projectArtifacts.createdAt))
        .limit(validLimit)
        .offset(offset);

      // 获取 roles 映射
      const roleRows = await this.ctx
        .select({
          id: projectRoles.id,
          name: projectRoles.name,
          description: projectRoles.description,
          parentRoleId: projectRoles.parentRoleId,
          isLeaf: projectRoles.isLeaf,
          createdAt: projectRoles.createdAt,
        })
        .from(projectRoles)
        .where(eq(projectRoles.projectId, projectId));

      const roleMap = new Map(roleRows.map(r => [r.id, r]));

      // 获取 artifacts 的 tags 和 stats
      const artifactIds = artifactRelations.map(a => a.id);
      
      const tagsMap: Record<string, { slug: string; name: string; description: string | null; color: string | null }[]> = {};
      const statsMap: Record<string, { viewCount: number; starCount: number; forkCount: number; downloadCount: number }> = {};

      if (artifactIds.length > 0) {
        const tagResults = await this.ctx
          .select({
            artifactId: artifactTags.artifactId,
            tagSlug: tags.slug,
            tagName: tags.name,
            tagDescription: tags.description,
            tagColor: tags.color,
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          if (!tagsMap[row.artifactId]) {
            tagsMap[row.artifactId] = [];
          }
          tagsMap[row.artifactId].push({
            slug: row.tagSlug,
            name: row.tagName,
            description: row.tagDescription,
            color: row.tagColor,
          });
        }

        const statsResults = await this.ctx
          .select()
          .from(artifactStats)
          .where(inArray(artifactStats.artifactId, artifactIds));

        for (const row of statsResults) {
          statsMap[row.artifactId] = {
            viewCount: row.viewCount,
            starCount: row.favCount,
            forkCount: row.refCount,
            downloadCount: row.downloadCount,
          };
        }
      }

      // 构建响应
      const projectArtifactItems: ProjectArtifactItem[] = artifactRelations.map(a => ({
        artifact: {
          id: a.id,
          name: a.name,
          description: a.description,
          isListed: a.isListed ?? false,
          thumbnailUrl: a.thumbnailUrl,
          license: a.license,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          author: {
            id: a.authorId,
            username: a.authorUsername ?? '',
            displayName: a.authorDisplayName,
            avatarUrl: a.authorAvatarUrl,
          },
          tags: tagsMap[a.id] ?? [],
          stats: statsMap[a.id],
        },
        role: a.roleId ? roleMap.get(a.roleId) : undefined,
        isOfficial: a.isOfficial,
        createdAt: a.relationCreatedAt,
      }));

      return {
        success: true,
        data: {
          artifacts: projectArtifactItems,
          pagination: {
            page: validPage,
            limit: validLimit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error('Failed to list project artifacts:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list project artifacts',
        },
      };
    }
  }

  // 将 artifact 链接到 project
  async linkArtifactToProject(params: LinkArtifactToProjectParams): Promise<ServiceResult<ProjectArtifactItem>> {
    const { projectId, artifactId, roleId, isOfficial, userId } = params;

    try {
      // 验证 roleId 是必填的
      if (!roleId) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'roleId is required when linking artifact to project',
          },
        };
      }

      // 验证 project 存在
      const [project] = await this.ctx
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
          },
        };
      }

      // 验证 artifact 存在
      const [artifact] = await this.ctx
        .select({
          id: artifacts.id,
          name: artifacts.name,
          description: artifacts.description,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
          authorId: artifacts.authorId,
        })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);

      if (!artifact) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Artifact not found',
          },
        };
      }

      // 检查是否已经关联
      const existingLink = await this.ctx
        .select({ projectId: projectArtifacts.projectId })
        .from(projectArtifacts)
        .where(and(
          eq(projectArtifacts.projectId, projectId),
          eq(projectArtifacts.artifactId, artifactId)
        ))
        .limit(1);

      if (existingLink.length > 0) {
        return {
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Artifact is already linked to this project',
          },
        };
      }

      // 检查 isOfficial 权限：只有有管理权限的用户可以设置 isOfficial=true
      const finalIsOfficial = isOfficial ?? false;
      if (finalIsOfficial) {
        const userAcl = await this.ctx
          .select({ canManage: resourceAcl.canManage })
          .from(resourceAcl)
          .where(and(
            eq(resourceAcl.resourceType, 'project'),
            eq(resourceAcl.resourceId, projectId),
            eq(resourceAcl.userId, userId)
          ))
          .limit(1);

        const hasManagePermission = userAcl.length > 0 && userAcl[0].canManage;

        if (!hasManagePermission) {
          return {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Only users with manage permission can set isOfficial to true',
            },
          };
        }
      }

      // 如果指定了 roleId，验证 role 存在且是 isLeaf
      // roleId 现在是必填的，所以这里一定会执行
      const [roleRow] = await this.ctx
        .select({
          id: projectRoles.id,
          name: projectRoles.name,
          description: projectRoles.description,
          parentRoleId: projectRoles.parentRoleId,
          isLeaf: projectRoles.isLeaf,
          createdAt: projectRoles.createdAt,
        })
        .from(projectRoles)
        .where(and(
          eq(projectRoles.id, roleId),
          eq(projectRoles.projectId, projectId)
        ))
        .limit(1);

      if (!roleRow) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Role not found in this project',
          },
        };
      }

      if (!roleRow.isLeaf) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Only leaf roles can be assigned to artifacts',
          },
        };
      }

      const role = roleRow;

      // 创建关联
      this.ctx.modify(db => db.insert(projectArtifacts).values({
        projectId,
        artifactId,
        roleId,
        isOfficial: finalIsOfficial,
      }));

      // 获取 author 信息
      const [author] = await this.ctx
        .select({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        })
        .from(user)
        .where(eq(user.id, artifact.authorId))
        .limit(1);

      // 获取 tags
      const tagResults = await this.ctx
        .select({
          tagSlug: tags.slug,
          tagName: tags.name,
          tagDescription: tags.description,
          tagColor: tags.color,
        })
        .from(artifactTags)
        .innerJoin(tags, eq(artifactTags.tagSlug, tags.slug))
        .where(eq(artifactTags.artifactId, artifactId));

      // 获取 stats
      const [stats] = await this.ctx
        .select()
        .from(artifactStats)
        .where(eq(artifactStats.artifactId, artifactId))
        .limit(1);

      // 获取 artifact 的 access control 信息
      const [discoveryControl] = await this.ctx
        .select({
          isListed: resourceDiscoveryControl.isListed,
        })
        .from(resourceDiscoveryControl)
        .where(and(
          eq(resourceDiscoveryControl.resourceType, 'artifact'),
          eq(resourceDiscoveryControl.resourceId, artifactId)
        ))
        .limit(1);

      const result: ProjectArtifactItem = {
        artifact: {
          id: artifact.id,
          name: artifact.name,
          description: artifact.description,
          isListed: discoveryControl?.isListed ?? false,
          thumbnailUrl: artifact.thumbnailUrl,
          license: artifact.license,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
          author: author ? {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            avatarUrl: author.avatarUrl,
          } : {
            id: artifact.authorId,
            username: '',
            displayName: null,
            avatarUrl: null,
          },
          tags: tagResults.map(t => ({
            slug: t.tagSlug,
            name: t.tagName,
            description: t.tagDescription,
            color: t.tagColor,
          })),
          stats: stats ? {
            viewCount: stats.viewCount,
            favCount: stats.favCount,
            refCount: stats.refCount,
            downloadCount: stats.downloadCount,
          } : undefined,
        },
        role,
        isOfficial: finalIsOfficial,
        createdAt: new Date().toISOString(),
      };

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Failed to link artifact to project:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to link artifact to project',
        },
      };
    }
  }

  // 检查用户在 project 中的权限
  async checkProjectPermissions(projectId: string, userId: string): Promise<ServiceResult<{ isOwner: boolean; hasWritePermission: boolean; hasManagePermission: boolean }>> {
    try {
      const [project] = await this.ctx
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
          },
        };
      }

      const isOwner = project.ownerId === userId;

      const userAcl = await this.ctx
        .select({ canWrite: resourceAcl.canWrite, canManage: resourceAcl.canManage })
        .from(resourceAcl)
        .where(and(
          eq(resourceAcl.resourceType, 'project'),
          eq(resourceAcl.resourceId, projectId),
          eq(resourceAcl.userId, userId)
        ))
        .limit(1);

      return {
        success: true,
        data: {
          isOwner,
          hasWritePermission: userAcl.length > 0 && (userAcl[0].canWrite || userAcl[0].canManage),
          hasManagePermission: userAcl.length > 0 && userAcl[0].canManage,
        },
      };
    } catch (error) {
      console.error('Failed to check project permissions:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check project permissions',
        },
      };
    }
  }

  // 检查用户是否是 project 的 owner 或有写权限（向后兼容方法）
  async isProjectMember(projectId: string, userId: string): Promise<ServiceResult<{ isOwner: boolean; isMaintainer: boolean }>> {
    const result = await this.checkProjectPermissions(projectId, userId);
    if (!result.success) {
      return result as ServiceResult<{ isOwner: boolean; isMaintainer: boolean }>;
    }
    return {
      success: true,
      data: {
        isOwner: result.data.isOwner,
        // 向后兼容：有写权限等价于原来的 isMaintainer
        isMaintainer: result.data.hasWritePermission,
      },
    };
  }

  /**
   * Delete a project and all related data.
   * - Deletes all project posts and their associated discussions
   * - Deletes all project pages
   * - Removes project_artifacts associations (does NOT delete artifacts)
   * - Deletes all project roles
   * - Cleans up ACL and discovery control records
   */
  async deleteProject(params: DeleteProjectParams): Promise<ServiceResult<void>> {
    const { projectId, userId } = params;
    const projectRef = { type: 'project' as const, id: projectId };

    try {
      // Step 1: Check project exists
      const [existing] = await this.ctx.select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!existing) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        };
      }

      // Step 2: Check manage permission
      const canManage = await this.aclService.canManage(projectRef, userId);
      if (!canManage) {
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: 'No permission to delete this project' },
        };
      }

      // Step 3: Get all project posts and their discussion IDs
      const posts = await this.ctx
        .select({ id: projectPosts.id, discussionId: projectPosts.discussionId })
        .from(projectPosts)
        .where(eq(projectPosts.projectId, projectId));

      // Step 4: Delete discussions and their replies for each post
      const discussionIds = posts
        .map(p => p.discussionId)
        .filter((id): id is string => id !== null);

      if (discussionIds.length > 0) {
        // Delete discussion replies first (foreign key constraint)
        this.ctx.modify(db =>
          db.delete(discussionReplies).where(inArray(discussionReplies.discussionId, discussionIds))
        );

        // Delete discussions
        this.ctx.modify(db =>
          db.delete(discussions).where(inArray(discussions.id, discussionIds))
        );
      }

      // Step 5: Delete project posts
      this.ctx.modify(db =>
        db.delete(projectPosts).where(eq(projectPosts.projectId, projectId))
      );

      // Step 6: Delete project pages
      this.ctx.modify(db =>
        db.delete(projectPages).where(eq(projectPages.projectId, projectId))
      );

      // Step 7: Remove project_artifacts associations (not deleting artifacts)
      this.ctx.modify(db =>
        db.delete(projectArtifacts).where(eq(projectArtifacts.projectId, projectId))
      );

      // Step 8: Delete project roles
      this.ctx.modify(db =>
        db.delete(projectRoles).where(eq(projectRoles.projectId, projectId))
      );

      // Step 9: Delete project record
      this.ctx.modify(db =>
        db.delete(projects).where(eq(projects.id, projectId))
      );

      // Step 10: Delete ACL records
      this.aclService.deleteAllAcls(projectRef);

      // Step 11: Delete discovery control record
      this.discoveryService.delete(projectRef);

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Failed to delete project:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete project' },
      };
    }
  }
}
