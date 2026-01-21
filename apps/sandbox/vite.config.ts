import { defineConfig } from 'vite'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 4001,
    host: 'localhost',
    cors: true,
    // 禁用 HMR，让开发环境行为与生产环境一致
    hmr: false,
    headers: {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './__sandbox.html'
      },
      output: {
        // 禁用代码分割，输出单个 JS 文件
        manualChunks: undefined,
        inlineDynamicImports: true,
        entryFileNames: '__sandbox.js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  plugins: [
    {
      name: 'serve-sandbox-files',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // 将根路径请求重定向到 __sandbox.html
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/__sandbox.html'
          }
          
          // 在开发模式下，从 dist 目录提供 Service Worker
          if (req.url === '/sandbox-sw.js' || 
              req.url === '/sandbox-sw.js.map' ||
              req.url === '/bootstrap.js' ||
              req.url === '/bootstrap.js.map') {
            const filePath = resolve(__dirname, 'dist', req.url.slice(1))
            if (existsSync(filePath)) {
              const content = readFileSync(filePath)
              const contentType = req.url.endsWith('.map') 
                ? 'application/json' 
                : 'application/javascript'
              res.setHeader('Content-Type', contentType)
              if (req.url === '/sandbox-sw.js') {
                res.setHeader('Service-Worker-Allowed', '/')
              }
              res.end(content)
              return
            }
          }
          next()
        })
      }
    }
  ]
})
