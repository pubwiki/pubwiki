import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ArtifactService, NodeService, cloudSaves, eq, and, type ListArtifactsParams, type GetLineageParams, type CreateArtifactNodeContent } from '@pubwiki/db';
import type { ListArtifactsResponse, GetArtifactLineageResponse, ApiError, ArtifactType, CreateArtifactMetadata, CreateArtifactResponse, ArtifactDescriptor, GetArtifactGraphResponse, GetNodeDetailResponse, ArtifactNodeDescriptor } from '@pubwiki/api';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';
import { marked } from 'marked';

const artifactsRoute = new Hono<{ Bindings: Env }>();

// 生成artifact主页在R2中的存储key
function getArtifactHomepageKey(artifactId: string): string {
  return `artifacts/${artifactId}/homepage.html`;
}

// 获取公开 artifact 列表
artifactsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);

  // 解析查询参数
  const query = c.req.query();
  
  // 解析数组参数（URL query 中的重复参数）
  const url = new URL(c.req.url);
  const typeInclude = url.searchParams.getAll('type.include') as ArtifactType[];
  const typeExclude = url.searchParams.getAll('type.exclude') as ArtifactType[];
  const tagInclude = url.searchParams.getAll('tag.include');
  const tagExclude = url.searchParams.getAll('tag.exclude');

  const params: ListArtifactsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    typeInclude: typeInclude.length > 0 ? typeInclude : undefined,
    typeExclude: typeExclude.length > 0 ? typeExclude : undefined,
    tagInclude: tagInclude.length > 0 ? tagInclude : undefined,
    tagExclude: tagExclude.length > 0 ? tagExclude : undefined,
    sortBy: query.sortBy as ListArtifactsParams['sortBy'],
    sortOrder: query.sortOrder as ListArtifactsParams['sortOrder'],
  };

  // 验证排序参数
  const validSortBy = ['createdAt', 'updatedAt', 'viewCount', 'starCount'];
  const validSortOrder = ['asc', 'desc'];
  
  if (params.sortBy && !validSortBy.includes(params.sortBy)) {
    return c.json<ApiError>({ error: `Invalid sortBy value. Must be one of: ${validSortBy.join(', ')}` }, 400);
  }
  if (params.sortOrder && !validSortOrder.includes(params.sortOrder)) {
    return c.json<ApiError>({ error: `Invalid sortOrder value. Must be one of: ${validSortOrder.join(', ')}` }, 400);
  }

  // 验证类型参数
  const validTypes = ['RECIPE', 'GAME', 'ASSET_PACK', 'PROMPT'];
  if (params.typeInclude) {
    for (const type of params.typeInclude) {
      if (!validTypes.includes(type)) {
        return c.json<ApiError>({ error: `Invalid type value: ${type}. Must be one of: ${validTypes.join(', ')}` }, 400);
      }
    }
  }
  if (params.typeExclude) {
    for (const type of params.typeExclude) {
      if (!validTypes.includes(type)) {
        return c.json<ApiError>({ error: `Invalid type value: ${type}. Must be one of: ${validTypes.join(', ')}` }, 400);
      }
    }
  }

  const result = await artifactService.listPublicArtifacts(params);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListArtifactsResponse>(result.data);
});

