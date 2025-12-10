export interface Artifact {
	id: string;
	owner_id: string;
	owner_name: string; // Added for UI convenience
	title: string;
	description: string;
	
	// 类型区分
	type: 'RECIPE' | 'GAME' | 'ASSET_PACK' | 'PROMPT';
	
	// 可见性
	visibility: 'PUBLIC' | 'PRIVATE';
	
	// 版本控制
	version_hash: string;
	version_tag: string; // e.g. "v1.0"
	
	// 统计数据
	stats: {
		views: number;
		stars: number;
		forks: number;
		runs: number;
	};

	// 溯源信息
	lineage: {
		parent_recipe_ids?: string[];
		parent_artifact_id?: string;
		input_params?: Record<string, any>;
	};

	tags: string[];
	coverImage: string;
	files?: ArtifactFile[];

	created_at: Date;
	updated_at: Date;
}

export interface ArtifactFile {
	id: string;
	artifact_id: string;
	path: string;
	content: string;
	language: string;
	size: number;
}

// Keep Game for backward compatibility with existing home page, 
// but it could be mapped to Artifact in the future.
export interface Game {
	id: number;
	title: string;
	author: string;
	description: string;
	tags: string[];
	views: number;
	likes: number;
	coverImage: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface User {
	id: number;
	username: string;
	avatar?: string;
	bio?: string;
	games?: Game[];
}

export type FilterType = 'All' | 'Sci-Fi' | 'Fantasy' | 'Xianxia' | 'Cyberpunk' | 'Horror' | 'Strategy' | 'Survival';
export type SortType = 'New' | 'Top' | 'Trending';
