/**
 * Skill Tools — list_skills / get_skill_content
 *
 * Provides read-only access to built-in skills and user-defined skills.
 * Tracks which skills have been read for Skill-First guard enforcement.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import type { SkillListItem } from '../../types'
import { BUILTIN_SKILLS, getBuiltinSkillContent } from '../prompts/skills'
import { markSkillRead } from './state-tools'

// ============================================================================
// Skill Provider Interface
// ============================================================================

/**
 * Interface for providing user-defined skills.
 * The orchestrator injects an implementation of this.
 */
export interface SkillProvider {
  /** Get all user-defined skills */
  getUserSkills(): SkillListItem[]
  /** Get content of a user-defined skill by ID */
  getUserSkillContent(id: string): string | null
}

/** No-op provider for when user skills are not available */
const EMPTY_SKILL_PROVIDER: SkillProvider = {
  getUserSkills: () => [],
  getUserSkillContent: () => null,
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * list_skills — List all available skills (built-in + user-defined).
 */
export function createListSkillsTool(provider: SkillProvider = EMPTY_SKILL_PROVIDER) {
  return defineTool({
    name: 'list_skills',
    description: '列出所有可用的技能文档（内置指南 + 用户自定义）。',
    schema: z.object({}),
    handler: async () => {
      const builtIn = BUILTIN_SKILLS
      const userSkills = provider.getUserSkills()

      const lines = ['# 📚 Available Skills']

      lines.push('\n## Built-in Skills (⭐ = recommended first read)')
      for (const s of builtIn) {
        const star = s.id.includes('schema') ? ' ⭐' : ''
        lines.push(`- \`${s.id}\`${star} — ${s.description}`)
      }

      if (userSkills.length > 0) {
        lines.push('\n## User Skills')
        for (const s of userSkills) {
          lines.push(`- \`${s.id}\` — ${s.description || s.title}`)
        }
      }

      lines.push('\n> Use `get_skill_content(id)` to read a skill\'s full content.')
      return lines.join('\n')
    },
  })
}

/**
 * get_skill_content — Read a skill's full content.
 * Also tracks which skills have been read for Skill-First guard.
 */
export function createGetSkillContentTool(provider: SkillProvider = EMPTY_SKILL_PROVIDER) {
  return defineTool({
    name: 'get_skill_content',
    description: '读取指定技能文档的完整内容。用于在执行任务前学习相关知识。',
    schema: z.object({
      id: z.string().describe('Skill ID'),
    }),
    handler: async ({ id }) => {
      // Try built-in first
      const builtinContent = getBuiltinSkillContent(id)
      if (builtinContent) {
        markSkillRead(id)
        return builtinContent
      }

      // Try user-defined
      const userContent = provider.getUserSkillContent(id)
      if (userContent) {
        markSkillRead(id)
        return userContent
      }

      return `错误: 找不到技能 "${id}"。使用 list_skills() 查看所有可用技能。`
    },
  })
}
