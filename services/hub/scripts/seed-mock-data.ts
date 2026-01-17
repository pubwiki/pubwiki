/**
 * 通过 API 创建 mock 数据
 * 
 * 使用方法:
 *   pnpm seed
 * 
 * 前置条件:
 *   确保 API 服务器已启动: pnpm dev
 * 
 * 这个脚本会:
 * 1. 注册测试用户
 * 2. 登录获取 token
 * 3. 从 scripts/mock 目录读取 artifact 配置
 * 4. 通过 API 创建 artifacts
 * 5. 创建 projects 并关联 artifacts
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// 从 .env 文件加载环境变量
config();

// API 基础 URL
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.pub.wiki/api';

// 存储 session cookies
const userCookies: Record<string, string> = {};

// Mock 用户数据
const mockUsers = [
  { username: 'user_a', email: 'user_a@example.com', password: 'password123', displayName: 'User A' },
  { username: 'user_b', email: 'user_b@example.com', password: 'password123', displayName: 'User B' },
  { username: 'worldbuilder', email: 'worldbuilder@example.com', password: 'password123', displayName: 'World Builder' },
  { username: 'gamedev', email: 'gamedev@example.com', password: 'password123', displayName: 'Game Developer' },
];

// Mock 文件类型定义
interface MockNodeFile {
  filename: string;
  filepath: string;
  content: string;
  mimeType: string;
}

interface MockArtifactNode {
  id: string;
  type: 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'LOADER' | 'SANDBOX' | 'STATE';
  name: string;
  external?: boolean;
  externalArtifactId?: string;
  externalArtifactSlug?: string;
  externalNodeId?: string;
  vfsFilePaths?: string[];
  uploadFiles?: MockNodeFile[];
}

interface MockArtifact {
  authorUsername: string;
  type: 'RECIPE' | 'GAME' | 'ASSET_PACK' | 'PROMPT';
  name: string;
  slug: string;
  description: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  license?: string;
  thumbnailUrl?: string;
  version: string;
  changelog?: string;
  tags: string[];
  nodes: MockArtifactNode[];
  edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
  homepage?: string;
}

interface MockProjectRole {
  name: string;
  description?: string;
  parentName?: string;
}

interface MockProjectPage {
  name: string;
  icon?: string;
  content?: string;
}

interface MockProjectArtifactLink {
  artifactSlug: string;
  roleName: string;  // 使用 role 的 name 作为引用
}

interface MockProject {
  ownerUsername: string;
  name: string;
  slug: string;
  topic: string;
  description?: string;
  visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  license?: string;
  coverUrls?: string[];
  roles: MockProjectRole[];
  pages?: MockProjectPage[];
  homepageIndex?: number;
  officialArtifacts: MockProjectArtifactLink[];
  communityArtifacts: MockProjectArtifactLink[];
}

// Mock Article 类型定义
interface MockArticleContentBlock {
  type: 'text' | 'game_ref';
  id?: string;      // for text
  text?: string;    // for text
  textId?: string;  // for game_ref
  ref?: string;     // for game_ref
}

interface MockArticle {
  id: string;
  title: string;
  sandboxNodeSlug: string;  // 用于查找对应的 artifact
  sandboxNodeId: string;    // sandbox node 的 ID
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  content: MockArticleContentBlock[];
}

// 存储创建的资源
const createdArtifacts: Map<string, { id: string; slug: string; authorUsername: string }> = new Map();
const createdProjects: Map<string, { id: string; slug: string; roles: Array<{ id: string; name: string }> }> = new Map();
const createdArticles: Map<string, { id: string; title: string }> = new Map();

// 注册或登录用户，返回 session cookie
async function getOrCreateUserCookie(user: typeof mockUsers[0]): Promise<string> {
  if (userCookies[user.username]) {
    return userCookies[user.username];
  }

  const origin = new URL(API_BASE_URL).origin;

  // 尝试登录
  let response = await fetch(`${API_BASE_URL}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Origin': origin,
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
    }),
  });

  if (response.ok) {
    const setCookie = response.headers.get('Set-Cookie') || '';
    const sessionCookie = setCookie.split(';')[0];
    userCookies[user.username] = sessionCookie;
    console.log(`  ✓ Logged in as ${user.username}`);
    return sessionCookie;
  }

  // 登录失败，尝试注册
  response = await fetch(`${API_BASE_URL}/auth/sign-up/email`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Origin': origin,
    },
    body: JSON.stringify({
      name: user.displayName,
      username: user.username,
      email: user.email,
      password: user.password,
    }),
  });

  if (response.ok) {
    const setCookie = response.headers.get('Set-Cookie') || '';
    const sessionCookie = setCookie.split(';')[0];
    userCookies[user.username] = sessionCookie;
    console.log(`  ✓ Registered and logged in as ${user.username}`);
    return sessionCookie;
  }

  // 安全地解析错误响应
  let errorMessage = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (text) {
      const error = JSON.parse(text) as { error?: string; message?: string };
      errorMessage = error.error || error.message || text;
    }
  } catch {
    // 忽略解析错误
  }
  throw new Error(`Failed to authenticate user ${user.username}: ${errorMessage}`);
}

/**
 * 创建带认证的 fetch 函数
 * @param sessionCookie session cookie 字符串
 * @returns 带 Cookie header 的 fetch 函数
 */
