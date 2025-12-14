/**
 * 从文件名和文件夹路径构建完整路径
 */
export function buildFilePath(
  folderPath: string | null,
  fileName: string
): string {
  if (!folderPath || folderPath === '/') {
    return `/${fileName}`
  }

  const normalizedFolder = folderPath.startsWith('/')
    ? folderPath
    : `/${folderPath}`
  const cleanFolder = normalizedFolder.endsWith('/')
    ? normalizedFolder.slice(0, -1)
    : normalizedFolder

  return `${cleanFolder}/${fileName}`
}

/**
 * 从完整路径提取文件名
 */
export function getFileName(path: string): string {
  return path.split('/').pop() || path
}

/**
 * 从完整路径提取文件夹路径
 */
export function getFolderPath(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/**
 * 规范化路径
 */
export function normalizePath(path: string): string {
  // 移除多余的斜杠
  let normalized = path.replace(/\/+/g, '/')

  // 确保以 / 开头
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  // 移除末尾的斜杠（除了根路径）
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

/**
 * 合并路径段
 */
export function joinPaths(...paths: string[]): string {
  const joined = paths
    .filter((p) => p && p !== '/')
    .join('/')
    .replace(/\/+/g, '/')

  return normalizePath(joined)
}

/**
 * 检查路径是否为根路径
 */
export function isRootPath(path: string): boolean {
  return normalizePath(path) === '/'
}

/**
 * 获取父路径
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path)
  if (isRootPath(normalized)) {
    return '/'
  }

  return getFolderPath(normalized)
}

/**
 * 检查路径是否是另一个路径的子路径
 */
export function isSubPath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parentPath)

  if (normalizedParent === '/') {
    return true
  }

  return normalizedPath.startsWith(normalizedParent + '/')
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(path: string): string {
  const fileName = getFileName(path)
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(lastDot + 1) : ''
}

/**
 * 获取不带扩展名的文件名
 */
export function getFileBaseName(path: string): string {
  const fileName = getFileName(path)
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}

/**
 * 获取相对路径
 */
export function getRelativePath(path: string, basePath: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedBase = normalizePath(basePath)

  if (!isSubPath(normalizedPath, normalizedBase)) {
    return normalizedPath
  }

  if (normalizedBase === '/') {
    return normalizedPath.slice(1)
  }

  return normalizedPath.slice(normalizedBase.length + 1)
}
