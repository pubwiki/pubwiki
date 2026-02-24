/** 错误严重程度 */
export type ErrorSeverity = 'silent' | 'info' | 'warning' | 'error' | 'fatal';

/**
 * 前端错误分类——基于前端视角，与后端 ServiceError 的 code 无关。
 * 通过 HTTP 状态码推断，不依赖后端的内部错误类型。
 */
export type ErrorCategory =
	| 'network' // 网络/连接问题（通常可重试）
	| 'auth' // 认证/授权问题
	| 'validation' // 用户输入验证
	| 'conflict' // 并发冲突（需要用户决策）
	| 'not_found' // 资源不存在
	| 'server' // 服务端内部错误（对前端是黑盒）
	| 'client' // 前端逻辑错误（bug）
	| 'storage' // 本地存储错误（IndexedDB/VFS）
	| 'generation'; // LLM 生成错误

/** 仅依赖 HTTP 语义，不依赖后端内部逻辑 */
function httpStatusToCategory(status: number): ErrorCategory {
	if (status === 401 || status === 403) return 'auth';
	if (status === 404) return 'not_found';
	if (status === 409) return 'conflict';
	if (status === 400 || status === 422) return 'validation';
	if (status >= 500) return 'server';
	return 'server';
}

/** 前端统一错误类型 */
export class AppError extends Error {
	override readonly name = 'AppError';

	constructor(
		public readonly code: string,
		message: string,
		public readonly category: ErrorCategory,
		public readonly severity: ErrorSeverity = 'error',
		public readonly retryable: boolean = false,
		public readonly context?: Record<string, unknown>
	) {
		super(message);
	}

	/**
	 * 从 HTTP 响应构造 AppError。
	 * 只读取 HTTP 状态码和通用的 { error: string } 响应体，
	 * 不假设后端的内部错误类型结构。
	 */
	static fromHttpResponse(body: { error: string }, status: number): AppError {
		const category = httpStatusToCategory(status);
		const severity = status >= 500 ? 'error' : 'warning';
		const retryable = status >= 500; // 5xx 可重试，4xx 是客户端问题不重试
		return new AppError(`HTTP_${status}`, body.error, category, severity as ErrorSeverity, retryable);
	}
}
