/**
 * Bundle Options Types
 *
 * Configuration options for esbuild bundling.
 */

/**
 * Bundle options for esbuild
 */
export interface BundleOptions {
  /** Enable minification */
  minify?: boolean
  /** Generate source maps */
  sourcemap?: boolean | 'inline' | 'external'
  /** Target environment (e.g., 'es2020', 'esnext') */
  target?: string
  /** Output format */
  format?: 'esm' | 'cjs' | 'iife'
  /** External packages (not bundled) */
  external?: string[]
  /** Additional define replacements */
  define?: Record<string, string>
  /** JSX mode */
  jsx?: 'transform' | 'preserve' | 'automatic' | 'classic'
  /** JSX import source for automatic mode */
  jsxImportSource?: string
  /** Enable tree shaking */
  treeShaking?: boolean
  /**
   * Development mode.
   * When true:
   * - Sets process.env.NODE_ENV to 'development' (unless explicitly overridden in define)
   * - Fetches development builds from CDN (e.g. esm.sh?dev) for better error messages
   * - Disables minification
   */
  development?: boolean
}
