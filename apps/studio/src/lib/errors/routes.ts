import type { ErrorRoute } from './router';

/**
 * Studio 应用的错误路由规则
 *
 * 规则按顺序匹配，第一个匹配的规则生效
 */
export const studioErrorRoutes: ErrorRoute[] = [
	// Canceled operations (e.g. Monaco file switch canceling pending diagnostics): silent
	{
		match: (e) => e.message === 'Canceled',
		handle: 'silent'
	},
	// 网络断开：静默，SyncStatusIndicator 已经在显示状态
	{
		match: (e) => e.category === 'network' && e.retryable,
		handle: 'log'
	},
	// 认证失败：toast + 提示重新登录
	{
		match: (e) => e.category === 'auth',
		handle: 'toast',
		message: '登录已过期，请重新登录'
	},
	// 并发冲突：已有冲突解决 UI，不需要额外 toast
	{
		match: (e) => e.category === 'conflict',
		handle: 'silent'
	},
	// VFS 操作失败（非致命）：log
	{
		match: (e) => e.category === 'storage' && e.severity !== 'fatal',
		handle: 'log'
	},
	// LLM 生成错误：toast
	{
		match: (e) => e.category === 'generation',
		handle: 'toast',
		message: (e) => `生成失败: ${e.message}`
	},
	// 资源不存在：log（通常前端会自行处理空状态）
	{
		match: (e) => e.category === 'not_found',
		handle: 'log'
	},
	// 验证错误：toast + 具体消息
	{
		match: (e) => e.category === 'validation',
		handle: 'toast'
	},
	// 其他所有错误：toast
	{
		match: () => true,
		handle: 'toast'
	}
];
