import { setContext, getContext } from 'svelte';
import type { ProjectListItem, Pagination } from '@pubwiki/api';
import { apiClient } from '$lib/api';

const PROJECTS_KEY = Symbol('projects');

export class ProjectStore {
	projects = $state<ProjectListItem[]>([]);
	pagination = $state<Pagination | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	initialized = $state(false);

	async fetchProjects(options?: {
		page?: number;
		limit?: number;
		topic?: string;
		sortBy?: 'createdAt' | 'updatedAt';
		sortOrder?: 'asc' | 'desc';
	}) {
		this.loading = true;
		this.error = null;

		try {
			const { data, error } = await apiClient.GET('/projects', {
				params: {
					query: {
						page: options?.page ?? 1,
						limit: options?.limit ?? 20,
						topic: options?.topic,
						sortBy: options?.sortBy ?? 'createdAt',
						sortOrder: options?.sortOrder ?? 'desc'
					}
				}
			});

			if (data) {
				this.projects = data.projects;
				this.pagination = data.pagination;
				return { success: true, pagination: data.pagination };
			}

			this.error = error?.error || 'Failed to fetch projects';
			return { success: false, error: this.error };
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Unknown error';
			return { success: false, error: this.error };
		} finally {
			this.loading = false;
			this.initialized = true;
		}
	}

	getProjectById(id: string): ProjectListItem | undefined {
		return this.projects.find(p => p.id === id);
	}
}

export function createProjectStore() {
	const store = new ProjectStore();
	setContext(PROJECTS_KEY, store);
	return store;
}

export function useProjectStore(): ProjectStore {
	const store = getContext<ProjectStore | undefined>(PROJECTS_KEY);
	if (!store) {
		throw new Error('ProjectStore not found in context. Make sure to call createProjectStore() in a parent component.');
	}
	return store;
}
