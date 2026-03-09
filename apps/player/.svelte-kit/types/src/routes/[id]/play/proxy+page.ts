// @ts-nocheck
import type { PageLoad } from './$types';

export interface PlayPageData {
	artifactId: string;
	saveCommit: string | null;
}

export const load = ({ params, url }: Parameters<PageLoad>[0]): PlayPageData => {
	return {
		artifactId: params.id,
		saveCommit: url.searchParams.get('save'),
	};
};
