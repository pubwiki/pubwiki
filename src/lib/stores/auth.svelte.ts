import { setContext, getContext } from 'svelte';
import persist from '$lib/persist.svelte';
import { createApiClient } from '@pubwiki/api/client';
import type { PublicUser, UpdateProfileRequest } from '@pubwiki/api';
import { API_BASE_URL } from '$lib/config';

const AUTH_KEY = Symbol('auth');

export class AuthStore {
	token = persist<string | null>('auth_token', null);
	user = persist<PublicUser | null>('auth_user', null);

	get isAuthenticated() {
		return !!this.token.value;
	}

	get currentUser() {
		return this.user.value;
	}

	private getClient() {
		return createApiClient(API_BASE_URL, this.token.value ?? undefined);
	}

	async login(usernameOrEmail: string, password: string) {
		const client = this.getClient();
		const { data, error } = await client.POST('/auth/login', {
			body: { usernameOrEmail, password }
		});

		if (data) {
			this.token.value = data.token;
			this.user.value = data.user;
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
			this.token.value = data.token;
			this.user.value = data.user;
			return { success: true };
		}

		return { success: false, error: error?.error || 'Registration failed' };
	}

	logout() {
		this.token.value = null;
		this.user.value = null;
	}

	async updateProfile(profile: UpdateProfileRequest) {
		const client = this.getClient();
		const { data, error } = await client.PATCH('/me', {
			body: profile
		});

		if (data) {
			this.user.value = data.user;
			return { success: true, user: data.user };
		}

		return { success: false, error: error?.error || 'Update failed' };
	}

	async fetchUser() {
		if (!this.token.value) return;
		const client = this.getClient();
		const { data } = await client.GET('/me');
		if (data) {
			this.user.value = data.user;
		}
	}
}

export function createAuth() {
	const auth = new AuthStore();
	setContext(AUTH_KEY, auth);
	return auth;
}

export function useAuth() {
	return getContext<AuthStore>(AUTH_KEY);
}
