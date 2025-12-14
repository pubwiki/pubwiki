/**
 * Utility functions for sandbox-host
 */

import type { BuildError } from './types'

/**
 * MIME type mapping for common file extensions
 */
export const MIME_TYPES: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',

  // Web
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',

  // Data
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.csv': 'text/csv',

  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Binary / Other
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.map': 'application/json'
}

/**
 * Get MIME type for a file path based on extension.
 */
export function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Normalize a path by resolving . and .. segments
 */
export function normalizePath(basePath: string, relativePath: string): string {
  // If relativePath is absolute, return as-is
  if (relativePath.startsWith('/')) {
    return relativePath
  }

  // Combine paths
  const parts = basePath.split('/').filter(Boolean)
  const relParts = relativePath.split('/').filter(Boolean)

  for (const part of relParts) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.') {
      parts.push(part)
    }
  }

  return '/' + parts.join('/')
}

/**
 * Check if a file is one of the entry files
 */
export function isEntryFile(filePath: string, entryFiles: string[]): boolean {
  return entryFiles.includes(filePath)
}

/**
 * HTML escape utility
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Generate an HTML error page for build failures.
 */
export function createBuildErrorPage(path: string, errors: BuildError[]): string {
  const errorMessages = errors
    .map(e => {
      let result = `${escapeHtml(e.file)}:${e.line}:${e.column} - ${escapeHtml(e.message)}`
      if (e.snippet) {
        result += `\n\n${escapeHtml(e.snippet)}`
      }
      return result
    })
    .join('\n\n')

  return `<!DOCTYPE html>
<html>
<head>
  <title>Build Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #f44336;
      padding: 20px;
      margin: 0;
    }
    h1 { color: #ff6b6b; margin-bottom: 20px; }
    pre {
      background: #2d2d2d;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .file { color: #4fc3f7; }
    .error-count {
      color: #aaa;
      font-size: 14px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <h1>⚠️ Build Failed</h1>
  <p>Failed to build: <span class="file">${escapeHtml(path)}</span></p>
  <p class="error-count">${errors.length} error${errors.length > 1 ? 's' : ''} found</p>
  <pre>${errorMessages}</pre>
</body>
</html>`
}

/**
 * Generate a minimal error page for quick display
 */
export function createSimpleErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #f44336;
      padding: 20px;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    h1 { color: #ff6b6b; margin-bottom: 20px; }
    p { color: #aaa; max-width: 600px; text-align: center; }
  </style>
</head>
<body>
  <h1>⚠️ Error</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`
}
