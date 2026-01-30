export interface DocItem {
	title: string;
	slug: string;
	order: number;
	children?: DocItem[];
}

export interface DocMetadata {
	title: string;
	description?: string;
	order?: number;
	draft?: boolean;
}

// Auto-generate sidebar from content directory
// Uses Vite's glob import with 'import' option to only load metadata, not full module
export function getSidebar(): DocItem[] {
	// Only import the metadata export, not the full component
	const modules = import.meta.glob<DocMetadata>('../../../content/**/*.{md,svx}', {
		eager: true,
		import: 'metadata'
	});

	const items = new Map<string, DocItem>();
	const children = new Map<string, DocItem[]>();

	for (const [path, metadata] of Object.entries(modules)) {
		// Skip drafts
		if (metadata?.draft) continue;

		// Convert path: ../../../content/getting-started/installation.md -> getting-started/installation
		let slug = path
			.replace(/^\.\.\/\.\.\/\.\.\/content\//, '')
			.replace(/\.mdx?$/, '')
			.replace(/\.svx$/, '');

		const isIndex = slug.endsWith('/index') || slug === 'index';
		if (isIndex) {
			slug = slug.replace(/\/index$/, '').replace(/^index$/, '');
		}

		const parts = slug.split('/');
		const depth = parts.length;
		const parentSlug = parts.slice(0, -1).join('/');

		const item: DocItem = {
			title: metadata?.title || parts[parts.length - 1] || 'Home',
			slug: slug || 'index',
			order: metadata?.order ?? 999
		};

		if (depth === 1 || (depth === 0 && isIndex)) {
			// Top-level item
			const key = slug || 'index';
			if (isIndex || !items.has(key)) {
				items.set(key, item);
			}
		} else {
			// Nested item
			if (isIndex) {
				// This is a section index (e.g., getting-started/index.md)
				items.set(slug, item);
			} else {
				// This is a child page
				if (!children.has(parentSlug)) {
					children.set(parentSlug, []);
				}
				children.get(parentSlug)!.push(item);
			}
		}
	}

	// Attach children to parents
	for (const [parentSlug, childItems] of children) {
		const parent = items.get(parentSlug);
		if (parent) {
			parent.children = childItems.sort((a, b) => a.order - b.order);
		} else {
			// Parent doesn't have index.md, create a virtual parent
			const parts = parentSlug.split('/');
			items.set(parentSlug, {
				title: parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
				slug: parentSlug,
				order: 999,
				children: childItems.sort((a, b) => a.order - b.order)
			});
		}
	}

	// Sort and return top-level items
	return Array.from(items.values()).sort((a, b) => a.order - b.order);
}
