import type { PageLoad } from './$types';

export interface PlayPageData {
	/** Artifact ID from URL path */
	artifactId: string;
	/** State node ID for the play session */
	stateNodeId: string | null;
	/** Optional save ID to load from */
	saveId: string | null;
	/** Optional checkpoint ID to load */
	checkpointId: string | null;
}

export const load: PageLoad = ({ params, url }): PlayPageData => {
	const stateNodeId = url.searchParams.get('state_id');
	const saveId = url.searchParams.get('saveid');
	const checkpointId = url.searchParams.get('checkpoint');
	
	console.log('[Play +page.ts] Load params:', { 
		artifactId: params.id, 
		stateNodeId, 
		saveId, 
		checkpointId 
	});
	
	return {
		artifactId: params.id,
		stateNodeId,
		saveId,
		checkpointId
	};
};
