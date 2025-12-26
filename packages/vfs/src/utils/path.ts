/**
 * 路径工具函数
 * 
 * 这些函数是对 VfsPath 类的字符串接口封装，提供兼容的 API。
 * 内部使用基于 segments 的 VfsPath 进行处理，避免字符串边界问题。
 */

import { VfsPath } from './vfs-path'

/**
 * 从文件名和文件夹路径构建完整路径
 */
export function buildFilePath(
  folderPath: string | null,
  fileName: string
): string {
  if (!folderPath) {
    return VfsPath.root().append(fileName).toString()
  }
  return VfsPath.parse(folderPath).append(fileName).toString()
}

/**
 * 从完整路径提取文件名
 */
export function getFileName(path: string): string {
  const vp = VfsPath.parse(path)
  return vp.name || path
}

/**
 * 从完整路径提取文件夹路径
 */
export function getFolderPath(path: string): string {
  return VfsPath.parse(path).parent().toString()
}

/**
 * 规范化路径
 * - 移除多余的斜杠
 * - 确保以 / 开头
 * - 移除末尾的斜杠（除了根路径）
 */
export function normalizePath(path: string): string {
  return VfsPath.parse(path).toString()
}

/**
 * 合并路径段
 */
export function joinPaths(...paths: string[]): string {
  if (paths.length === 0) {
    return '/'
  }
  
  let result = VfsPath.parse(paths[0])
  for (let i = 1; i < paths.length; i++) {
    if (paths[i] && paths[i] !== '/') {
      result = result.append(paths[i])
    }
  }
  return result.toString()
}

/**
 * 检查路径是否为根路径
 */
export function isRootPath(path: string): boolean {
  return VfsPath.parse(path).isRoot
}

/**
 * 获取父路径
 */
export function getParentPath(path: string): string {
  return VfsPath.parse(path).parent().toString()
}

/**
 * 检查路径是否是另一个路径的子路径（严格子路径，不包括相等）
 */
export function isSubPath(path: string, parentPath: string): boolean {
  return VfsPath.parse(path).isUnder(VfsPath.parse(parentPath), true)
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(path: string): string {
  return VfsPath.parse(path).extension
}

/**
 * 获取不带扩展名的文件名
 */
export function getFileBaseName(path: string): string {
  return VfsPath.parse(path).baseName
}

/**
 * 获取相对路径
 * 如果 path 不是 basePath 的子路径，返回原始的规范化路径
 */
export function getRelativePath(path: string, basePath: string): string {
  const vp = VfsPath.parse(path)
  const base = VfsPath.parse(basePath)
  
  const relative = vp.relativeTo(base)
  if (!relative) {
    return vp.toString()
  }
  
  // 返回不带前导斜杠的相对路径
  if (relative.isRoot) {
    return ''
  }
  return relative.segments.join('/')
}
