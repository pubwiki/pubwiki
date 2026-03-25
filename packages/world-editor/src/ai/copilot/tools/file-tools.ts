/**
 * File Tools — list_workspace_files / get_workspace_file_content /
 * use_workspace_file_agent / get_workspace_image_content
 *
 * Provides AI access to user-uploaded workspace files.
 * Uses a `WorkspaceFileProvider` abstraction — the host app injects a
 * concrete implementation (e.g. VFS-backed in Studio).
 */

import { z } from 'zod'
import { defineTool, ChatStreamPipeline, type LLMConfig, type ContentPart } from '@pubwiki/chat'
import type { WorkspaceFileProvider } from '../../types'

// ============================================================================
// Helpers
// ============================================================================

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeFilenames(filename: string | string[]): string[] {
  return Array.isArray(filename) ? filename : [filename]
}

// ============================================================================
// Tool Factories
// ============================================================================

const filenameSchema = z.union([
  z.string().describe('单个文件名'),
  z.array(z.string()).describe('多个文件名列表'),
])

/**
 * list_workspace_files — List all uploaded workspace files.
 */
export function createListWorkspaceFilesTool(
  getProvider: () => WorkspaceFileProvider | null,
) {
  return defineTool({
    name: 'list_workspace_files',
    description: '列出用户上传的所有文件，返回文件名、类型和大小信息。',
    schema: z.object({}),
    handler: async () => {
      const provider = getProvider()
      if (!provider) return '⚠️ 文件存储未初始化。'

      const files = await provider.listFiles()
      if (files.length === 0) {
        return '📭 用户暂未上传任何文件。'
      }

      const lines = ['# 📂 Workspace Files', '']
      for (const f of files) {
        lines.push(`- \`${f.name}\` — ${f.type} (${formatFileSize(f.size)})`)
      }
      lines.push('')
      lines.push(`共 ${files.length} 个文件。`)
      lines.push('> 使用 `get_workspace_file_content(filename)` 读取文件内容。')
      lines.push('> 使用 `get_workspace_image_content(filename)` 查看图片。')
      return lines.join('\n')
    },
  })
}

/**
 * get_workspace_file_content — Read text file content.
 */
export function createGetWorkspaceFileContentTool(
  getProvider: () => WorkspaceFileProvider | null,
) {
  return defineTool({
    name: 'get_workspace_file_content',
    description:
      '读取用户上传的文件内容。支持单个文件或多个文件批量读取。对于图片文件，请改用 get_workspace_image_content。',
    schema: z.object({
      filename: filenameSchema.describe('要读取的文件名（支持单个或多个）'),
    }),
    handler: async ({ filename }) => {
      const provider = getProvider()
      if (!provider) return '⚠️ 文件存储未初始化。'

      const names = normalizeFilenames(filename)
      const results: string[] = []

      for (const name of names) {
        if (isImageFile(name)) {
          results.push(`### ${name}\n⚠️ 这是图片文件，请使用 \`get_workspace_image_content("${name}")\` 查看。`)
          continue
        }

        const content = await provider.readTextFile(name)
        if (content === null) {
          results.push(`### ${name}\n❌ 文件未找到。`)
          continue
        }

        // Truncate very long files
        const MAX_CHARS = 2000
        if (content.length > MAX_CHARS) {
          results.push(
            `### ${name}\n\`\`\`\n${content.slice(0, MAX_CHARS)}\n\`\`\`\n` +
              `⚠️ 文件较长（${content.length} 字符），已截断显示前 ${MAX_CHARS} 字符。` +
              `如需完整处理，请使用 \`use_workspace_file_agent\`。`,
          )
        } else {
          results.push(`### ${name}\n\`\`\`\n${content}\n\`\`\``)
        }
      }

      return results.join('\n\n')
    },
  })
}

/**
 * use_workspace_file_agent — Invoke a secondary model to process file content.
 */