function authFetch(sessionCookie: string) {
  return (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', sessionCookie);
    return fetch(url, { ...init, headers });
  };
}

// 创建 artifact
// 返回值: artifact ID (成功), null (失败), 'PENDING' (需要稍后重试，因为外部引用未解决)
async function createArtifact(artifact: MockArtifact, sessionCookie: string): Promise<string | null | 'PENDING'> {
  const fetchWithAuth = authFetch(sessionCookie);
  const formData = new FormData();
  
  // 生成 artifactId (客户端生成的 UUID)
  const artifactId = crypto.randomUUID();
  
  // 添加 metadata
  const metadata = {
    artifactId, // 必填字段
    type: artifact.type,
    name: artifact.name,
    slug: artifact.slug,
    description: artifact.description,
    visibility: artifact.visibility,
    license: artifact.license,
    thumbnailUrl: artifact.thumbnailUrl,
    version: artifact.version,
    changelog: artifact.changelog,
    tags: artifact.tags,
  };
  formData.append('metadata', JSON.stringify(metadata));

  // 构建 descriptor - 先处理节点，检查是否有外部引用问题
  // 存储本地 ID 到实际 ID 的映射（用于处理 edges）
  const localIdToActualId: Record<string, string> = {};
  
  const nodeDescriptors: Array<{
    id: string;
    external: boolean;
    type: string;
    name: string;
    files?: string[];
  } | null> = artifact.nodes.map(node => {
    // 处理外部引用 - 外部节点的 id 应该是被引用节点的真实 ID
    if (node.external) {
      if (node.externalArtifactSlug && node.externalNodeId) {
        const externalArtifact = createdArtifacts.get(node.externalArtifactSlug);
        if (externalArtifact) {
          // 直接使用 externalNodeId，现在我们信任用户传入的 ID
          localIdToActualId[node.id] = node.externalNodeId;
          return {
            id: node.externalNodeId,  // 使用被引用节点的 ID
            external: true,
            type: node.type,
            name: node.name,
          };
        } else {
          // 如果引用的 artifact 还没创建，返回 null
          return null;
        }
      } else if (node.externalArtifactId && node.externalNodeId) {
        // 直接使用提供的 ID
        localIdToActualId[node.id] = node.externalNodeId;
        return {
          id: node.externalNodeId,
          external: true,
          type: node.type,
          name: node.name,
        };
      }
    }
    
    // 非外部节点使用本地 ID
    localIdToActualId[node.id] = node.id;
    const nodeDesc: {
      id: string;
      external: boolean;
      type: string;
      name: string;
      files?: string[];
    } = {
      id: node.id,
      external: false,
      type: node.type,
      name: node.name,
    };
    
    // VFS 类型节点的文件路径
    if (node.type === 'VFS' && node.vfsFilePaths && node.vfsFilePaths.length > 0) {
      nodeDesc.files = node.vfsFilePaths;
    }
    return nodeDesc;
  });

  // 检查是否有外部引用未解决
  if (nodeDescriptors.some(n => n === null)) {
    return 'PENDING'; // 返回特殊标记表示需要稍后重试
  }

  // 映射 edges 中的节点 ID
  const mappedEdges = artifact.edges.map(edge => ({
    source: localIdToActualId[edge.source] || edge.source,
    target: localIdToActualId[edge.target] || edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }));

  const descriptor = {
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes: nodeDescriptors.filter((n): n is NonNullable<typeof n> => n !== null),
    edges: mappedEdges,
  };
  formData.append('descriptor', JSON.stringify(descriptor));

  // 添加节点文件
  for (const node of artifact.nodes) {
    if (node.uploadFiles && !node.external) {
      for (const file of node.uploadFiles) {
        const blob = new Blob([file.content], { type: file.mimeType });
        formData.append(`nodes[${node.id}]`, blob, file.filepath);
      }
    }
  }

  // 添加 homepage
  if (artifact.homepage) {
    const homepageBlob = new Blob([artifact.homepage], { type: 'text/markdown' });
    formData.append('homepage', homepageBlob, 'homepage.md');
  }

  const response = await fetchWithAuth(`${API_BASE_URL}/artifacts`, {
    method: 'POST',
    body: formData,
  });

  if (response.ok) {
    const data = await response.json() as { 
      artifact: { id: string; slug: string }; 
    };
    createdArtifacts.set(artifact.slug, { 
      id: data.artifact.id, 
      slug: data.artifact.slug,
      authorUsername: artifact.authorUsername,
    });
    console.log(`  ✓ Created artifact: ${artifact.name}`);
    return data.artifact.id;
  } else {
    const error = await response.json() as { error: string };
    if (error.error.includes('slug already exists')) {
      console.log(`  ⚠ Artifact already exists: ${artifact.name}`);
      // 尝试获取已存在的 artifact
      const getResponse = await fetchWithAuth(`${API_BASE_URL}/artifacts?slug=${artifact.slug}`, {});
      if (getResponse.ok) {
        const listData = await getResponse.json() as { artifacts: Array<{ id: string; slug: string }> };
        if (listData.artifacts.length > 0) {
          const existingArtifact = listData.artifacts[0];
          createdArtifacts.set(artifact.slug, { 
            id: existingArtifact.id, 
            slug: existingArtifact.slug,
            authorUsername: artifact.authorUsername,
          });
          return existingArtifact.id;
        }
      }
    } else {
      console.error(`  ❌ Failed to create artifact ${artifact.name}: ${error.error}`);
    }
    return null;
  }
}

