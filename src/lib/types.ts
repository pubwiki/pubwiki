// Re-export types from @pubwiki/api
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

// Re-export from artifacts store
export type { ArtifactDetails, ArtifactGraphData, ArtifactNodeDetail } from './stores/artifacts.svelte';

// Frontend-specific types
export type FilterType = 'All' | 'Sci-Fi' | 'Fantasy' | 'Xianxia' | 'Cyberpunk' | 'Horror' | 'Strategy' | 'Survival';
export type SortType = 'New' | 'Top' | 'Trending';