// 获取 artifact 谱系信息
artifactsRoute.get('/:artifactId/lineage', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const artifactId = c.req.param('artifactId');
  const user = c.get('user');

  // 获取 artifact 信息进行权限检查
  const artifactResult = await artifactService.getArtifactById(artifactId);
  if (!artifactResult.success) {
    if (artifactResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Artifact not found' }, 404);
    }
    return c.json<ApiError>({ error: artifactResult.error.message }, 500);
  }

  const { artifact, author } = artifactResult.data;

  // 权限检查
  if (artifact.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted artifact' }, 401);
  }
  if (artifact.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private artifact' }, 401);
    }
    if (user.id !== artifact.authorId) {
      return c.json<ApiError>({ error: 'You do not have permission to access this artifact' }, 403);
    }
  }

  // 解析深度参数
  const query = c.req.query();
  const lineageParams: GetLineageParams = {};
  
  if (query.parentDepth) {
    const depth = parseInt(query.parentDepth, 10);
    if (isNaN(depth) || depth < 1) {
      return c.json<ApiError>({ error: 'parentDepth must be a positive integer' }, 400);
    }
    lineageParams.parentDepth = depth;
  }
  
  if (query.childDepth) {
    const depth = parseInt(query.childDepth, 10);
    if (isNaN(depth) || depth < 1) {
      return c.json<ApiError>({ error: 'childDepth must be a positive integer' }, 400);
    }
    lineageParams.childDepth = depth;
  }

  // 获取谱系信息
  const lineageResult = await artifactService.getArtifactLineage(artifactId, lineageParams);
  if (!lineageResult.success) {
    return c.json<ApiError>({ error: lineageResult.error.message }, 500);
  }

  return c.json<GetArtifactLineageResponse>(lineageResult.data);
});

// 获取 artifact 主页 HTML
artifactsRoute.get('/:artifactId/homepage', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const artifactId = c.req.param('artifactId');
  const user = c.get('user');

  // 获取 artifact 信息进行权限检查
  const artifactResult = await artifactService.getArtifactById(artifactId);
  if (!artifactResult.success) {
    if (artifactResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Artifact not found' }, 404);
    }
    return c.json<ApiError>({ error: artifactResult.error.message }, 500);
  }

  const { artifact } = artifactResult.data;

  // 权限检查
  // PUBLIC: 所有人可访问
  // UNLISTED: 仅注册用户可访问
  // PRIVATE: 仅 owner 可访问
  if (artifact.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted artifact' }, 401);
  }
  if (artifact.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private artifact' }, 401);
    }
    if (user.id !== artifact.authorId) {
      return c.json<ApiError>({ error: 'You do not have permission to access this artifact' }, 403);
    }
  }

  // 从 R2 获取主页 HTML
  const key = getArtifactHomepageKey(artifactId);
  const object = await c.env.R2_BUCKET.get(key);

  if (!object) {
    return c.json<ApiError>({ error: 'Artifact homepage not found' }, 404);
  }

  const html = await object.text();
  
  return c.html(html);
});

// 验证 descriptor 中的节点内容
interface DescriptorValidationResult {
  valid: boolean;
  error?: string;
}

function validateDescriptor(descriptor: ArtifactDescriptor): DescriptorValidationResult {
  for (const node of descriptor.nodes) {
    if (!node.external) {
      if (!node.type) {
        return { valid: false, error: `Internal node ${node.id} must have a type` };
      }
      // 非外部节点必须有 content（VFS 节点除外，VFS 的 content 可以为空，因为文件在 tar.gz 中）
      if (node.type !== 'VFS' && !node.content) {
        return { valid: false, error: `Internal node ${node.id} (type: ${node.type}) must have content in descriptor` };
      }
    }
  }
  return { valid: true };
}

