import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiError } from '@pubwiki/api';

/**
 * Format a single Zod issue into a readable string,
 * expanding invalid_union errors to show per-variant details.
 */
function formatIssue(issue: z.core.$ZodIssue, depth = 0): string {
  const prefix = issue.path.length ? `${issue.path.join('.')}: ` : '';
  if (issue.code === 'invalid_union' && 'errors' in issue) {
    const variantErrors = (issue as z.core.$ZodIssueInvalidUnion).errors;
    const details = variantErrors.map((variantIssues, i) => {
      const msgs = variantIssues.map(vi => formatIssue(vi, depth + 1));
      return `  variant ${i + 1}: ${msgs.join('; ')}`;
    }).join('\n');
    return `${prefix}No matching union variant:\n${details}`;
  }
  return `${prefix}${issue.message}`;
}

function formatZodErrors(issues: z.core.$ZodIssue[]): string {
  return issues.map(issue => formatIssue(issue)).join('; ');
}

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
    return c.json<ApiError>({ error: `Validation error: ${formatZodErrors(result.error.issues)}` }, 400);
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
    return c.json<ApiError>({ error: `Validation error: ${formatZodErrors(result.error.issues)}` }, 400);
  }
  return result.data;
}

/**
 * 从 FormData 中获取 JSON 字段并校验（必填字段版本）
 * @param c Hono Context
 * @param formData FormData 对象
 * @param fieldName 字段名
 * @param schema Zod schema
 * @returns 校验后的数据，或 Response（错误）
 */
export function validateFormDataJson<T extends z.ZodType>(
  c: Context,
  formData: FormData,
  fieldName: string,
  schema: T,
): z.infer<T> | Response;

/**
 * 从 FormData 中获取 JSON 字段并校验（可选字段版本）
 * @param c Hono Context
 * @param formData FormData 对象
 * @param fieldName 字段名
 * @param schema Zod schema
 * @param options.required 是否必填
 * @returns 校验后的数据，或 Response（错误），或 undefined（可选字段不存在时）
 */
export function validateFormDataJson<T extends z.ZodType>(
  c: Context,
  formData: FormData,
  fieldName: string,
  schema: T,
  options: { required: false },
): z.infer<T> | Response | undefined;

// 实现
export function validateFormDataJson<T extends z.ZodType>(
  c: Context,
  formData: FormData,
  fieldName: string,
  schema: T,
  options: { required?: boolean } = {},
): z.infer<T> | Response | undefined {
  const { required = true } = options;

  const fieldValue = formData.get(fieldName);
  
  // 检查字段是否存在
  if (!fieldValue || typeof fieldValue !== 'string') {
    if (required) {
      return c.json<ApiError>({ error: `${fieldName} field is required and must be a JSON string` }, 400);
    }
    return undefined;
  }

  // 解析 JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldValue);
  } catch {
    return c.json<ApiError>({ error: `Invalid JSON in ${fieldName} field` }, 400);
  }

  // 使用 schema 校验
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return c.json<ApiError>({ error: `Validation error in ${fieldName}: ${formatZodErrors(result.error.issues)}` }, 400);
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
    return c.json<ApiError>({ error: `Validation error: ${formatZodErrors(result.error.issues)}` }, 400);
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
