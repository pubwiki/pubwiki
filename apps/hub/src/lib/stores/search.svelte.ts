import { setContext, getContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { ArtifactListItem, Pagination } from '@pubwiki/api';
import { apiClient } from '$lib/api';

const SEARCH_KEY = Symbol('search');

export class SearchStore {
	// Sparse page cache for virtual list (not deeply reactive)
	private pageCache = new SvelteMap<number, ArtifactListItem[]>();
	private loadingPages = new SvelteSet<number>();
	// Trigger for cache updates
	private cacheVersion = $state(0);
	
	totalItems = $state(0);
	pageSize = $state(20);
	loading = $state(false);
	error = $state<string | null>(null);
	initialized = $state(false);
	
	// Current search options
	private currentOptions: {
		query: string;
		tagInclude?: string[];
		sortBy?: 'relevance' | 'createdAt' | 'updatedAt' | 'viewCount' | 'favCount';
		sortOrder?: 'asc' | 'desc';
	} = { query: '' };

	// Active query tracking
	currentQuery = $state('');
	isActive = $state(false);

	get totalPages(): number {
		return Math.ceil(this.totalItems / this.pageSize);
	}
	
	get loadedPageCount(): number {
		return this.pageCache.size;
	}

	/**
	 * Initialize search with a query
	 */
	async search(query: string, options?: {
		tagInclude?: string[];
		sortBy?: 'relevance' | 'createdAt' | 'updatedAt' | 'viewCount' | 'favCount';
		sortOrder?: 'asc' | 'desc';
		pageSize?: number;
	}) {
		const trimmedQuery = query.trim();
		
		// If empty query, clear search
		if (!trimmedQuery) {
			this.clear();
			return;
		}

		// Clear existing cache on new search
		this.pageCache.clear();
		this.loadingPages.clear();
		this.cacheVersion++;
		this.totalItems = 0;
		this.error = null;
		this.initialized = false;
		
		this.currentQuery = trimmedQuery;
		this.isActive = true;
		this.currentOptions = {
			query: trimmedQuery,
			tagInclude: options?.tagInclude,
			sortBy: options?.sortBy ?? 'relevance',
			sortOrder: options?.sortOrder ?? 'desc'
		};
		
		if (options?.pageSize) {
			this.pageSize = options.pageSize;
		}
		
		// Load first page to get total count
		this.loading = true;
		try {
			const result = await this.loadPage(1);
			if (result?.pagination) {
				this.totalItems = result.pagination.total;
			}
		} finally {
			this.loading = false;
			this.initialized = true;
		}
	}

	/**
	 * Load a specific page of search results
	 */
	async loadPage(pageNum: number): Promise<{ artifacts: ArtifactListItem[]; pagination: Pagination } | null> {
		// Not in search mode
		if (!this.isActive || !this.currentOptions.query) {
			return null;
		}

		// Already cached or loading
		if (this.pageCache.has(pageNum) || this.loadingPages.has(pageNum)) {
			return null;
		}
		
		// Out of range check (only after first load when we know total)
		if (this.initialized && pageNum > this.totalPages) {
			return null;
		}
		
		this.loadingPages.add(pageNum);
		
		try {
			const { data, error } = await apiClient.GET('/artifacts/search', {
				params: {
					query: {
						q: this.currentOptions.query,
						page: pageNum,
						limit: this.pageSize,
						'tag.include': this.currentOptions.tagInclude,
						sortBy: this.currentOptions.sortBy,
						sortOrder: this.currentOptions.sortOrder
					}
				}
			});

			if (data) {
				// Update page cache
				this.pageCache.set(pageNum, data.artifacts);
				this.cacheVersion++;
				
				return { artifacts: data.artifacts, pagination: data.pagination };
			}
			
			if (error) {
				this.error = error.error || 'Search failed';
			}
			return null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Unknown error';
			return null;
		} finally {
			this.loadingPages.delete(pageNum);
		}
	}

	/**
	 * Ensure a range of pages are loaded (with buffer)
	 */
	async ensurePagesLoaded(startPage: number, endPage: number): Promise<void> {
		const pagesToLoad: number[] = [];
		
		// Include 1 buffer page on each side
		const loadStart = Math.max(1, startPage - 1);
		const loadEnd = this.totalPages > 0 
			? Math.min(this.totalPages, endPage + 1)
			: endPage + 1;
		
		for (let p = loadStart; p <= loadEnd; p++) {
			if (!this.pageCache.has(p) && !this.loadingPages.has(p)) {
				pagesToLoad.push(p);
			}
		}
		
		if (pagesToLoad.length > 0) {
			await Promise.all(pagesToLoad.map(p => this.loadPage(p)));
		}
	}

	/**
	 * Get items for a specific index range (for virtual list rendering)
	 * Reading cacheVersion ensures reactivity when cache updates
	 */
	getItemsForRange(startIdx: number, endIdx: number): (ArtifactListItem | null)[] {
		// Touch cacheVersion for reactivity
		void this.cacheVersion;
		
		const items: (ArtifactListItem | null)[] = [];
		const actualEnd = Math.min(endIdx, this.totalItems);
		
		for (let i = startIdx; i < actualEnd; i++) {
			const page = Math.floor(i / this.pageSize) + 1;
			const indexInPage = i % this.pageSize;
			
			const pageData = this.pageCache.get(page);
			if (pageData && indexInPage < pageData.length) {
				items.push(pageData[indexInPage]);
			} else {
				items.push(null); // Placeholder for loading state
			}
		}
		
		return items;
	}

	/**
	 * Check if a page is currently loading
	 */
	isPageLoading(pageNum: number): boolean {
		return this.loadingPages.has(pageNum);
	}

	/**
	 * Unload pages that are far from the current view to save memory
	 */
	unloadDistantPages(currentPage: number, threshold = 5): void {
		let removed = false;
		const pagesToRemove: number[] = [];
		
		for (const page of this.pageCache.keys()) {
			if (Math.abs(page - currentPage) > threshold) {
				pagesToRemove.push(page);
				removed = true;
			}
		}
		
		for (const page of pagesToRemove) {
			this.pageCache.delete(page);
		}
		
		if (removed) {
			this.cacheVersion++;
		}
	}

	/**
	 * Clear search state and return to normal mode
	 */
	clear() {
		this.pageCache.clear();
		this.loadingPages.clear();
		this.cacheVersion++;
		this.totalItems = 0;
		this.loading = false;
		this.error = null;
		this.currentQuery = '';
		this.isActive = false;
		this.initialized = false;
		this.currentOptions = { query: '' };
	}
}

export function createSearchStore() {
	const store = new SearchStore();
	setContext(SEARCH_KEY, store);
	return store;
}

export function useSearchStore() {
	return getContext<SearchStore>(SEARCH_KEY);
}
