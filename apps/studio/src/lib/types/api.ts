// Re-export types from @pubwiki/api for studio use
export type {
	ArtifactListItem,
	ArtifactVersion,
	ArtifactLineageItem,
	ArtifactNodeSummary,
	ArtifactEdge,
	ArtifactNodeType,
	NodeFileInfo,
	Tag,
	Pagination,
	ProjectListItem,
	ProjectRole,
	UserProjectListItem
} from '@pubwiki/api';

import type { ArtifactNodeSummary, ArtifactEdge, NodeFileInfo } from '@pubwiki/api';

/**
 * Node detail as returned by the API
 * 
 * Note: In the new version control architecture:
 * - No more external/originalRef distinction
 * - All nodes are identified by globally unique nodeId
 * - Version lineage is tracked via parent commit
 */
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
