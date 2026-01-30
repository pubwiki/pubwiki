import { escapeSvelte } from 'mdsvex';
import { createHighlighter } from 'shiki';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

const theme = 'github-light';

const highlighter = await createHighlighter({
	themes: [theme, 'github-dark'],
	langs: [
		'javascript',
		'typescript',
		'svelte',
		'html',
		'css',
		'json',
		'yaml',
		'markdown',
		'bash',
		'shell',
		'lua',
		'python',
		'rust',
		'sql',
		'http'
	]
});

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexConfig = {
	extensions: ['.md', '.svx'],
	smartypants: {
		dashes: 'oldschool'
	},
	// Layout is handled at route level for Svelte 5 compatibility
	remarkPlugins: [],
	rehypePlugins: [
		rehypeSlug,
		[
			rehypeAutolinkHeadings,
			{
				behavior: 'wrap',
				properties: {
					class: 'heading-anchor'
				}
			}
		]
	],
	highlight: {
		highlighter: async (code, lang = 'text') => {
			const html = escapeSvelte(
				highlighter.codeToHtml(code, {
					lang,
					theme
				})
			);
			return `{@html \`${html}\`}`;
		}
	}
};

export default mdsvexConfig;
