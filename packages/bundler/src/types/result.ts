/**
 * Bundle Result Types
 *
 * Types for build results, errors, and warnings.
 */

/**
 * Build error
 */
export interface BuildError {
  file: string
  line: number
  column: number
  message: string
  snippet?: string
}

/**
 * Build warning
 */
export interface BuildWarning {
  file?: string
  line?: number
  column?: number
  message: string
}

/**
 * 单个入口文件的构建结果
 */
export interface FileBuildResult {
  success: boolean
  code?: string
  css?: string
  map?: string
  errors: BuildError[]
  warnings?: BuildWarning[]
  dependencies?: string[]
  timing?: {
    total: number
    resolve?: number
    transform?: number
  }
}

/**
 * 项目构建结果（基于 tsconfig）
 */
export interface ProjectBuildResult {
  /** 是否全部成功 */
  success: boolean
  /** 每个入口文件的构建结果，key 为入口路径 */
  outputs: Map<string, FileBuildResult>
  /** 所有依赖文件的路径（用于监听） */
  dependencies: string[]
}
