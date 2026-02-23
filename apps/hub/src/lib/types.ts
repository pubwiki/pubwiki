// Re-export store-specific types
export type { ArtifactDetails, ArtifactGraphData, ArtifactNodeDetail } from './stores/artifacts.svelte';

// Frontend-specific types
export type FilterType = 'All' | 'Sci-Fi' | 'Fantasy' | 'Xianxia' | 'Cyberpunk' | 'Horror' | 'Strategy' | 'Survival';
export type SortType = 'New' | 'Top' | 'Trending';
