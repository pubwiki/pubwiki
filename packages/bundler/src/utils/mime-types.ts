/**
 * MIME Types Utility
 *
 * Get MIME type for a file path based on extension.
 */

const mimeTypes: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.jsx': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  
  // Web
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  
  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  
  // Data
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  
  // Binary
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
}

/**
 * Get MIME type for a file path
 * @param path File path or filename
 * @returns MIME type string
 */
export function getMimeType(path: string): string {
  const ext = getExtension(path)
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Get file extension from path
 */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.')
  if (lastDot === -1) return ''
  return path.substring(lastDot).toLowerCase()
}
