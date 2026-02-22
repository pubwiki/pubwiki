import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb, BatchContext, ArtifactService, OptimisticLockError, type GetLineageParams, type CreateArtifactInput, type PatchArtifactInput, type UpdateArtifactMetadataInput, type UpdateVersionMetadataInput } from '@pubwiki/db';
import type { ListArtifactsResponse, GetArtifactLineageResponse, ApiError, CreateArtifactResponse, GetArtifactGraphResponse, PatchArtifactResponse, UpdateArtifactMetadataResponse, UpdateVersionMetadataResponse } from '@pubwiki/api';
import { computeSha256Hex } from '@pubwiki/api';
import { ListArtifactsQueryParams, GetArtifactLineageQueryParams, CreateArtifactBody, PatchArtifactBody, UpdateArtifactMetadataBody, UpdateVersionMetadataBody } from '@pubwiki/api/validate';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';
import { resourceAccessMiddleware } from '../middleware/resource-access';
import { checkResourceAccess } from '../lib/access-control';
import { validateQuery, validateFormDataJson, validateBody, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';
import { marked } from 'marked';

const artifactsRoute = new Hono<{ Bindings: Env }>();

// 从 CreateArtifactBody 提取子 schema（用于 multipart/form-data 的分字段校验）
const CreateArtifactMetadataSchema = CreateArtifactBody.shape.metadata;
const CreateArtifactNodesSchema = CreateArtifactBody.shape.nodes;
const CreateArtifactEdgesSchema = CreateArtifactBody.shape.edges;

// 从 PatchArtifactBody 提取子 schema
const PatchArtifactMetadataSchema = PatchArtifactBody.shape.metadata;

// 生成artifact主页在R2中的存储key
function getArtifactHomepageKey(artifactId: string): string {
  return `artifacts/${artifactId}/homepage.html`;
}

// 获取公开 artifact 列表
artifactsRoute.get('/', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);

  // 解析数组参数（URL query 中的重复参数）
  const rawQuery = {
    ...c.req.query(),
    'tag.include': c.req.queries('tag.include'),
    'tag.exclude': c.req.queries('tag.exclude'),
  };

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, ListArtifactsQueryParams, rawQuery);
  if (isValidationError(validated)) return validated;

  const result = await artifactService.listPublicArtifacts(validated);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 500);
  }

  return c.json<ListArtifactsResponse>(result.data);
});

// 获取 artifact 谱系信息
artifactsRoute.get('/:artifactId/lineage', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const artifactId = c.req.param('artifactId');

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'artifact', id: artifactId });
  if (accessError) return accessError;

  // 使用 zod schema 校验查询参数
  const validated = validateQuery(c, GetArtifactLineageQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const lineageParams: GetLineageParams = {
    commit: validated.commit,
    parentDepth: validated.parentDepth,
    childDepth: validated.childDepth,
  };

  // 获取谱系信息
  const lineageResult = await artifactService.getArtifactLineage(artifactId, lineageParams);
  if (!lineageResult.success) {
    return c.json<ApiError>({ error: lineageResult.error.message }, 500);
  }

  return c.json<GetArtifactLineageResponse>(lineageResult.data);
});

// 获取 artifact 主页 HTML
artifactsRoute.get('/:artifactId/homepage', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const artifactId = c.req.param('artifactId');

  // 先检查 artifact 是否存在
  const artifact = await artifactService.getArtifactById(artifactId);
  if (!artifact.success) {
    return c.json<ApiError>({ error: 'artifact not found' }, 404);
  }

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'artifact', id: artifactId });
  if (accessError) return accessError;

  // 从 R2 获取主页 HTML
  const key = getArtifactHomepageKey(artifactId);
  const object = await c.env.R2_BUCKET.get(key);

  if (!object) {
    return c.json<ApiError>({ error: 'Artifact homepage not found' }, 404);
  }

  const html = await object.text();
  
  return c.html(html);
});

