import { setContext, getContext } from 'svelte';
import { createAuthClient, createApiClient } from '@pubwiki/api/client';
import type { PublicUser, UpdateProfileRequest } from '@pubwiki/api';

const AUTH_KEY = Symbol('auth');

export class AuthStore {
	private _user = $state<PublicUser | null>(null);
	private _isAuthenticated = $state(false);
	private _authClient: ReturnType<typeof createAuthClient>;
	private _apiBaseUrl: string;

	constructor(apiBaseUrl: string) {
		// apiBaseUrl 是 '/api' 路径，需要提取 baseURL
		// 例如: 'http://localhost:8787/api' -> 'http://localhost:8787'
		this._apiBaseUrl = apiBaseUrl;
		const baseURL = apiBaseUrl.replace(/\/api$/, '');
		this._authClient = createAuthClient(baseURL);
		
		// 初始化时获取会话状态
		if (typeof document !== 'undefined') {
			this.fetchSession();
		}
	}

	get user() {
		return this._user;
	}

	get isAuthenticated() {
		return this._isAuthenticated;
	}

	get currentUser() {
		return this._user;
	}

	private getApiClient() {
		return createApiClient(this._apiBaseUrl);
	}

	/**
	 * 获取当前会话状态
	 */
	async fetchSession() {
		const { data } = await this._authClient.getSession();
		if (data?.session) {
			this._isAuthenticated = true;
			// 从 API 获取完整用户信息
			await this.fetchUser();
		} else {
			this._isAuthenticated = false;
			this._user = null;
		}
	}

	/**
	 * 使用邮箱登录
	 */
	async login(usernameOrEmail: string, password: string) {
		// 判断是邮箱还是用户名
		const isEmail = usernameOrEmail.includes('@');
		
		try {
			let result;
			if (isEmail) {
				result = await this._authClient.signIn.email({
					email: usernameOrEmail,
					password,
				});
			} else {
				result = await this._authClient.signIn.username({
					username: usernameOrEmail,
					password,
				});
			}

			if (result.error) {
				return { success: false, error: result.error.message || 'Login failed' };
			}

			this._isAuthenticated = true;
			await this.fetchUser();
			return { success: true };
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : 'Login failed';
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * 用户注册
	 */
	async register(username: string, email: string, password: string, displayName?: string) {
		try {
			const result = await this._authClient.signUp.email({
				email,
				password,
				name: displayName || username,
				username,
			});

			if (result.error) {
				return { success: false, error: result.error.message || 'Registration failed' };
			}

			this._isAuthenticated = true;
			await this.fetchUser();
			return { success: true };
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : 'Registration failed';
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * 登出
	 */
	async logout() {
		try {
			await this._authClient.signOut();
		} catch {
			// 忽略登出错误
		}
		this._isAuthenticated = false;
		this._user = null;
	}

	/**
	 * 更新用户资料
	 */
	async updateProfile(profile: UpdateProfileRequest) {
		const client = this.getApiClient();
		const { data, error } = await client.PATCH('/me', {
			body: profile
		});

		if (data) {
			this._user = data.user;
			return { success: true, user: data.user };
		}

		return { success: false, error: error?.error || 'Update failed' };
	}

	/**
	 * 获取当前用户信息
	 */
	async fetchUser() {
		if (!this._isAuthenticated) return;
		const client = this.getApiClient();
		const { data } = await client.GET('/me');
		if (data) {
			this._user = data.user;
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
