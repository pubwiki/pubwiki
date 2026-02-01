/**
 * VFS 文件对象
 */
export interface VfsFile {
  /** 文件完整路径 */
  path: string
  /** 文件名 */
  name: string
  /** 文件类型/扩展名 */
  type: string
  /** 文件大小（字节） */
  size: number
  /** 创建时间（ISO 8601） */
  createdAt: string
  /** 更新时间（ISO 8601） */
  updatedAt: string
  /** 父文件夹路径 */
  folderPath: string
  /** 文件内容（可选，按需加载） */
  content?: ArrayBuffer | string
}

/**
 * VFS 文件夹对象
 */
export interface VfsFolder {
  /** 文件夹完整路径 */
  path: string
  /** 文件夹名称 */
  name: string
  /** 父文件夹路径 */
  parentPath: string
  /** 创建时间（ISO 8601） */
  createdAt: string
  /** 更新时间（ISO 8601） */
  updatedAt: string
  /** 子项（可选，递归列出时使用） */
  children?: Array<VfsFile | VfsFolder>
  /** 如果此文件夹是挂载点，表示挂载的ID标识 */
  mountedId?: string
}

/**
 * 文件或文件夹的联合类型
 */
export type VfsItem = VfsFile | VfsFolder

/**
 * 判断是否为文件
 */
export function isVfsFile(item: VfsItem): item is VfsFile {
  return 'folderPath' in item && 'size' in item
}

/**
 * 判断是否为文件夹
 */
export function isVfsFolder(item: VfsItem): item is VfsFolder {
  return 'parentPath' in item && !('size' in item)
}
