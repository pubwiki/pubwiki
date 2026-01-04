# @pubwiki/api

PubWiki API 类型定义和客户端库。基于 OpenAPI 3.1 规范自动生成类型安全的 TypeScript 类型和 HTTP 客户端。

## 安装

```bash
pnpm add @pubwiki/api
```

## 特性

- 🔒 **类型安全** - 从 OpenAPI 规范自动生成 TypeScript 类型
- 🚀 **零运行时开销** - 类型仅在编译时使用
- 📝 **API 文档即代码** - OpenAPI 规范作为单一真相来源
- 🔄 **自动同步** - 类型与 API 实现始终保持一致

## 使用方法

### 导入类型

```typescript
import type {
  // Schema 类型
  ApiError,
  PublicUser,
  JwtPayload,
  UpdateProfileRequest,
  ArtifactType,
  Tag,
  ArtifactListItem,
  Pagination,
  VisibilityType,
  ArtifactVersion,
  LineageType,
  ArtifactLineageItem,
  ProjectRole,
  CreateProjectRole,
  ProjectListItem,
  ProjectArtifact,
  ProjectDetail,
  CreateArtifactMetadata,
  CreateProjectMetadata,
  UserProjectRole,
  UserProjectListItem,
  
  // Page 相关类型
  CreateProjectPage,
  ProjectPage,
  ProjectPageDetail,
  
  // Node 相关类型
  ArtifactNodeType,
  ArtifactNodeDescriptor,
  ArtifactEdgeDescriptor,
  ArtifactDescriptor,
  ArtifactNodeSummary,
  ArtifactEdge,
  NodeVersionInfo,
  NodeFileInfo,
  
  // 请求类型
  RegisterRequest,
  LoginRequest,
  
  // 响应类型
  HealthCheckResponse,
  RegisterResponse,
  LoginResponse,
  GetMeResponse,
  UpdateProfileResponse,
  ListArtifactsResponse,
  GetArtifactLineageResponse,
  GetArtifactGraphResponse,
  GetNodeDetailResponse,
  ListProjectsResponse,
  GetProjectDetailResponse,
  GetProjectPageResponse,
  GetArtifactHomepageResponse,
  CreateArtifactResponse,
  CreateProjectResponse,
  GetUserArtifactsResponse,
  GetUserProjectsResponse,
  
  // 查询参数类型
  ListArtifactsQuery,
  ListProjectsQuery,
  GetUserArtifactsQuery,
  GetUserProjectsQuery,
} from '@pubwiki/api';
```

### 使用 API 客户端

```typescript
import { createApiClient } from '@pubwiki/api/client';

// 创建客户端
const client = createApiClient('https://api.pubwiki.com/api');

// 健康检查
const { data, error } = await client.GET('/');
if (data) {
  console.log(data.message); // "PubWiki API is running"
  console.log(data.version); // "1.0.0"
}

// 用户注册
const { data, error } = await client.POST('/auth/register', {
  body: {
    username: 'newuser',
    email: 'user@example.com',
    password: 'securePassword123',
    displayName: 'New User', // 可选
  },
});

if (data) {
  console.log(data.message);      // "Registration successful"
  console.log(data.user.username); // "newuser"
  console.log(data.token);         // JWT token
}

// 用户登录
const { data, error } = await client.POST('/auth/login', {
  body: {
    usernameOrEmail: 'newuser', // 可以是用户名或邮箱
    password: 'securePassword123',
  },
});

if (data) {
  const token = data.token;
  // 使用 token 创建认证客户端
  const authClient = createApiClient('https://api.pubwiki.com/api', token);
  
  // 获取当前用户信息
  const { data: meData } = await authClient.GET('/me');
  if (meData) {
    console.log(meData.user.username);
    console.log(meData.user.email);
  }

  // 更新用户 Profile
  const { data: updateData } = await authClient.PATCH('/me', {
    body: {
      displayName: 'My New Name',
      bio: 'A short bio about me',
      website: 'https://mywebsite.com',
      location: 'Tokyo, Japan',
      avatarUrl: 'https://example.com/avatar.png',
    },
  });
  if (updateData) {
    console.log(updateData.message);        // "Profile updated successfully"
    console.log(updateData.user.displayName); // "My New Name"
  }
}

// 创建/更新 Artifact（支持文件上传）
// 使用 multipart/form-data 格式
// - metadata: JSON 元数据（artifactId 必需，服务端通过检查数据库是否存在决定创建或更新）
// - descriptor: JSON 节点/边描述符（节点 ID 必须是 UUID 格式，服务端直接使用）
// - nodes[{nodeId}]: 节点对应的文件
// - homepage: 可选的 Markdown 文件，将被渲染为 HTML 保存
const formData = new FormData();
formData.append('metadata', JSON.stringify({
  artifactId: crypto.randomUUID(),  // 必需：客户端生成 UUID，数据库存在则更新，不存在则创建
  type: 'RECIPE',
  name: 'My Awesome Recipe',
  slug: 'my-awesome-recipe',
  version: '1.0.0',
  description: 'An awesome recipe for something great',
  visibility: 'PUBLIC',
  tags: ['javascript', 'tutorial'],
  changelog: 'Initial release',
  isPrerelease: false,
}));

// 节点和边描述符
// 注意：节点 ID 必须是 UUID 格式，服务端会直接使用该 ID
formData.append('descriptor', JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  nodes: [
    { id: crypto.randomUUID(), type: 'VFS', name: 'main' }
  ],
  edges: []
}));

// 为方便演示，假设上面生成的节点 ID 为 nodeId
const nodeId = '550e8400-e29b-41d4-a716-446655440000'; // 实际使用时应该用上面生成的 UUID

// 添加节点文件（nodeId 对应 descriptor 中的 node id）
formData.append(`nodes[${nodeId}]`, new Blob(['# My Recipe\n\nContent here...'], { type: 'text/markdown' }), 'README.md');
formData.append(`nodes[${nodeId}]`, new Blob(['{"key": "value"}'], { type: 'application/json' }), 'config.json');

// 可选：添加主页 Markdown（会自动渲染为 HTML）
formData.append('homepage', new Blob([
  '# Welcome to My Awesome Recipe\n\n',
  '## Features\n\n',
  '- Feature 1\n',
  '- Feature 2\n',
  '- Feature 3\n',
].join(''), { type: 'text/markdown' }), 'homepage.md');

const createResponse = await fetch(`${baseUrl}/artifacts`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${authToken}`,
  },
  body: formData,
});

