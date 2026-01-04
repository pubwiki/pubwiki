import { setContext, getContext } from 'svelte';
import { createApiClient } from '@pubwiki/api/client';
import type {
	ArtifactListItem,
	ArtifactLineageItem,
	ArtifactNodeSummary,
	ArtifactEdge,
	NodeFileInfo
} from '@pubwiki/api';
import { API_BASE_URL } from '$lib/config';

const ARTIFACTS_KEY = Symbol('artifacts');

export interface ArtifactNodeDetail {
	id: string;
	type: string;
	name?: string | null;
	external: boolean;
	externalArtifact?: {
		id?: string;
		name?: string;
		slug?: string;
		author?: { id: string; username: string };
	};
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
	artifacts = $state<ArtifactListItem[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	
	// Cache for artifact details
	private detailsCache = new Map<string, ArtifactDetails>();
	// Cache for node content (key: `${artifactId}:${nodeId}`)
	private nodeContentCache = new Map<string, string>();
	// Cache for node details (key: `${artifactId}:${nodeId}`)
	private nodeDetailCache = new Map<string, ArtifactNodeDetail>();

	private getClient(token?: string) {
		return createApiClient(API_BASE_URL, token);
	}

	async fetchArtifacts(options?: {
		page?: number;
		limit?: number;
		typeInclude?: string[];
		tagInclude?: string[];
		sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'starCount';
		sortOrder?: 'asc' | 'desc';
	}) {
		this.loading = true;
		this.error = null;
		
		try {
			const client = this.getClient();
			const { data, error } = await client.GET('/artifacts', {
				params: {
					query: {
						page: options?.page ?? 1,
						limit: options?.limit ?? 20,
						'type.include': options?.typeInclude as any,
						'tag.include': options?.tagInclude,
						sortBy: options?.sortBy ?? 'createdAt',
						sortOrder: options?.sortOrder ?? 'desc'
					}
				}
			});

			if (data) {
				this.artifacts = data.artifacts;
				// Update cache with basic info
				for (const artifact of data.artifacts) {
					if (!this.detailsCache.has(artifact.id)) {
						this.detailsCache.set(artifact.id, { artifact });
					} else {
						const existing = this.detailsCache.get(artifact.id)!;
						existing.artifact = artifact;
					}
				}
				return { success: true, pagination: data.pagination };
			}

			this.error = error?.error || 'Failed to fetch artifacts';
			return { success: false, error: this.error };
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Unknown error';
			return { success: false, error: this.error };
		} finally {
			this.loading = false;
		}
	}

	getArtifactById(id: string): ArtifactListItem | undefined {
		return this.artifacts.find(a => a.id === id);
	}

	async fetchHomepage(artifactId: string): Promise<string | null> {
		try {
			const response = await fetch(`${API_BASE_URL}/artifacts/${artifactId}/homepage`);
			if (response.ok) {
				return await response.text();
			}
			return null;
		} catch {
			return null;
		}
	}

	async fetchGraph(artifactId: string, token?: string): Promise<ArtifactGraphData | null> {
		try {
			const client = this.getClient(token);
			const { data } = await client.GET('/artifacts/{artifactId}/graph', {
				params: { path: { artifactId }, query: { version: 'latest' } }
			});
			if (data) {
				return {
					nodes: data.nodes,
					edges: data.edges,
					version: data.version
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	async fetchArtifactDetails(artifactId: string, token?: string): Promise<ArtifactDetails | null> {
		const cached = this.detailsCache.get(artifactId);
		
		// If we have full details cached, return them
		if (cached?.graph && cached?.parents !== undefined && cached?.homepage !== undefined) {
			return cached;
		}

		// Get basic artifact info first
		let artifact = this.getArtifactById(artifactId);
		
		// If not in list, we need to fetch the list or handle this case
		if (!artifact && !cached?.artifact) {
			// Try to fetch the artifacts list first
			await this.fetchArtifacts({ limit: 100 });
			artifact = this.getArtifactById(artifactId);
			if (!artifact) {
				return null;
			}
		}

		const client = this.getClient(token);
		
		// Fetch homepage, graph and lineage in parallel
		const [homepageResult, graphResult, lineageResult] = await Promise.all([
			this.fetchHomepage(artifactId),
			this.fetchGraph(artifactId, token),
			client.GET('/artifacts/{artifactId}/lineage', {
				params: { path: { artifactId } }
			})
		]);

		const details: ArtifactDetails = {
			artifact: artifact || cached!.artifact,
			homepage: homepageResult ?? undefined,
			graph: graphResult ?? undefined,
			parents: lineageResult.data?.parents,
			children: lineageResult.data?.children
		};

		this.detailsCache.set(artifactId, details);
		return details;
	}

	async fetchNodeContent(artifactId: string, nodeId: string, token?: string): Promise<string | null> {
		const cacheKey = `${artifactId}:${nodeId}`;
		
		// Check cache first
		if (this.nodeContentCache.has(cacheKey)) {
			return this.nodeContentCache.get(cacheKey)!;
		}
		
		try {
			const headers: HeadersInit = {};
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}
			const response = await fetch(`${API_BASE_URL}/artifacts/${artifactId}/nodes/${nodeId}/content`, { headers });
			if (response.ok) {
				const content = await response.text();
				// Cache the result
				this.nodeContentCache.set(cacheKey, content);
				return content;
			}
			return null;
		} catch {
			return null;
		}
	}

	async fetchNodeDetail(artifactId: string, nodeId: string, token?: string): Promise<ArtifactNodeDetail | null> {
		const cacheKey = `${artifactId}:${nodeId}`;
		
		// Check cache first
		if (this.nodeDetailCache.has(cacheKey)) {
			return this.nodeDetailCache.get(cacheKey)!;
		}
		
		try {
			const client = this.getClient(token);
			const { data } = await client.GET('/artifacts/{artifactId}/nodes/{nodeId}', {
				params: { 
					path: { artifactId, nodeId },
					query: { version: 'latest' }
				}
			});
			
			if (data) {
				const detail: ArtifactNodeDetail = {
					id: data.id,
					type: data.type,
					name: data.name,
					external: data.external,
					externalArtifact: data.externalArtifact,
					version: data.version,
					files: data.files
				};
				// Cache the result
				this.nodeDetailCache.set(cacheKey, detail);
				return detail;
			}
			return null;
		} catch {
			return null;
		}
	}

	clearCache() {
		this.detailsCache.clear();
		this.nodeContentCache.clear();
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
