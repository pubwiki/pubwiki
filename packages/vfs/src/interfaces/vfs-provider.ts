import type { VfsStat as VfsStat } from '../types'

/**
 * VFS Provider 基础接口
 *
 * 提供基本的文件系统操作能力。
 * 由具体的存储后端实现（如 ZenFS、Node.js fs、内存等）。
 */
export interface VfsProvider {
  // ========== ID 生成 ==========

  /**
   * 为路径生成稳定 ID
   * @param path 文件/目录路径
   * @returns 稳定的唯一标识符
   */
  id(path: string): Promise<string>

  // ========== 文件操作 ==========

  /**
   * 读取文件内容
   * @param path 文件路径
   * @returns 文件内容（二进制）
   */
  readFile(path: string): Promise<Uint8Array>

  /**
   * 写入文件内容
   * @param path 文件路径
   * @param content 文件内容
   */
  writeFile(path: string, content: Uint8Array): Promise<void>

  /**
   * 删除文件
   * @param path 文件路径
   */
  unlink(path: string): Promise<void>

  // ========== 目录操作 ==========

  /**
   * 创建目录
   * @param path 目录路径
   * @param options.recursive 是否递归创建
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>

  /**
   * 读取目录内容
   * @param path 目录路径
   * @returns 目录项名称列表
   */
  readdir(path: string): Promise<string[]>

  /**
   * 删除目录
   * @param path 目录路径
   * @param options.recursive 是否递归删除
   */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>

  // ========== 状态查询 ==========

  /**
   * 获取文件/目录状态
   * @param path 路径
   */
  stat(path: string): Promise<VfsStat>

  /**
   * 检查路径是否存在
   * @param path 路径
   */
  exists(path: string): Promise<boolean>

  // ========== 移动/复制 ==========

  /**
   * 重命名/移动文件或目录
   * @param from 源路径
   * @param to 目标路径
   */
  rename(from: string, to: string): Promise<void>

  /**
   * 复制文件
   * @param from 源路径
   * @param to 目标路径
   */
  copyFile(from: string, to: string): Promise<void>

  // ========== 生命周期（可选） ==========

  /**
   * 初始化 Provider
   */
  initialize?(): Promise<void>

  /**
   * 销毁 Provider，释放资源
   */
  dispose?(): Promise<void>
}