// 创建 project
async function createProject(project: MockProject, sessionCookie: string): Promise<string | null> {
  const fetchWithAuth = authFetch(sessionCookie);
  // 构建 artifacts 数组，使用 roleName 引用
  const artifacts = project.officialArtifacts
    .map(a => {
      const artifactId = createdArtifacts.get(a.artifactSlug)?.id;
      if (!artifactId) return null;
      return { artifactId, roleName: a.roleName };
    })
    .filter((item): item is { artifactId: string; roleName: string } => item !== null);

  // 构建请求体
  const body = {
    name: project.name,
    slug: project.slug,
    topic: project.topic,
    description: project.description,
    visibility: project.visibility || 'PUBLIC',
    license: project.license,
    coverUrls: project.coverUrls,
    roles: project.roles,
    pages: project.pages,
    homepageIndex: project.homepageIndex,
    artifacts,
  };

  const response = await fetchWithAuth(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    const data = await response.json() as { 
      project: { 
        id: string; 
        slug: string; 
        roles: Array<{ id: string; name: string }> 
      } 
    };
    
    createdProjects.set(project.slug, {
      id: data.project.id,
      slug: data.project.slug,
      roles: data.project.roles,
    });
    
    console.log(`  ✓ Created project: ${project.name}`);
    return data.project.id;
  } else {
    const error = await response.json() as { error: string };
    if (error.error.includes('slug already exists') || error.error.includes('already exists')) {
      console.log(`  ⚠ Project already exists: ${project.name}`);
      // 尝试获取已存在的 project 以获取 roles 映射
      const listResponse = await fetchWithAuth(`${API_BASE_URL}/projects?topic=${encodeURIComponent(project.topic)}`, {});
      if (listResponse.ok) {
        const listData = await listResponse.json() as { projects: Array<{ id: string; name: string }> };
        const existingProject = listData.projects.find(p => p.name === project.name);
        if (existingProject) {
          // 获取 project 详情以获取 roles
          const detailResponse = await fetchWithAuth(`${API_BASE_URL}/projects/${existingProject.id}`, {});
          if (detailResponse.ok) {
            const detailData = await detailResponse.json() as { 
              id: string; 
              slug: string; 
              roles: Array<{ id: string; name: string }> 
            };
            createdProjects.set(project.slug, {
              id: detailData.id,
              slug: detailData.slug,
              roles: detailData.roles,
            });
            return detailData.id;
          }
        }
      }
    } else {
      console.error(`  ❌ Failed to create project ${project.name}: ${error.error}`);
    }
    return null;
  }
}

