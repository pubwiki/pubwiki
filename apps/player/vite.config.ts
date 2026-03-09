import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import fs from 'fs';

// Check if local HTTPS certificates exist (for mobile debugging)
const httpsConfig = fs.existsSync('./cert.pem') && fs.existsSync('./key.pem')
	? {
		key: fs.readFileSync('./key.pem'),
		cert: fs.readFileSync('./cert.pem'),
	}
	: undefined;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
	],
	server: {
		port: 5175,
		host: true,
		https: httpsConfig,
		fs: { allow: ['../../packages'] }
	},
	ssr: {
		noExternal: ['@pubwiki/api']
	}
});
