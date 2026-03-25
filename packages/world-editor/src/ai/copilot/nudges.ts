/**
 * Tool Result Nudges — Migrated from copilotChat.ts
 *
 * Strict verbatim migration per §4.4 of the migration plan.
 * Only key change: update_state_with_javascript → update_state
 */

/**
 * Behavioral nudge messages appended to each tool's return value.
 * Exploits LLM recency bias to guide behavior after tool calls.
 */
export const TOOL_RESULT_NUDGES: Record<string, string> = {
  get_state_overview: '📋 提醒：了解状态后，请先向用户说明你的分析和计划，再行动。不要直接开始修改。',
  get_state_content: '📂 提醒：数据已获取。请分析后告知用户你的发现和下一步计划。',
  update_state: '✅ 提醒：修改完成！请立刻向用户汇报这一步的结果，确认是否继续下一步。记得用 save_memory 记录进度。',
  check_state_error: '🔍 提醒：检查完成。请将结果告知用户，确认问题后再修改。',
  get_skill_content: '📖 提醒：Skill 已阅读。请基于内容制定计划并告知用户，等待确认后再执行。',
  list_skills: '📚 提醒：技能列表已获取。根据任务需要，阅读相关 Skill 后再行动。',
  save_memory: '📝 提醒：进度已记录。请继续执行下一步并向用户汇报。',
  list_memories: '📝 提醒：已查看记忆列表。如有相关记忆请先阅读，了解之前的工作上下文。',
  get_workspace_file_content: '📁 提醒：文件已读取。请分析内容后告知用户你的发现和计划。',
  use_workspace_file_agent: '🤖 提醒：文件处理完成。请将结果整理后告知用户，确认下一步。',
  query_user: '📋 提醒：用户已提交表单。请基于用户的回答继续执行任务。',
  _default: '💬 提醒：请向用户汇报进度，不要连续调用多个工具而不与用户交流。',
}

/**
 * Get the nudge message for a tool, falling back to _default.
 */
export function getNudgeForTool(toolName: string): string {
  return TOOL_RESULT_NUDGES[toolName] ?? TOOL_RESULT_NUDGES._default
}
