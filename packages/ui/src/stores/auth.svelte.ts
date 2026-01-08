import { setContext, getContext } from 'svelte';
import { getCookie, setCookie, deleteCookie } from '../utils/cookie';
import { createApiClient } from '@pubwiki/api/client';
import type { PublicUser, UpdateProfileRequest } from '@pubwiki/api';

const AUTH_KEY = Symbol('auth');

// Cookie configuration - domain is set via VITE_AUTH_DOMAIN in production
const AUTH_DOMAIN = typeof window !== 'undefined' 
	? (import.meta.env?.VITE_AUTH_DOMAIN || undefined) 
	: undefined;
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

/**
 * Try to get value from cookie first, then localStorage as fallback
 */
function getStoredValue<T>(key: string): T | null {
	// Try cookie first
	const cookieValue = getCookie(key);
	if (cookieValue) {
		try {
			return JSON.parse(cookieValue);
		} catch {
			return cookieValue as T;
		}
	}
	
	// Fallback to localStorage (for development without subdomains)
	if (typeof localStorage !== 'undefined') {
		const localValue = localStorage.getItem(key);
		if (localValue) {
			try {
				return JSON.parse(localValue);
			} catch {
				return localValue as T;
			}
		}
	}
	
	return null;
}

/**
 * Store value in both cookie and localStorage
 */
function setStoredValue(key: string, value: unknown): void {
	const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
	
	// Set cookie with cross-subdomain support
	setCookie(key, stringValue, {
		domain: AUTH_DOMAIN,
		maxAge: TOKEN_MAX_AGE,
		secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
		sameSite: 'Lax'
	});
	
	// Also set in localStorage as fallback
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(key, stringValue);
	}
}

/**
 * Remove value from both cookie and localStorage
 */
function removeStoredValue(key: string): void {
	deleteCookie(key, AUTH_DOMAIN);
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(key);
	}
}

export class AuthStore {
	private _token = $state<string | null>(null);
	private _user = $state<PublicUser | null>(null);
	private _apiBaseUrl: string;

	constructor(apiBaseUrl: string) {
		this._apiBaseUrl = apiBaseUrl;
		
		// Initialize from stored values
		if (typeof document !== 'undefined') {
			this._token = getStoredValue<string>('auth_token');
			this._user = getStoredValue<PublicUser>('auth_user');
		}
	}

	get token() {
		return this._token;
	}

	set token(value: string | null) {
		this._token = value;
		if (value) {
			setStoredValue('auth_token', value);
		} else {
			removeStoredValue('auth_token');
		}
	}

	get user() {
		return this._user;
	}

	set user(value: PublicUser | null) {
		this._user = value;
		if (value) {
			setStoredValue('auth_user', value);
		} else {
			removeStoredValue('auth_user');
		}
	}

	get isAuthenticated() {
		return !!this._token;
	}

	get currentUser() {
		return this._user;
	}

	private getClient() {
		return createApiClient(this._apiBaseUrl, this._token ?? undefined);
	}

	async login(usernameOrEmail: string, password: string) {
		const client = this.getClient();
		const { data, error } = await client.POST('/auth/login', {
			body: { usernameOrEmail, password }
		});

		if (data) {
			this.token = data.token;
			this.user = data.user;
			return { success: true };
		}

		return { success: false, error: error?.error || 'Login failed' };
	}

	async register(username: string, email: string, password: string, displayName?: string) {
		const client = this.getClient();
		const { data, error } = await client.POST('/auth/register', {
			body: { username, email, password, displayName }
		});

		if (data) {
			this.token = data.token;
			this.user = data.user;
			return { success: true };
		}

		return { success: false, error: error?.error || 'Registration failed' };
	}

	logout() {
		this.token = null;
		this.user = null;
	}

	async updateProfile(profile: UpdateProfileRequest) {
		const client = this.getClient();
		const { data, error } = await client.PATCH('/me', {
			body: profile
		});

		if (data) {
			this.user = data.user;
			return { success: true, user: data.user };
		}

		return { success: false, error: error?.error || 'Update failed' };
	}

	async fetchUser() {
		if (!this._token) return;
		const client = this.getClient();
		const { data } = await client.GET('/me');
		if (data) {
			this.user = data.user;
		}
	}
}

export function createAuth(apiBaseUrl: string) {
	const auth = new AuthStore(apiBaseUrl);
	setContext(AUTH_KEY, auth);
	return auth;
}

export function useAuth() {
	return getContext<AuthStore>(AUTH_KEY);
}
