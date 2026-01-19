// Re-export types from @pubwiki/api for studio use
export type {
	ArtifactListItem,
	ArtifactType,
	ArtifactVersion,
	ArtifactLineageItem,
	ArtifactNodeSummary,
	ArtifactEdge,
	ArtifactNodeType,
	NodeFileInfo,
	LineageType,
	VisibilityType,
	Tag,
	Pagination,
	ProjectListItem,
	ProjectRole,
	UserProjectRole,
	UserProjectListItem
} from '@pubwiki/api';

import type { ArtifactNodeSummary, ArtifactEdge, NodeFileInfo } from '@pubwiki/api';

/**
 * Node detail as returned by the API
 */
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

/**
 * Graph data as returned by the API
 */
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
