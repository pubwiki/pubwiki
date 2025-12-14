/**
 * Path Utilities
 *
 * Path manipulation functions for the bundler.
 */

/**
 * Normalize a path by resolving . and .. segments
 */
export function normalizePath(basePath: string, relativePath: string): string {
  // If relativePath is already absolute, normalize it directly
  if (relativePath.startsWith('/')) {
    return normalizeAbsolutePath(relativePath)
  }

  // Combine base and relative paths
  const combined = basePath.endsWith('/')
    ? basePath + relativePath
    : basePath + '/' + relativePath

  return normalizeAbsolutePath(combined)
}

/**
 * Normalize an absolute path
 */
export function normalizeAbsolutePath(path: string): string {
  const parts = path.split('/')
  const result: string[] = []

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    } else if (part === '..') {
      result.pop()
    } else {
      result.push(part)
    }
  }

  return '/' + result.join('/')
}

/**
 * Get the directory path of a file
 */
export function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : '/'
}

/**
 * Get the parent directory of a path
 */
export function getParentDirectory(dirPath: string): string | null {
  if (dirPath === '/' || dirPath === '') return null
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '/'
}

/**
 * Get filename from path
 */
export function getFilename(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? path : path.substring(lastSlash + 1)
}

/**
 * Get file extension
 */
export function getExtension(path: string): string {
  const filename = getFilename(path)
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? '' : filename.substring(lastDot)
}

/**
 * Join path segments
 */
export function joinPath(...segments: string[]): string {
  const combined = segments.join('/')
  return normalizeAbsolutePath(combined)
}

/**
 * Check if path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/')
}

/**
 * Remove comments from JSON string (supports single-line and multi-line comments)
 */
export function stripJsonComments(content: string): string {
  let result = ''
  let i = 0
  let inString = false
  let stringChar = ''

  while (i < content.length) {
    const char = content[i]
    const nextChar = content[i + 1]

    // Handle string content
    if (inString) {
      result += char
      if (char === '\\' && i + 1 < content.length) {
        // Skip escaped character
        result += nextChar
        i += 2
        continue
      }
      if (char === stringChar) {
        inString = false
      }
      i++
      continue
    }

    // Check for string start
    if (char === '"' || char === "'") {
      inString = true
      stringChar = char
      result += char
      i++
      continue
    }

    // Check for single-line comment
    if (char === '/' && nextChar === '/') {
      // Skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++
      }
      continue
    }

    // Check for multi-line comment
    if (char === '/' && nextChar === '*') {
      i += 2
      // Skip until end of comment
      while (i < content.length - 1) {
        if (content[i] === '*' && content[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      continue
    }

    result += char
    i++
  }

  return result
}
