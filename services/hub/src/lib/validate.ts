import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiError } from '@pubwiki/api';

/**
 * 校验请求参数并返回校验后的数据
 * 失败时返回 400 错误响应
 */
export function validateQuery<T extends z.ZodType>(
  c: Context,
  schema: T,
  rawQuery: Record<string, string | string[] | undefined>,
): z.infer<T> | Response {
  // 将字符串类型的数字转换为数字
  const processedQuery = processQueryParams(rawQuery);
  
  const result = schema.safeParse(processedQuery);
  if (!result.success) {
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('; ');
    return c.json<ApiError>({ error: `Validation error: ${errors}` }, 400);
  }
  return result.data;
}

/**
 * 校验请求体并返回校验后的数据
 * 失败时返回 400 错误响应
 */
export async function validateBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiError>({ error: 'Invalid JSON body' }, 400);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('; ');
    return c.json<ApiError>({ error: `Validation error: ${errors}` }, 400);
  }
  return result.data;
}

/**
 * 校验路径参数
 */
export function validateParams<T extends z.ZodType>(
  c: Context,
  schema: T,
  params: Record<string, string>,
): z.infer<T> | Response {
  const result = schema.safeParse(params);
  if (!result.success) {
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('; ');
    return c.json<ApiError>({ error: `Validation error: ${errors}` }, 400);
  }
  return result.data;
}

/**
 * 类型守卫：检查校验结果是否为 Response（错误）
 */
export function isValidationError(result: unknown): result is Response {
  return result instanceof Response;
}

/**
 * 处理查询参数：将字符串数字转换为数字类型
 */
function processQueryParams(
  query: Record<string, string | string[] | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    
    if (Array.isArray(value)) {
      result[key] = value;
    } else {
      // 尝试转换为数字
      const num = Number(value);
      if (!isNaN(num) && value !== '') {
        result[key] = num;
      } else {
        result[key] = value;
      }
    }
  }
  
  return result;
}
