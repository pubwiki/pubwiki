import type { PageLoad } from './$types';

export interface PlayPageData {
	artifactId: string;
	saveCommit: string | null;
}

export const load: PageLoad = ({ params, url }): PlayPageData => {
	return {
		artifactId: params.id,
		saveCommit: url.searchParams.get('save'),
	};
};
