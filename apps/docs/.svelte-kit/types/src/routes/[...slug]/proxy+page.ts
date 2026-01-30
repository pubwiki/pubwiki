// @ts-nocheck
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = async ({ params }: Parameters<PageLoad>[0]) => {
	const slug = params.slug;

	// Try to import the markdown file
	const modules = import.meta.glob<{
		default: ConstructorOfATypedSvelteComponent;
		metadata?: Record<string, unknown>;
	}>('../../../content/**/*.{md,svx}', { eager: true });

	// Try exact path first
	const exactPath = `../../../content/${slug}.md`;
	const exactPathSvx = `../../../content/${slug}.svx`;
	// Try index file in directory
	const indexPath = `../../../content/${slug}/index.md`;
	const indexPathSvx = `../../../content/${slug}/index.svx`;

	const module = modules[exactPath] || modules[exactPathSvx] || modules[indexPath] || modules[indexPathSvx];

	if (!module) {
		throw error(404, `Document not found: ${slug}`);
	}

	return {
		content: module.default,
		metadata: module.metadata
	};
};
