/**
 * Frontend VFS File Tools for the Designer Agent
 *
 * Provides AI access to the Frontend VFS — the actual React source code
 * that runs in the sandbox iframe. Supports full path-based file operations.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import { type Vfs, isVfsFolder } from '@pubwiki/vfs'

// ============================================================================
// Types
// ============================================================================

/** Lazy getter for the Frontend VFS (may not be available immediately) */
export type FrontendVfsGetter = () => Vfs | null

// ============================================================================
// Helpers
// ============================================================================

function normalizePath(path: string): string {
  // Ensure leading slash
  if (!path.startsWith('/')) path = '/' + path
  // Remove trailing slash (unless root)
  if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

async function listRecursive(
  vfs: Vfs,
  dirPath: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await vfs.listFolder(dirPath)
    for (const entry of entries) {
      const fullPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`
      if (isVfsFolder(entry)) {
        results.push(fullPath + '/')
        if (currentDepth < maxDepth) {
          const children = await listRecursive(vfs, fullPath, maxDepth, currentDepth + 1)
          results.push(...children)
        }
      } else {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory may not exist
  }
  return results
}

// ============================================================================
// Tool Factories
// ============================================================================

/**
 * list_frontend_files — List files and directories in the Frontend VFS.
 */
export function createListFrontendFilesTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'list_frontend_files',
    description:
      '列出前端项目中的文件和目录。可指定路径和深度。',
    schema: z.object({
      path: z.string().optional().describe('目录路径，默认为 "/"'),
      depth: z.number().optional().describe('递归深度，默认为 2'),
    }),
    handler: async ({ path, depth }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const dirPath = normalizePath(path ?? '/')
      const maxDepth = Math.min(depth ?? 2, 5) // Cap at 5 to avoid excessive listing

      const files = await listRecursive(vfs, dirPath, maxDepth)
      if (files.length === 0) {
        return `📭 No files found in ${dirPath}`
      }

      const lines = [`# 📂 Frontend Files (${dirPath})`, '']
      for (const f of files) {
        lines.push(`- ${f}`)
      }
      lines.push('')
      lines.push(`Total: ${files.length} items`)
      return lines.join('\n')
    },
  })
}

/**
 * read_frontend_file — Read a file from the Frontend VFS.
 */
export function createReadFrontendFileTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'read_frontend_file',
    description:
      '读取前端项目中的文件内容（UTF-8 文本）。',
    schema: z.object({
      path: z.string().describe('文件路径，如 "/src/App.tsx"'),
    }),
    handler: async ({ path }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const filePath = normalizePath(path)
      try {
        const file = await vfs.readFile(filePath)
        let content: string
        if (typeof file.content === 'string') {
          content = file.content
        } else if (file.content instanceof ArrayBuffer) {
          content = new TextDecoder().decode(file.content)
        } else {
          return `❌ Cannot read binary file: ${filePath}`
        }

        // Truncate very long files
        const MAX_CHARS = 8000
        if (content.length > MAX_CHARS) {
          return (
            `### ${filePath}\n\`\`\`\n${content.slice(0, MAX_CHARS)}\n\`\`\`\n` +
            `⚠️ File truncated (${content.length} chars total, showing first ${MAX_CHARS}).`
          )
        }
        return `### ${filePath}\n\`\`\`\n${content}\n\`\`\``
      } catch {
        return `❌ File not found: ${filePath}`
      }
    },
  })
}

/**
 * write_frontend_file — Write/overwrite a file in the Frontend VFS.
 */
export function createWriteFrontendFileTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'write_frontend_file',
    description:
      '写入或覆盖前端项目中的文件。父目录会自动创建。写入后 sandbox 会自动热更新。',
    schema: z.object({
      path: z.string().describe('文件路径，如 "/src/components/MyComponent.tsx"'),
      content: z.string().describe('文件内容（完整源码）'),
    }),
    handler: async ({ path, content }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const filePath = normalizePath(path)
      if (filePath.startsWith('/lib/')) {
        return '❌ /lib/ is read-only (contains platform libraries). Write files under /src/ instead.'
      }
      try {
        const exists = await vfs.exists(filePath)
        if (exists) {
          await vfs.updateFile(filePath, content)
        } else {
          await vfs.createFile(filePath, content)
        }
        return `✅ Written: ${filePath} (${content.length} chars)`
      } catch (e) {
        return `❌ Failed to write ${filePath}: ${(e as Error).message}`
      }
    },
  })
}

/**
 * delete_frontend_file — Delete a file from the Frontend VFS.
 */
export function createDeleteFrontendFileTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'delete_frontend_file',
    description:
      '删除前端项目中的文件。',
    schema: z.object({
      path: z.string().describe('要删除的文件路径'),
    }),
    handler: async ({ path }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const filePath = normalizePath(path)
      if (filePath.startsWith('/lib/')) {
        return '❌ /lib/ is read-only (contains platform libraries). Only delete files under /src/.'
      }
      try {
        const exists = await vfs.exists(filePath)
        if (!exists) {
          return `⚠️ File does not exist: ${filePath}`
        }
        await vfs.deleteFile(filePath)
        return `✅ Deleted: ${filePath}`
      } catch (e) {
        return `❌ Failed to delete ${filePath}: ${(e as Error).message}`
      }
    },
  })
}