// 链接 artifact 到 project
async function linkArtifactToProject(
  projectSlug: string, 
  artifactSlug: string, 
  roleName: string,  // 使用 role 的 name 作为引用
  isOfficial: boolean, 
  sessionCookie: string
): Promise<boolean> {
  const fetchWithAuth = authFetch(sessionCookie);
  const project = createdProjects.get(projectSlug);
  const artifact = createdArtifacts.get(artifactSlug);
  
  if (!project || !artifact) {
    console.error(`  ❌ Cannot link: project or artifact not found`);
    return false;
  }
  
  // 查找 role ID（必须找到）
  const role = project.roles.find(r => r.name === roleName);
  if (!role) {
    console.error(`  ❌ Cannot link: role "${roleName}" not found in project`);
    return false;
  }
  
  const response = await fetchWithAuth(`${API_BASE_URL}/projects/${project.id}/artifacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactId: artifact.id,
      roleId: role.id,
      isOfficial,
    }),
  });

  if (response.ok) {
    console.log(`  ✓ Linked artifact "${artifactSlug}" to project "${projectSlug}" (official: ${isOfficial})`);
    return true;
  } else {
    const error = await response.json() as { error: string };
    if (error.error.includes('already linked') || error.error.includes('already exists')) {
      console.log(`  ⚠ Artifact already linked: ${artifactSlug}`);
    } else {
      console.error(`  ❌ Failed to link artifact: ${error.error}`);
    }
    return false;
  }
}

// 递归读取目录中的所有文件
function readDirRecursively(dir: string, basePath: string = ''): Array<{ relativePath: string; fullPath: string }> {
  const results: Array<{ relativePath: string; fullPath: string }> = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = basePath ? `${basePath}/${item.name}` : item.name;
    
    if (item.isDirectory()) {
      results.push(...readDirRecursively(fullPath, relativePath));
    } else if (item.isFile()) {
      results.push({ relativePath, fullPath });
    }
  }
  
  return results;
}

// 根据文件扩展名获取 MIME 类型
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
  };
  return mimeTypes[ext] || 'text/plain';
}

// 从 mock 目录加载 artifacts
async function loadMockArtifactsFromDirectory(): Promise<MockArtifact[]> {
  const mockDir = path.join(process.cwd(), 'scripts', 'mock');
  const artifacts: MockArtifact[] = [];

  if (!fs.existsSync(mockDir)) {
    return artifacts;
  }

  const mockDirs = fs.readdirSync(mockDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const dir of mockDirs) {
    const artifactDir = path.join(mockDir, dir);
    const configPath = path.join(artifactDir, 'pubwiki.artifact.json');
    const promptsDir = path.join(artifactDir, 'prompts');
    const vfsDir = path.join(artifactDir, 'vfs');

    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as {
        authorUsername: string;
        type: 'RECIPE' | 'GAME' | 'ASSET_PACK' | 'PROMPT';
        name: string;
        slug: string;
        description: string;
        visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
        license?: string;
        thumbnailUrl?: string;
        version: string;
        changelog?: string;
        tags: string[];
        nodes: Array<{
          id: string;
          type: 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'SANDBOX' | 'STATE' | 'LOADER';
          name: string;
          external?: boolean;
          externalArtifactSlug?: string;
          externalNodeId?: string;
          vfsFilePaths?: string[];
        }>;
        edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
        homepage?: string;
      };

      // 处理节点
      const processedNodes: MockArtifactNode[] = [];

      for (const node of config.nodes) {
        if (node.external) {
          // 外部引用节点
          processedNodes.push({
            id: node.id,
            type: node.type,
            name: node.name,
            external: true,
            externalArtifactSlug: node.externalArtifactSlug,
            externalNodeId: node.externalNodeId,
          });
        } else if (node.type === 'VFS') {
          // VFS 节点：从 vfs/ 目录读取文件
          if (fs.existsSync(vfsDir)) {
            const files: MockNodeFile[] = [];
            const vfsFilePaths: string[] = [];

            if (node.vfsFilePaths && node.vfsFilePaths.length > 0) {
              for (const relativePath of node.vfsFilePaths) {
                const fullPath = path.join(vfsDir, relativePath);
                if (fs.existsSync(fullPath)) {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  const filename = path.basename(relativePath);
                  vfsFilePaths.push(relativePath);
                  files.push({
                    filename,
                    filepath: relativePath,
                    content,
                    mimeType: getMimeType(filename),
                  });
                }
              }
            } else {
              const allFiles = readDirRecursively(vfsDir);
              for (const { relativePath, fullPath } of allFiles) {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const filename = path.basename(relativePath);
                vfsFilePaths.push(relativePath);
                files.push({
                  filename,
                  filepath: relativePath,
                  content,
                  mimeType: getMimeType(filename),
                });
              }
            }

            processedNodes.push({
              id: node.id,
              type: 'VFS',
              name: node.name,
              external: false,
              vfsFilePaths,
              uploadFiles: files,
            });
          }
        } else {
          // PROMPT/INPUT/GENERATED/LOADER/SANDBOX/STATE 节点
          // 尝试从 prompts 目录读取对应的文件
          const possibleFiles = [
            path.join(promptsDir, `${node.id}.md`),
            path.join(promptsDir, `${node.id}.txt`),
            path.join(promptsDir, `${node.id}.json`),
          ];

          let fileFound = false;
          for (const filePath of possibleFiles) {
            if (fs.existsSync(filePath)) {
              const content = fs.readFileSync(filePath, 'utf-8');
              // 非 VFS 类型统一使用 node.json
              const uploadFilename = 'node.json';
              const mimeType = 'application/json';
              
              processedNodes.push({
                id: node.id,
                type: node.type,
                name: node.name,
                external: false,
                uploadFiles: [{
                  filename: uploadFilename,
                  filepath: uploadFilename,
                  content,
                  mimeType,
                }],
              });
              fileFound = true;
              break;
            }
          }

          // 对于 SANDBOX/STATE/LOADER 类型，如果没有找到文件，生成默认的空 node.json
          if (!fileFound) {
            if (node.type === 'SANDBOX' || node.type === 'STATE' || node.type === 'LOADER') {
              const defaultContent = JSON.stringify({
                type: node.type,
                name: node.name,
                data: {},
              }, null, 2);
              
              processedNodes.push({
                id: node.id,
                type: node.type,
                name: node.name,
                external: false,
                uploadFiles: [{
                  filename: 'node.json',
                  filepath: 'node.json',
                  content: defaultContent,
                  mimeType: 'application/json',
                }],
              });
            } else {
              console.warn(`  ⚠ File not found for node ${node.id} in ${dir}`);
            }
          }
        }
      }

      const authorExists = mockUsers.some(u => u.username === config.authorUsername);
      
      artifacts.push({
        authorUsername: authorExists ? config.authorUsername : 'user_a',
        type: config.type,
        name: config.name,
        slug: config.slug,
        description: config.description,
        visibility: config.visibility,
        license: config.license,
        thumbnailUrl: config.thumbnailUrl,
        version: config.version,
        changelog: config.changelog,
        tags: config.tags,
        nodes: processedNodes,
        edges: config.edges,
        homepage: config.homepage,
      });

      console.log(`  ✓ Loaded artifact config: ${config.name}`);
    } catch (error) {
      console.error(`  ❌ Error parsing ${configPath}: ${error}`);
    }
  }

  return artifacts;
}

// 从 mock 目录加载 projects
async function loadMockProjectsFromDirectory(): Promise<MockProject[]> {
  const mockDir = path.join(process.cwd(), 'scripts', 'mock');
  const projects: MockProject[] = [];

  if (!fs.existsSync(mockDir)) {
    return projects;
  }

  const mockDirs = fs.readdirSync(mockDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const dir of mockDirs) {
    const projectDir = path.join(mockDir, dir);
    const configPath = path.join(projectDir, 'pubwiki.project.json');

    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as MockProject;
      
      const ownerExists = mockUsers.some(u => u.username === config.ownerUsername);
      
      projects.push({
        ...config,
        ownerUsername: ownerExists ? config.ownerUsername : 'user_a',
      });

      console.log(`  ✓ Loaded project config: ${config.name}`);
    } catch (error) {
      console.error(`  ❌ Error parsing ${configPath}: ${error}`);
    }
  }

  return projects;
}

// 从 mock 目录加载 articles
async function loadMockArticlesFromDirectory(): Promise<{ article: MockArticle; artifactSlug: string }[]> {
  const mockDir = path.join(process.cwd(), 'scripts', 'mock');
  const articles: { article: MockArticle; artifactSlug: string }[] = [];

  if (!fs.existsSync(mockDir)) {
    return articles;
  }

  const mockDirs = fs.readdirSync(mockDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const dir of mockDirs) {
    const articlesDir = path.join(mockDir, dir, 'articles');

    if (!fs.existsSync(articlesDir)) {
      continue;
    }

    const articleFiles = fs.readdirSync(articlesDir)
      .filter(f => f.endsWith('.json'));

    for (const file of articleFiles) {
      const filePath = path.join(articlesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content) as MockArticle;
        articles.push({
          article: config,
          artifactSlug: config.sandboxNodeSlug,
        });
        console.log(`  ✓ Loaded article config: ${config.title}`);
      } catch (error) {
        console.error(`  ❌ Error parsing ${filePath}: ${error}`);
      }
    }
  }

  return articles;
}

// 创建 article
async function createArticle(
  article: MockArticle,
  sessionCookie: string
): Promise<string | null> {
  const fetchWithAuth = authFetch(sessionCookie);
  const response = await fetchWithAuth(`${API_BASE_URL}/articles/${article.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: article.title,
      sandboxNodeId: article.sandboxNodeId,
      content: article.content,
      visibility: article.visibility,
    }),
  });

  if (response.ok) {
    const data = await response.json() as { id: string; title: string };
    createdArticles.set(article.id, { id: data.id, title: data.title });
    console.log(`  ✓ Created article: ${article.title}`);
    return data.id;
  } else {
    const error = await response.json() as { error: string };
    console.error(`  ❌ Failed to create article ${article.title}: ${error.error}`);
    return null;
  }
}