export function createUseWorkspaceFileAgentTool(
  getProvider: () => WorkspaceFileProvider | null,
  getSubAgentConfig: () => LLMConfig | null,
) {
  return defineTool({
    name: 'use_workspace_file_agent',
    description:
      '调用次级模型对指定的上传文件执行操作，如提取信息、总结内容、转换格式等。支持单个或多个文件（含图片）。',
    schema: z.object({
      filename: filenameSchema.describe('要处理的文件名（支持单个或多个）'),
      instruction: z.string().describe('给次级模型的指令'),
    }),
    handler: async ({ filename, instruction }) => {
      const provider = getProvider()
      if (!provider) return '⚠️ 文件存储未初始化。'

      const subConfig = getSubAgentConfig()
      if (!subConfig) return '⚠️ 次级模型未配置。'

      const names = normalizeFilenames(filename)

      // Separate text and image files
      const textParts: string[] = []
      const imageDataUrls: string[] = []

      for (const name of names) {
        if (isImageFile(name)) {
          const dataUrl = await provider.readImageAsDataUrl(name)
          if (dataUrl) imageDataUrls.push(dataUrl)
          else textParts.push(`[图片 "${name}" 未找到]`)
        } else {
          const content = await provider.readTextFile(name)
          if (content) textParts.push(`=== ${name} ===\n${content}`)
          else textParts.push(`[文件 "${name}" 未找到]`)
        }
      }

      // Build messages for the sub-agent call
      const contentParts: ContentPart[] = []

      if (textParts.length > 0) {
        contentParts.push({ type: 'text', text: textParts.join('\n\n') })
      }
      for (const dataUrl of imageDataUrls) {
        contentParts.push({ type: 'image_url', image_url: { url: dataUrl } })
      }

      if (contentParts.length === 0) {
        return '❌ 未能读取任何文件。'
      }

      // Add the instruction as a text part
      contentParts.push({ type: 'text', text: `\n\n---\n指令：${instruction}` })

      const pipeline = new ChatStreamPipeline({
        model: subConfig.model ?? '',
        apiKey: subConfig.apiKey ?? '',
        baseUrl: subConfig.baseUrl,
        temperature: subConfig.temperature,
        maxTokens: subConfig.maxTokens,
      })

      let result = ''
      for await (const event of pipeline.stream([
        {
          role: 'system' as const,
          content: '你是一个文档处理助手，根据用户的指令处理给定的文档内容（包括图片）。请直接给出结果。',
        },
        {
          role: 'user' as const,
          content: contentParts,
        },
      ])) {
        if (event.type === 'token') {
          result += event.token
        }
      }

      return result || '⚠️ 次级模型未返回结果。'
    },
  })
}

/**
 * get_workspace_image_content — Attach images to the conversation context.
 */
export function createGetWorkspaceImageContentTool(
  getProvider: () => WorkspaceFileProvider | null,
) {
  return defineTool({
    name: 'get_workspace_image_content',
    description:
      '获取工作区中图片文件的内容，使其在对话中可见。调用此工具后，图片将附加到后续消息中供你直接查看和分析。支持单个或多个图片。',
    schema: z.object({
      filename: filenameSchema.describe('要查看的图片文件名（支持单个或多个）'),
    }),
    handler: async ({ filename }) => {
      const provider = getProvider()
      if (!provider) return '⚠️ 文件存储未初始化。'

      const names = normalizeFilenames(filename)
      const results: string[] = []

      for (const name of names) {
        if (!isImageFile(name)) {
          results.push(`⚠️ "${name}" 不是图片文件，请使用 \`get_workspace_file_content\` 读取。`)
          continue
        }

        const dataUrl = await provider.readImageAsDataUrl(name)
        if (!dataUrl) {
          results.push(`❌ 图片 "${name}" 未找到。`)
          continue
        }

        const mime = provider.getMimeType(name)
        results.push(`✅ 图片 "${name}" (${mime}) 已附加到对话上下文中。`)
      }

      return results.join('\n')
    },
  })
}
