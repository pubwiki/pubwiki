/**
 * Build Error Page Generator
 *
 * Generates HTML error pages for build failures.
 */

import type { BuildError } from '../types'

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
 *
 * @param path - The file path that failed to build
 * @param errors - Array of build errors
 * @returns HTML string
 */
export function createBuildErrorPage(path: string, errors: BuildError[]): string {
  const errorMessages = errors
    .map(e => {
      let msg = `${e.file}:${e.line}:${e.column} - ${e.message}`
      if (e.snippet) {
        msg += `\n\n${e.snippet}`
      }
      return msg
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
  <pre>${escapeHtml(errorMessages)}</pre>
</body>
</html>`
}

/**
 * Generate a minimal error page for quick display
 *
 * @param message - Error message
 * @returns HTML string
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
    h1 { color: #ff6b6b; }
    p {
      max-width: 600px;
      text-align: center;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <h1>⚠️ Error</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`
}
