import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
	return {
		artifactId: params.id,
		version: url.searchParams.get('version') || 'latest'
	};
};
