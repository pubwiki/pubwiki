import * as Sentry from '@sentry/sveltekit';

/**
 * Check if user has opted in to error reporting via localStorage.
 * Reads directly from localStorage to avoid requiring Svelte context.
 */
function isErrorReportingEnabled(): boolean {
	try {
		const raw = localStorage.getItem('user_settings');
		if (!raw) return false;
		const settings = JSON.parse(raw);
		return settings?.privacy?.errorReporting === true;
	} catch {
		return false;
	}
}

/**
 * Report an error to Sentry if the user has enabled error reporting.
 * Can be called from any context (not just Svelte components).
 */
export function reportError(
	error: unknown,
	context?: { operation?: string; artifactId?: string; [key: string]: unknown }
): void {
	if (!isErrorReportingEnabled()) return;

	Sentry.withScope((scope) => {
		if (context?.operation) scope.setTag('operation', context.operation);
		if (context?.artifactId) scope.setContext('artifact', { id: context.artifactId });

		if (error instanceof Error) {
			Sentry.captureException(error);
		} else {
			Sentry.captureMessage(String(error), 'error');
		}
	});
}
