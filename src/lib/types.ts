// Re-export types from @pubwiki/api
export type {
	ArtifactListItem,
	ArtifactFile,
	ArtifactType,
	ArtifactVersion,
	ArtifactLineageItem,
	LineageType,
	VisibilityType,
	Tag,
	Pagination
} from '@pubwiki/api';

// Re-export from artifacts store
export type { ArtifactDetails } from './stores/artifacts.svelte';

// Frontend-specific types
export type FilterType = 'All' | 'Sci-Fi' | 'Fantasy' | 'Xianxia' | 'Cyberpunk' | 'Horror' | 'Strategy' | 'Survival';
export type SortType = 'New' | 'Top' | 'Trending';
