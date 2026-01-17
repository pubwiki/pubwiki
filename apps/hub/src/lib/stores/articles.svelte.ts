import { setContext, getContext } from 'svelte';
import { createApiClient } from '@pubwiki/api/client';
import type { ArticleDetail, Pagination } from '@pubwiki/api';
import { API_BASE_URL } from '$lib/config';

const ARTICLES_KEY = Symbol('articles');

export class ArticleStore {
	// Cache for articles by sandbox node ID
	private articlesBySandboxCache = new Map<string, { articles: ArticleDetail[]; pagination: Pagination }>();
	// Cache for single article by ID
	private articleCache = new Map<string, ArticleDetail>();

	private getClient() {
		return createApiClient(API_BASE_URL);
	}

	/**
	 * Fetch articles by sandbox node ID
	 */
	async fetchArticlesBySandbox(
		sandboxNodeId: string,
		options?: { page?: number; limit?: number }
	): Promise<{ articles: ArticleDetail[]; pagination: Pagination } | null> {
		try {
			const client = this.getClient();
			const { data, error } = await client.GET('/articles/by-sandbox/{sandboxNodeId}', {
				params: {
					path: { sandboxNodeId },
					query: {
						page: options?.page ?? 1,
						limit: options?.limit ?? 20
					}
				}
			});

			if (data) {
				const result = { articles: data.articles, pagination: data.pagination };
				this.articlesBySandboxCache.set(sandboxNodeId, result);
				// Also cache individual articles
				for (const article of data.articles) {
					this.articleCache.set(article.id, article);
				}
				return result;
			}

			console.error('Failed to fetch articles by sandbox:', error);
			return null;
		} catch (e) {
			console.error('Error fetching articles by sandbox:', e);
			return null;
		}
	}

	/**
	 * Fetch a single article by ID
	 */
	async fetchArticle(articleId: string): Promise<ArticleDetail | null> {
		// Check cache first
		if (this.articleCache.has(articleId)) {
			return this.articleCache.get(articleId)!;
		}

		try {
			const client = this.getClient();
			const { data, error } = await client.GET('/articles/{articleId}', {
				params: { path: { articleId } }
			});

			if (data) {
				this.articleCache.set(articleId, data);
				return data;
			}

			console.error('Failed to fetch article:', error);
			return null;
		} catch (e) {
			console.error('Error fetching article:', e);
			return null;
		}
	}

	/**
	 * Get cached articles by sandbox node ID
	 */
	getCachedArticlesBySandbox(sandboxNodeId: string): { articles: ArticleDetail[]; pagination: Pagination } | null {
		return this.articlesBySandboxCache.get(sandboxNodeId) ?? null;
	}

	/**
	 * Get cached article by ID
	 */
	getCachedArticle(articleId: string): ArticleDetail | null {
		return this.articleCache.get(articleId) ?? null;
	}

	/**
	 * Clear all caches
	 */
	clearCache() {
		this.articlesBySandboxCache.clear();
		this.articleCache.clear();
	}
}

export function createArticleStore() {
	const store = new ArticleStore();
	setContext(ARTICLES_KEY, store);
	return store;
}

export function useArticleStore() {
	return getContext<ArticleStore>(ARTICLES_KEY);
}
