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
}
