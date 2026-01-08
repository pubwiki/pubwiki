import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	],

	server: { 
		fs: { allow: ['../packages'] },
		port: 5174
	},

	ssr: {
		noExternal: ['@xyflow/svelte', '@pubwiki/chat', '@pubwiki/svelte-chat']
	}
});
