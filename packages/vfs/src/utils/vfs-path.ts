/**
 * VfsPath - 基于 segments 数组的结构化路径类型
 * 
 * 将路径解析为 segments 数组进行处理，避免字符串操作带来的斜线处理问题。
 * 所有路径比较和操作都基于 segments，确保逻辑清晰且不易出错。
 */

/**
 * 路径 segments 数组类型
 * - 空数组 [] 表示根路径 "/"
 * - ["src", "file.ts"] 表示 "/src/file.ts"
 */
export type PathSegments = readonly string[]

/**
 * 不可变的 VFS 路径对象
 * 
 * 设计原则：
 * 1. 所有路径操作返回新对象，保持不可变性
 * 2. segments 是路径的核心表示，字符串形式只在需要时生成
 * 3. 所有比较和操作都基于 segments，避免字符串的边界情况
 */
export class VfsPath {
  /** 路径 segments（不包含根目录） */
  readonly segments: PathSegments
  
  /** 缓存的字符串表示 */
  private _string: string | null = null

  /**
   * 私有构造函数，使用静态方法创建实例
   */
  private constructor(segments: PathSegments) {
    this.segments = segments
  }

  // ========== 静态工厂方法 ==========

  /**
   * 从字符串解析路径
   * 
   * @example
   * VfsPath.parse("/src/file.ts") // segments: ["src", "file.ts"]
   * VfsPath.parse("src/file.ts")  // segments: ["src", "file.ts"]
   * VfsPath.parse("/")            // segments: []
   * VfsPath.parse("")             // segments: []
   * VfsPath.parse("///a//b///")   // segments: ["a", "b"]
   */
  static parse(path: string): VfsPath {
    // 分割并过滤空段
    const segments = path.split('/').filter(s => s.length > 0)
    return new VfsPath(segments)
  }

  /**
   * 从 segments 数组创建路径
   */
  static fromSegments(segments: readonly string[]): VfsPath {
    // 过滤空字符串以确保一致性
    return new VfsPath(segments.filter(s => s.length > 0))
  }

  /**
   * 创建根路径
   */
  static root(): VfsPath {
    return new VfsPath([])
  }

  // ========== 基本属性 ==========

  /**
   * 是否为根路径
   */
  get isRoot(): boolean {
    return this.segments.length === 0
  }

  /**
   * 路径深度（segments 数量）
   */
  get depth(): number {
    return this.segments.length
  }

  /**
   * 文件/目录名（最后一个 segment）
   */
  get name(): string {
    if (this.segments.length === 0) {
      return ''
    }
    return this.segments[this.segments.length - 1]
  }

  /**
   * 文件扩展名（不含点号）
   */
  get extension(): string {
    const name = this.name
    const lastDot = name.lastIndexOf('.')
    return lastDot > 0 ? name.slice(lastDot + 1) : ''
  }

  /**
   * 不带扩展名的文件名
   */
  get baseName(): string {
    const name = this.name
    const lastDot = name.lastIndexOf('.')
    return lastDot > 0 ? name.slice(0, lastDot) : name
  }

  // ========== 路径转换 ==========

  /**
   * 转换为规范化的字符串形式（始终以 / 开头，不以 / 结尾，除非是根路径）
   * 
   * @example
   * VfsPath.parse("/src/file.ts").toString() // "/src/file.ts"
   * VfsPath.root().toString()                // "/"
   */
  toString(): string {
    if (this._string === null) {
      if (this.segments.length === 0) {
        this._string = '/'
      } else {
        this._string = '/' + this.segments.join('/')
      }
    }
    return this._string
  }

  /**
   * 获取第 n 个 segment（支持负数索引）
   */
  at(index: number): string | undefined {
    const len = this.segments.length
    const idx = index < 0 ? len + index : index
    return idx >= 0 && idx < len ? this.segments[idx] : undefined
  }

  // ========== 路径操作 ==========

  /**
   * 获取父路径
   * 
   * @example
   * VfsPath.parse("/src/file.ts").parent() // "/src"
   * VfsPath.parse("/src").parent()         // "/"
   * VfsPath.root().parent()                // "/"
   */
  parent(): VfsPath {
    if (this.segments.length <= 1) {
      return VfsPath.root()
    }
    return new VfsPath(this.segments.slice(0, -1))
  }

  /**
   * 追加子路径
   * 
   * @example
   * VfsPath.parse("/src").append("file.ts")       // "/src/file.ts"
   * VfsPath.parse("/src").append("lib", "index.ts") // "/src/lib/index.ts"
   * VfsPath.root().append("src")                   // "/src"
   */
  append(...parts: string[]): VfsPath {
    const newSegments: string[] = [...this.segments]
    for (const part of parts) {
      // 支持传入包含 / 的路径片段
      const partSegments = part.split('/').filter(s => s.length > 0)
      newSegments.push(...partSegments)
    }
    return new VfsPath(newSegments)
  }

  /**
   * 连接另一个 VfsPath
   */
  join(other: VfsPath): VfsPath {
    return new VfsPath([...this.segments, ...other.segments])
  }

  /**
   * 获取前 n 个 segments
   */
  take(n: number): VfsPath {
    if (n <= 0) {
      return VfsPath.root()
    }
    return new VfsPath(this.segments.slice(0, n))
  }

  /**
   * 跳过前 n 个 segments
   */
  skip(n: number): VfsPath {
    if (n >= this.segments.length) {
      return VfsPath.root()
    }
    return new VfsPath(this.segments.slice(n))
  }

  // ========== 路径比较 ==========

