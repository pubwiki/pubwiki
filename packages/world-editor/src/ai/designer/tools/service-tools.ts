/**
 * Backend Service Discovery Tools for the Designer Agent
 *
 * Provides convenient access to backend service type definitions
 * (auto-generated from Lua service definitions into the docs VFS).
 * Both tools read from /lib/game-sdk/generated/services.d.ts.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import type { Vfs } from '@pubwiki/vfs'
import type { FrontendVfsGetter } from './frontend-file-tools'

// ============================================================================
// Constants
// ============================================================================

const SERVICES_DTS_PATH = '/lib/game-sdk/generated/services.d.ts'

// ============================================================================
// Helpers
// ============================================================================

async function readFileText(vfs: Vfs, path: string): Promise<string | null> {
  try {
    const file = await vfs.readFile(path)
    if (typeof file.content === 'string') return file.content
    if (file.content instanceof ArrayBuffer) return new TextDecoder().decode(file.content)
    return null
  } catch {
    return null
  }
}

/** Parse service entries from the Services interface in services.d.ts */
function parseServiceEntries(content: string): { identifier: string; jsDoc: string; block: string; kind: string; streaming: boolean }[] {
  const entries: { identifier: string; jsDoc: string; block: string; kind: string; streaming: boolean }[] = []
  const lines = content.split('\n')

  let i = 0
  while (i < lines.length) {
    // Look for JSDoc + service entry: /** desc */ \n  'ns:Name': {
    let jsDoc = ''
    if (lines[i].trim().startsWith('/**') && lines[i].trim().endsWith('*/')) {
      jsDoc = lines[i].trim().replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, '')
      i++
    }

    const match = lines[i]?.match(/^\s+'([^']+)':\s*\{/)
    if (match && match[1].includes(':')) {
      const svcId = match[1]
      const blockStart = i
      let depth = 1
      i++
      while (i < lines.length && depth > 0) {
        for (const ch of lines[i]) {
          if (ch === '{') depth++
          if (ch === '}') depth--
        }
        i++
      }
      const block = lines.slice(blockStart, i).join('\n')
      const kind = block.match(/kind:\s*'(\w+)'/)?.[1] ?? 'ACTION'
      const streaming = block.includes("streaming: true")
      entries.push({ identifier: svcId, jsDoc, block, kind, streaming })
      continue
    }
    i++
  }
  return entries
}

// ============================================================================
// Tool Factories
// ============================================================================

/**
 * list_backend_services — List available backend services from services.d.ts.
 */
export function createListBackendServicesTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'list_backend_services',
    description:
      '列出可用的后端服务，包括服务标识符、描述和调用方式（普通/流式）。' +
      '可选 query 参数按关键字过滤（大小写不敏感）。',
    schema: z.object({
      query: z.string().optional().describe('可选的搜索关键字，过滤服务名称或描述（大小写不敏感）'),
    }),
    handler: async ({ query }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available. Services not yet loaded.'

      const content = await readFileText(vfs, SERVICES_DTS_PATH)
      if (content === null) {
        return '⚠️ Service type definitions not generated yet. Wait for the Loader to finish initializing.'
      }

      let entries = parseServiceEntries(content)
      if (entries.length === 0) {
        return '⚠️ No services found in services.d.ts.'
      }

      // Filter if query provided
      if (query) {
        const q = query.toLowerCase()
        entries = entries.filter(e =>
          e.identifier.toLowerCase().includes(q) || e.jsDoc.toLowerCase().includes(q)
        )
        if (entries.length === 0) {
          return `🔍 No services matching "${query}".`
        }
      }

      const rows = entries.map(e => {
        const stream = e.streaming ? '✓' : '—'
        const desc = e.jsDoc || '—'
        return `| \`${e.identifier}\` | ${e.kind} | ${stream} | ${desc} |`
      })

      const filterNote = query ? ` (filtered by "${query}")` : ''
      return [
        `# Available Backend Services${filterNote}`,
        '',
        '| Service ID | Kind | Streaming | Description |',
        '|------------|------|-----------|-------------|',
        ...rows,
        '',
        'Use `get_service_definition(identifier)` to see the full TypeScript type definition for a specific service.',
      ].join('\n')
    },
  })
}

/**
 * get_service_definition — Get the TypeScript type definition for a specific backend service.
 */
export function createGetServiceDefinitionTool(getVfs: FrontendVfsGetter) {
  return defineTool({
    name: 'get_service_definition',
    description:
      '获取指定后端服务的完整 TypeScript 类型定义，包括输入参数类型、输出类型和调用方式。' +
      '在调用 usePub() 的服务之前，务必先使用此工具了解参数结构。' +
      '支持按服务名搜索（如 "CreativeWritingStream"）或完整标识符（如 "GameTemplate:CreativeWritingStream"）。',
    schema: z.object({
      identifier: z.string().describe(
        '服务名称或标识符。可以是完整标识符如 "GameTemplate:CreativeWritingStream"，' +
        '也可以是部分名称如 "CreativeWriting"（模糊匹配）'
      ),
    }),
    handler: async ({ identifier }) => {
      const vfs = getVfs()
      if (!vfs) return '⚠️ Frontend VFS not available. Services not yet loaded.'

      const content = await readFileText(vfs, SERVICES_DTS_PATH)
      if (content === null) {
        return '⚠️ Service type definitions not generated yet. Wait for the Loader to finish initializing.'
      }

      const search = identifier.toLowerCase()
      const entries = parseServiceEntries(content)

      const matching = entries.filter(e => e.identifier.toLowerCase().includes(search))

      if (matching.length === 0) {
        const available = entries.map(e => e.identifier).join(', ')
        return `❌ No service found matching "${identifier}".\n\nAvailable services: ${available}`
      }

      const lines = content.split('\n')
      const results: string[] = []
      for (const entry of matching) {
        const svcName = entry.identifier.split(':')[1] || entry.identifier
        results.push(`## ${entry.identifier}\n`)
        results.push('### Type Definition (from Services interface)')
        results.push('```typescript')
        results.push(entry.block)
        results.push('```')

        // Find the service interface (e.g. "export interface CreativeWritingStreamService {")
        const interfacePattern = `export interface ${pascalCase(svcName)}Service {`
        const ifaceStart = lines.findIndex(l => l.includes(interfacePattern))
        if (ifaceStart !== -1) {
          let ifaceEnd = ifaceStart + 1
          while (ifaceEnd < lines.length && !lines[ifaceEnd].startsWith('}')) {
            ifaceEnd++
          }
          ifaceEnd++ // include closing brace
          results.push('')
          results.push('### Service Interface')
          results.push('```typescript')
          results.push(lines.slice(ifaceStart, ifaceEnd).join('\n'))
          results.push('```')
        }

        results.push('')
      }

      return results.join('\n')
    },
  })
}

function pascalCase(s: string): string {
  return s.replace(/(^|[_-])([a-zA-Z])/g, (_, __, c) => c.toUpperCase())
}
