import { setContext, getContext } from 'svelte';
import type {
	ArtifactListItem,
	ArtifactLineageItem,
	ArtifactNodeSummary,
	ArtifactEdge,
	NodeFileInfo
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
	artifacts = $state<ArtifactListItem[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	
	// Cache for artifact details
	private detailsCache = new Map<string, ArtifactDetails>();
	// Cache for node details (key: `${artifactId}:${nodeId}`)
	private nodeDetailCache = new Map<string, ArtifactNodeDetail>();

	async fetchArtifacts(options?: {
		page?: number;
		limit?: number;
		typeInclude?: string[];
		tagInclude?: string[];
		sortBy?: 'createdAt' | 'updatedAt' | 'viewCount' | 'favCount';
		sortOrder?: 'asc' | 'desc';
	}) {
		this.loading = true;
		this.error = null;
		
		try {
			const { data, error } = await apiClient.GET('/artifacts', {
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
		
		// Fetch homepage, graph and lineage in parallel
		const [homepageResult, graphResult, lineageResult] = await Promise.all([
			this.fetchHomepage(artifactId),
			this.fetchGraph(artifactId),
			apiClient.GET('/artifacts/{artifactId}/lineage', {
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
