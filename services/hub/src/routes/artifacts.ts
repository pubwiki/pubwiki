import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, ArtifactService, NodeVersionService, artifactVersions, artifactVersionNodes, artifactVersionEdges, artifactCommitTags, eq, and, desc, inArray, type ListArtifactsParams, type GetLineageParams, type CreateArtifactNode, type PatchArtifactInput, type CreateSaveInput } from '@pubwiki/db';
import type { ListArtifactsResponse, GetArtifactLineageResponse, ApiError, CreateArtifactMetadata, CreateArtifactResponse, GetArtifactGraphResponse, ArtifactEdgeDescriptor, ArtifactNodeContent, ArtifactNodeType, PatchArtifactRequest, PatchArtifactResponse, UpdateCommitTagsRequest, ArtifactVersion as ArtifactVersionType } from '@pubwiki/api';
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
  const tagInclude = url.searchParams.getAll('tag.include');
  const tagExclude = url.searchParams.getAll('tag.exclude');

  const params: ListArtifactsParams = {
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
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

  // 解析查询参数
  const query = c.req.query();
  const lineageParams: GetLineageParams = {};

  if (query.commit) {
    lineageParams.commit = query.commit;
  }
  
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

// 创建 artifact（两步流程的第二步：引用已同步的 node versions）
// 前置条件：所有引用的 node versions 必须已通过 POST /nodes/:nodeId/sync 同步
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

  // 获取并解析 nodes（完整的 node version 数据）
  const nodesStr = formData.get('nodes');
  if (!nodesStr || typeof nodesStr !== 'string') {
    return c.json<ApiError>({ error: 'nodes field is required and must be a JSON string' }, 400);
  }

  let nodes: CreateArtifactNode[];
  try {
    nodes = JSON.parse(nodesStr);
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON in nodes field' }, 400);
  }

  if (!Array.isArray(nodes)) {
    return c.json<ApiError>({ error: 'nodes must be an array' }, 400);
  }

  // 验证每个 node 的必填字段
  for (const node of nodes) {
    if (!node.nodeId || !node.commit || !node.type || !node.contentHash) {
      return c.json<ApiError>({ error: 'Each node must have nodeId, commit, type, and contentHash fields' }, 400);
    }
  }

  // 收集 VFS 二进制文件: vfs[{commit}] 和 save 二进制文件: save[{commit}]
  const vfsArchives = new Map<string, ArrayBuffer>();
  const saveArchives = new Map<string, ArrayBuffer>();
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const vfsMatch = key.match(/^vfs\[([^\]]+)\]$/);
      if (vfsMatch) {
        const commit = vfsMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        vfsArchives.set(commit, arrayBuffer);
        continue;
      }
      const saveMatch = key.match(/^save\[([^\]]+)\]$/);
      if (saveMatch) {
        const commit = saveMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        saveArchives.set(commit, arrayBuffer);
      }
    }
  }

  // 获取并解析 edges
  const edgesStr = formData.get('edges');
  if (!edgesStr || typeof edgesStr !== 'string') {
    return c.json<ApiError>({ error: 'edges field is required and must be a JSON string' }, 400);
  }

  let edges: ArtifactEdgeDescriptor[];
  try {
    edges = JSON.parse(edgesStr);
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON in edges field' }, 400);
  }

  if (!Array.isArray(edges)) {
    return c.json<ApiError>({ error: 'edges must be an array' }, 400);
  }

  // 验证必填字段
  if (!metadata.name) {
    return c.json<ApiError>({ error: 'name is required in metadata' }, 400);
  }

  // 验证 artifactId
  if (!metadata.artifactId) {
    return c.json<ApiError>({ error: 'artifactId is required in metadata' }, 400);
  }

  // 验证 commit
  if (!metadata.commit) {
    return c.json<ApiError>({ error: 'commit is required in metadata' }, 400);
  }

  // 解析可选的 saves（和 nodes、edges 平级）
  let saves: CreateSaveInput[] | undefined;
  const savesStr = formData.get('saves');
  if (savesStr && typeof savesStr === 'string') {
    try {
      saves = JSON.parse(savesStr);
      if (!Array.isArray(saves)) {
        return c.json<ApiError>({ error: 'saves must be an array' }, 400);
      }
    } catch {
      return c.json<ApiError>({ error: 'Invalid JSON in saves field' }, 400);
    }
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

  // 创建 artifact（内部同步 node versions + 创建 saves + 创建 artifact version）
  const result = await artifactService.createArtifact({
    authorId: user.id,
    metadata,
    nodes,
    edges,
    saves,
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

  // 上传 VFS 归档到 R2（commit 全局唯一，作为 key）
  for (const [commit, archiveBuffer] of vfsArchives.entries()) {
    const r2Key = `archives/${commit}.tar.gz`;
    await c.env.R2_BUCKET.put(r2Key, archiveBuffer, {
      httpMetadata: { contentType: 'application/gzip' },
    });
  }

  // 上传 save 数据到 R2（commit 全局唯一，作为 key）
  for (const [commit, saveBuffer] of saveArchives.entries()) {
    const r2Key = `saves/${commit}.bin`;
    await c.env.R2_BUCKET.put(r2Key, saveBuffer, {
      httpMetadata: { contentType: 'application/octet-stream' },
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

// 获取 artifact 节点图结构（使用新 artifact_version_nodes/edges + node_versions）
artifactsRoute.get('/:artifactId/graph', optionalAuthMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const nodeVersionService = new NodeVersionService(db);
  const artifactId = c.req.param('artifactId');
  const user = c.get('user');
  const versionQuery = c.req.query('version');

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

  // 获取指定版本或最新版本
  let versionResult;
  if (versionQuery && versionQuery !== 'latest') {
    // 先尝试按 commitHash 查询
    versionResult = await db
      .select()
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.artifactId, artifactId),
          eq(artifactVersions.commitHash, versionQuery)
        )
      )
      .limit(1);

    // 如果找不到，再尝试按 commitTag 查询（通过关联表）
    if (versionResult.length === 0) {
      const tagResult = await artifactService.getVersionByTag(artifactId, versionQuery);
      if (tagResult.success) {
        versionResult = [tagResult.data.version];
      }
    }
  } else {
    versionResult = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.createdAt))
      .limit(1);
  }

  if (versionResult.length === 0) {
    return c.json<ApiError>({ error: 'Artifact version not found' }, 404);
  }

  const version = versionResult[0];

  // 获取 artifact_version_nodes
  const versionNodes = await db
    .select()
    .from(artifactVersionNodes)
    .where(eq(artifactVersionNodes.commitHash, version.commitHash));

  // 获取每个节点的版本信息和内容
  const nodes = [];
  for (const vn of versionNodes) {
    const versionDetail = await nodeVersionService.getVersion(vn.nodeCommit);
    if (versionDetail.success) {
      const v = versionDetail.data;
      nodes.push({
        id: vn.nodeId,
        type: v.type as ArtifactNodeType,
        commit: v.commit,
        contentHash: v.contentHash,
        name: v.name,
        position: vn.positionX != null && vn.positionY != null
          ? { x: vn.positionX, y: vn.positionY }
          : undefined,
        content: v.content as ArtifactNodeContent,
      });
    }
  }

  // 获取 artifact_version_edges
  const versionEdges = await db
    .select()
    .from(artifactVersionEdges)
    .where(eq(artifactVersionEdges.commitHash, version.commitHash));

  const edges = versionEdges.map(e => ({
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));

  // 查询该版本的 commitTags
  const versionCommitTags = await db
    .select({ tag: artifactCommitTags.tag })
    .from(artifactCommitTags)
    .where(eq(artifactCommitTags.commitHash, version.commitHash));

  return c.json<GetArtifactGraphResponse>({
    nodes,
    edges,
    version: {
      id: version.id,
      commitHash: version.commitHash,
      commitTags: versionCommitTags.map(t => t.tag),
      version: version.version ?? '',
      createdAt: version.createdAt,
      entrypoint: version.entrypoint ?? undefined,
    },
  });
});

// PATCH: 基于已有版本和增量补丁创建新 Artifact 版本
artifactsRoute.patch('/', authMiddleware, async (c) => {
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

  let metadata: PatchArtifactRequest;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON in metadata field' }, 400);
  }

  // 验证必填字段
  if (!metadata.artifactId) {
    return c.json<ApiError>({ error: 'artifactId is required' }, 400);
  }
  if (!metadata.baseCommit) {
    return c.json<ApiError>({ error: 'baseCommit is required' }, 400);
  }
  // commit 仅在有 graph 变更时必须（service 层会校验）

  // 收集 VFS 二进制文件: vfs[{commit}] 和 save 二进制文件: save[{commit}]
  const vfsArchives = new Map<string, ArrayBuffer>();
  const saveArchives = new Map<string, ArrayBuffer>();
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const vfsMatch = key.match(/^vfs\[([^\]]+)\]$/);
      if (vfsMatch) {
        const commit = vfsMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        vfsArchives.set(commit, arrayBuffer);
        continue;
      }
      const saveMatch = key.match(/^save\[([^\]]+)\]$/);
      if (saveMatch) {
        const commit = saveMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        saveArchives.set(commit, arrayBuffer);
      }
    }
  }

  // 解析可选的 saves
  let saves: CreateSaveInput[] | undefined;
  const savesStr = formData.get('saves');
  if (savesStr && typeof savesStr === 'string') {
    try {
      saves = JSON.parse(savesStr);
      if (!Array.isArray(saves)) {
        return c.json<ApiError>({ error: 'saves must be an array' }, 400);
      }
    } catch {
      return c.json<ApiError>({ error: 'Invalid JSON in saves field' }, 400);
    }
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

  // 执行 patch
  const result = await artifactService.patchArtifact({
    authorId: user.id,
    metadata: {
      ...metadata,
      addNodes: metadata.addNodes as CreateArtifactNode[] | undefined,
    },
    saves,
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

  const { artifact: patchedArtifact, versionCreated } = result.data;
  const artifactId = patchedArtifact.id;

  // 上传 VFS 归档到 R2（commit 全局唯一，作为 key）
  if (versionCreated) {
    for (const [commit, archiveBuffer] of vfsArchives.entries()) {
      const r2Key = `archives/${commit}.tar.gz`;
      await c.env.R2_BUCKET.put(r2Key, archiveBuffer, {
        httpMetadata: { contentType: 'application/gzip' },
      });
    }
  }

  // 上传 save 数据到 R2（commit 全局唯一，作为 key）
  for (const [commit, saveBuffer] of saveArchives.entries()) {
    const r2Key = `saves/${commit}.bin`;
    await c.env.R2_BUCKET.put(r2Key, saveBuffer, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  }

  // 上传主页 HTML 到 R2
  if (homepageHtml) {
    const homepageKey = getArtifactHomepageKey(artifactId);
    await c.env.R2_BUCKET.put(homepageKey, homepageHtml, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }

  return c.json<PatchArtifactResponse>(
    {
      message: 'Artifact patched successfully',
      artifact: patchedArtifact,
      versionCreated,
    },
    200
  );
});

// PUT: 设置 commit 上的标签列表
artifactsRoute.put('/:artifactId/commit-tag', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const user = c.get('user');
  const artifactId = c.req.param('artifactId');

  let body: UpdateCommitTagsRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.commitHash) {
    return c.json<ApiError>({ error: 'commitHash is required' }, 400);
  }

  if (!Array.isArray(body.commitTags)) {
    return c.json<ApiError>({ error: 'commitTags must be an array' }, 400);
  }

  const result = await artifactService.updateCommitTags(
    artifactId,
    user.id,
    body.commitHash,
    body.commitTags,
  );

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    if (result.error.code === 'FORBIDDEN') {
      return c.json<ApiError>({ error: result.error.message }, 403);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json({
    message: 'Commit tags updated successfully',
    version: result.data.version,
  }, 200);
});

// PUT: 标记版本为 weak（不可逆）
artifactsRoute.put('/:artifactId/versions/:commitHash/weak', authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const artifactService = new ArtifactService(db);
  const user = c.get('user');
  const artifactId = c.req.param('artifactId');
  const commitHash = c.req.param('commitHash');

  const result = await artifactService.markVersionWeak(
    artifactId,
    user.id,
    commitHash,
  );

  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return c.json<ApiError>({ error: result.error.message }, 404);
    }
    if (result.error.code === 'FORBIDDEN') {
      return c.json<ApiError>({ error: result.error.message }, 403);
    }
    if (result.error.code === 'BAD_REQUEST') {
      return c.json<ApiError>({ error: result.error.message }, 400);
    }
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json({
    message: 'Version marked as weak',
    gcResult: result.data.gcResult,
  }, 200);
});

export { artifactsRoute };
