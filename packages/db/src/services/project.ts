import { eq, and, asc, desc, sql, count, inArray, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../client';
import { projects, projectMaintainers, projectArtifacts, projectRoles, projectPages, type Project, type ProjectRole, type ProjectPage } from '../schema/projects';
import { artifacts, tags, artifactTags } from '../schema/artifacts';
import { artifactStats } from '../schema/stats';
import { user, type User } from '../schema/auth';
import type { ServiceError, ServiceResult } from './user';
import type { PaginationInfo } from './artifact';
import type {
  ProjectListItem,
  ProjectDetail,
  ProjectArtifact as ProjectArtifactItem,
  ArtifactListItem,
  ArtifactType,
  VisibilityType,
  UserProjectListItem,
  UserProjectRole,
  CreateProjectMetadata,
  CreateProjectRole,
  CreateProjectPage,
  ProjectPage as ProjectPageItem,
  ProjectPageDetail,
} from '@pubwiki/api';

// 重新导出供其他模块使用
export type { ProjectListItem, ProjectDetail, ProjectArtifactItem, UserProjectListItem, UserProjectRole, CreateProjectMetadata, ProjectPageItem, ProjectPageDetail };

// 创建 project 参数
export interface CreateProjectParams {
  ownerId: string;
  metadata: CreateProjectMetadata;
}

// 用户简要信息（内部使用）
interface UserBrief {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// 列表查询参数
export interface ListProjectsParams {
  page?: number;
  limit?: number;
  topic?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

// 列表响应
export interface ListProjectsResult {
  projects: ProjectListItem[];
  pagination: PaginationInfo;
}

export class ProjectService {
  constructor(private db: Database) {}

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
      // 构建基础条件：只查询公开且未归档的 projects
      const baseConditions = [
        eq(projects.visibility, 'PUBLIC'),
        eq(projects.isArchived, false),
      ];

      // Topic 过滤
      if (topic) {
        baseConditions.push(eq(projects.topic, topic));
      }

      // 获取总数
      const countResult = await this.db
        .select({ count: count() })
        .from(projects)
        .where(and(...baseConditions));

      const total = countResult[0]?.count ?? 0;
      const totalPages = Math.ceil(total / validLimit);

      // 构建排序
      const orderColumn = sortBy === 'updatedAt' ? projects.updatedAt : projects.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // 获取 project 列表（关联 owner）
      const projectRows = await this.db
        .select({
          id: projects.id,
          name: projects.name,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          visibility: projects.visibility,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.name,
          ownerAvatarUrl: user.image,
        })
        .from(projects)
        .leftJoin(user, eq(projects.ownerId, user.id))
        .where(and(...baseConditions))
        .orderBy(orderFn(orderColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取每个 project 的 maintainer 和 artifact 数量
      const projectIds = projectRows.map(p => p.id);
      
      let maintainerCounts: Record<string, number> = {};
      let artifactCounts: Record<string, number> = {};

      if (projectIds.length > 0) {
        // 获取 maintainer 数量
        const maintainerResults = await this.db
          .select({
            projectId: projectMaintainers.projectId,
            count: count(),
          })
          .from(projectMaintainers)
          .where(sql`${projectMaintainers.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(projectMaintainers.projectId);

        for (const r of maintainerResults) {
          maintainerCounts[r.projectId] = r.count;
        }

        // 获取 artifact 数量
        const artifactResults = await this.db
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
        visibility: row.visibility as VisibilityType,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        owner: {
          id: row.ownerId,
          username: row.ownerUsername ?? '',
          displayName: row.ownerDisplayName,
          avatarUrl: row.ownerAvatarUrl,
        },
        maintainerCount: maintainerCounts[row.id] ?? 0,
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
      const result = await this.db
        .select()
        .from(projects)
        .leftJoin(user, eq(projects.ownerId, user.id))
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

  // 检查用户是否是 project 的 maintainer
  async isMaintainer(projectId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.db
        .select()
        .from(projectMaintainers)
        .where(and(
          eq(projectMaintainers.projectId, projectId),
          eq(projectMaintainers.userId, userId)
        ))
        .limit(1);

      return result.length > 0;
    } catch (error) {
      console.error('Failed to check maintainer:', error);
      return false;
    }
  }

  // 获取 project 详情（包含 maintainers, artifacts, roles, pages）
  async getProjectDetails(projectId: string): Promise<ServiceResult<ProjectDetail>> {
    try {
      // 1. 获取 project 基本信息和 owner
      const projectResult = await this.db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          homepageId: projects.homepageId,
          visibility: projects.visibility,
          isArchived: projects.isArchived,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.name,
          ownerAvatarUrl: user.image,
        })
        .from(projects)
        .leftJoin(user, eq(projects.ownerId, user.id))
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

      // 2. 获取 maintainers
      const maintainerRows = await this.db
        .select({
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        })
        .from(projectMaintainers)
        .innerJoin(user, eq(projectMaintainers.userId, user.id))
        .where(eq(projectMaintainers.projectId, projectId));

      // 3. 获取 roles
      const roleRows = await this.db
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
      const pageRows = await this.db
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
      const artifactRelations = await this.db
        .select({
          artifactId: projectArtifacts.artifactId,
          roleId: projectArtifacts.roleId,
          isOfficial: projectArtifacts.isOfficial,
          relationCreatedAt: projectArtifacts.createdAt,
          // Artifact 基本信息
          id: artifacts.id,
          type: artifacts.type,
          name: artifacts.name,
          slug: artifacts.slug,
          description: artifacts.description,
          visibility: artifacts.visibility,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          isArchived: artifacts.isArchived,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
          authorId: artifacts.authorId,
          // Author 信息
          authorUsername: user.username,
          authorDisplayName: user.name,
          authorAvatarUrl: user.image,
        })
        .from(projectArtifacts)
        .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
        .leftJoin(user, eq(artifacts.authorId, user.id))
        .where(eq(projectArtifacts.projectId, projectId));

      // 创建 role 映射
      const roleMap = new Map(roleRows.map(r => [r.id, r]));

      // 6. 获取 artifacts 的 tags 和 stats
      const artifactIds = artifactRelations.map(a => a.id);
      
      let tagsMap: Record<string, { id: string; name: string; slug: string; description: string | null; color: string | null }[]> = {};
      let statsMap: Record<string, { viewCount: number; starCount: number; forkCount: number; downloadCount: number }> = {};

      if (artifactIds.length > 0) {
        // 获取 tags
        const tagResults = await this.db
          .select({
            artifactId: artifactTags.artifactId,
            tagId: tags.id,
            tagName: tags.name,
            tagSlug: tags.slug,
            tagDescription: tags.description,
            tagColor: tags.color,
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          if (!tagsMap[row.artifactId]) {
            tagsMap[row.artifactId] = [];
          }
          tagsMap[row.artifactId].push({
            id: row.tagId,
            name: row.tagName,
            slug: row.tagSlug,
            description: row.tagDescription,
            color: row.tagColor,
          });
        }

        // 获取 stats
        const statsResults = await this.db
          .select()
          .from(artifactStats)
          .where(inArray(artifactStats.artifactId, artifactIds));

        for (const row of statsResults) {
          statsMap[row.artifactId] = {
            viewCount: row.viewCount,
            starCount: row.starCount,
            forkCount: row.forkCount,
            downloadCount: row.downloadCount,
          };
        }
      }

      // 构建 artifacts 列表
      const projectArtifactItems: ProjectArtifactItem[] = artifactRelations.map(a => ({
        artifact: {
          id: a.id,
          type: a.type as ArtifactType,
          name: a.name,
          slug: a.slug,
          description: a.description,
          visibility: a.visibility as VisibilityType,
          thumbnailUrl: a.thumbnailUrl,
          license: a.license,
          isArchived: a.isArchived,
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
          visibility: project.visibility as VisibilityType,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          owner: {
            id: project.ownerId,
            username: project.ownerUsername ?? '',
            displayName: project.ownerDisplayName,
            avatarUrl: project.ownerAvatarUrl,
          },
          maintainers: maintainerRows,
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

  // 获取用户的 project 列表（包括 own 和 maintain 的）
  async listUserProjects(
    userId: string,
    params: ListUserProjectsParams = {}
  ): Promise<ServiceResult<ListUserProjectsResult>> {
    const {
      page = 1,
      limit = 20,
      role: roleFilter,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      visibilityFilter = ['PUBLIC'],
    } = params;

    // 验证分页参数
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 构建排序
      const orderColumn = sortBy === 'updatedAt' ? projects.updatedAt : projects.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // 根据 role filter 决定查询策略
      let ownedProjectIds: string[] = [];
      let maintainedProjectIds: string[] = [];

      if (!roleFilter || roleFilter === 'owner') {
        // 获取用户 own 的 projects
        const ownedResults = await this.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.ownerId, userId),
            eq(projects.isArchived, false),
            inArray(projects.visibility, visibilityFilter)
          ));
        ownedProjectIds = ownedResults.map(p => p.id);
      }

      if (!roleFilter || roleFilter === 'maintainer') {
        // 获取用户 maintain 的 projects（排除已归档和不可见的）
        const maintainedResults = await this.db
          .select({ projectId: projectMaintainers.projectId })
          .from(projectMaintainers)
          .innerJoin(projects, eq(projectMaintainers.projectId, projects.id))
          .where(and(
            eq(projectMaintainers.userId, userId),
            eq(projects.isArchived, false),
            inArray(projects.visibility, visibilityFilter)
          ));
        maintainedProjectIds = maintainedResults.map(p => p.projectId);
      }

      // 合并去重
      const allProjectIds = [...new Set([...ownedProjectIds, ...maintainedProjectIds])];

      if (allProjectIds.length === 0) {
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

      // 获取总数
      const total = allProjectIds.length;
      const totalPages = Math.ceil(total / validLimit);

      // 获取 project 列表（关联 owner）
      const projectRows = await this.db
        .select({
          id: projects.id,
          name: projects.name,
          topic: projects.topic,
          description: projects.description,
          license: projects.license,
          coverUrls: projects.coverUrls,
          visibility: projects.visibility,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          ownerUsername: user.username,
          ownerDisplayName: user.name,
          ownerAvatarUrl: user.image,
        })
        .from(projects)
        .leftJoin(user, eq(projects.ownerId, user.id))
        .where(inArray(projects.id, allProjectIds))
        .orderBy(orderFn(orderColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取每个 project 的 maintainer 和 artifact 数量
      const projectIds = projectRows.map(p => p.id);
      
      let maintainerCounts: Record<string, number> = {};
      let artifactCounts: Record<string, number> = {};

      if (projectIds.length > 0) {
        // 获取 maintainer 数量
        const maintainerResults = await this.db
          .select({
            projectId: projectMaintainers.projectId,
            count: count(),
          })
          .from(projectMaintainers)
          .where(sql`${projectMaintainers.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(projectMaintainers.projectId);

        for (const r of maintainerResults) {
          maintainerCounts[r.projectId] = r.count;
        }

        // 获取 artifact 数量
        const artifactResults = await this.db
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

      // 创建 owner set 和 maintainer set 方便查询
      const ownedSet = new Set(ownedProjectIds);
      const maintainedSet = new Set(maintainedProjectIds);

      // 组装结果
      const projectList: UserProjectListItem[] = projectRows.map(row => ({
        id: row.id,
        name: row.name,
        topic: row.topic,
        description: row.description,
        license: row.license,
        coverUrls: row.coverUrls ? JSON.parse(row.coverUrls) : [],
        visibility: row.visibility as VisibilityType,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        owner: {
          id: row.ownerId,
          username: row.ownerUsername ?? '',
          displayName: row.ownerDisplayName,
          avatarUrl: row.ownerAvatarUrl,
        },
        maintainerCount: maintainerCounts[row.id] ?? 0,
        artifactCount: artifactCounts[row.id] ?? 0,
        // 确定用户在这个 project 中的角色（优先 owner）
        role: ownedSet.has(row.id) ? 'owner' : 'maintainer',
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

  // 创建 project（使用 batch 保证原子性）
  async createProject(params: CreateProjectParams): Promise<ServiceResult<ProjectDetail>> {
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
      const existingProject = await this.db
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
        const existingArtifacts = await this.db
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

      // === 构建 batch 操作 ===
      const batchOperations: BatchItem<"sqlite">[] = [];

      // 1. 创建 project
      batchOperations.push(this.db.insert(projects).values({
        id: projectId,
        ownerId,
        name: metadata.name,
        slug: metadata.slug,
        topic: metadata.topic,
        description: metadata.description,
        license: metadata.license,
        coverUrls: metadata.coverUrls ? JSON.stringify(metadata.coverUrls) : null,
        visibility: metadata.visibility || 'PUBLIC',
        homepageId, // 直接设置，因为我们已经知道 page ID
      }));

      // 2. 创建 pages（如果提供）
      if (metadata.pages && metadata.pages.length > 0) {
        for (let i = 0; i < metadata.pages.length; i++) {
          const page = metadata.pages[i];
          batchOperations.push(this.db.insert(projectPages).values({
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
        
        batchOperations.push(this.db.insert(projectRoles).values({
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
          batchOperations.push(this.db.insert(projectArtifacts).values({
            projectId,
            artifactId: artifact.artifactId,
            roleId,
            isOfficial: true,
          }));
        }
      }

      // === 执行 batch（D1 的 batch 是事务性的）===
      await this.db.batch(batchOperations as any);

      // 获取完整的 project 详情
      const projectDetail = await this.getProjectDetails(projectId);
      if (!projectDetail.success) {
        return projectDetail;
      }

      return {
        success: true,
        data: projectDetail.data,
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
      const [page] = await this.db
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
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const offset = (validPage - 1) * validLimit;

    try {
      // 验证 project 存在
      const projectExists = await this.db
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
      const [{ total }] = await this.db
        .select({ total: count() })
        .from(projectArtifacts)
        .where(whereClause);

      const totalPages = Math.ceil(total / validLimit);

      // 获取 artifacts
      const orderByColumn = sortBy === 'createdAt' ? projectArtifacts.createdAt : projectArtifacts.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      const artifactRelations = await this.db
        .select({
          artifactId: projectArtifacts.artifactId,
          roleId: projectArtifacts.roleId,
          isOfficial: projectArtifacts.isOfficial,
          relationCreatedAt: projectArtifacts.createdAt,
          // Artifact 基本信息
          id: artifacts.id,
          type: artifacts.type,
          name: artifacts.name,
          slug: artifacts.slug,
          description: artifacts.description,
          visibility: artifacts.visibility,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          isArchived: artifacts.isArchived,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
          authorId: artifacts.authorId,
          // Author 信息
          authorUsername: user.username,
          authorDisplayName: user.name,
          authorAvatarUrl: user.image,
        })
        .from(projectArtifacts)
        .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
        .leftJoin(user, eq(artifacts.authorId, user.id))
        .where(whereClause)
        .orderBy(orderFn(orderByColumn))
        .limit(validLimit)
        .offset(offset);

      // 获取 roles 映射
      const roleRows = await this.db
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
      
      let tagsMap: Record<string, { id: string; name: string; slug: string; description: string | null; color: string | null }[]> = {};
      let statsMap: Record<string, { viewCount: number; starCount: number; forkCount: number; downloadCount: number }> = {};

      if (artifactIds.length > 0) {
        const tagResults = await this.db
          .select({
            artifactId: artifactTags.artifactId,
            tagId: tags.id,
            tagName: tags.name,
            tagSlug: tags.slug,
            tagDescription: tags.description,
            tagColor: tags.color,
          })
          .from(artifactTags)
          .innerJoin(tags, eq(artifactTags.tagId, tags.id))
          .where(inArray(artifactTags.artifactId, artifactIds));

        for (const row of tagResults) {
          if (!tagsMap[row.artifactId]) {
            tagsMap[row.artifactId] = [];
          }
          tagsMap[row.artifactId].push({
            id: row.tagId,
            name: row.tagName,
            slug: row.tagSlug,
            description: row.tagDescription,
            color: row.tagColor,
          });
        }

        const statsResults = await this.db
          .select()
          .from(artifactStats)
          .where(inArray(artifactStats.artifactId, artifactIds));

        for (const row of statsResults) {
          statsMap[row.artifactId] = {
            viewCount: row.viewCount,
            starCount: row.starCount,
            forkCount: row.forkCount,
            downloadCount: row.downloadCount,
          };
        }
      }

      // 构建响应
      const projectArtifactItems: ProjectArtifactItem[] = artifactRelations.map(a => ({
        artifact: {
          id: a.id,
          type: a.type as ArtifactType,
          name: a.name,
          slug: a.slug,
          description: a.description,
          visibility: a.visibility as VisibilityType,
          thumbnailUrl: a.thumbnailUrl,
          license: a.license,
          isArchived: a.isArchived,
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
      const [project] = await this.db
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
      const [artifact] = await this.db
        .select({
          id: artifacts.id,
          type: artifacts.type,
          name: artifacts.name,
          slug: artifacts.slug,
          description: artifacts.description,
          visibility: artifacts.visibility,
          thumbnailUrl: artifacts.thumbnailUrl,
          license: artifacts.license,
          isArchived: artifacts.isArchived,
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
      const existingLink = await this.db
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

      // 检查 isOfficial 权限：只有 owner 或 maintainer 可以设置 isOfficial=true
      let finalIsOfficial = isOfficial ?? false;
      if (finalIsOfficial) {
        const isOwner = project.ownerId === userId;
        const isMaintainer = await this.db
          .select({ userId: projectMaintainers.userId })
          .from(projectMaintainers)
          .where(and(
            eq(projectMaintainers.projectId, projectId),
            eq(projectMaintainers.userId, userId)
          ))
          .limit(1);

        if (!isOwner && isMaintainer.length === 0) {
          return {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Only project owner or maintainer can set isOfficial to true',
            },
          };
        }
      }

      // 如果指定了 roleId，验证 role 存在且是 isLeaf
      // roleId 现在是必填的，所以这里一定会执行
      const [roleRow] = await this.db
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
      await this.db.insert(projectArtifacts).values({
        projectId,
        artifactId,
        roleId,
        isOfficial: finalIsOfficial,
      });

      // 获取 author 信息
      const [author] = await this.db
        .select({
          id: user.id,
          username: user.username,
          displayName: user.name,
          avatarUrl: user.image,
        })
        .from(user)
        .where(eq(user.id, artifact.authorId))
        .limit(1);

      // 获取 tags
      const tagResults = await this.db
        .select({
          tagId: tags.id,
          tagName: tags.name,
          tagSlug: tags.slug,
          tagDescription: tags.description,
          tagColor: tags.color,
        })
        .from(artifactTags)
        .innerJoin(tags, eq(artifactTags.tagId, tags.id))
        .where(eq(artifactTags.artifactId, artifactId));

      // 获取 stats
      const [stats] = await this.db
        .select()
        .from(artifactStats)
        .where(eq(artifactStats.artifactId, artifactId))
        .limit(1);

      const result: ProjectArtifactItem = {
        artifact: {
          id: artifact.id,
          type: artifact.type as ArtifactType,
          name: artifact.name,
          slug: artifact.slug,
          description: artifact.description,
          visibility: artifact.visibility as VisibilityType,
          thumbnailUrl: artifact.thumbnailUrl,
          license: artifact.license,
          isArchived: artifact.isArchived,
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
            id: t.tagId,
            name: t.tagName,
            slug: t.tagSlug,
            description: t.tagDescription,
            color: t.tagColor,
          })),
          stats: stats ? {
            viewCount: stats.viewCount,
            starCount: stats.starCount,
            forkCount: stats.forkCount,
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

  // 检查用户是否是 project 的 owner 或 maintainer
  async isProjectMember(projectId: string, userId: string): Promise<ServiceResult<{ isOwner: boolean; isMaintainer: boolean }>> {
    try {
      const [project] = await this.db
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

      const maintainer = await this.db
        .select({ userId: projectMaintainers.userId })
        .from(projectMaintainers)
        .where(and(
          eq(projectMaintainers.projectId, projectId),
          eq(projectMaintainers.userId, userId)
        ))
        .limit(1);

      return {
        success: true,
        data: {
          isOwner,
          isMaintainer: maintainer.length > 0,
        },
      };
    } catch (error) {
      console.error('Failed to check project membership:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check project membership',
        },
      };
    }
  }
}

// Project artifacts 查询参数
export interface ListProjectArtifactsParams {
  page?: number;
  limit?: number;
  roleId?: string | null; // null 表示无角色的 artifacts
  isOfficial?: boolean;
  sortBy?: 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

// Project artifacts 列表结果
export interface ListProjectArtifactsResult {
  artifacts: ProjectArtifactItem[];
  pagination: PaginationInfo;
}

// 链接 artifact 到 project 参数
export interface LinkArtifactToProjectParams {
  projectId: string;
  artifactId: string;
  roleId?: string;
  isOfficial?: boolean;
  userId: string; // 执行操作的用户，用于权限检查
}

// 用户 projects 查询参数
export interface ListUserProjectsParams {
  page?: number;
  limit?: number;
  role?: UserProjectRole;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  // 权限控制：可以看到哪些可见性级别的 projects
  visibilityFilter?: VisibilityType[];
}

// 用户 projects 列表结果
export interface ListUserProjectsResult {
  projects: UserProjectListItem[];
  pagination: PaginationInfo;
}
