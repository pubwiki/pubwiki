import { setContext, getContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ArticleDetail, Pagination } from '@pubwiki/api';
import { apiClient } from '$lib/api';

const ARTICLES_KEY = Symbol('articles');

export class ArticleStore {
	// Cache for articles by artifact ID
	private articlesByArtifactCache = new SvelteMap<string, { articles: ArticleDetail[]; pagination: Pagination }>();
	// Cache for single article by ID
	private articleCache = new SvelteMap<string, ArticleDetail>();

	/**
	 * Fetch articles by artifact ID
	 */
	async fetchArticlesByArtifact(
		artifactId: string,
		options?: { page?: number; limit?: number }
	): Promise<{ articles: ArticleDetail[]; pagination: Pagination } | null> {
		try {
			const { data, error } = await apiClient.GET('/articles/by-artifact/{artifactId}', {
				params: {
					path: { artifactId },
					query: {
						page: options?.page ?? 1,
						limit: options?.limit ?? 20
					}
				}
			});

			if (data) {
				const result = { articles: data.articles, pagination: data.pagination };
				this.articlesByArtifactCache.set(artifactId, result);
				// Also cache individual articles
				for (const article of data.articles) {
					this.articleCache.set(article.id, article);
				}
				return result;
			}

			console.error('Failed to fetch articles by artifact:', error);
			return null;
		} catch (e) {
			console.error('Error fetching articles by artifact:', e);
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
			const { data, error } = await apiClient.GET('/articles/{articleId}', {
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
	 * Get cached articles by artifact ID
	 */
	getCachedArticlesByArtifact(artifactId: string): { articles: ArticleDetail[]; pagination: Pagination } | null {
		return this.articlesByArtifactCache.get(artifactId) ?? null;
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
		this.articlesByArtifactCache.clear();
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