if (createResponse.ok) {
  const { message, artifact } = await createResponse.json();
  console.log(message);           // "Artifact saved successfully"（创建和更新统一返回 200）
  console.log(artifact.id);       // artifact ID（与 metadata 中的 artifactId 一致）
  console.log(artifact.name);     // "My Awesome Recipe"
  console.log(artifact.slug);     // "my-awesome-recipe"
}

// 获取公开 Artifact 列表
const { data: artifactsData } = await client.GET('/artifacts', {
  params: {
    query: {
      page: 1,
      limit: 20,
      'type.include': ['RECIPE', 'GAME'],
      'tag.include': ['javascript'],
      sortBy: 'viewCount',
      sortOrder: 'desc',
    },
  },
});

if (artifactsData) {
  console.log(`Found ${artifactsData.pagination.total} artifacts`);
  for (const artifact of artifactsData.artifacts) {
    console.log(`${artifact.name} by ${artifact.author.username}`);
    console.log(`  Type: ${artifact.type}, Views: ${artifact.stats?.viewCount}`);
    console.log(`  Tags: ${artifact.tags.map(t => t.name).join(', ')}`);
  }
}

// 获取 Artifact 节点图结构
const { data: graphData } = await client.GET('/artifacts/{artifactId}/graph', {
  params: {
    path: { artifactId: 'artifact-uuid-here' },
    query: { version: 'latest' },  // 可选，默认 latest
  },
});

if (graphData) {
  console.log(`Version: ${graphData.version.version}`);
  console.log('Nodes:');
  for (const node of graphData.nodes) {
    console.log(`  ${node.id}: ${node.type} - ${node.name || '(unnamed)'}`);
    if (node.external) {
      console.log(`    External: ${node.externalArtifactId}`);
    }
  }
  console.log('Edges:');
  for (const edge of graphData.edges) {
    console.log(`  ${edge.source} -> ${edge.target}`);
  }
}

// 获取节点详情
const { data: nodeDetail } = await client.GET('/artifacts/{artifactId}/nodes/{nodeId}', {
  params: {
    path: { artifactId: 'artifact-uuid-here', nodeId: 'node-uuid-here' },
    query: { version: 'latest' },  // 可选
  },
});

if (nodeDetail) {
  console.log(`Node: ${nodeDetail.node.name}`);
  console.log(`Type: ${nodeDetail.node.type}`);
  console.log(`Current Version: ${nodeDetail.currentVersion.commitHash}`);
  console.log('Files:');
  for (const file of nodeDetail.files) {
    console.log(`  ${file.filepath} (${file.sizeBytes} bytes)`);
  }
}

