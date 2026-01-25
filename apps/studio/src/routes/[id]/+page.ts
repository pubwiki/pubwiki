import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
	const importArtifactId = url.searchParams.get('import');
	console.log('[Studio +page.ts] Load params:', { projectId: params.id, importArtifactId });
	return {
		projectId: params.id,
		importArtifactId
	};
};