// Mock 讨论数据
interface MockDiscussion {
  artifactSlug: string;
  authorUsername: string;
  title: string;
  content: string;
  category: 'QUESTION' | 'FEEDBACK' | 'BUG_REPORT' | 'FEATURE_REQUEST' | 'GENERAL';
  replies?: Array<{
    authorUsername: string;
    content: string;
  }>;
}

const mockDiscussions: MockDiscussion[] = [
  {
    artifactSlug: 'stellar-nexus-universe',
    authorUsername: 'user_a',
    title: '关于涟漪空间的技术细节',
    content: '<p>我在阅读宇宙基础设定时，对涟漪空间有些疑问。文档中提到涟漪空间是超光速旅行的关键，但我不太理解它与普通空间的关系。</p><p>具体问题：</p><ol><li>涟漪空间的"涟漪"是如何产生的？</li><li>为什么只有织者能直接感知涟漪空间？</li><li>涟漪导航员需要什么样的训练？</li></ol>',
    category: 'QUESTION',
    replies: [
      {
        authorUsername: 'worldbuilder',
        content: '<p>非常好的问题！涟漪空间是一个平行于常规空间的维度，它的"涟漪"是由大质量天体的引力场引起的时空波动在这个维度的投影。</p><p>关于织者的感知能力，这与他们独特的神经结构有关。他们的大脑中有一种特殊的器官，可以感知超维空间的波动。</p><p>导航员的训练需要至少5年的专业学习，包括数学建模、空间感知强化训练等。</p>'
      },
      {
        authorUsername: 'user_b',
        content: '<p>补充一下：在官方设定中，混血（人类/织者）有时也会继承这种感知能力，比如艾拉·星尘就是一个例子。她的能力似乎比一些纯血织者还要强。</p>'
      }
    ]
  },
  {
    artifactSlug: 'stellar-nexus-universe',
    authorUsername: 'user_b',
    title: '建议：添加更多关于深空流浪者的设定',
    content: '<p>我觉得深空流浪者是一个非常有趣的势力，但目前的设定还比较简略。建议可以添加：</p><ul><li>流浪者舰队的组织结构</li><li>他们的传统和文化</li><li>与银河联邦的历史关系</li><li>著名的流浪者人物</li></ul><p>这样可以让创作者更容易以流浪者为背景创作角色。</p>',
    category: 'FEATURE_REQUEST',
    replies: [
      {
        authorUsername: 'worldbuilder',
        content: '<p>感谢建议！深空流浪者的详细设定正在筹备中，预计会在下个版本更新。敬请期待！</p>'
      }
    ]
  },
  {
    artifactSlug: 'ayla-stardust-navigator',
    authorUsername: 'worldbuilder',
    title: '角色设定审核通过',
    content: '<p>艾拉·星尘的角色设定已经审核通过，可以正式纳入星际纽带宇宙！</p><p>特别喜欢她的背景设定和"莉拉计划"的神秘元素，这为后续的故事发展留下了很大的空间。</p><p>期待看到她在社区故事中的表现。</p>',
    category: 'GENERAL'
  },
  {
    artifactSlug: 'harry-potter-worldview',
    authorUsername: 'user_b',
    title: '魔法体系中的禁咒设定',
    content: '<p>在魔法体系设定中，我注意到三大不可饶恕咒是被严格禁止的。但在同人创作中，如果需要涉及黑魔法的剧情，有什么创作建议吗？</p>',
    category: 'QUESTION',
    replies: [
      {
        authorUsername: 'worldbuilder',
        content: '<p>好问题！在同人创作中处理黑魔法时，建议：</p><ol><li>可以描写后果和影响，但避免详细描写施法过程</li><li>强调使用黑魔法的道德困境</li><li>可以创造新的、不那么极端的黑魔法</li></ol><p>关键是保持故事的教育意义和积极价值观。</p>'
      }
    ]
  },
  {
    artifactSlug: 'react-snake-game',
    authorUsername: 'user_a',
    title: '能否添加移动端触控支持？',
    content: '<p>游戏本身非常流畅！但我发现在手机上玩的时候没法控制。能否考虑添加触控支持？</p><p>建议可以加入滑动控制或虚拟按键。</p>',
    category: 'FEATURE_REQUEST',
    replies: [
      {
        authorUsername: 'gamedev',
        content: '<p>感谢反馈！触控支持已经在开发计划中了，预计下个版本会加入。会同时支持滑动和虚拟方向键两种模式。</p>'
      }
    ]
  }
];

