import { AppError } from '$lib/errors/types';

/**
 * 将 openapi-fetch 的 { data?, error? } 结果转换为
 * 成功时直接返回 data，失败时抛出 AppError
 *
 * @example
 * ```typescript
 * // 旧代码：
 * const { data, error } = await apiClient.GET('/artifacts', { ... });
 * if (error) { this.error = error.error || '...'; return { success: false }; }
 * this.artifacts = data.artifacts;
 *
 * // 新代码：
 * const data = await apiCall(() => apiClient.GET('/artifacts', { ... }));
 * this.artifacts = data.artifacts;
 * // 错误由外层 try/catch + errorRouter.dispatch() 统一处理
 * ```
 */
export async function apiCall<T>(
	fn: () => Promise<{ data?: T; error?: { error: string }; response: Response }>
): Promise<T> {
	const { data, error, response } = await fn();
	if (error || !data) {
		throw AppError.fromHttpResponse(error ?? { error: 'Unknown API error' }, response.status);
	}
	return data;
}

/**
 * apiCall 的变体，返回 { success, data, error } 而不是抛出异常
 *
 * 适用于需要在调用点处理错误的场景，而不是让错误向上传播
 *
 * @example
 * ```typescript
 * const result = await apiCallSafe(() => apiClient.GET('/artifacts', { ... }));
 * if (!result.success) {
 *   // 处理特定错误类型
 *   if (result.error.category === 'not_found') {
 *     return showEmptyState();
 *   }
 *   errorRouter.dispatch(result.error);
 *   return;
 * }
 * // 使用 result.data
 * ```
 */
export async function apiCallSafe<T>(
	fn: () => Promise<{ data?: T; error?: { error: string }; response: Response }>
): Promise<{ success: true; data: T } | { success: false; error: AppError }> {
	try {
		const data = await apiCall(fn);
		return { success: true, data };
	} catch (error) {
		if (error instanceof AppError) {
			return { success: false, error };
		}
		return {
			success: false,
			error: new AppError('UNKNOWN', error instanceof Error ? error.message : String(error), 'client')
		};
	}
}
