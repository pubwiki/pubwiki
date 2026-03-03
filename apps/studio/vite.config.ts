import { sentrySvelteKit } from "@sentry/sveltekit";
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import fs from 'fs';

// Check if local HTTPS certificates exist (for mobile debugging)
const httpsConfig = fs.existsSync('./cert.pem') && fs.existsSync('./key.pem')
	? {
		key: fs.readFileSync('./key.pem'),
		cert: fs.readFileSync('./cert.pem'),
	}
	: undefined;

export default defineConfig({
	plugins: [sentrySvelteKit({
        org: "pubwiki",
        project: "pubwiki-studio"
    }), tailwindcss(), sveltekit(), paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })],

	server: { 
		fs: { allow: ['../../packages'] },
		port: 5174,
		host: true, // Listen on all interfaces for mobile access
		https: httpsConfig
	},

	optimizeDeps: {
		exclude: [
			'quickjs-emscripten-core',
			'@jitl/quickjs-wasmfile-release-asyncify'
		]
	},

	ssr: {
		noExternal: ['@xyflow/svelte', '@pubwiki/chat', '@pubwiki/svelte-chat', '@pubwiki/api']
	}
});
