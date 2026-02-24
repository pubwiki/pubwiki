export interface Logger {
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}

/** 开发环境 logger（输出到 console） */
export function createConsoleLogger(module: string): Logger {
	return {
		debug: (msg, ctx) => console.debug(`[${module}]`, msg, ctx ?? ''),
		info: (msg, ctx) => console.info(`[${module}]`, msg, ctx ?? ''),
		warn: (msg, ctx) => console.warn(`[${module}]`, msg, ctx ?? ''),
		error: (msg, err, ctx) => console.error(`[${module}]`, msg, err ?? '', ctx ?? '')
	};
}

/** 生产环境 logger（仅 error/warn，可接入远程日志服务） */
export function createProductionLogger(module: string): Logger {
	return {
		debug: () => {},
		info: () => {},
		warn: (msg, ctx) => console.warn(`[${module}]`, msg, ctx ?? ''),
		error: (msg, err, ctx) => {
			console.error(`[${module}]`, msg, err ?? '', ctx ?? '');
			// TODO: 接入 Sentry / 自建日志服务
			// logService.captureException(err, { module, message: msg, ...ctx });
		}
	};
}