// 创建讨论
async function createDiscussion(
  targetType: 'ARTIFACT' | 'PROJECT' | 'POST',
  targetId: string,
  discussion: MockDiscussion,
  sessionCookie: string
): Promise<string | null> {
  const fetchWithAuth = authFetch(sessionCookie);
  const response = await fetchWithAuth(`${API_BASE_URL}/discussions?targetType=${targetType}&targetId=${targetId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: discussion.title,
      content: discussion.content,
      category: discussion.category,
    }),
  });

  if (response.ok) {
    const data = await response.json() as { discussion: { id: string } };
    console.log(`  ✓ Created discussion: ${discussion.title}`);
    return data.discussion.id;
  } else {
    const error = await response.json() as { error: string };
    console.error(`  ❌ Failed to create discussion: ${error.error}`);
    return null;
  }
}

// 创建讨论回复
async function createDiscussionReply(
  discussionId: string,
  content: string,
  sessionCookie: string
): Promise<boolean> {
  const fetchWithAuth = authFetch(sessionCookie);
  const response = await fetchWithAuth(`${API_BASE_URL}/discussions/${discussionId}/replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (response.ok) {
    console.log(`    ✓ Added reply to discussion`);
    return true;
  } else {
    const error = await response.json() as { error: string };
    console.error(`    ❌ Failed to add reply: ${error.error}`);
    return false;
  }
}

// 创建 Mock 讨论
async function createMockDiscussions(artifacts: MockArtifact[]): Promise<void> {
  for (const discussion of mockDiscussions) {
    const artifact = createdArtifacts.get(discussion.artifactSlug);
    if (!artifact) {
      console.warn(`  ⚠ Artifact not found: ${discussion.artifactSlug}`);
      continue;
    }

    const author = mockUsers.find(u => u.username === discussion.authorUsername);
    if (!author) continue;

    try {
      const cookie = await getOrCreateUserCookie(author);
      const discussionId = await createDiscussion('ARTIFACT', artifact.id, discussion, cookie);
      
      // 创建回复
      if (discussionId && discussion.replies) {
        for (const reply of discussion.replies) {
          const replyAuthor = mockUsers.find(u => u.username === reply.authorUsername);
          if (!replyAuthor) continue;
          
          const replyCookie = await getOrCreateUserCookie(replyAuthor);
          await createDiscussionReply(discussionId, reply.content, replyCookie);
        }
      }
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }
}

// Mock 动态数据
interface MockPost {
  projectSlug: string;
  authorUsername: string;
  title: string;
  content: string;
  coverUrls?: string[];
}

const mockPosts: MockPost[] = [
  {
    projectSlug: 'stellar-nexus-chronicles',
    authorUsername: 'worldbuilder',
    title: '🎉 星际纽带宇宙正式开放！',
    content: '<h2>欢迎来到银河联邦纪元391年！</h2><p>经过数月的筹备，星际纽带宇宙终于正式开放了！在这里，你可以：</p><ul><li>创造属于自己的角色</li><li>书写独特的星际冒险</li><li>与其他创作者一起构建这个浩瀚的宇宙</li></ul><p>我们已经准备好了基础世界观设定，包括银河联邦、深空流浪者等势力的详细介绍。</p><p><strong>快来开始你的创作之旅吧！</strong></p>',
    coverUrls: ['https://placehold.co/800x400/1e3a5f/white?text=Welcome+to+Stellar+Nexus']
  },
  {
    projectSlug: 'stellar-nexus-chronicles',
    authorUsername: 'worldbuilder',
    title: '📢 第一位社区角色入驻！',
    content: '<p>非常高兴地宣布，我们的第一位社区创作角色 <strong>艾拉·星尘</strong> 已经正式入驻星际纽带宇宙！</p><p>艾拉是一位神秘的涟漪导航员，她的背景故事充满悬念。感谢 @user_a 的精彩创作！</p><p>欢迎更多创作者加入我们，一起丰富这个宇宙。</p>'
  },
  {
    projectSlug: 'wizarding-world-collab',
    authorUsername: 'worldbuilder',
    title: '🧙 魔法世界创作项目启动',
    content: '<h2>探索魔法的奥秘</h2><p>魔法世界创作项目正式启动！我们整理了完整的哈利波特世界观参考资料，包括：</p><ul><li>角色设定指南</li><li>世界观详解</li><li>魔法体系说明</li><li>故事元素参考</li></ul><p>无论你是想创作新角色，还是书写同人故事，这里都能找到你需要的参考。</p><p><em>记住：是我们的选择决定了我们是什么样的人，而不是我们的能力。</em></p>'
  },
  {
    projectSlug: 'cultivation-chronicles',
    authorUsername: 'worldbuilder',
    title: '⛰️ 九天修仙录开服公告',
    content: '<h2>道友，修仙之路已开</h2><p>九天修仙录世界观正式对外开放！</p><p>本世界观包含：</p><ul><li>完整的八大境界修炼体系</li><li>三大正道宗门与魔道六宗设定</li><li>丰富的法宝丹药系统</li><li>详细的故事创作指南</li></ul><p>无论你想创建一位正道剑修，还是邪魅的魔道修士，这个世界都在等待你的故事。</p><p><strong>长生路漫漫，道友请上路！</strong></p>',
    coverUrls: ['https://placehold.co/800x400/dc2626/white?text=九天修仙录']
  }
];

// 创建项目动态
async function createPost(
  projectId: string,
  post: MockPost,
  sessionCookie: string
): Promise<string | null> {
  const fetchWithAuth = authFetch(sessionCookie);
  const response = await fetchWithAuth(`${API_BASE_URL}/projects/${projectId}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      coverUrls: post.coverUrls,
    }),
  });

  if (response.ok) {
    const data = await response.json() as { post: { id: string } };
    console.log(`  ✓ Created post: ${post.title}`);
    return data.post.id;
  } else {
    const error = await response.json() as { error: string };
    console.error(`  ❌ Failed to create post: ${error.error}`);
    return null;
  }
}

// 创建 Mock 动态
async function createMockPosts(projects: MockProject[]): Promise<void> {
  for (const post of mockPosts) {
    const project = createdProjects.get(post.projectSlug);
    if (!project) {
      console.warn(`  ⚠ Project not found: ${post.projectSlug}`);
      continue;
    }

    const author = mockUsers.find(u => u.username === post.authorUsername);
    if (!author) continue;

    try {
      const cookie = await getOrCreateUserCookie(author);
      await createPost(project.id, post, cookie);
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }
}

// 主函数
async function main() {
  console.log('🌱 Seeding mock data via API...');
  console.log(`📡 API URL: ${API_BASE_URL}\n`);

  // 检查 API 是否可用
  try {
    const healthResponse = await fetch(`${API_BASE_URL}/`);
    if (!healthResponse.ok) {
      throw new Error('API health check failed');
    }
    console.log('✓ API is available\n');
  } catch (error) {
    console.error('❌ Cannot connect to API. Make sure the server is running.');
    console.error('   Run: pnpm dev');
    process.exit(1);
  }

  // 步骤 1: 注册/登录所有用户
  console.log('👤 Setting up users...');
  for (const user of mockUsers) {
    try {
      await getOrCreateUserCookie(user);
    } catch (error) {
      console.error(`  ❌ ${error}`);
      process.exit(1);
    }
  }
  console.log('');

  // 步骤 2: 从 mock 目录加载 artifacts
  console.log('📂 Loading artifacts from mock directory...');
  const artifacts = await loadMockArtifactsFromDirectory();
  console.log('');

  // 步骤 3: 按依赖顺序创建 artifacts
  // 先创建没有外部引用的 artifacts，再创建有外部引用的
  console.log('📦 Creating artifacts...');
  
  const artifactsWithoutExternalRefs = artifacts.filter(
    a => !a.nodes.some(n => n.external && n.externalArtifactSlug)
  );
  const artifactsWithExternalRefs = artifacts.filter(
    a => a.nodes.some(n => n.external && n.externalArtifactSlug)
  );

  for (const artifact of artifactsWithoutExternalRefs) {
    const user = mockUsers.find(u => u.username === artifact.authorUsername);
    if (!user) continue;
    
    try {
      const cookie = await getOrCreateUserCookie(user);
      await createArtifact(artifact, cookie);
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }

  for (const artifact of artifactsWithExternalRefs) {
    const user = mockUsers.find(u => u.username === artifact.authorUsername);
    if (!user) continue;
    
    try {
      const cookie = await getOrCreateUserCookie(user);
      await createArtifact(artifact, cookie);
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }
  console.log('');

  // 步骤 4: 从 mock 目录加载 projects
  console.log('📂 Loading projects from mock directory...');
  const projects = await loadMockProjectsFromDirectory();
  console.log('');

  // 步骤 5: 创建 projects
  console.log('🏗️ Creating projects...');
  for (const project of projects) {
    const user = mockUsers.find(u => u.username === project.ownerUsername);
    if (!user) continue;
    
    try {
      const cookie = await getOrCreateUserCookie(user);
      await createProject(project, cookie);
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }
  console.log('');

  // 步骤 6: 链接 community artifacts 到 projects
  console.log('🔗 Linking community artifacts to projects...');
  for (const project of projects) {
    const createdProject = createdProjects.get(project.slug);
    if (!createdProject) continue;
    
    for (const link of project.communityArtifacts) {
      const artifact = createdArtifacts.get(link.artifactSlug);
      if (!artifact) {
        console.warn(`  ⚠ Artifact not found for linking: ${link.artifactSlug}`);
        continue;
      }
      
      // 使用 artifact 作者的 cookie 来链接（社区贡献）
      const artifactConfig = artifacts.find(a => a.slug === link.artifactSlug);
      if (!artifactConfig) continue;
      
      const user = mockUsers.find(u => u.username === artifactConfig.authorUsername);
      if (!user) continue;
      
      try {
        const cookie = await getOrCreateUserCookie(user);
        await linkArtifactToProject(project.slug, link.artifactSlug, link.roleName, false, cookie);
      } catch (error) {
        console.error(`  ❌ ${error}`);
      }
    }
  }
  console.log('');

  // 步骤 7: 创建讨论
  console.log('💬 Creating discussions...');
  await createMockDiscussions(artifacts);
  console.log('');

  // 步骤 8: 创建项目动态
  console.log('📢 Creating project posts...');
  await createMockPosts(projects);
  console.log('');

  // 步骤 9: 从 mock 目录加载并创建 articles
  console.log('📂 Loading articles from mock directory...');
  const articleConfigs = await loadMockArticlesFromDirectory();
  console.log('');

  console.log('📝 Creating articles...');
  for (const { article, artifactSlug } of articleConfigs) {
    // 找到对应的 artifact 以获取作者信息
    const artifactInfo = createdArtifacts.get(artifactSlug);
    if (!artifactInfo) {
      console.warn(`  ⚠ Artifact not found for article: ${article.title} (slug: ${artifactSlug})`);
      continue;
    }

    const user = mockUsers.find(u => u.username === artifactInfo.authorUsername);
    if (!user) {
      console.warn(`  ⚠ User not found: ${artifactInfo.authorUsername}`);
      continue;
    }

    try {
      const cookie = await getOrCreateUserCookie(user);
      await createArticle(article, cookie);
    } catch (error) {
      console.error(`  ❌ ${error}`);
    }
  }
  console.log('');

  console.log('✅ Mock data seeding complete!');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   Users: ${mockUsers.length}`);
  console.log(`   Artifacts: ${createdArtifacts.size}`);
  console.log(`   Projects: ${createdProjects.size}`);
  console.log(`   Articles: ${createdArticles.size}`);
}

main().catch(console.error);
