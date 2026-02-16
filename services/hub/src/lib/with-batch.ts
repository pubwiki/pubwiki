import type { Context } from 'hono';
import type { ApiError } from '@pubwiki/api';
import { createDb, BatchContext, OptimisticLockError, type ServiceResult } from '@pubwiki/db';
import { serviceErrorResponse } from './service-error';
import type { Env } from '../types';

export interface WithBatchOptions<T> {
  c: Context<{ Bindings: Env }>;
  /** Business logic to execute within BatchContext */
  run: (ctx: BatchContext) => Promise<ServiceResult<T>>;
  /** Side effects to execute after successful commit */
  afterCommit?: (data: T) => Promise<void>;
}

/**
 * Execute business logic with BatchContext and handle commit/error
 *
 * @example
 * ```typescript
 * artifactsRoute.post('/', authMiddleware, async (c) => {
 *   const data = await withBatch({
 *     c,
 *     run: async (ctx) => {
 *       const artifactService = new ArtifactService(ctx);
 *       return artifactService.createArtifact(input);
 *     },
 *     afterCommit: async (result) => {
 *       for (const [commit, buffer] of vfsArchives) {
 *         await c.env.R2_BUCKET.put(`archives/${commit}.tar.gz`, buffer);
 *       }
 *     },
 *   });
 *
 *   if (data instanceof Response) return data;
 *
 *   return c.json<CreateArtifactResponse>({
 *     message: 'Artifact created successfully',
 *     artifact: data.artifact,
 *   });
 * });
 * ```
 */
export async function withBatch<T>(
  options: WithBatchOptions<T>
): Promise<T | Response> {
  const { c, run, afterCommit } = options;
  const db = createDb(c.env.DB);
  const ctx = new BatchContext(db);

  // 1. Execute business logic
  const result = await run(ctx);
  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  // 2. Commit
  try {
    await ctx.commit();
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return c.json<ApiError>({ error: error.msg }, 409);
    }
    throw error;
  }

  // 3. Side effects
  if (afterCommit) {
    await afterCommit(result.data);
  }

  return result.data;
}