artifactsRoute.post('/', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const user = c.get('user');

  // 解析 multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json<ApiError>({ error: 'Invalid form data' }, 400);
  }

  // 使用 zod schema 校验 metadata
  const metadata = validateFormDataJson(c, formData, 'metadata', CreateArtifactMetadataSchema);
  if (isValidationError(metadata)) return metadata;

  // 使用 zod schema 校验 nodes
  const nodes = validateFormDataJson(c, formData, 'nodes', CreateArtifactNodesSchema);
  if (isValidationError(nodes)) return nodes;

  // 使用 zod schema 校验 edges
  const edges = validateFormDataJson(c, formData, 'edges', CreateArtifactEdgesSchema);
  if (isValidationError(edges)) return edges;

  // 收集 VFS 二进制文件: vfs[{filesHash}] 和 save 二进制文件: save[{quadsHash}]
  // 使用 hash 作为 key 支持内容去重
  const vfsArchives = new Map<string, ArrayBuffer>();
  const saveArchives = new Map<string, ArrayBuffer>();
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const vfsMatch = key.match(/^vfs\[([^\]]+)\]$/);
      if (vfsMatch) {
        const filesHash = vfsMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        // Verify hash matches
        const computedHash = await computeSha256Hex(arrayBuffer);
        if (computedHash !== filesHash) {
          return c.json<ApiError>({
            error: `VFS filesHash mismatch: expected ${filesHash}, computed ${computedHash}`,
          }, 400);
        }
        vfsArchives.set(filesHash, arrayBuffer);
        continue;
      }
      const saveMatch = key.match(/^save\[([^\]]+)\]$/);
      if (saveMatch) {
        const quadsHash = saveMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        // Verify hash matches
        const computedHash = await computeSha256Hex(arrayBuffer);
        if (computedHash !== quadsHash) {
          return c.json<ApiError>({
            error: `Save quadsHash mismatch: expected ${quadsHash}, computed ${computedHash}`,
          }, 400);
        }
        saveArchives.set(quadsHash, arrayBuffer);
      }
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

  // 创建 artifact（内部同步 node versions + 创建 artifact version）
  // SAVE nodes are now first-class artifact nodes and are included in the nodes array
  // 使用类型断言：zod 推断的类型和 openapi-typescript 生成的类型结构等价，但 TypeScript 认为不兼容
  const result = await artifactService.createArtifact({
    authorId: user.id,
    metadata,
    nodes,
    edges,
  } as CreateArtifactInput);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit database operations
  // OptimisticLockError is thrown here if artifact already exists (idempotent creation)
  try {
    await ctx.commit();
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return c.json<ApiError>(
        { error: `Artifact ${metadata.artifactId} already exists. Use PATCH for graph changes or PUT /metadata for metadata changes.` },
        409
      );
    }
    throw error;
  }

  const { artifact: createdArtifact } = result.data;
  const artifactId = createdArtifact.id;

  // 上传 VFS 归档到 R2（filesHash 作为 key，支持去重）
  for (const [filesHash, archiveBuffer] of vfsArchives.entries()) {
    const r2Key = `vfs/${filesHash}/files.tar.gz`;
    await c.env.R2_BUCKET.put(r2Key, archiveBuffer, {
      httpMetadata: { contentType: 'application/gzip' },
    });
  }

  // 上传 save 数据到 R2（quadsHash 作为 key，支持去重）
  for (const [quadsHash, saveBuffer] of saveArchives.entries()) {
    const r2Key = `saves/${quadsHash}/quads.bin`;
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

// 获取 artifact 节点图结构
artifactsRoute.get('/:artifactId/graph', optionalAuthMiddleware, resourceAccessMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const artifactId = c.req.param('artifactId');
  const versionQuery = c.req.query('version');

  // 访问控制检查
  const accessError = await checkResourceAccess(c, { type: 'artifact', id: artifactId });
  if (accessError) return accessError;

  const result = await artifactService.getArtifactGraph(artifactId, versionQuery);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<GetArtifactGraphResponse>(result.data);
});

// DELETE: Delete artifact
artifactsRoute.delete('/:artifactId', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const user = c.get('user');

  const artifactId = c.req.param('artifactId');

  // Validate UUID format
  if (!artifactId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return c.json<ApiError>({ error: 'Invalid artifact ID format' }, 400);
  }

  const result = await artifactService.deleteArtifact(
    { artifactId, userId: user.id },
    c.env.R2_BUCKET
  );

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit the batch to persist changes
  await ctx.commit();

  return c.body(null, 204);
});

