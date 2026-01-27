import type { PageLoad } from './$types';

export interface PlayPageData {
	/** Artifact ID from URL path */
	artifactId: string;
	/** Sandbox node ID for the play session (original artifact ID) */
	sandboxNodeId: string | null;
	/** Optional save ID to load from */
	saveId: string | null;
	/** Optional checkpoint ID to load */
	checkpointId: string | null;
}

export const load: PageLoad = ({ params, url }): PlayPageData => {
	const sandboxNodeId = url.searchParams.get('sandbox_id');
	const saveId = url.searchParams.get('saveid');
	const checkpointId = url.searchParams.get('checkpoint');
	
	console.log('[Play +page.ts] Load params:', { 
		artifactId: params.id, 
		sandboxNodeId, 
		saveId, 
		checkpointId 
	});
	
	return {
		artifactId: params.id,
		sandboxNodeId,
		saveId,
		checkpointId
	};
};
