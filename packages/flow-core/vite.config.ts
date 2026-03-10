import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	build: {
		lib: {
			entry: resolve(__dirname, 'src/index.ts'),
			formats: ['es'],
			fileName: 'index',
		},
		rollupOptions: {
			external: [
				'@pubwiki/api',
				'@pubwiki/chat',
				'@pubwiki/lua',
				'@pubwiki/rdfstore',
				'@pubwiki/vfs',
				'jsonrepair',
				'n3',
			],
		},
		target: 'es2022',
		sourcemap: true,
		// Don't empty outDir on every build (tsc might write .d.ts there)
		emptyOutDir: false,
	},
});
