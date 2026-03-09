import { setContext, getContext } from 'svelte';
import type {
	ArtifactListItem,
	ArtifactLineageItem,
	ArtifactNodeSummary,
	ArtifactEdge,
	NodeFileInfo,
	Pagination
} from '@pubwiki/api';
import { apiClient } from '$lib/api';

const ARTIFACTS_KEY = Symbol('artifacts');

export interface ArtifactNodeDetail {
	id: string;
	type: string;
	name?: string | null;
	version: { 
		id: string; 
		commitHash: string; 
		contentHash?: string;
		message?: string | null;
		createdAt: string;
	};
	files?: NodeFileInfo[];
}

export interface ArtifactGraphData {
	nodes: ArtifactNodeSummary[];
	edges: ArtifactEdge[];
	version: {
		id: string;
		commitHash: string;
		commitTags?: string[];
		version: string;
		createdAt: string;
	};
}

export interface ArtifactDetails {
	artifact: ArtifactListItem;
	homepage?: string;
	graph?: ArtifactGraphData;
	parents?: ArtifactLineageItem[];
	children?: ArtifactLineageItem[];
}

export class ArtifactStore {
	// Sparse page cache for virtual list (not deeply reactive)
	private pageCache = new Map<number, ArtifactListItem[]>();
	private loadingPages = new Set<number>();
	// Trigger for cache updates
	private cacheVersion = $state(0);
	
	totalItems = $state(0);
	pageSize = $state(20);
	loading = $state(false);
	error = $state<string | null>(null);
	initialized = $state(false);
	
	// Current query options (for consistent loading)
	private currentOptions: {
		typeInclude?: string[];
		tagInclude?: string[];
		sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'favCount';
		sortOrder?: 'asc' | 'desc';
	} = {};
	
	// Cache for artifact details
	private detailsCache = new Map<string, ArtifactDetails>();
	// Cache for node details (key: `${artifactId}:${nodeId}`)
	private nodeDetailCache = new Map<string, ArtifactNodeDetail>();

	get totalPages(): number {
		return Math.ceil(this.totalItems / this.pageSize);
	}
	
	get loadedPageCount(): number {
		return this.pageCache.size;
	}