  /**
   * 判断两个路径是否相等
   */
  equals(other: VfsPath): boolean {
    if (this.segments.length !== other.segments.length) {
      return false
    }
    for (let i = 0; i < this.segments.length; i++) {
      if (this.segments[i] !== other.segments[i]) {
        return false
      }
    }
    return true
  }

  /**
   * 判断当前路径是否是 base 的子路径（或相等）
   * 
   * @example
   * VfsPath.parse("/src/file.ts").isUnder(VfsPath.parse("/src"))  // true
   * VfsPath.parse("/src/file.ts").isUnder(VfsPath.parse("/src/file.ts")) // true (strict=false)
   * VfsPath.parse("/src").isUnder(VfsPath.parse("/src/file.ts")) // false
   * 
   * @param base 父路径
   * @param strict 如果为 true，则相等的路径返回 false
   */
  isUnder(base: VfsPath, strict: boolean = false): boolean {
    // 根路径是所有路径的祖先
    if (base.isRoot) {
      return strict ? !this.isRoot : true
    }

    // 子路径长度必须 >= 父路径长度
    if (strict) {
      if (this.segments.length <= base.segments.length) {
        return false
      }
    } else {
      if (this.segments.length < base.segments.length) {
        return false
      }
    }

    // 检查前缀是否匹配
    for (let i = 0; i < base.segments.length; i++) {
      if (this.segments[i] !== base.segments[i]) {
        return false
      }
    }

    return true
  }

  /**
   * 判断当前路径是否是 base 的直接子项
   * 
   * @example
   * VfsPath.parse("/src/file.ts").isDirectChildOf(VfsPath.parse("/src"))  // true
   * VfsPath.parse("/src/a/b.ts").isDirectChildOf(VfsPath.parse("/src"))   // false
   */
  isDirectChildOf(base: VfsPath): boolean {
    return this.segments.length === base.segments.length + 1 && this.isUnder(base, true)
  }

  /**
   * 获取相对于 base 的相对路径
   * 如果不是 base 的子路径，返回 null
   * 
   * @example
   * VfsPath.parse("/src/lib/index.ts").relativeTo(VfsPath.parse("/src")) 
   * // VfsPath with segments ["lib", "index.ts"]
   */
  relativeTo(base: VfsPath): VfsPath | null {
    if (!this.isUnder(base)) {
      return null
    }
    return new VfsPath(this.segments.slice(base.segments.length))
  }

  /**
   * 获取两个路径的公共祖先路径
   * 
   * @example
   * VfsPath.parse("/src/a/file.ts").commonAncestor(VfsPath.parse("/src/b/other.ts"))
   * // VfsPath with segments ["src"]
   */
  commonAncestor(other: VfsPath): VfsPath {
    const minLen = Math.min(this.segments.length, other.segments.length)
    const commonSegments: string[] = []
    
    for (let i = 0; i < minLen; i++) {
      if (this.segments[i] === other.segments[i]) {
        commonSegments.push(this.segments[i])
      } else {
        break
      }
    }
    
    return new VfsPath(commonSegments)
  }

  // ========== 实用方法 ==========

  /**
   * 迭代路径的每一级（从根到当前路径）
   * 
   * @example
   * for (const p of VfsPath.parse("/src/lib/index.ts").ancestors()) {
   *   console.log(p.toString())
   * }
   * // "/"
   * // "/src"
   * // "/src/lib"
   * // "/src/lib/index.ts"
   */
  *ancestors(): Generator<VfsPath, void, unknown> {
    yield VfsPath.root()
    for (let i = 1; i <= this.segments.length; i++) {
      yield new VfsPath(this.segments.slice(0, i))
    }
  }

  /**
   * 检查名称是否以点号开头（隐藏文件）
   */
  get isHidden(): boolean {
    return this.name.startsWith('.')
  }

  /**
   * 将文件名替换为新名称
   */
  withName(newName: string): VfsPath {
    if (this.isRoot) {
      return VfsPath.parse(newName)
    }
    return this.parent().append(newName)
  }

  /**
   * 替换扩展名
   */
  withExtension(newExt: string): VfsPath {
    const ext = newExt.startsWith('.') ? newExt.slice(1) : newExt
    const newName = ext ? `${this.baseName}.${ext}` : this.baseName
    return this.withName(newName)
  }
}

// ========== 兼容性工具函数 ==========

/**
 * 将字符串或 VfsPath 统一转换为 VfsPath
 */
export function toVfsPath(path: string | VfsPath): VfsPath {
  return typeof path === 'string' ? VfsPath.parse(path) : path
}

/**
 * 判断路径 a 是否在 b 下（字符串接口）
 */
export function isPathUnder(path: string, base: string, strict: boolean = false): boolean {
  return VfsPath.parse(path).isUnder(VfsPath.parse(base), strict)
}

/**
 * 获取相对路径（字符串接口）
 */
export function getPathRelativeTo(path: string, base: string): string | null {
  const relative = VfsPath.parse(path).relativeTo(VfsPath.parse(base))
  return relative ? relative.toString() : null
}

/**
 * 获取路径深度（字符串接口）
 */
export function getPathDepth(path: string): number {
  return VfsPath.parse(path).depth
}

/**
 * 路径连接（字符串接口）
 */
export function joinPath(...parts: string[]): string {
  if (parts.length === 0) {
    return '/'
  }
  
  let result = VfsPath.parse(parts[0])
  for (let i = 1; i < parts.length; i++) {
    result = result.append(parts[i])
  }
  return result.toString()
}
