import { AppError, type ErrorSeverity } from './types';

export interface ErrorRoute {
	/** 匹配条件 */
	match: (error: AppError) => boolean;
	/** 处理方式 */
	handle: 'silent' | 'log' | 'toast' | 'modal';
	/** 可选：覆盖显示消息 */
	message?: string | ((error: AppError) => string);
}

export interface ErrorHandler {
	log: (error: AppError) => void;
	showToast: (message: string, type: 'info' | 'warning' | 'error') => void;
	showModal: (error: AppError) => void;
}

function severityToToastType(severity: ErrorSeverity): 'info' | 'warning' | 'error' {
	switch (severity) {
		case 'silent':
		case 'info':
			return 'info';
		case 'warning':
			return 'warning';
		case 'error':
		case 'fatal':
			return 'error';
	}
}

function toAppError(error: AppError | unknown): AppError {
	if (error instanceof AppError) return error;
	if (error instanceof Error) {
		return new AppError('UNKNOWN', error.message, 'client', 'error', false);
	}
	return new AppError('UNKNOWN', String(error), 'client', 'error', false);
}

export interface ErrorRouter {
	dispatch(error: AppError | unknown): void;
}

export function createErrorRouter(routes: ErrorRoute[], handler: ErrorHandler): ErrorRouter {
	return {
		dispatch(error: AppError | unknown): void {
			const appError = toAppError(error);

			// 找第一个匹配的路由
			const route = routes.find((r) => r.match(appError));
			if (!route) {
				// 默认行为：log + toast
				handler.log(appError);
				handler.showToast(appError.message, 'error');
				return;
			}

			switch (route.handle) {
				case 'silent':
					break;
				case 'log':
					handler.log(appError);
					break;
				case 'toast': {
					const msg =
						typeof route.message === 'function'
							? route.message(appError)
							: (route.message ?? appError.message);
					handler.showToast(msg, severityToToastType(appError.severity));
					handler.log(appError);
					break;
				}
				case 'modal':
					handler.showModal(appError);
					handler.log(appError);
					break;
			}
		}
	};
}
