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

/** Read a VFS file and decode to string */
async function readFileText(vfs: Vfs, filePath: string): Promise<string | null> {
  try {
    const file = await vfs.readFile(filePath)
    if (typeof file.content === 'string') return file.content
    if (file.content instanceof ArrayBuffer) return new TextDecoder().decode(file.content)
    return null
  } catch {
    return null
  }
}

/** Format file content with line numbers */
function formatWithLineNumbers(content: string, startLine = 1): string {
  const lines = content.split('\n')
  const maxLineNo = startLine + lines.length - 1
  const pad = String(maxLineNo).length
  return lines
    .map((line, i) => `${String(startLine + i).padStart(pad)} | ${line}`)
    .join('\n')
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
 * read_frontend_file — Read a file from the Frontend VFS with optional line range.
 */
export function createReadFrontendFileTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'read_frontend_file',
    description:
      '读取前端项目中的文件内容（UTF-8 文本）。输出带行号。可用 startLine/endLine 指定行范围（1-based，闭区间）。',
    schema: z.object({
      path: z.string().describe('文件路径，如 "/src/App.tsx"'),
      startLine: z.number().optional().describe('起始行号（1-based），省略则从第 1 行开始'),
      endLine: z.number().optional().describe('结束行号（1-based，包含），省略则到末尾'),
    }),
    handler: async ({ path, startLine, endLine }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const filePath = normalizePath(path)
      const content = await readFileText(vfs, filePath)
      if (content === null) return `❌ File not found or binary: ${filePath}`

      const allLines = content.split('\n')
      const totalLines = allLines.length

      // Resolve range (1-based inclusive)
      const start = Math.max(1, startLine ?? 1)
      const end = Math.min(totalLines, endLine ?? totalLines)
      if (start > end) return `❌ Invalid range: startLine=${start} > endLine=${end} (file has ${totalLines} lines)`

      const slice = allLines.slice(start - 1, end)
      const numbered = formatWithLineNumbers(slice.join('\n'), start)

      const rangeLabel = (startLine || endLine)
        ? ` (lines ${start}-${end} of ${totalLines})`
        : ` (${totalLines} lines)`

      // Truncate if too long
      const MAX_CHARS = 12000
      if (numbered.length > MAX_CHARS) {
        return (
          `### ${filePath}${rangeLabel}\n\`\`\`\n${numbered.slice(0, MAX_CHARS)}\n\`\`\`\n` +
          `⚠️ Output truncated. Use startLine/endLine to read smaller ranges.`
        )
      }
      return `### ${filePath}${rangeLabel}\n\`\`\`\n${numbered}\n\`\`\``
    },
  })
}

/**
 * write_frontend_file — Write/overwrite a file (or a line range) in the Frontend VFS.
 */
export function createWriteFrontendFileTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'write_frontend_file',
    description:
      '写入或覆盖前端项目中的文件。支持两种模式：\n' +
      '1. 全量写入：只提供 path 和 content，覆盖整个文件。\n' +
      '2. 行范围替换：提供 startLine 和 endLine（1-based，闭区间），用 content 替换指定行。\n' +
      '父目录会自动创建。写入后 sandbox 会自动热更新。',
    schema: z.object({
      path: z.string().describe('文件路径，如 "/src/components/MyComponent.tsx"'),
      content: z.string().describe('文件内容（全量写入时为完整源码，行范围替换时为替换内容）'),
      startLine: z.number().optional().describe('替换起始行号（1-based）。省略则全量写入。'),
      endLine: z.number().optional().describe('替换结束行号（1-based，包含）。省略则全量写入。'),
    }),
    handler: async ({ path, content, startLine, endLine }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const filePath = normalizePath(path)
      if (filePath.startsWith('/lib/')) {
        return '❌ /lib/ is read-only (contains platform libraries). Write files under /src/ instead.'
      }

      try {
        // Line-range replacement mode
        if (startLine !== undefined && endLine !== undefined) {
          const existing = await readFileText(vfs, filePath)
          if (existing === null) return `❌ File not found: ${filePath} (line-range mode requires existing file)`

          const lines = existing.split('\n')
          if (startLine < 1 || endLine < startLine || startLine > lines.length) {
            return `❌ Invalid range: startLine=${startLine}, endLine=${endLine} (file has ${lines.length} lines)`
          }

          const newLines = content.split('\n')
          // Replace lines [startLine-1 .. endLine-1] (inclusive) with newLines
          const clampedEnd = Math.min(endLine, lines.length)
          lines.splice(startLine - 1, clampedEnd - startLine + 1, ...newLines)

          const finalContent = lines.join('\n')
          await vfs.updateFile(filePath, finalContent)
          return `✅ Replaced lines ${startLine}-${clampedEnd} in ${filePath} with ${newLines.length} line(s). File now has ${lines.length} lines.`
        }

        // Full-file write mode
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

/**
 * search_frontend_files — Search for a string or regex across all files.
 */
export function createSearchFrontendFilesTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'search_frontend_files',
    description:
      '在前端项目的所有文本文件中搜索字符串或正则表达式。返回匹配的文件路径、行号和行内容。',
    schema: z.object({
      query: z.string().describe('搜索字符串或正则表达式'),
      isRegex: z.boolean().optional().describe('是否作为正则表达式匹配，默认 false'),
      path: z.string().optional().describe('限定搜索目录，默认 "/"'),
      maxResults: z.number().optional().describe('最大匹配条数，默认 50'),
    }),
    handler: async ({ query, isRegex, path, maxResults }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available.'

      const searchDir = normalizePath(path ?? '/')
      const limit = Math.min(maxResults ?? 50, 200)

      // Build matcher
      let regex: RegExp
      try {
        regex = isRegex ? new RegExp(query, 'gi') : new RegExp(escapeRegExp(query), 'gi')
      } catch (e) {
        return `❌ Invalid regex: ${(e as Error).message}`
      }

      // Collect all files
      const allFiles = await listRecursive(vfs, searchDir, 10)
      const textFiles = allFiles.filter(f => !f.endsWith('/'))

      const matches: string[] = []
      let totalMatches = 0

      for (const filePath of textFiles) {
        if (totalMatches >= limit) break

        const content = await readFileText(vfs, filePath)
        if (content === null) continue

        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= limit) break
          regex.lastIndex = 0
          if (regex.test(lines[i])) {
            matches.push(`${filePath}:${i + 1}: ${lines[i].trimEnd()}`)
            totalMatches++
          }
        }
      }

      if (matches.length === 0) {
        return `🔍 No matches for "${query}" in ${searchDir}`
      }

      const header = `🔍 ${totalMatches} match(es) for "${query}" in ${searchDir}`
      const truncated = totalMatches >= limit ? `\n⚠️ Results capped at ${limit}. Narrow your search or specify a path.` : ''
      return `${header}\n\n${matches.join('\n')}${truncated}`
    },
  })
}

/** Escape special regex characters in a plain string */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
