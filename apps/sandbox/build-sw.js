// build-sw.js
// 使用 esbuild 构建 Service Worker
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isWatch = process.argv.includes('--watch')

// 确保 dist 目录存在
const distDir = join(__dirname, 'dist')
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

const buildOptions = {
  entryPoints: [join(__dirname, 'src/sandbox-sw.ts')],
  bundle: true,
  outfile: join(__dirname, 'dist/sandbox-sw.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !isWatch,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  },
  logLevel: 'info'
}

async function build() {
  try {
    if (isWatch) {
      console.log('👀 Watching Service Worker files for changes...')
      const context = await esbuild.context(buildOptions)
      await context.watch()
      console.log('✅ Service Worker watch mode started')
    } else {
      console.log('🔨 Building Service Worker...')
      await esbuild.build(buildOptions)
      console.log('✅ Service Worker built successfully')
    }
  } catch (error) {
    console.error('❌ Service Worker build failed:', error)
    process.exit(1)
  }
}

build()
