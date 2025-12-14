import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		// Include workspace dependencies for proper bundling
		include: ['@pubwiki/chat', '@pubwiki/svelte-chat']
	},
	ssr: {
		// Don't externalize workspace packages
		noExternal: ['@pubwiki/chat', '@pubwiki/svelte-chat']
	}
});
