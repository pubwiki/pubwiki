import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@pubwiki/api';
import { OptimisticLockError, type BatchContext } from '@pubwiki/db';

/**
 * ServiceError code 到 HTTP 状态码的映射
 */
const SERVICE_ERROR_STATUS_MAP: Record<string, ContentfulStatusCode> = {
  CONFLICT: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  USER_EXISTS: 409,
  INVALID_CREDENTIALS: 401,
  USER_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/**
 * 将 ServiceError 转换为 HTTP 响应
 * @param c Hono Context
 * @param error ServiceError 对象
 * @param defaultStatus 未知 error code 时的默认状态码（默认 500）
 */
export function serviceErrorResponse(
  c: Context,
  error: { code: string; message: string },
  defaultStatus: ContentfulStatusCode = 500,
): Response {
  const status = SERVICE_ERROR_STATUS_MAP[error.code] ?? defaultStatus;
  return c.json<ApiError>({ error: error.message }, status);
}

// ============================================================================
// Convenience error response helpers
// These provide a consistent API for common error patterns in route handlers
// ============================================================================

/** 400 Bad Request */
export function badRequest(c: Context, message: string): Response {
  return c.json<ApiError>({ error: message }, 400);
}

/** 403 Forbidden */
export function forbidden(c: Context, message: string = 'Access denied'): Response {
  return c.json<ApiError>({ error: message }, 403);
}

/** 404 Not Found */
export function notFound(c: Context, message: string): Response {
  return c.json<ApiError>({ error: message }, 404);
}

/** 409 Conflict */
export function conflict(c: Context, message: string): Response {
  return c.json<ApiError>({ error: message }, 409);
}

/** 500 Internal Server Error */
export function internalError(c: Context, message: string): Response {
  return c.json<ApiError>({ error: message }, 500);
}

// ============================================================================
// D1/SQLite constraint error detection
// ============================================================================

/**
 * Check if an error is a D1/SQLite UNIQUE constraint violation.
 * When a UNIQUE/PRIMARY KEY constraint is violated inside db.batch(),
 * the entire batch rolls back and this error is thrown.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

// ============================================================================
// BatchContext commit helper with OptimisticLockError handling
// ============================================================================

/**
 * Commit BatchContext with consistent OptimisticLockError handling.
 * Returns a Response if there's a conflict, otherwise returns null.
 * 
 * @param c Hono Context
 * @param ctx BatchContext to commit
 * @param conflictMessage Message to return on OptimisticLockError (409 Conflict)
 * @returns Response if conflict, null if success
 */
export async function commitWithConflictHandling(
  c: Context,
  ctx: BatchContext,
  conflictMessage: string = 'Concurrent modification detected. Please retry.',
): Promise<Response | null> {
  try {
    await ctx.commit();
    return null;
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return conflict(c, conflictMessage);
    }
    throw error;
  }
}
