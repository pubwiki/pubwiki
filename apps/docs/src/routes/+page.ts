import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	// Use glob import to find content files
	const modules = import.meta.glob<{
		default: ConstructorOfATypedSvelteComponent;
		metadata?: Record<string, unknown>;
	}>('../../content/index.md', { eager: true });

	const module = Object.values(modules)[0];

	if (!module) {
		throw error(404, 'Document not found');
	}

	return {
		content: module.default,
		metadata: module.metadata
	};
};