// 创建 artifact（新架构：内容在 descriptor 中，VFS 文件单独上传为 tar.gz）
artifactsRoute.post('/', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const user = c.get('user');

  // 解析 multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json<ApiError>({ error: 'Invalid form data' }, 400);
  }

  // 获取并解析 metadata
  const metadataStr = formData.get('metadata');
  if (!metadataStr || typeof metadataStr !== 'string') {
    return c.json<ApiError>({ error: 'metadata field is required and must be a JSON string' }, 400);
  }

  let metadata: CreateArtifactMetadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON in metadata field' }, 400);
  }

  // 获取并解析 descriptor
  const descriptorStr = formData.get('descriptor');
  if (!descriptorStr || typeof descriptorStr !== 'string') {
    return c.json<ApiError>({ error: 'descriptor field is required and must be a JSON string' }, 400);
  }

  let descriptor: ArtifactDescriptor;
  try {
    descriptor = JSON.parse(descriptorStr);
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON in descriptor field' }, 400);
  }

  // 验证 descriptor
  if (!descriptor.version || !descriptor.nodes || !descriptor.edges) {
    return c.json<ApiError>({ error: 'descriptor must contain version, nodes, and edges' }, 400);
  }

  // 验证必填字段
  if (!metadata.type || !metadata.name || !metadata.slug || !metadata.version) {
    return c.json<ApiError>({ error: 'type, name, slug, and version are required in metadata' }, 400);
  }

  // 验证 type
  const validTypes = ['RECIPE', 'GAME', 'ASSET_PACK', 'PROMPT'];
  if (!validTypes.includes(metadata.type)) {
    return c.json<ApiError>({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, 400);
  }

  // 验证 slug 格式
  const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!slugPattern.test(metadata.slug)) {
    return c.json<ApiError>({ error: 'slug must be URL-friendly (lowercase letters, numbers, and hyphens only)' }, 400);
  }

  // 验证 version 格式 (semver)
  const versionPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/;
  if (!versionPattern.test(metadata.version)) {
    return c.json<ApiError>({ error: 'version must be in semver format (e.g., 1.0.0 or 1.0.0-beta)' }, 400);
  }

  // 处理可选的主页 markdown
  let homepageHtml: string | null = null;
  const homepageFile = formData.get('homepage');
  if (homepageFile) {
    if (homepageFile instanceof File) {
      const markdownContent = await homepageFile.text();
      homepageHtml = await marked.parse(markdownContent);
    } else if (typeof homepageFile === 'string') {
      homepageHtml = await marked.parse(homepageFile);
    }
  }

  // 验证 descriptor 中的节点 content（新架构）
  const validationResult = validateDescriptor(descriptor);
  if (!validationResult.valid) {
    return c.json<ApiError>({ error: validationResult.error! }, 400);
  }

  // 收集 VFS 节点的 tar.gz 文件
  // 文件 key 格式: vfs[{nodeId}]
  const vfsArchives = new Map<string, ArrayBuffer>();

  for (const [key, value] of formData.entries()) {
    const match = key.match(/^vfs\[([^\]]+)\]$/);
    if (match && value instanceof File) {
      const nodeId = match[1];
      const arrayBuffer = await value.arrayBuffer();
      vfsArchives.set(nodeId, arrayBuffer);
    }
  }

  // 验证 VFS 节点必须有对应的 tar.gz 文件（非 external 的）
  for (const node of descriptor.nodes) {
    if (node.type === 'VFS' && !node.external) {
      if (!vfsArchives.has(node.id)) {
        return c.json<ApiError>({ 
          error: `VFS node ${node.id} requires a tar.gz archive (vfs[${node.id}])` 
        }, 400);
      }
    }
  }

  // 构建 nodeContents Map（从 descriptor 中提取）
  const nodeContents = new Map<string, CreateArtifactNodeContent>();

  for (const node of descriptor.nodes) {
    if (node.external) continue;

    const content = node.content;
    if (content === undefined || content === null) {
      return c.json<ApiError>({ 
        error: `Node ${node.id} is missing content in descriptor` 
      }, 400);
    }

    // 计算 content hash
    const contentStr = JSON.stringify(content);
    const encoder = new TextEncoder();
    const data = encoder.encode(contentStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

    nodeContents.set(node.id, {
      content,
      contentHash,
    });
  }

  // 验证 STATE 节点必须指定有效的 saveId 和 checkpointId
  for (const node of descriptor.nodes) {
    if (node.type === 'STATE' && !node.external) {
      const nodeContentEntry = nodeContents.get(node.id);
      const nodeContent = nodeContentEntry?.content as Record<string, unknown> | undefined;
      
      if (!nodeContent?.saveId || !nodeContent?.checkpointId) {
        return c.json<ApiError>({ 
          error: `STATE node ${node.id} must specify saveId and checkpointId in content` 
        }, 400);
      }

      const saveId = nodeContent.saveId as string;
      const checkpointId = nodeContent.checkpointId as string;

      // 验证 save 存在且属于当前用户
      const [save] = await db.select().from(cloudSaves)
        .where(and(
          eq(cloudSaves.id, saveId),
          eq(cloudSaves.userId, user.id)
        ))
        .limit(1);

      if (!save) {
        return c.json<ApiError>({ 
          error: `Save ${saveId} not found or access denied for STATE node ${node.id}` 
        }, 400);
      }

      // 验证 checkpoint 存在
      const checkpoint = await c.env.GAMESAVE.getCheckpoint(saveId, checkpointId);
      if (!checkpoint) {
        return c.json<ApiError>({ 
          error: `Checkpoint ${checkpointId} not found in save ${saveId} for STATE node ${node.id}` 
        }, 400);
      }

      // 发布时将 checkpoint visibility 设置为 max(checkpoint_visibility, artifact_visibility)
      const visibilityOrder = { 'PRIVATE': 0, 'UNLISTED': 1, 'PUBLIC': 2 } as const;
      const artifactVisibility = metadata.visibility || 'PUBLIC'; // 默认 PUBLIC
      const checkpointVisLevel = visibilityOrder[checkpoint.visibility];
      const artifactVisLevel = visibilityOrder[artifactVisibility as keyof typeof visibilityOrder] ?? 2;
      
      if (checkpointVisLevel < artifactVisLevel) {
        await c.env.GAMESAVE.updateCheckpointVisibility(saveId, checkpointId, artifactVisibility as 'PRIVATE' | 'UNLISTED' | 'PUBLIC');
      }
    }
  }

  // 创建 artifact
  const result = await artifactService.createArtifact({
    authorId: user.id,
    metadata,
    descriptor,
    nodeContents,
  });

  if (!result.success) {
    if (result.error.code === 'CONFLICT') {
      return c.json<ApiError>({ error: result.error.message }, 409);
    }
    if (result.error.code === 'FORBIDDEN') {
      return c.json<ApiError>({ error: result.error.message }, 403);
    }
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    if (result.error.code === 'BAD_REQUEST') {
      return c.json<ApiError>({ error: result.error.message }, 400);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  const { artifact: createdArtifact } = result.data;
  const artifactId = createdArtifact.id;

  // 上传 VFS 节点的 tar.gz 到 R2
  const nodeService = new NodeService(db);

  for (const [nodeId, archiveBuffer] of vfsArchives.entries()) {
    const archiveKeyResult = await nodeService.getVfsArchiveKey(artifactId, nodeId);
    if (!archiveKeyResult.success) continue;

    const r2Key = archiveKeyResult.data.key;
    await c.env.R2_BUCKET.put(r2Key, archiveBuffer, {
      httpMetadata: {
        contentType: 'application/gzip',
      },
    });
  }

  // 上传主页 HTML 到 R2
  if (homepageHtml) {
    const homepageKey = getArtifactHomepageKey(artifactId);
    await c.env.R2_BUCKET.put(homepageKey, homepageHtml, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
    });
  }

  return c.json<CreateArtifactResponse>(
    {
      message: 'Artifact saved successfully',
      artifact: createdArtifact,
    },
    200
  );
});