// PATCH: 基于已有版本和增量补丁创建新 Artifact 版本
artifactsRoute.patch('/', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const user = c.get('user');

  // 解析 multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json<ApiError>({ error: 'Invalid form data' }, 400);
  }

  // 使用 zod schema 校验 metadata
  const metadata = validateFormDataJson(c, formData, 'metadata', PatchArtifactMetadataSchema);
  if (isValidationError(metadata)) return metadata;

  // 收集 VFS 二进制文件: vfs[{filesHash}] 和 save 二进制文件: save[{quadsHash}]
  // 使用 hash 作为 key 支持内容去重
  const vfsArchives = new Map<string, ArrayBuffer>();
  const saveArchives = new Map<string, ArrayBuffer>();
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const vfsMatch = key.match(/^vfs\[([^\]]+)\]$/);
      if (vfsMatch) {
        const filesHash = vfsMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        // Verify hash matches
        const computedHash = await computeSha256Hex(arrayBuffer);
        if (computedHash !== filesHash) {
          return c.json<ApiError>({
            error: `VFS filesHash mismatch: expected ${filesHash}, computed ${computedHash}`,
          }, 400);
        }
        vfsArchives.set(filesHash, arrayBuffer);
        continue;
      }
      const saveMatch = key.match(/^save\[([^\]]+)\]$/);
      if (saveMatch) {
        const quadsHash = saveMatch[1];
        const arrayBuffer = await value.arrayBuffer();
        // Verify hash matches
        const computedHash = await computeSha256Hex(arrayBuffer);
        if (computedHash !== quadsHash) {
          return c.json<ApiError>({
            error: `Save quadsHash mismatch: expected ${quadsHash}, computed ${computedHash}`,
          }, 400);
        }
        saveArchives.set(quadsHash, arrayBuffer);
      }
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
  // SAVE nodes are now first-class artifact nodes, included in metadata.nodes if graph update is needed
  // 使用类型断言：zod 推断的类型和 openapi-typescript 生成的类型结构等价，但 TypeScript 认为不兼容
  const result = await artifactService.patchArtifact({
    authorId: user.id,
    metadata,
  } as PatchArtifactInput);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit database operations
  // OptimisticLockError is thrown here if version with same commit already exists (idempotent patch)
  try {
    await ctx.commit();
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return c.json<ApiError>(
        { error: `Version with commit ${metadata.commit} already exists for artifact ${metadata.artifactId}. This indicates a duplicate patch request.` },
        409
      );
    }
    throw error;
  }

  const { artifact: patchedArtifact } = result.data;
  const artifactId = patchedArtifact.id;

  // Upload VFS archives to R2 (filesHash as key, supports deduplication)
  // PATCH always creates a new version, so always upload VFS archives
  for (const [filesHash, archiveBuffer] of vfsArchives.entries()) {
    const r2Key = `vfs/${filesHash}/files.tar.gz`;
    await c.env.R2_BUCKET.put(r2Key, archiveBuffer, {
      httpMetadata: { contentType: 'application/gzip' },
    });
  }

  // Upload save data to R2 (quadsHash as key, supports deduplication)
  for (const [quadsHash, saveBuffer] of saveArchives.entries()) {
    const r2Key = `saves/${quadsHash}/quads.bin`;
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
    },
    200
  );
});

// PUT: Update artifact metadata (name, description, isListed, isPrivate, etc.)
artifactsRoute.put('/:artifactId/metadata', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const user = c.get('user');
  const artifactId = c.req.param('artifactId');

  // Validate request body with zod schema
  const validated = await validateBody(c, UpdateArtifactMetadataBody);
  if (isValidationError(validated)) return validated;

  const input: UpdateArtifactMetadataInput = {
    artifactId,
    authorId: user.id,
    data: validated,
  };

  const result = await artifactService.updateArtifactMetadata(input);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit database operations
  try {
    await ctx.commit();
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      // Concurrent public→private transition detected
      // Return 409 to let client retry and discover the new state
      return c.json<ApiError>(
        { error: 'Concurrent modification: artifact privacy is being updated by another request' },
        409
      );
    }
    throw error;
  }

  return c.json<UpdateArtifactMetadataResponse>(result.data, 200);
});

// PUT: Update version metadata (version, changelog, commitTags, entrypoint)
artifactsRoute.put('/:artifactId/versions/:commitHash/metadata', authMiddleware, async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const artifactService = new ArtifactService(ctx);
  const user = c.get('user');
  const artifactId = c.req.param('artifactId');
  const commitHash = c.req.param('commitHash');

  // Validate request body with zod schema
  const validated = await validateBody(c, UpdateVersionMetadataBody);
  if (isValidationError(validated)) return validated;

  const input: UpdateVersionMetadataInput = {
    artifactId,
    authorId: user.id,
    commitHash,
    data: validated,
  };

  const result = await artifactService.updateVersionMetadata(input);

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // Commit database operations
  await ctx.commit();

  return c.json({
    message: 'Version metadata updated successfully',
    version: result.data.version,
  } satisfies UpdateVersionMetadataResponse, 200);
});

export { artifactsRoute };
