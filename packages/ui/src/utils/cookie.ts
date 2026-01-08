/**
 * Cookie utility functions for cross-subdomain authentication
 */

export interface CookieOptions {
	domain?: string;
	maxAge?: number;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
	path?: string;
}

/**
 * Set a cookie with the given options
 */
export function setCookie(name: string, value: string, options: CookieOptions = {}) {
	const parts = [
		`${name}=${encodeURIComponent(value)}`,
		`path=${options.path ?? '/'}`
	];

	if (options.domain) parts.push(`domain=${options.domain}`);
	if (options.maxAge !== undefined) parts.push(`max-age=${options.maxAge}`);
	if (options.secure) parts.push('secure');
	if (options.sameSite) parts.push(`samesite=${options.sameSite}`);

	document.cookie = parts.join('; ');
}

/**
 * Get a cookie value by name
 */
export function getCookie(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
	return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Delete a cookie by name
 */
export function deleteCookie(name: string, domain?: string) {
	const parts = [`${name}=`, 'path=/', 'max-age=0'];
	if (domain) parts.push(`domain=${domain}`);
	document.cookie = parts.join('; ');
}
