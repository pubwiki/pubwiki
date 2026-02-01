/**
 * VFS 文件/文件夹状态信息
 */
export interface VfsStat {
  /** 文件大小（字节） */
  size: number
  /** 是否为文件 */
  isFile: boolean
  /** 是否为目录 */
  isDirectory: boolean
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
  /** 
   * 如果此项是一个挂载点，则表示挂载的ID标识
   * 如果不是挂载点，则为 undefined
   */
  mountedId?: string
}