	/**
	 * Initialize the store with query options and load first page
	 */
	async initialize(options?: {
		typeInclude?: string[];
		tagInclude?: string[];
		sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'favCount';
		sortOrder?: 'asc' | 'desc';
		pageSize?: number;
	}) {
		// Clear existing cache on re-initialize
		this.pageCache.clear();
		this.loadingPages.clear();
		this.cacheVersion++;
		this.totalItems = 0;
		this.error = null;
		this.initialized = false;
		
		this.currentOptions = {
			typeInclude: options?.typeInclude,
			tagInclude: options?.tagInclude,
			sortBy: options?.sortBy ?? 'createdAt',
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
	 * Load a specific page of artifacts
	 */
	async loadPage(pageNum: number): Promise<{ artifacts: ArtifactListItem[]; pagination: Pagination } | null> {
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
			const { data, error } = await apiClient.GET('/artifacts', {
				params: {
					query: {
						page: pageNum,
						limit: this.pageSize,
						'type.include': this.currentOptions.typeInclude as any,
						'tag.include': this.currentOptions.tagInclude,
						sortBy: this.currentOptions.sortBy ?? 'createdAt',
						sortOrder: this.currentOptions.sortOrder ?? 'desc'
					}
				}
			});

			if (data) {
				// Update page cache
				this.pageCache.set(pageNum, data.artifacts);
				this.cacheVersion++;
				
				// Update details cache
				for (const artifact of data.artifacts) {
					if (!this.detailsCache.has(artifact.id)) {
						this.detailsCache.set(artifact.id, { artifact });
					} else {
						const existing = this.detailsCache.get(artifact.id)!;
						existing.artifact = artifact;
					}
				}
				
				return { artifacts: data.artifacts, pagination: data.pagination };
			}
			
			if (error) {
				this.error = error.error || 'Failed to fetch artifacts';
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
	 * Find an artifact by ID from the page cache
	 */
	getArtifactById(id: string): ArtifactListItem | undefined {
		for (const items of this.pageCache.values()) {
			const found = items.find(a => a.id === id);
			if (found) return found;
		}
		return undefined;
	}

	async fetchHomepage(artifactId: string): Promise<string | null> {
		try {
			const { data, error } = await apiClient.GET('/artifacts/{artifactId}/homepage', {
				params: { path: { artifactId } },
				parseAs: 'text'
			});
			if (!error && data) {
				return data;
			}
			return null;
		} catch {
			return null;
		}
	}

	async fetchGraph(artifactId: string, version: string = 'latest'): Promise<ArtifactGraphData | null> {
		try {
			const { data } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: { path: { artifactId }, query: { version } }
			});
			if (data) {
				return {
					nodes: data.nodes,
					edges: data.edges,
					version: {
						...data.version,
						commitTags: data.version.commitTags
					}
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Fetch graph for a specific version (by commit hash or commit tag)
	 */
	async fetchGraphByVersion(artifactId: string, version: string): Promise<ArtifactGraphData | null> {
		return this.fetchGraph(artifactId, version);
	}

	async fetchArtifactDetails(artifactId: string): Promise<ArtifactDetails | null> {
		const cached = this.detailsCache.get(artifactId);
		
		// If we have full details cached, return them
		if (cached?.graph && cached?.parents !== undefined && cached?.homepage !== undefined) {
			return cached;
		}

		let artifact = this.getArtifactById(artifactId) ?? cached?.artifact;

		// If artifact info is not cached (e.g. direct URL navigation),
		// use the graph endpoint as an existence check instead of loading
		// the entire artifact list (which causes reactive state loops).
		if (!artifact) {
			const graphResult = await this.fetchGraph(artifactId);
			if (!graphResult) {
				// Graph returned 404 — artifact does not exist
				return null;
			}

			// Artifact exists; try to get basic list info from page cache
			if (!this.pageCache.has(1)) {
				await this.loadPage(1);
			}
			artifact = this.getArtifactById(artifactId);

			if (!artifact) {
				// Artifact exists but not in page 1 of the list.
				// Without a dedicated single-artifact endpoint we cannot
				// obtain the full ArtifactListItem metadata.
				return null;
			}

			// Fetch remaining sub-resources (graph already fetched)
			const [homepageResult, lineageResult] = await Promise.all([
				this.fetchHomepage(artifactId),
				apiClient.GET('/artifacts/{artifactId}/lineage', {
					params: { path: { artifactId } }
				})
			]);

			const details: ArtifactDetails = {
				artifact,
				homepage: homepageResult ?? undefined,
				graph: graphResult,
				parents: lineageResult.data?.parents,
				children: lineageResult.data?.children
			};
			this.detailsCache.set(artifactId, details);
			return details;
		}

		// Normal path: basic artifact info already in cache
		const [homepageResult, graphResult, lineageResult] = await Promise.all([
			this.fetchHomepage(artifactId),
			this.fetchGraph(artifactId),
			apiClient.GET('/artifacts/{artifactId}/lineage', {
				params: { path: { artifactId } }
			})
		]);

		const details: ArtifactDetails = {
			artifact,
			homepage: homepageResult ?? undefined,
			graph: graphResult ?? undefined,
			parents: lineageResult.data?.parents,
			children: lineageResult.data?.children
		};

		this.detailsCache.set(artifactId, details);
		return details;
	}

	/**
	 * Get node detail from cached graph data.
	 * 
	 * NOTE: The old `/artifacts/{artifactId}/nodes/{nodeId}` endpoint has been removed.
	 * Node detail is now retrieved from the graph response which already contains
	 * ArtifactNodeSummary with content field.
	 */
	async fetchNodeDetail(artifactId: string, nodeId: string): Promise<ArtifactNodeDetail | null> {
		const cacheKey = `${artifactId}:${nodeId}`;
		
		// Check cache first
		if (this.nodeDetailCache.has(cacheKey)) {
			return this.nodeDetailCache.get(cacheKey)!;
		}
		
		// Try to get from details cache (which includes graph)
		let details = this.detailsCache.get(artifactId);
		if (!details) {
			// Fetch artifact details if not cached
			const fetched = await this.fetchArtifactDetails(artifactId);
			if (!fetched) {
				return null;
			}
			details = fetched;
		}
		
		if (!details?.graph) {
			return null;
		}
		
		// Find the node in the graph
		const node = details.graph.nodes.find(n => n.id === nodeId);
		if (!node) {
			return null;
		}
		
		// Extract files from VFS content if applicable
		let files: NodeFileInfo[] | undefined;
		if (node.type === 'VFS' && node.content) {
			const vfsContent = node.content as { type: 'VFS'; files?: { path: string; size?: number; mimeType?: string }[] };
			if (vfsContent.files && Array.isArray(vfsContent.files)) {
				files = vfsContent.files.map(f => ({
					filepath: f.path,
					filename: f.path.split('/').pop() || f.path,
					mimeType: f.mimeType ?? null,
					sizeBytes: f.size ?? null,
				}));
			}
		}
		
		const detail: ArtifactNodeDetail = {
			id: node.id,
			type: node.type,
			name: node.name,
			version: {
				id: details.graph.version.id,
				commitHash: node.commit,
				contentHash: node.contentHash,
				createdAt: details.graph.version.createdAt
			},
			files
		};
		
		// Cache the result
		this.nodeDetailCache.set(cacheKey, detail);
		return detail;
	}

	clearCache() {
		this.detailsCache.clear();
		this.nodeDetailCache.clear();
	}
}

export function createArtifactStore() {
	const store = new ArtifactStore();
	setContext(ARTIFACTS_KEY, store);
	return store;
}

export function useArtifactStore() {
	return getContext<ArtifactStore>(ARTIFACTS_KEY);
}
