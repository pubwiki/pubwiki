/**
 * State Tools — get_state_overview / get_state_content / update_state / check_state_error
 *
 * These are the core tools for AI to read and modify the game state.
 * Uses `defineTool()` from @pubwiki/chat for type-safe tool registration.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import type { WorldEditorAIContext } from '../../types'
import {
  generateStateOverview,
  getByPath,
  executeUpdateState,
  validateFullState,
  formatValidationWarnings,
} from '../../state-bridge'

// ============================================================================
// Skill-First guard
// ============================================================================

/** Track which skills the AI has read in this session */
const _readSkillIds = new Set<string>()

/** Record that a skill has been read (called from skill-tools) */
export function markSkillRead(skillId: string): void {
  _readSkillIds.add(skillId)
}

/** Check if a skill has been read */
export function hasReadSkill(skillId: string): boolean {
  return _readSkillIds.has(skillId)
}

/** Reset skill tracking (call when starting a new session) */
export function resetSkillReadTracking(): void {
  _readSkillIds.clear()
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * get_state_overview — Get a truncated overview of the current game state.
 */
export function createGetStateOverviewTool(ctx: WorldEditorAIContext) {
  return defineTool({
    name: 'get_state_overview',
    description: '获取当前游戏状态的概览，包含世界、角色、地域、组织等信息的摘要。',
    schema: z.object({}),
    handler: async () => {
      const state = ctx.getState()
      return generateStateOverview(state)
    },
  })
}

/**
 * get_state_content — Get complete data at a specified path.
 */
export function createGetStateContentTool(ctx: WorldEditorAIContext) {
  return defineTool({
    name: 'get_state_content',
    description: '获取游戏状态中指定路径的完整数据。',
    schema: z.object({
      path: z.string().describe('数据路径，如 "Creatures"、"World.registry"'),
    }),
    handler: async ({ path }) => {
      const state = ctx.getState()
      const value = getByPath(state, path)
      if (value === undefined) return `错误: 路径 "${path}" 不存在`
      return JSON.stringify(value, null, 2)
    },
  })
}

/**
 * check_state_error — Validate current state for errors.
 */
export function createCheckStateErrorTool(ctx: WorldEditorAIContext) {
  return defineTool({
    name: 'check_state_error',
    description: '检查当前游戏状态的数据完整性，发现缺失的ID、重复项、缺失的文档等问题。',
    schema: z.object({}),
    handler: async () => {
      const state = ctx.getState()
      const validation = validateFullState(state)

      if (validation.valid && validation.warnings.length === 0) {
        return '✅ 数据完整性检查通过，未发现问题。'
      }

      const lines: string[] = []
      if (!validation.valid) {
        lines.push(`❌ 发现 ${validation.errors.length} 个错误:`)
        lines.push(...validation.errors.map((e) => `  - ${e}`))
      }
      if (validation.autoFixes.length > 0) {
        lines.push(`\n🔧 自动修正 (${validation.autoFixes.length} 项):`)
        lines.push(...validation.autoFixes.map((f) => `  - ${f}`))
      }
      const warningText = formatValidationWarnings(validation.warnings)
      if (warningText) lines.push(warningText)

      return lines.join('\n')
    },
  })
}

/**
 * update_state — JSON operation dispatch for modifying game state.
 * Replaces the old `update_state_with_javascript` (no JS execution).
 */
export function createUpdateStateTool(ctx: WorldEditorAIContext) {
  return defineTool({
    name: 'update_state',
    description: '通过 JSON 操作更新游戏状态。每个操作描述一个具体变更，系统自动执行校验和提交。',
    schema: z.object({
      operations: z.array(z.discriminatedUnion('op', [
        // ---- Creature ----
        z.object({
          op: z.literal('upsert_creature'),
          creature_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({
          op: z.literal('replace_creature'),
          creature_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({ op: z.literal('delete_creature'), creature_id: z.string() }),

        // ---- Region ----
        z.object({
          op: z.literal('upsert_region'),
          region_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({
          op: z.literal('replace_region'),
          region_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({ op: z.literal('delete_region'), region_id: z.string() }),

        // ---- Organization ----
        z.object({
          op: z.literal('upsert_organization'),
          organization_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({
          op: z.literal('replace_organization'),
          organization_id: z.string(),
          data: z.record(z.string(), z.any()),
        }),
        z.object({ op: z.literal('delete_organization'), organization_id: z.string() }),

        // ---- World / Story ----
        z.object({ op: z.literal('update_world'), data: z.record(z.string(), z.any()) }),
        z.object({ op: z.literal('set_initial_story'), data: z.record(z.string(), z.any()) }),
        z.object({ op: z.literal('set_story_history'), entries: z.array(z.any()) }),
      ])),
    }),
    handler: async ({ operations }) => {
      // Guard: must have read schema skill first
      if (!_readSkillIds.has('builtin_statedata_schema')) {
        return [
          '❌ 错误: 修改状态前必须先阅读 StateData Schema！',
          '',
          '请先执行以下操作：',
          '1. `get_skill_content("builtin_statedata_schema")` — 阅读完整的 StateData 类型定义',
          '2. `get_skill_content("builtin_game_creation")` — 阅读游戏创建示例（推荐）',
          '',
          '阅读后再调用 update_state。',
        ].join('\n')
      }

      return executeUpdateState(operations, ctx).text
    },
  })
}