// 获取 VFS 节点文件内容（从 R2 存储）
// 注意：文件内容通过 fetch 直接获取二进制流
const fileResponse = await fetch(
  `${baseUrl}/artifacts/${artifactId}/nodes/${nodeId}/files/${encodeURIComponent(filePath)}`,
  { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
);

if (fileResponse.ok) {
  // 文本文件
  const textContent = await fileResponse.text();
  console.log(textContent);
  
  // 或二进制文件
  const binaryContent = await fileResponse.arrayBuffer();
  console.log(`File size: ${binaryContent.byteLength} bytes`);
}

// 获取非 VFS 节点内容（PROMPT、RECIPE 等类型）
const contentResponse = await fetch(
  `${baseUrl}/artifacts/${artifactId}/nodes/${nodeId}/content`,
  { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
);

if (contentResponse.ok) {
  const content = await contentResponse.text();
  console.log(content);
}

// 获取 Artifact 谱系信息（支持递归查询多代）
// 不指定深度参数时，默认无限递归获取所有祖先和后代
const { data: lineageData } = await client.GET('/artifacts/{artifactId}/lineage', {
  params: {
    path: { artifactId: 'artifact-uuid-here' },
    query: {
      parentDepth: 3,  // 可选：向上追溯3代祖先
      childDepth: 2,   // 可选：向下追溯2代后代
    },
  },
});

if (lineageData) {
  console.log('Parents (dependencies):');
  for (const parent of lineageData.parents) {
    console.log(`  ${parent.lineageType}: ${parent.artifact.name}`);
    // parentId 可用于构建树状结构
    // null 表示直接父代，非 null 指向递归链中的上一层 artifact
    console.log(`    parentId: ${parent.parentId}`);
  }
  console.log('Children (dependents):');
  for (const child of lineageData.children) {
    console.log(`  ${child.lineageType}: ${child.artifact.name}`);
    console.log(`    parentId: ${child.parentId}`);
  }
}

// 构建树状结构示例
function buildLineageTree(items: ArtifactLineageItem[]): Map<string | null, ArtifactLineageItem[]> {
  const tree = new Map<string | null, ArtifactLineageItem[]>();
  for (const item of items) {
    const key = item.parentId;
    if (!tree.has(key)) tree.set(key, []);
    tree.get(key)!.push(item);
  }
  return tree;
}

// 获取公开 Project 列表
const { data: projectsData } = await client.GET('/projects', {
  params: {
    query: {
      page: 1,
      limit: 20,
      topic: 'game-jam',  // 按 topic（hashtag）过滤
      sortBy: 'createdAt',
      sortOrder: 'desc',
    },
  },
});

if (projectsData) {
  console.log(`Found ${projectsData.pagination.total} projects`);
  for (const project of projectsData.projects) {
    console.log(`${project.name} by ${project.owner.username}`);
    console.log(`  Topic: #${project.topic}`);
    console.log(`  Maintainers: ${project.maintainerCount}, Artifacts: ${project.artifactCount}`);
  }
}

// 获取 Project 详情（包含 maintainers、artifacts、roles）
const { data: projectDetail } = await client.GET('/projects/{projectId}', {
  params: {
    path: { projectId: 'project-uuid-here' },
  },
});

if (projectDetail) {
  console.log(`${projectDetail.name} by ${projectDetail.owner.username}`);
  console.log(`Topic: #${projectDetail.topic}`);
  console.log(`Maintainers: ${projectDetail.maintainers.length}`);
  
  // 查看关联的 artifacts（完整的 ArtifactListItem 格式）
  for (const pa of projectDetail.artifacts) {
    console.log(`  Artifact: ${pa.artifact.name}`);
    console.log(`    Type: ${pa.artifact.type}`);
    console.log(`    Author: ${pa.artifact.author.username}`);
    if (pa.role) {
      console.log(`    Role: ${pa.role.name}`);
    }
  }
  
  // 查看定义的角色
  for (const role of projectDetail.roles) {
    console.log(`  Role: ${role.name} - ${role.description}`);
    if (role.parentRoleId) {
      console.log(`    Parent Role ID: ${role.parentRoleId}`);
    }
  }
  
  // 查看关联的 artifacts 是否为官方
  for (const pa of projectDetail.artifacts) {
    console.log(`  Artifact: ${pa.artifact.name}, Official: ${pa.isOfficial}`);
  }
  
  // 查看角色是否为叶子角色
  for (const role of projectDetail.roles) {
    console.log(`  Role: ${role.name}, Is Leaf: ${role.isLeaf}`);
  }
}

// 获取 Project 的 Artifact 列表（支持过滤）
const { data: projectArtifacts } = await client.GET('/projects/{projectId}/artifacts', {
  params: {
    path: { projectId: 'project-uuid-here' },
    query: {
      page: 1,
      limit: 20,
      roleId: 'role-uuid-here',  // 可选：按角色过滤，传 "null" 获取无角色的
      isOfficial: true,          // 可选：只获取官方 artifacts
      sortOrder: 'desc',
    },
  },
});

if (projectArtifacts) {
  console.log(`Found ${projectArtifacts.pagination.total} artifacts`);
  for (const pa of projectArtifacts.artifacts) {
    console.log(`${pa.artifact.name}`);
    console.log(`  Role: ${pa.role?.name ?? 'No role'}`);
    console.log(`  Official: ${pa.isOfficial}`);
  }
}

// 将 Artifact 链接到 Project
const { data: linkResult } = await authClient.POST('/projects/{projectId}/artifacts', {
  params: {
    path: { projectId: 'project-uuid-here' },
  },
  body: {
    artifactId: 'artifact-uuid-here',
    roleId: 'role-uuid-here',  // 必填：必须是叶子角色
    isOfficial: true,          // 可选：只有 owner/maintainer 可设置为 true
  },
});

if (linkResult) {
  console.log(linkResult.message);  // "Artifact linked to project successfully"
  console.log(`Linked: ${linkResult.projectArtifact.artifact.name}`);
}

// 创建 Project（支持角色树结构和多页面）
// 使用 JSON body 而不是 FormData
const requestBody = {
  name: 'My New Project',
  slug: 'my-new-project',
  topic: 'game-jam',
  // 必填：创建时定义角色（支持父子关系），至少需要一个角色
  // 使用 name 作为标识符，parentName 引用父角色
  roles: [
    { name: 'Main Character', description: '主角' },
    { name: 'Sidekick', description: '配角', parentName: 'Main Character' },
    { name: 'Villain', description: '反派' },
  ],
  // 可选：创建时同时关联 artifacts（这些 artifacts 的 isOfficial 会设为 true）
  artifactIds: ['artifact-uuid-1', 'artifact-uuid-2'],
  // 可选：创建项目页面（HTML 内容），页面顺序由数组顺序决定
  pages: [
    { name: 'Home', icon: '🏠', content: '<h1>Welcome to My Project</h1><p>Project description...</p>' },
    { name: 'Documentation', icon: '📚', content: '<h1>Documentation</h1>' },
    { name: 'FAQ', icon: '❓', content: '<h1>FAQ</h1>' },
  ],
  // 可选：指定首页在 pages 数组中的索引（从 0 开始）
  homepageIndex: 0,
};

const createResponse = await fetch(`${baseUrl}/projects`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
});

if (createResponse.ok) {
  const createResult = await createResponse.json();
  console.log(`Created project: ${createResult.project.id}`);
  console.log(`Homepage ID: ${createResult.project.homepageId}`);
  console.log(`Pages: ${createResult.project.pages.length}`);
  // 注意：返回的 roles 中，id 是真正的数据库 ID，parentRoleId 指向父角色的真实 ID
}

// 获取 Artifact 主页 HTML（存储在 R2 中，从创建时的 Markdown 渲染）
const artifactHomepageResponse = await fetch(`${baseUrl}/artifacts/${artifactId}/homepage`);
if (artifactHomepageResponse.ok) {
  const artifactHtml = await artifactHomepageResponse.text();
  console.log(artifactHtml);  // 渲染后的 HTML
}

// 获取 Project 页面 HTML（通过 pageId）
const pageResponse = await fetch(`${baseUrl}/projects/${projectId}/pages/${pageId}`);
if (pageResponse.ok) {
  const pageData = await pageResponse.json();
  console.log(pageData.name);     // 页面名称
  console.log(pageData.icon);     // 页面图标
  console.log(pageData.content);  // HTML 内容
}

// 获取用户的 Artifact 列表
const { data: userArtifacts } = await client.GET('/users/{userId}/artifacts', {
  params: {
    path: { userId: 'user-uuid-here' },
    query: {
      page: 1,
      limit: 20,
      'type.include': ['RECIPE'],
      sortBy: 'viewCount',
      sortOrder: 'desc',
    },
  },
});

if (userArtifacts) {
  console.log(`Found ${userArtifacts.pagination.total} artifacts`);
  for (const artifact of userArtifacts.artifacts) {
    console.log(`${artifact.name} - ${artifact.type}`);
  }
}

// 获取用户的 Project 列表（包含角色信息）
const { data: userProjects } = await client.GET('/users/{userId}/projects', {
  params: {
    path: { userId: 'user-uuid-here' },
    query: {
      page: 1,
      limit: 20,
      role: 'owner',  // 仅获取用户拥有的 projects
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    },
  },
});

if (userProjects) {
  console.log(`Found ${userProjects.pagination.total} projects`);
  for (const project of userProjects.projects) {
    console.log(`${project.name} - Role: ${project.role}`);
    // project.role 为 'owner' 或 'maintainer'
  }
}
```

### 错误处理

```typescript
const { data, error, response } = await client.POST('/auth/register', {
  body: { username: 'ab', email: 'test@example.com', password: 'pass' },
});

if (error) {
  console.error(`Error ${response.status}: ${error.error}`);
  // Error 400: Username must be 3-50 characters...
}
```

## API 端点

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/` | 健康检查 | ❌ |
| POST | `/auth/register` | 用户注册 | ❌ |
| POST | `/auth/login` | 用户登录 | ❌ |
| GET | `/me` | 获取当前用户信息 | ✅ |
| PATCH | `/me` | 更新当前用户 Profile | ✅ |
| GET | `/artifacts` | 获取公开 Artifact 列表 | ❌ |
| POST | `/artifacts` | 创建/更新 Artifact（artifactId 必需，支持文件上传和主页 Markdown） | ✅ |
| GET | `/artifacts/{artifactId}/homepage` | 获取 Artifact 主页 HTML | 🔒* |
| GET | `/artifacts/{artifactId}/lineage` | 获取 Artifact 谱系信息（支持递归） | 🔒* |
| GET | `/artifacts/{artifactId}/graph` | 获取 Artifact 节点图结构 | 🔒* |
| GET | `/artifacts/{artifactId}/nodes/{nodeId}` | 获取节点详情 | 🔒* |
| GET | `/artifacts/{artifactId}/nodes/{nodeId}/content` | 获取非 VFS 节点内容 | 🔒* |
| GET | `/artifacts/{artifactId}/nodes/{nodeId}/files/{filePath}` | 获取 VFS 节点文件内容 | 🔒* |
| GET | `/projects` | 获取公开 Project 列表 | ❌ |
| POST | `/projects` | 创建 Project（支持角色树和多页面） | ✅ |
| GET | `/projects/{projectId}` | 获取 Project 详情（包含 pages 和 homepageId） | 🔒* |
| GET | `/projects/{projectId}/pages/{pageId}` | 获取 Project 页面详情 | 🔒* |
| GET | `/projects/{projectId}/artifacts` | 获取 Project 的 Artifact 列表 | 🔒* |
| POST | `/projects/{projectId}/artifacts` | 将 Artifact 链接到 Project | ✅ |
| GET | `/users/{userId}/artifacts` | 获取用户的 Artifact 列表 | 🔒* |
| GET | `/users/{userId}/projects` | 获取用户的 Project 列表（own 或 maintain） | 🔒* |

### 谱系查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `parentDepth` | integer | 向上追溯父代的深度（1=直接父代，2=父代+祖父代...），不指定则无限递归 |
| `childDepth` | integer | 向下追溯子代的深度（1=直接子代，2=子代+孙代...），不指定则无限递归 |

### Graph/Node 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `version` | string | artifact 版本哈希或 "latest"（默认） |

### Projects 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `page` | integer | 页码，默认 1 |
| `limit` | integer | 每页数量，默认 20，最大 100 |
| `topic` | string | 按 topic（hashtag）过滤 |
| `sortBy` | string | 排序字段：`createdAt`（默认）, `updatedAt` |
| `sortOrder` | string | 排序方向：`asc`, `desc`（默认） |

### Project Artifacts 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `page` | integer | 页码，默认 1 |
| `limit` | integer | 每页数量，默认 20，最大 100 |
| `roleId` | string | 按角色 ID 过滤，传 "null" 字符串表示获取无角色的 artifacts |
| `isOfficial` | boolean | 按是否官方过滤 |
| `sortOrder` | string | 排序方向：`asc`, `desc`（默认） |

### User Artifacts 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `page` | integer | 页码，默认 1 |
| `limit` | integer | 每页数量，默认 20，最大 100 |
| `type.include` | array | 包含的类型列表（RECIPE、GAME、ASSET_PACK、PROMPT） |
| `type.exclude` | array | 排除的类型列表 |
| `sortBy` | string | 排序字段：`createdAt`（默认）, `updatedAt`, `viewCount`, `starCount` |
| `sortOrder` | string | 排序方向：`asc`, `desc`（默认） |

### User Projects 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `page` | integer | 页码，默认 1 |
| `limit` | integer | 每页数量，默认 20，最大 100 |
| `role` | string | 按用户角色过滤：`owner`, `maintainer` |
| `sortBy` | string | 排序字段：`createdAt`（默认）, `updatedAt` |
| `sortOrder` | string | 排序方向：`asc`, `desc`（默认） |

> \* 权限说明：
> - PUBLIC artifact/project: 所有人可访问
> - UNLISTED artifact/project: 仅注册用户可访问
> - PRIVATE artifact: 仅 owner 可访问
> - PRIVATE project: 仅 owner 和 maintainer 可访问
> 
> 用户 artifacts/projects 端点权限：
> - 未认证用户：只能看到 PUBLIC 资源
> - 已认证用户查看他人：可以看到 PUBLIC 和 UNLISTED 资源
> - 已认证用户查看自己：可以看到所有资源（包括 PRIVATE）

## 类型定义

### PublicUser

用户公开信息（不含敏感字段）：

```typescript
interface PublicUser {
  id: string;           // UUID
  username: string;     // 3-50 字符
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  isAdmin: boolean;
  createdAt: string;    // ISO 8601 日期时间
  updatedAt: string;
}
```

### UpdateProfileRequest

更新用户 Profile 请求体：

```typescript
interface UpdateProfileRequest {
  displayName?: string;   // 最大 100 字符
  avatarUrl?: string;     // URL，最大 500 字符
  bio?: string;
  website?: string;       // URL，最大 255 字符
  location?: string;      // 最大 100 字符
}
```

### ArtifactType

Artifact 类型枚举：

```typescript
type ArtifactType = 'RECIPE' | 'GAME' | 'ASSET_PACK' | 'PROMPT';
```

### ArtifactNodeType

节点类型枚举：

```typescript
type ArtifactNodeType = 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'STATE' | 'LOADER' | 'SANDBOX';
```

### CreateArtifactMetadata

创建或更新 Artifact 的元数据（JSON 格式，作为 multipart/form-data 的 metadata 字段）：

```typescript
interface CreateArtifactMetadata {
  artifactId: string;        // 必填，客户端生成的 UUID（使用 crypto.randomUUID()）
  type: ArtifactType;        // 必填
  name: string;              // 必填，1-100 字符
  slug: string;              // 必填，URL-friendly 标识符
  version: string;           // 必填，semver 格式（如 1.0.0、1.0.0-beta）
  description?: string;      // 可选
  visibility?: VisibilityType;  // 可选，默认 PUBLIC
  thumbnailUrl?: string;     // 可选，URL 格式
  license?: string;          // 可选，最大 50 字符
  repositoryUrl?: string;    // 可选，URL 格式
  changelog?: string;        // 可选，版本更新日志
  isPrerelease?: boolean;    // 可选，默认 false
  tags?: string[];           // 可选，tag slugs 数组
}
```

**创建/更新模式说明**：`artifactId` 必须是客户端生成的 UUID，服务端根据此 ID 是否已存在决定操作模式：
- **创建模式**：ID 不存在于数据库中，创建新 artifact，返回 201
- **更新模式**：ID 存在且当前用户是 owner，更新 artifact，返回 200
- **错误情况**：
  - ID 存在但 owner 不是当前用户：返回 403 Forbidden
  - 更新时新 slug 与其他 artifact 冲突：返回 409 Conflict
  - 更新时会保留原有的统计数据（viewCount、likeCount 等）和 createdAt 时间

### CreateProjectMetadata

创建 Project 的元数据（JSON body）：

```typescript
interface CreateProjectMetadata {
  name: string;              // 必填，1-100 字符
  slug: string;              // 必填，URL-friendly 标识符
  topic: string;             // 必填，Project 的 hashtag
  description?: string;      // 可选
  visibility?: VisibilityType;  // 可选，默认 PUBLIC
  license?: string;          // 可选，最大 50 字符
  coverUrls?: string[];      // 可选，封面图片 URL 数组
  artifactIds?: string[];    // 可选，要关联的 artifact ID 列表
  roles: CreateProjectRole[];  // 必填，至少需要一个角色
  pages?: CreateProjectPage[];  // 可选，要创建的页面列表
  homepageIndex?: number;    // 可选，首页在 pages 数组中的索引（从 0 开始）
}
```

### ArtifactDescriptor

Artifact 描述符（节点和边结构）：

```typescript
interface ArtifactDescriptor {
  version: number;              // 描述符版本
  exportedAt: string;           // ISO 8601 日期时间
  nodes: ArtifactNodeDescriptor[];
  edges: ArtifactEdgeDescriptor[];
}
```

### ArtifactNodeDescriptor

节点描述符：

```typescript
interface ArtifactNodeDescriptor {
  id: string;                    // 节点 ID（用于上传文件时的 key，或外部节点的真实 ID）
  external?: boolean;            // 是否为外部引用节点，默认 false
  type?: ArtifactNodeType;       // 节点类型（内部节点必填）
  name?: string;                 // 节点名称
  files?: string[];              // VFS 类型时的文件路径列表
}
```

### ArtifactEdgeDescriptor

边描述符：

```typescript
interface ArtifactEdgeDescriptor {
  source: string;      // 源节点 ID
  target: string;      // 目标节点 ID
  sourceHandle?: string;
  targetHandle?: string;
}
```

### ArtifactNodeSummary

节点摘要（用于图列表）：

```typescript
interface ArtifactNodeSummary {
  id: string;
  type: ArtifactNodeType;
  name?: string | null;
  external: boolean;
  externalArtifactId?: string;  // 外部引用时的 artifact ID
}
```

### ArtifactEdge

边信息：

```typescript
interface ArtifactEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}
```

### NodeVersionInfo

节点版本信息：

```typescript
interface NodeVersionInfo {
  id: string;
  commitHash: string;      // SHA-256 前8位
  contentHash?: string;
  message?: string | null;
  createdAt: string;
}
```

### NodeFileInfo

节点文件信息：

```typescript
interface NodeFileInfo {
  filepath: string;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  createdAt: string;
}
```

### ArtifactListItem

Artifact 列表项：

```typescript
interface ArtifactListItem {
  id: string;
  type: ArtifactType;
  name: string;
  slug: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  thumbnailUrl?: string | null;
  license?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  tags: Tag[];
  stats?: {
    viewCount: number;
    starCount: number;
    forkCount: number;
    downloadCount: number;
  };
}
```

### Tag

标签信息：

```typescript
interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  color?: string | null;  // #RRGGBB 格式
}
```

### Pagination

分页信息：

```typescript
interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

### ArtifactVersion

Artifact 版本信息：

```typescript
interface ArtifactVersion {
  id: string;
  version: string;
  changelog?: string | null;
  isPrerelease: boolean;
  publishedAt?: string | null;
  createdAt: string;
}
```

### LineageType

谱系关系类型：

```typescript
type LineageType = 'DEPENDS_ON' | 'FORKED_FROM' | 'INSPIRED_BY' | 'GENERATED_BY';
```

### ArtifactLineageItem

谱系关系项：

```typescript
interface ArtifactLineageItem {
  id: string;
  lineageType: LineageType;
  description?: string | null;
  parentId?: string | null;  // 用于构建树状结构，详见下文
  createdAt: string;
  artifact: {
    id: string;
    name: string;
    slug: string;
    type: ArtifactType;
    visibility: VisibilityType;
    thumbnailUrl?: string | null;
    author: {
      id: string;
      username: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    };
  };
}
```

#### parentId 字段说明

`parentId` 字段用于在前端构建树状结构，表示递归链中的父子关系：

- **在父谱系 (parents) 中**：
  - 第一层（直接父代）的 `parentId` 为 `null`
  - 第二层（祖父代）的 `parentId` 指向第一层的 artifact ID
  - 以此类推...

- **在子谱系 (children) 中**：
  - 第一层（直接子代）的 `parentId` 为 `null`
  - 第二层（孙代）的 `parentId` 指向第一层的 artifact ID
  - 以此类推...

**示例：**

假设谱系链为：`GreatGrandparent → Grandparent → Parent → [QueryArtifact] → Child → Grandchild`

查询 `[QueryArtifact]` 的谱系返回：

```json
{
  "parents": [
    { "artifact": { "id": "parent-id", "name": "Parent" }, "parentId": null },
    { "artifact": { "id": "grandparent-id", "name": "Grandparent" }, "parentId": "parent-id" },
    { "artifact": { "id": "greatgrandparent-id", "name": "GreatGrandparent" }, "parentId": "grandparent-id" }
  ],
  "children": [
    { "artifact": { "id": "child-id", "name": "Child" }, "parentId": null },
    { "artifact": { "id": "grandchild-id", "name": "Grandchild" }, "parentId": "child-id" }
  ]
}
```

### ProjectListItem

Project 列表项：

```typescript
interface ProjectListItem {
  id: string;           // UUID
  name: string;
  topic: string;        // hashtag
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  createdAt: string;    // ISO 8601 日期时间
  updatedAt: string;
  owner: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  maintainerCount?: number;   // 管理者数量
  artifactCount?: number;     // 关联 artifact 数量
}
```

### ProjectRole

Project 定义的角色（支持树形结构）：

```typescript
interface ProjectRole {
  id: string;
  name: string;
  description?: string | null;
  parentRoleId?: string | null;  // 父角色 ID（构成树结构）
  isLeaf: boolean;               // 是否为叶子角色（只有叶子角色可以分配给 artifact）
  createdAt: string;
}
```

### CreateProjectRole

创建角色的输入（用于创建 Project 时）：

```typescript
interface CreateProjectRole {
  name: string;                // 角色名称，在同一 project 内必须唯一，同时作为标识符
  description?: string | null;
  parentName?: string | null;  // 父角色的名称
}
```

### ProjectPage

Project 页面信息（列表用，不含内容）：

```typescript
interface ProjectPage {
  id: string;
  name: string;
  icon?: string | null;    // 页面图标（emoji 或图标标识符）
  order: number;           // 显示顺序
  createdAt: string;
  updatedAt: string;
}
```

### CreateProjectPage

创建页面的输入（用于创建 Project 时）：

```typescript
interface CreateProjectPage {
  name: string;           // 页面名称，1-100 字符
  icon?: string;          // 页面图标（emoji 或图标标识符），最大 50 字符
  content?: string;       // 页面 HTML 内容
}
```

### ProjectPageDetail

页面详情（包含内容）：

```typescript
interface ProjectPageDetail {
  id: string;
  name: string;
  icon?: string | null;
  content?: string | null;  // HTML 内容
  order: number;
  createdAt: string;
  updatedAt: string;
}
```

### ProjectArtifact

Project 关联的 Artifact（带角色和官方标识）：

```typescript
interface ProjectArtifact {
  artifact: ArtifactListItem;  // 完整的 Artifact 信息
  role?: ProjectRole;          // 在 Project 中的角色（只能是叶子角色）
  isOfficial: boolean;         // 是否为官方 artifact
  createdAt: string;           // 关联创建时间
}
```

### ProjectDetail

Project 详情（包含所有关联数据）：

```typescript
interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  topic: string;        // hashtag
  description?: string | null;
  license?: string | null;
  coverUrls?: string[];  // 封面图片 URL 数组
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  maintainers: {        // 管理者列表
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  }[];
  artifacts: ProjectArtifact[];  // 关联的 artifacts
  roles: ProjectRole[];          // 定义的角色列表
  pages: ProjectPage[];          // 页面列表（不含内容）
  homepageId?: string | null;    // 主页 ID
}
```

### UserProjectRole

用户在 Project 中的角色类型：

```typescript
type UserProjectRole = 'owner' | 'maintainer';
```

### UserProjectListItem

用户的 Project 列表项（包含角色信息）：

```typescript
interface UserProjectListItem {
  id: string;           // UUID
  name: string;
  topic: string;        // hashtag
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  createdAt: string;    // ISO 8601 日期时间
  updatedAt: string;
  owner: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  maintainerCount?: number;   // 管理者数量
  artifactCount?: number;     // 关联 artifact 数量
  role: UserProjectRole;      // 用户在此 project 中的角色
}
```

### JwtPayload

JWT Token 负载：

```typescript
interface JwtPayload {
  sub: string;      // 用户 ID
  username: string;
  email: string;
  isAdmin: boolean;
  iat?: number;     // 签发时间
  exp?: number;     // 过期时间
}
```

## 开发

### 重新生成类型

修改 `openapi.yaml` 后，运行以下命令重新生成类型：

```bash
pnpm generate
```

### 文件结构

```
packages/api/
├── openapi.yaml           # OpenAPI 3.1 规范（单一真相来源）
├── src/
│   ├── index.ts           # 主入口，导出便捷类型别名
│   ├── client.ts          # API 客户端工厂函数
│   └── generated/
│       └── openapi.ts     # 自动生成的类型（勿手动修改）
├── package.json
└── README.md
```

## 依赖

- [openapi-typescript](https://github.com/drwpow/openapi-typescript) - 从 OpenAPI 规范生成类型
- [openapi-fetch](https://github.com/drwpow/openapi-typescript/tree/main/packages/openapi-fetch) - 类型安全的 fetch 客户端

## License

MIT
