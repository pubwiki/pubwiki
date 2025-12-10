import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getArtifactById, getArtifactsByRecipeId, getArtifactsByForkId, getRelatedArtifacts } from '$lib/mockData';

export const load: PageLoad = ({ params }) => {
	const artifact = getArtifactById(params.id);

	if (!artifact) {
		throw error(404, 'Artifact not found');
	}

	// If it's a recipe, load its children (remixes)
	const remixes = artifact.type === 'RECIPE' ? getArtifactsByRecipeId(artifact.id) : [];
	
	// Load forks
	const forks = getArtifactsByForkId(artifact.id);

	// Load related artifacts
	const related = getRelatedArtifacts(artifact);

	return {
		artifact,
		remixes,
		forks,
		related
	};
};