// 获取 artifact 节点图结构
artifactsRoute.get('/:artifactId/graph', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const nodeService = new NodeService(db);
  const artifactId = c.req.param('artifactId');
  const user = c.get('user');
  const version = c.req.query('version');

  // 获取 artifact 信息进行权限检查
  const artifactResult = await artifactService.getArtifactById(artifactId);
  if (!artifactResult.success) {
    if (artifactResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Artifact not found' }, 404);
    }
    return c.json<ApiError>({ error: artifactResult.error.message }, 500);
  }

  const { artifact } = artifactResult.data;

  // 权限检查
  if (artifact.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted artifact' }, 401);
  }
  if (artifact.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private artifact' }, 401);
    }
    if (user.id !== artifact.authorId) {
      return c.json<ApiError>({ error: 'You do not have permission to access this artifact' }, 403);
    }
  }

  // 获取图结构
  const graphResult = await nodeService.getArtifactGraph(artifactId, version);
  if (!graphResult.success) {
    if (graphResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: graphResult.error.message }, 404);
    }
    return c.json<ApiError>({ error: graphResult.error.message }, 500);
  }

  return c.json<GetArtifactGraphResponse>(graphResult.data);
});

// 获取节点详情
artifactsRoute.get('/:artifactId/nodes/:nodeId', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const nodeService = new NodeService(db);
  const artifactId = c.req.param('artifactId');
  const nodeId = c.req.param('nodeId');
  const user = c.get('user');
  const version = c.req.query('version');

  // 获取 artifact 信息进行权限检查
  const artifactResult = await artifactService.getArtifactById(artifactId);
  if (!artifactResult.success) {
    if (artifactResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Artifact not found' }, 404);
    }
    return c.json<ApiError>({ error: artifactResult.error.message }, 500);
  }

  const { artifact } = artifactResult.data;

  // 权限检查
  if (artifact.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted artifact' }, 401);
  }
  if (artifact.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private artifact' }, 401);
    }
    if (user.id !== artifact.authorId) {
      return c.json<ApiError>({ error: 'You do not have permission to access this artifact' }, 403);
    }
  }

  // 获取节点详情
  const nodeResult = await nodeService.getNodeDetail(artifactId, nodeId, version);
  if (!nodeResult.success) {
    if (nodeResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: nodeResult.error.message }, 404);
    }
    return c.json<ApiError>({ error: nodeResult.error.message }, 500);
  }

  return c.json<GetNodeDetailResponse>(nodeResult.data);
});

