/**
 * Context Prefix — Migrated from copilotPrompt.ts
 *
 * Strict verbatim migration per §4.3 of the migration plan.
 * generateUserMessagePrefix(), USER_MESSAGE_BASE, COT_SUFFIX — no changes.
 */

import type { SkillListItem, MemoryListItem, WorkspaceFileInfo } from '../../types'

// ============================================================================
// Base Reminder
// ============================================================================

/**
 * Base reminder template for user messages
 */
const USER_MESSAGE_BASE =
`**Quick Reminder**:
- **Think before acting** — For complex tasks, analyze first, make a plan, confirm with the user, then execute
- **Execute step by step** — Report progress to the user after each step, don't do everything at once
- **Use WorkingMemory** — Record plans and progress with \`save_memory()\`
- **Ask the user often** — Ask when uncertain, confirm the approach before complex operations
- **Check before modifying** — Use \`get_state_content()\` to check current values, use \`check_state_error()\` to validate`

/**
 * Static prefix for backward compatibility
 */
export const USER_MESSAGE_PREFIX =
`---
${USER_MESSAGE_BASE}
---

`

// ============================================================================
// CoT Suffix
// ============================================================================

/**
 * Pseudo Chain-of-Thought suffix — appended to the first user message only.
 */
export const COT_SUFFIX = '\n\n---\n🧠 在回复之前，请先在心里回答以下问题（不需要输出这些问题本身）：\n' +
  '1. 用户想要什么？我需要做几步？\n' +
  '2. 有没有需要先用工具了解的信息？\n' +
  '3. 我应该先向用户确认什么？\n' +
  '请先简要说明你的理解和计划，再开始行动。\n---'

// ============================================================================
// Dynamic Prefix Generation
// ============================================================================

/**
 * Generate dynamic user message prefix with skills, memories, and workspace files.
 * @param skills - List of available skills
 * @param memories - List of working memories
 * @param workspaceFiles - List of workspace files (optional)
 * @returns Formatted prefix string
 */
export function generateUserMessagePrefix(
  skills: SkillListItem[],
  memories: MemoryListItem[],
  workspaceFiles?: WorkspaceFileInfo[],
): string {
  const lines: string[] = ['---']

  // Add workspace files section if any
  if (workspaceFiles && workspaceFiles.length > 0) {
    lines.push('**Workspace Files** (use `get_workspace_file_content(filename)` or `use_workspace_file_agent(filename, instruction)`):')
    for (const file of workspaceFiles.slice(0, 10)) {
      const sizeStr = file.size < 1024
        ? `${file.size}B`
        : file.size < 1024 * 1024
          ? `${(file.size / 1024).toFixed(1)}KB`
          : `${(file.size / 1024 / 1024).toFixed(1)}MB`
      if (file.type === 'image') {
        lines.push(`- \`${file.name}\` (image, ${sizeStr}) — Use \`get_workspace_image_content\` or \`use_workspace_file_agent\` to view`)
      } else {
        lines.push(`- \`${file.name}\` (${file.type}, ${sizeStr})`)
      }
    }
    if (workspaceFiles.length > 10) {
      lines.push(`  ... and ${workspaceFiles.length - 10} more files`)
    }
    lines.push('')

    // Skill-First trigger when files are uploaded
    lines.push('> **SKILL-FIRST**: Files detected! Before processing, read relevant Skills:')
    lines.push('> `list_skills()` then `get_skill_content("workflow")`')
    lines.push('')
  }

  // Add skills section
  if (skills.length > 0) {
    const builtIn = skills.filter((s) => s.isBuiltIn)
    const userDefined = skills.filter((s) => !s.isBuiltIn)

    lines.push('**Available Skills** (use `get_skill_content(id)` to learn):')

    if (builtIn.length > 0) {
      lines.push('')
      lines.push('**Built-in Skills:**')
      for (const s of builtIn) {
        const emphasis = s.id.includes('schema') || s.id.includes('quickstart') || s.id.includes('template') ? ' ⭐' : ''
        lines.push(`- \`${s.id}\`${emphasis} - ${s.description || s.title}`)
      }
    }

    if (userDefined.length > 0) {
      lines.push('')
      lines.push('**User Skills:**')
      for (const s of userDefined.slice(0, 5)) {
        lines.push(`- \`${s.id}\` - ${s.description || s.title}`)
      }
      if (userDefined.length > 5) {
        lines.push(`  ... and ${userDefined.length - 5} more (use \`list_skills()\` to see all)`)
      }
    }
    lines.push('')
  }

  // Add working memory section
  if (memories.length > 0) {
    lines.push('**Working Memory** (context from previous work):')
    for (const m of memories.slice(0, 5)) {
      lines.push(`- \`${m.id}\` - ${m.title}`)
    }
    if (memories.length > 5) {
      lines.push(`  ... and ${memories.length - 5} more (use \`list_memories()\` to see all)`)
    }
    lines.push('')
    lines.push('> Review relevant memories with `get_memory_content(id)` to resume previous work')
    lines.push('')
  }

  // Add base reminder
  lines.push(USER_MESSAGE_BASE)
  lines.push('---')
  lines.push('')

  return lines.join('\n')
}
