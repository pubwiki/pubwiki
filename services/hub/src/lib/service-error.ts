import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@pubwiki/api';

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