// 获取 VFS 节点的 tar.gz 归档文件
artifactsRoute.get('/:artifactId/nodes/:nodeId/archive', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const nodeService = new NodeService(db);
  const artifactId = c.req.param('artifactId');
  const nodeId = c.req.param('nodeId');
  const user = c.get('user');
  const version = c.req.query('version');

  // 获取 artifact 信息进行权限检查
  const artifactResult = await artifactService.getArtifactById(artifactId);
  if (!artifactResult.success) {
    if (artifactResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: 'Artifact not found' }, 404);
    }
    return c.json<ApiError>({ error: artifactResult.error.message }, 500);
  }

  const { artifact } = artifactResult.data;

  // 权限检查
  if (artifact.visibility === 'UNLISTED' && !user) {
    return c.json<ApiError>({ error: 'Authentication required to access unlisted artifact' }, 401);
  }
  if (artifact.visibility === 'PRIVATE') {
    if (!user) {
      return c.json<ApiError>({ error: 'Authentication required to access private artifact' }, 401);
    }
    if (user.id !== artifact.authorId) {
      return c.json<ApiError>({ error: 'You do not have permission to access this artifact' }, 403);
    }
  }

  // 获取节点详情以检查类型
  const nodeResult = await nodeService.getNodeDetail(artifactId, nodeId, version);
  if (!nodeResult.success) {
    if (nodeResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: nodeResult.error.message }, 404);
    }
    return c.json<ApiError>({ error: nodeResult.error.message }, 500);
  }

  const node = nodeResult.data;

  // 只有 VFS 类型节点支持 archive 端点
  if (node.type !== 'VFS') {
    return c.json<ApiError>({ error: 'Only VFS type nodes support the archive endpoint. Use node detail for content.' }, 400);
  }

  // 获取 archive key
  const archiveKeyResult = await nodeService.getVfsArchiveKey(artifactId, nodeId, version);
  if (!archiveKeyResult.success) {
    if (archiveKeyResult.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: archiveKeyResult.error.message }, 404);
    }
    return c.json<ApiError>({ error: archiveKeyResult.error.message }, 500);
  }

  // 从 R2 获取 archive
  const object = await c.env.R2_BUCKET.get(archiveKeyResult.data.key);
  if (!object) {
    return c.json<ApiError>({ error: 'Archive not found in storage' }, 404);
  }

  // 返回 tar.gz 文件
  const headers = new Headers();
  headers.set('Content-Type', 'application/gzip');
  if (object.size) {
    headers.set('Content-Length', object.size.toString());
  }
  if (object.etag) {
    headers.set('ETag', object.etag);
  }
  headers.set('Content-Disposition', `attachment; filename="${nodeId}.tar.gz"`);

  return new Response(object.body, { headers });
});

export { artifactsRoute };
