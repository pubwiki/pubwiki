/**
 * Memory Tools — list_memories / get_memory_content / save_memory / delete_memory
 *
 * Provides AI access to persistent WorkingMemory for storing plans,
 * progress notes, and other context across turns.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import type { MemoryStore } from '../../services/memory-store'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * list_memories — List all working memory entries.
 */
export function createListMemoriesTool(getStore: () => MemoryStore | null) {
  return defineTool({
    name: 'list_memories',
    description:
      '列出所有工作记忆条目。用于回顾之前记录的计划、进度和上下文信息。',
    schema: z.object({}),
    handler: async () => {
      const store = getStore()
      if (!store) return '⚠️ 记忆存储未初始化。'

      const entries = await store.list()
      if (entries.length === 0) {
        return '📭 暂无工作记忆。使用 `save_memory` 来记录计划和进度。'
      }

      const lines = ['# 📝 Working Memories', '']
      for (const entry of entries) {
        const date = new Date(entry.updatedAt).toLocaleString()
        lines.push(`- \`${entry.id}\` — **${entry.title}** (updated: ${date})`)
      }
      lines.push('')
      lines.push('> Use `get_memory_content(id)` to read a memory\'s full content.')
      return lines.join('\n')
    },
  })
}

/**
 * get_memory_content — Read a memory entry's full content.
 */
export function createGetMemoryContentTool(getStore: () => MemoryStore | null) {
  return defineTool({
    name: 'get_memory_content',
    description: '读取指定工作记忆的完整内容。',
    schema: z.object({
      id: z.string().describe('Memory entry ID'),
    }),
    handler: async ({ id }) => {
      const store = getStore()
      if (!store) return '⚠️ 记忆存储未初始化。'

      const entry = await store.get(id)
      if (!entry) return `❌ 找不到记忆 "${id}"。使用 list_memories() 查看所有记忆。`

      return [
        `# 📝 ${entry.title}`,
        `> ID: ${entry.id} | Updated: ${new Date(entry.updatedAt).toLocaleString()}`,
        '',
        entry.content,
      ].join('\n')
    },
  })
}

/**
 * save_memory — Create or update a working memory entry.
 */
export function createSaveMemoryTool(getStore: () => MemoryStore | null) {
  return defineTool({
    name: 'save_memory',
    description:
      '保存工作记忆。用于记录计划、任务进度、重要发现等。如果 ID 已存在则更新。',
    schema: z.object({
      id: z.string().describe('Unique memory ID (e.g. "plan", "progress", "findings")'),
      title: z.string().describe('Human-readable title'),
      content: z.string().describe('Full content of the memory entry (markdown supported)'),
    }),
    handler: async ({ id, title, content }) => {
      const store = getStore()
      if (!store) return '⚠️ 记忆存储未初始化。'

      await store.save(id, title, content)
      return `✅ 记忆 "${title}" 已保存 (ID: ${id})。`
    },
  })
}

/**
 * delete_memory — Remove a working memory entry.
 */
export function createDeleteMemoryTool(getStore: () => MemoryStore | null) {
  return defineTool({
    name: 'delete_memory',
    description: '删除指定的工作记忆条目。',
    schema: z.object({
      id: z.string().describe('Memory entry ID to delete'),
    }),
    handler: async ({ id }) => {
      const store = getStore()
      if (!store) return '⚠️ 记忆存储未初始化。'

      const entry = await store.get(id)
      if (!entry) return `❌ 找不到记忆 "${id}"。`

      await store.delete(id)
      return `🗑️ 记忆 "${entry.title}" 已删除。`
    },
  })
}
