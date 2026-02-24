import { createErrorRouter } from './router';
import { createConsoleLogger } from '$lib/logger';
import { toastStore } from '@pubwiki/ui/stores';
import { type AppError } from './types';
import { studioErrorRoutes } from './routes';

const logger = createConsoleLogger('studio');

/**
 * Studio 应用的全局错误路由器
 *
 * 使用方式:
 * ```typescript
 * import { errorRouter, AppError } from '$lib/errors';
 *
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   errorRouter.dispatch(error);
 * }
 *
 * // 或者使用 AppError 提供更多上下文:
 * errorRouter.dispatch(
 *   new AppError('SYNC_FAILED', 'Failed to sync', 'network', 'warning', true, {
 *     operation: 'save',
 *     artifactId: '...'
 *   })
 * );
 * ```
 */
export const errorRouter = createErrorRouter(studioErrorRoutes, {
	log: (error: AppError) => logger.error(error.message, error, error.context),
	showToast: (message: string, type: 'info' | 'warning' | 'error') => toastStore.add({ message, type }),
	showModal: (error: AppError) => {
		// TODO: 实现错误详情模态框
		// 目前降级为 toast
		logger.error('Modal error (showing as toast):', error);
		toastStore.add({ message: error.message, type: 'error', duration: 8000 });
	}
});

/**
 * 初始化全局错误处理
 *
 * 在应用启动时调用，捕获未处理的 Promise rejection
 */
export function initGlobalErrorHandler(): void {
	if (typeof window !== 'undefined') {
		window.addEventListener('unhandledrejection', (event) => {
			logger.warn('Unhandled promise rejection caught by global handler');
			errorRouter.dispatch(event.reason);
		});

		window.addEventListener('error', (event) => {
			logger.warn('Uncaught error caught by global handler');
			errorRouter.dispatch(event.error);
		});
	}
}

// Re-export types
export { AppError, type ErrorSeverity, type ErrorCategory } from './types';
export { type ErrorRoute, type ErrorRouter, type ErrorHandler } from './router';
