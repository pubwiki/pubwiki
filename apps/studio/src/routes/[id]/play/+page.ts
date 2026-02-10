import type { PageLoad } from './$types';

export interface PlayPageData {
	/** Artifact ID from URL path */
	artifactId: string;
	/** Sandbox node ID for the play session (original artifact ID) */
	sandboxNodeId: string | null;
	/** Optional save commit hash to load from (new Save API) */
	saveCommit: string | null;
}

export const load: PageLoad = ({ params, url }): PlayPageData => {
	const sandboxNodeId = url.searchParams.get('sandbox_id');
	// New Save API uses commit hash directly
	const saveCommit = url.searchParams.get('save');
	
	console.log('[Play +page.ts] Load params:', { 
		artifactId: params.id, 
		sandboxNodeId, 
		saveCommit 
	});
	
	return {
		artifactId: params.id,
		sandboxNodeId,
		saveCommit
	};
};
