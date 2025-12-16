import { setContext, getContext } from 'svelte';
import { createApiClient } from '@pubwiki/api/client';
import type {
	ArtifactListItem,
	ArtifactFile,
	ArtifactVersion,
	ArtifactLineageItem
} from '@pubwiki/api';

const ARTIFACTS_KEY = Symbol('artifacts');
const API_BASE_URL = 'http://localhost:8787/api';

export interface ArtifactDetails {
	artifact: ArtifactListItem;
	files?: ArtifactFile[];
	version?: ArtifactVersion;
	parents?: ArtifactLineageItem[];
	children?: ArtifactLineageItem[];
}

export class ArtifactStore {
	artifacts = $state<ArtifactListItem[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	
	// Cache for artifact details (files and lineage)
	private detailsCache = new Map<string, ArtifactDetails>();

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

	async fetchArtifactDetails(artifactId: string, token?: string): Promise<ArtifactDetails | null> {
		const cached = this.detailsCache.get(artifactId);
		
		// If we have full details cached, return them
		if (cached?.files && cached?.parents !== undefined) {
			return cached;
		}

		// Get basic artifact info first
		let artifact = this.getArtifactById(artifactId);
		
		// If not in list, we need to fetch the list or handle this case
		// For now, if we don't have the artifact, return null
		if (!artifact && !cached?.artifact) {
			// Try to fetch the artifacts list first
			await this.fetchArtifacts({ limit: 100 });
			artifact = this.getArtifactById(artifactId);
			if (!artifact) {
				return null;
			}
		}

		const client = this.getClient(token);
		
		// Fetch files and lineage in parallel
		const [filesResult, lineageResult] = await Promise.all([
			client.GET('/artifacts/{artifactId}/files', {
				params: { path: { artifactId } }
			}),
			client.GET('/artifacts/{artifactId}/lineage', {
				params: { path: { artifactId } }
			})
		]);

		const details: ArtifactDetails = {
			artifact: artifact || cached!.artifact,
			files: filesResult.data?.files,
			version: filesResult.data?.version,
			parents: lineageResult.data?.parents,
			children: lineageResult.data?.children
		};

		this.detailsCache.set(artifactId, details);
		return details;
	}

	clearCache() {
		this.detailsCache.clear();
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
