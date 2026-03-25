/**
 * Copilot Chat Service - Using OpenAI SDK with Manual Tool Call Accumulation
 * 
 * This module handles streaming chat with proper tool call argument accumulation.
 * Tool call arguments that arrive in chunks are properly assembled before execution.
 */
import OpenAI from 'openai';
import type { StateData, CopilotConfig, CopilotModelConfig, UploadedFile } from '../../api/types';
import {
  COPILOT_SYSTEM_PROMPT,
  generateUserMessagePrefix,
  type SkillListItem,
  type MemoryListItem,
  type WorkspaceFileInfo
} from '../../api/copilotPrompt';
import {
  loadSkills,
  getSkill,
  loadMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory as deleteMemoryFn
} from '../../api/copilotService';
import { validateFullState, formatValidationWarnings } from '../../api/stateValidation';

// ============================================================================
// Tool Execution Context
// ============================================================================

export interface QueryUserField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'number';
  options?: string[];
  default?: unknown;
  required?: boolean;
  placeholder?: string;
}

export interface QueryUserRequest {
  title: string;
  fields: QueryUserField[];
}

export interface ToolExecutionContext {
  state: StateData;
  config: CopilotConfig;
  getFiles: () => UploadedFile[];
  onStateChange: (state: StateData) => void;
  onSkillsOrMemoryChange: () => void;
  queryUser?: (request: QueryUserRequest) => Promise<Record<string, unknown>>;
}

// Track which skills the AI has read in this session
// Prevents state modification without reading the schema first
const _readSkillIds = new Set<string>();

/** Reset skill read tracking (call when starting a new session) */
export function resetSkillReadTracking(): void {
  _readSkillIds.clear();
}

// ============================================================================
// Tool Definitions (OpenAI Format)
// ============================================================================

export const COPILOT_TOOLS_BASE: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_state_overview',
      description: '获取当前游戏状态的概览，包含世界、角色、地域、组织等信息的摘要。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_workspace_files',
      description: '列出用户上传的所有文件，返回文件名、类型和大小信息。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_workspace_file_content',
      description: '读取用户上传的文件内容。支持单个文件或多个文件批量读取。',
      parameters: {
        type: 'object',
        properties: {
          filename: { 
            oneOf: [
              { type: 'string', description: '单个文件名' },
              { type: 'array', items: { type: 'string' }, description: '多个文件名列表' }
            ],
            description: '要读取的文件名（支持单个或多个）' 
          }
        },
        required: ['filename']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'use_workspace_file_agent',
      description: '调用次级模型对指定的上传文件执行操作，如提取信息、总结内容、转换格式等。支持单个或多个文件。',
      parameters: {
        type: 'object',
        properties: {
          filename: { 
            oneOf: [
              { type: 'string', description: '单个文件名' },
              { type: 'array', items: { type: 'string' }, description: '多个文件名列表' }
            ],
            description: '要处理的文件名（支持单个或多个）' 
          },
          instruction: { type: 'string', description: '给次级模型的指令' }
        },
        required: ['filename', 'instruction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_workspace_image_content',
      description: '获取工作区中图片文件的内容，使其在对话中可见。调用此工具后，图片将附加到后续消息中供你直接查看和分析。支持单个或多个图片。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            oneOf: [
              { type: 'string', description: '单个图片文件名' },
              { type: 'array', items: { type: 'string' }, description: '多个图片文件名列表' }
            ],
            description: '要查看的图片文件名（支持单个或多个）'
          }
        },
        required: ['filename']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_state_content',
      description: '获取游戏状态中指定路径的完整数据。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '数据路径，如 "Creatures"、"World.Registry"' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_state_with_javascript',
      description: '通过执行 JavaScript 代码来更新游戏状态。代码中可以直接读写 state 对象（已深拷贝，安全可修改）。执行后会自动进行数据校验。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript 代码，可直接读写 state 对象。例如: state.Creatures.push({...})' }
        },
        required: ['code']
      }
    }
  },
  // Skill Tools (Read-Only Knowledge Base)
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出所有可用的技能文档（内置指南 + 用户自定义）。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_skill_content',
      description: '读取指定技能文档的完整内容。用于在执行任务前学习相关知识。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID' }
        },
        required: ['id']
      }
    }
  },
  // WorkingMemory Tools (Mutable Working Notes)
  {
    type: 'function',
    function: {
      name: 'list_memories',
      description: '列出所有工作记忆条目。工作记忆用于跨对话记录任务进度和决策。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_memory_content',
      description: '读取指定工作记忆的完整内容。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: '创建或更新工作记忆。不提供 id 时创建新记忆，提供 id 时更新已有记忆。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID，不提供则新建' },
          title: { type: 'string', description: '记忆标题' },
          content: { type: 'string', description: '记忆内容（Markdown 格式）' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: '删除指定的工作记忆。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID' }
        },
        required: ['id']
      }
    }
  },
  // User Query Tool (Interactive Form)
  {
    type: 'function',
    function: {
      name: 'query_user',
      description: '向用户展示一个交互式表单来收集结构化信息。当你需要同时问用户多个问题、或需要用户从选项中选择时，优先使用此工具而非纯文本提问。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '表单标题（简短描述此次询问的目的）' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: '字段键名（英文，用于返回结果）' },
                label: { type: 'string', description: '显示标签（用户看到的文字）' },
                type: {
                  type: 'string',
                  enum: ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number'],
                  description: '字段类型: text=单行文本, textarea=多行文本, select=单选下拉, multiselect=多选, checkbox=勾选框, number=数字'
                },
                options: { type: 'array', items: { type: 'string' }, description: 'select/multiselect 的选项列表' },
                default: { description: '默认值' },
                required: { type: 'boolean', description: '是否必填（默认 false）' },
                placeholder: { type: 'string', description: '输入框占位提示文字' }
              },
              required: ['key', 'label', 'type']
            },
            description: '表单字段定义列表'
          }
        },
        required: ['title', 'fields']
      }
    }
  }
];

/**
 * Get the full tool list
 */
export function getCopilotTools(_config: CopilotConfig): OpenAI.Chat.ChatCompletionTool[] {
  return COPILOT_TOOLS_BASE;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getReasoningParams(modelConfig: CopilotModelConfig): Record<string, unknown> {
  const effort = modelConfig.reasoning?.effort
  if (!effort) return {}
  return { reasoning: { effort } }
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      const nextPart = parts[i + 1];
      current[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
  return true;
}

/** 需要截断的长文本字段路径集合 */
const TRUNCATE_FIELDS = new Set([
  'content',       // SettingDocument.content, StoryHistoryEntry.story.content
  'background',    // GameInitialStory.background
  'start_story',   // GameInitialStory.start_story
  'dialogue',      // StoryLine dialogue
  'narration',     // StoryLine narration
  'body',          // appearance.body
  'clothing',      // appearance.clothing
])

const TEXT_MAX_LENGTH = 80

/**
 * 深拷贝 state 并截断长文本字段，移除 StoryHistory 以减少体积
 */
function truncateStateForOverview(obj: unknown, key?: string): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (key && TRUNCATE_FIELDS.has(key) && obj.length > TEXT_MAX_LENGTH) {
      return obj.substring(0, TEXT_MAX_LENGTH) + `...(${obj.length}chars)`
    }
    return obj
  }
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map((item, _i) => truncateStateForOverview(item, key))
  }
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = truncateStateForOverview(v, k)
  }
  return result
}

function generateStateOverview(state: StateData): string {
  // 深拷贝并截断长文本，移除 StoryHistory（纯运行时数据，不影响创建）
  const slim: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(state)) {
    if (k === 'StoryHistory') continue // 剧情历史太大，跳过
    slim[k] = truncateStateForOverview(v)
  }
  return JSON.stringify(slim, null, 2)
}

// ============================================================================
// Tool Result Nudges (Ephemeral Reminders)
// Appended to tool results to leverage LLM recency bias for behavior guidance
// ============================================================================

const TOOL_RESULT_NUDGES: Record<string, string> = {
  get_state_overview: '📋 提醒：了解状态后，请先向用户说明你的分析和计划，再行动。不要直接开始修改。',
  get_state_content: '📂 提醒：数据已获取。请分析后告知用户你的发现和下一步计划。',
  update_state_with_javascript: '✅ 提醒：修改完成！请立刻向用户汇报这一步的结果，确认是否继续下一步。记得用 save_memory 记录进度。',
  check_state_error: '🔍 提醒：检查完成。请将结果告知用户，确认问题后再修改。',
  get_skill_content: '📖 提醒：Skill 已阅读。请基于内容制定计划并告知用户，等待确认后再执行。',
  list_skills: '📚 提醒：技能列表已获取。根据任务需要，阅读相关 Skill 后再行动。',
  save_memory: '📝 提醒：进度已记录。请继续执行下一步并向用户汇报。',
  list_memories: '📝 提醒：已查看记忆列表。如有相关记忆请先阅读，了解之前的工作上下文。',
  get_workspace_file_content: '📁 提醒：文件已读取。请分析内容后告知用户你的发现和计划。',
  use_workspace_file_agent: '🤖 提醒：文件处理完成。请将结果整理后告知用户，确认下一步。',
  _default: '💬 提醒：请向用户汇报进度，不要连续调用多个工具而不与用户交流。'
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<string> {
  const { state, config, getFiles, onStateChange } = context;

  // 🔍 Log every tool call
  console.log(`[Copilot Tool] ▶ ${toolName}`, args);
  const _startTime = Date.now();

  let result: string;
  try {
    result = await _executeToolInner(toolName, args, context);
  } catch (e) {
    console.error(`[Copilot Tool] ✖ ${toolName} threw:`, e);
    throw e;
  }

  // Append behavioral nudge to tool result
  const nudge = TOOL_RESULT_NUDGES[toolName] || TOOL_RESULT_NUDGES._default;
  result = result + '\n\n---\n' + nudge;

  const elapsed = Date.now() - _startTime;
  const truncated = result.length > 500 ? result.substring(0, 500) + `... [${result.length} chars total]` : result;
  console.log(`[Copilot Tool] ✔ ${toolName} (${elapsed}ms)`, truncated);
  return result;
}

async function _executeToolInner(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<string> {
  const { state, config, getFiles, onStateChange } = context;

  switch (toolName) {
    case 'get_state_overview':
      return generateStateOverview(state);

    case 'list_workspace_files': {
      const files = getFiles();
      if (files.length === 0) return '当前没有上传的文件。';
      const lines = ['已上传的文件：'];
      files.forEach(f => {
        const sizeStr = f.size < 1024
          ? `${f.size} B`
          : f.size < 1024 * 1024
            ? `${(f.size / 1024).toFixed(1)} KB`
            : `${(f.size / 1024 / 1024).toFixed(1)} MB`;
        lines.push(`- ${f.name} (${f.type}, ${sizeStr})`);
      });
      return lines.join('\n');
    }

    case 'get_workspace_file_content': {
      const rawFilename = args.filename;
      const filenames = Array.isArray(rawFilename) ? rawFilename as string[] : [rawFilename as string];
      const files = getFiles();

      const results: string[] = [];
      for (const filename of filenames) {
        const file = files.find(f => f.name === filename);
        if (!file) {
          results.push(`❌ 文件 "${filename}"：找不到。使用 list_workspace_files 查看可用文件。`);
          continue;
        }

        if (file.type === 'image') {
          results.push(`🖼️ "${filename}" 是图片文件，请改用 get_workspace_image_content 或 use_workspace_file_agent 查看。`);
          continue;
        }

        const MAX_CONTENT_LENGTH = 2000;
        let content = file.content;
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.substring(0, MAX_CONTENT_LENGTH) +
            '\n\n[... 内容已截断 ...]\n\n' +
            '⚠️ 此文件过长，请使用 use_workspace_file_agent 调用小模型读取你想要的信息。';
        }
        results.push(`📄 文件: ${file.name}\n类型: ${file.type}\n\n内容:\n${content}`);
      }
      return results.join('\n\n---\n\n');
    }

    case 'get_workspace_image_content': {
      const rawFilename = args.filename;
      const filenames = Array.isArray(rawFilename) ? rawFilename as string[] : [rawFilename as string];
      const files = getFiles();

      const results: string[] = [];
      for (const filename of filenames) {
        const file = files.find(f => f.name === filename);
        if (!file) {
          results.push(`❌ 图片 "${filename}"：找不到。使用 list_workspace_files 查看可用文件。`);
          continue;
        }
        if (file.type !== 'image' || !file.dataUrl) {
          results.push(`❌ "${filename}" 不是图片文件或数据未加载。`);
          continue;
        }
        const sizeStr = file.size < 1024 ? `${file.size}B` : `${(file.size / 1024).toFixed(1)}KB`;
        results.push(`✅ 图片 "${filename}" (${file.mimeType || 'image'}, ${sizeStr}) 已加载，将附加到下一条消息中供你查看。`);
      }
      return results.join('\n');
    }

    case 'use_workspace_file_agent': {
      const rawFilename = args.filename;
      const filenames = Array.isArray(rawFilename) ? rawFilename as string[] : [rawFilename as string];
      const instruction = args.instruction as string;
      const files = getFiles();

      // Collect all matching files
      const matchedFiles: UploadedFile[] = [];
      const errors: string[] = [];
      for (const fn of filenames) {
        const file = files.find(f => f.name === fn);
        if (!file) {
          errors.push(`❌ 文件 "${fn}"：找不到。`);
        } else {
          matchedFiles.push(file);
        }
      }

      if (matchedFiles.length === 0) {
        return errors.join('\n');
      }

      try {
        const baseUrl = config.secondaryModel.baseUrl || config.primaryModel.baseUrl;
        const apiKey = config.secondaryModel.apiKey || config.primaryModel.apiKey;
        const model = config.secondaryModel.model || config.primaryModel.model;

        const client = new OpenAI({
          apiKey,
          baseURL: baseUrl,
          dangerouslyAllowBrowser: true
        });

        // Separate text files and image files
        const textFiles = matchedFiles.filter(f => f.type !== 'image');
        const imageFiles = matchedFiles.filter(f => f.type === 'image' && f.dataUrl);

        // Build user message content (may include images)
        const userContentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: string } }> = [];

        // Add text file summaries
        if (textFiles.length > 0) {
          const filesSummary = textFiles.map(f =>
            `文件名: ${f.name}\n文件类型: ${f.type}\n\n文件内容:\n${f.content}`
          ).join('\n\n---\n\n');
          userContentParts.push({ type: 'text', text: `${filesSummary}\n\n指令: ${instruction}` });
        } else {
          userContentParts.push({ type: 'text', text: `指令: ${instruction}` });
        }

        // Add image files as vision content parts
        for (const img of imageFiles) {
          userContentParts.push({ type: 'text', text: `\n图片文件: ${img.name}` });
          userContentParts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl!, detail: 'auto' }
          });
        }

        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: '你是一个文档处理助手，根据用户的指令处理给定的文档内容（包括图片）。请直接给出结果。' },
            { role: 'user', content: userContentParts as any }
          ]
        });

        let result = response.choices[0]?.message?.content || '（无响应）';
        if (errors.length > 0) {
          result = errors.join('\n') + '\n\n' + result;
        }
        return result;
      } catch (e) {
        return `错误: 调用次级模型失败 - ${(e as Error).message}`;
      }
    }

    case 'get_state_content': {
      const path = args.path as string;
      const value = getByPath(state, path);
      if (value === undefined) return `错误: 路径 "${path}" 不存在`;
      return JSON.stringify(value, null, 2);
    }

    case 'update_state_with_javascript': {
      // Guard: must have read schema skill first
      if (!_readSkillIds.has('builtin_statedata_schema')) {
        return [
          '❌ 错误: 修改状态前必须先阅读 StateData Schema！',
          '',
          '请先执行以下操作：',
          '1. `get_skill_content("builtin_statedata_schema")` — 阅读完整的 StateData 类型定义',
          '2. `get_skill_content("builtin_game_creation")` — 阅读游戏创建示例（推荐）',
          '',
          '阅读后再调用 update_state_with_javascript。',
        ].join('\n');
      }

      const code = args.code as string;
      if (!code || typeof code !== 'string') {
        return '错误: 必须提供 code 参数（JavaScript 代码字符串）';
      }

      console.log('[Copilot Tool] update_state_with_javascript code:\n', code);

      // Deep clone state to prevent side effects
      const newState = JSON.parse(JSON.stringify(state));

      // Track which top-level keys changed
      const beforeSnapshots: Record<string, string> = {};
      for (const key of Object.keys(state)) {
        try {
          beforeSnapshots[key] = JSON.stringify((state as unknown as Record<string, unknown>)[key]);
        } catch {
          beforeSnapshots[key] = '[non-serializable]';
        }
      }

      // Execute the code in sandbox
      try {
        const fn = new Function('state', code);
        fn(newState);
      } catch (e) {
        console.error('[Copilot Tool] update_state_with_javascript execution error:', e);
        return `错误: JavaScript 执行失败\n\n${(e as Error).message}\n\n请检查代码语法是否正确。`;
      }

      console.log('[Copilot Tool] State after JS execution:', JSON.stringify(newState).substring(0, 2000));

      // Validate the new state
      const validation = validateFullState(newState);
      console.log('[Copilot Tool] Validation result:', { valid: validation.valid, errors: validation.errors, warnings: validation.warnings });
      if (!validation.valid) {
        const errorList = validation.errors.map(e => `  - ${e}`).join('\n');
        return `错误: 数据校验失败，状态未更新\n\n${errorList}\n\n请根据错误信息修正代码后重试。`;
      }

      // Compute diff summary
      const changedKeys: string[] = [];
      for (const key of new Set([...Object.keys(newState), ...Object.keys(state)])) {
        let newSnapshot: string;
        try {
          newSnapshot = JSON.stringify((newState as Record<string, unknown>)[key]);
        } catch {
          newSnapshot = '[non-serializable]';
        }
        if (beforeSnapshots[key] !== newSnapshot) {
          changedKeys.push(key);
        }
      }

      console.log('[Copilot Tool] Changed keys:', changedKeys);

      // Commit the change
      onStateChange(newState);

      // Build result message
      const lines = ['成功: 游戏状态已更新'];
      if (changedKeys.length > 0) {
        lines.push(`修改的字段: ${changedKeys.join(', ')}`);
      }
      // Display auto-fixes
      if (validation.autoFixes.length > 0) {
        lines.push(`\n🔧 自动修正 (${validation.autoFixes.length} 项):`);
        validation.autoFixes.forEach(f => lines.push(`  - ${f}`));
      }
      const warningText = formatValidationWarnings(validation.warnings);
      if (warningText) {
        lines.push(warningText);
      }
      // Auto-inject state overview after successful update
      lines.push('\n📊 当前状态概览:');
      lines.push(generateStateOverview(newState));
      return lines.join('\n');
    }

    // === Skill Tools (Read-Only) ===
    case 'list_skills': {
      const skills = loadSkills();
      if (skills.length === 0) return '当前没有可用的技能文档。';
      const builtIn = skills.filter(s => s.isBuiltIn);
      const userDefined = skills.filter(s => !s.isBuiltIn);
      const lines = ['# 📚 技能文档列表'];
      if (builtIn.length > 0) {
        lines.push('\n## 内置技能');
        builtIn.forEach(s => {
          lines.push(`\n### ${s.title}`);
          lines.push(`- **ID**: \`${s.id}\``);
          lines.push(`- **描述**: ${s.description || '（无描述）'}`);
        });
      }
      if (userDefined.length > 0) {
        lines.push('\n## 用户自定义技能');
        userDefined.forEach(s => {
          lines.push(`\n### ${s.title}`);
          lines.push(`- **ID**: \`${s.id}\``);
          lines.push(`- **描述**: ${s.description || '（无描述）'}`);
        });
      }
      return lines.join('\n');
    }

    case 'get_skill_content': {
      const id = args.id as string;
      const skill = getSkill(id);
      if (!skill) return `错误: 找不到技能 "${id}"。`;
      // Track that this skill has been read
      _readSkillIds.add(id);
      return [
        `# ${skill.title}`,
        '',
        `**ID**: \`${skill.id}\``,
        skill.description ? `**描述**: ${skill.description}` : '',
        skill.isBuiltIn ? '**类型**: 内置技能（只读）' : '**类型**: 用户自定义技能',
        '',
        '---',
        '',
        skill.content || '（无内容）'
      ].filter(Boolean).join('\n');
    }

    // === WorkingMemory Tools (Read/Write) ===
    case 'list_memories': {
      const memories = loadMemories();
      if (memories.length === 0) return '当前没有工作记忆。可以使用 save_memory() 创建新的工作记忆来记录任务进度。';
      const lines = ['# 📝 工作记忆列表'];
      memories.forEach(m => {
        const updatedAt = new Date(m.updatedAt).toLocaleString('zh-CN');
        lines.push(`\n### ${m.title}`);
        lines.push(`- **ID**: \`${m.id}\``);
        lines.push(`- **更新时间**: ${updatedAt}`);
        // Show first 100 chars of content as preview
        const preview = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
        lines.push(`- **预览**: ${preview}`);
      });
      return lines.join('\n');
    }

    case 'get_memory_content': {
      const id = args.id as string;
      const memory = getMemory(id);
      if (!memory) return `错误: 找不到工作记忆 "${id}"。`;
      return [
        `# ${memory.title}`,
        '',
        `**ID**: \`${memory.id}\``,
        `**创建时间**: ${new Date(memory.createdAt).toLocaleString('zh-CN')}`,
        `**更新时间**: ${new Date(memory.updatedAt).toLocaleString('zh-CN')}`,
        '',
        '---',
        '',
        memory.content || '（无内容）'
      ].join('\n');
    }

    case 'save_memory': {
      const { id, title, content } = args as {
        id?: string;
        title: string;
        content: string;
      };
      
      const { onSkillsOrMemoryChange } = context;

      if (!title) return '错误: 必须提供 title 参数';
      if (!content) return '错误: 必须提供 content 参数';

      if (!id) {
        // Create new memory
        const memory = createMemory(title, content);
        onSkillsOrMemoryChange();
        return `成功: 已创建新工作记忆\n- **ID**: \`${memory.id}\`\n- **标题**: ${memory.title}`;
      }
      
      // Update existing memory
      const existing = getMemory(id);
      if (!existing) return `错误: 找不到工作记忆 "${id}"。`;
      
      const updated = updateMemory(id, { title, content });
      if (!updated) return `错误: 更新工作记忆 "${id}" 失败。`;
      
      onSkillsOrMemoryChange();
      return `成功: 已更新工作记忆 "${updated.title}"`;
    }

    case 'delete_memory': {
      const id = args.id as string;
      const { onSkillsOrMemoryChange } = context;
      
      const success = deleteMemoryFn(id);
      if (!success) return `错误: 找不到工作记忆 "${id}"，或删除失败。`;
      
      onSkillsOrMemoryChange();
      return `成功: 已删除工作记忆 "${id}"`;
    }

    case 'query_user': {
      const title = args.title as string || '请回答以下问题';
      const fields = args.fields as QueryUserField[] || [];

      if (!context.queryUser) {
        return '错误: queryUser 回调未注册。请检查前端配置。';
      }

      if (fields.length === 0) {
        return '错误: 表单字段为空，请至少提供一个字段。';
      }

      try {
        const result = await context.queryUser({ title, fields });
        const answeredLines: string[] = [];
        const customLines: string[] = [];
        const aiDecideLines: string[] = [];

        for (const field of fields) {
          const value = result[field.key];
          if (value === '__AI_DECIDE__') {
            aiDecideLines.push(`- **${field.label}**`);
          } else if (value !== undefined && value !== '' && value !== null) {
            const isCustom = (field.type === 'select' || field.type === 'multiselect')
              && typeof value === 'string'
              && !(field.options || []).includes(value);
            if (isCustom) {
              customLines.push(`- **${field.label}**: ${JSON.stringify(value)}`);
            } else {
              answeredLines.push(`- **${field.label}**: ${JSON.stringify(value)}`);
            }
          }
        }

        const sections: string[] = [`用户已提交表单「${title}」的回答：`];
        if (answeredLines.length > 0) {
          sections.push('\n**用户选择：**');
          sections.push(...answeredLines);
        }
        if (customLines.length > 0) {
          sections.push('\n**用户自定义输入：**');
          sections.push(...customLines);
        }
        if (aiDecideLines.length > 0) {
          sections.push('\n**以下问题由你（AI）自行决定：**');
          sections.push(...aiDecideLines);
        }
        return sections.join('\n');
      } catch (e) {
        return `queryUser 被取消或出错: ${(e as Error).message}`;
      }
    }

    default:
      return `错误: 未知工具 "${toolName}"`;
  }
}

// ============================================================================
// Stream Events for UI
// ============================================================================

export type CopilotStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; delta: string }
  | { type: 'tool_call_complete'; toolCallId: string; toolName: string; arguments: string; thought_signature?: string }
  | { type: 'done'; hasToolCalls: boolean }
  | { type: 'error'; error: string };

// ============================================================================
// Tool Call Accumulator
// ============================================================================

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
  thought_signature?: string;  // Gemini 3 思考签名
}

// ============================================================================
// Main Stream Function
// ============================================================================

export async function* streamCopilotChat(
  config: CopilotConfig,
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string }; extra_content?: any }>;
  }>,
  context: ToolExecutionContext,
  abortSignal?: AbortSignal,
  options?: Record<string, unknown>
): AsyncGenerator<CopilotStreamEvent> {
  const client = new OpenAI({
    apiKey: config.primaryModel.apiKey,
    baseURL: config.primaryModel.baseUrl,
    dangerouslyAllowBrowser: true
  });

  // Generate dynamic prefix with skills, memories, and workspace files
  const skills = loadSkills();
  const skillList: SkillListItem[] = skills.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description,
    isBuiltIn: s.isBuiltIn
  }));
  
  const memories = loadMemories();
  const memoryList: MemoryListItem[] = memories.map(m => ({
    id: m.id,
    title: m.title
  }));
  
  // Get workspace files info
  const uploadedFiles = context.getFiles();
  const workspaceFiles: WorkspaceFileInfo[] = uploadedFiles.map(f => ({
    name: f.name,
    type: f.type,
    size: f.size
  }));
  
  const dynamicPrefix = generateUserMessagePrefix(skillList, memoryList, workspaceFiles);
  
  // Find the last user message index to prepend prefix
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMessageIndex = i;
      break;
    }
  }

  // Pseudo Chain-of-Thought: only inject on first round (last message is user, not tool)
  const isFirstRound = messages.length > 0 && messages[messages.length - 1].role === 'user';
  const COT_SUFFIX = '\n\n---\n🧠 在回复之前，请先在心里回答以下问题（不需要输出这些问题本身）：\n' +
    '1. 用户想要什么？我需要做几步？\n' +
    '2. 有没有需要先用工具了解的信息？\n' +
    '3. 我应该先向用户确认什么？\n' +
    '请先简要说明你的理解和计划，再开始行动。\n---';

  try {
    const stream = await client.chat.completions.create({
      model: config.primaryModel.model,
      messages: [
        { role: 'system', content: COPILOT_SYSTEM_PROMPT },
        ...messages.map((m, index) => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' };
          }
          if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
            return {
              role: 'assistant' as const,
              content: m.content,
              tool_calls: m.tool_calls
            };
          }
          // Prepend prefix to the last user message, and append CoT suffix on first round
          if (m.role === 'user' && index === lastUserMessageIndex && typeof m.content === 'string') {
            const cotPart = isFirstRound ? COT_SUFFIX : '';
            return { role: 'user' as const, content: dynamicPrefix + m.content + cotPart };
          }
          // Pass array content (e.g. image injection) as-is
          if (Array.isArray(m.content)) {
            return { role: m.role as 'user', content: m.content };
          }
          return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
        })
      ],
      tools: getCopilotTools(config),
      temperature: config.primaryModel.temperature || 0.7,
      max_tokens: config.primaryModel.maxTokens || 20480,
      stream: true,
      ...getReasoningParams(config.primaryModel)
    }, abortSignal ? { signal: abortSignal } : undefined);

    // 工具调用累积器 - 按 index 累积参数 chunks
    const toolCallAccumulator = new Map<number, AccumulatedToolCall>();
    const emittedToolCalls = new Set<number>(); // 已经发出 start 事件的工具调用

    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        yield { type: 'done' as const, hasToolCalls: false };
        return;
      }
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // 处理文本增量
      if (delta?.content) {
        yield { type: 'text_delta', delta: delta.content };
      }

      // 处理工具调用增量
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          
          // 检查是否是新的工具调用
          if (!toolCallAccumulator.has(index)) {
            // 新工具调用开始
            // Gemini 3 在 tool call 顶层直接携带 thought_signature
            const sig = (tc as any).thought_signature as string | undefined
            const toolCall: AccumulatedToolCall = {
              id: tc.id || `tool_${index}`,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
              thought_signature: sig
            };
            toolCallAccumulator.set(index, toolCall);
            
            // 发出 start 事件
            if (toolCall.name && !emittedToolCalls.has(index)) {
              emittedToolCalls.add(index);
              yield { type: 'tool_call_start', toolCallId: toolCall.id, toolName: toolCall.name };
            }
          } else {
            // 累积参数
            const existing = toolCallAccumulator.get(index)!;
            
            // 更新 id 如果之前没有
            if (tc.id && !existing.id.startsWith('call_')) {
              existing.id = tc.id;
            }
            
            // 更新 name 如果之前没有
            if (tc.function?.name && !existing.name) {
              existing.name = tc.function.name;
              // 发出 start 事件
              if (!emittedToolCalls.has(index)) {
                emittedToolCalls.add(index);
                yield { type: 'tool_call_start', toolCallId: existing.id, toolName: existing.name };
              }
            }
            
            // 捕获 Gemini 3 thought_signature（可能在后续 chunk 中到达）
            const laterSig = (tc as any).thought_signature as string | undefined
            if (laterSig && !existing.thought_signature) {
              existing.thought_signature = laterSig;
            }

            // 累积参数 chunks
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
              yield { type: 'tool_call_delta', toolCallId: existing.id, delta: tc.function.arguments };
            }
          }
        }
      }

      // 检查是否完成
      if (choice.finish_reason) {
        // 发出所有完整的工具调用
        for (const [, toolCall] of toolCallAccumulator) {
          yield {
            type: 'tool_call_complete',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            thought_signature: toolCall.thought_signature
          };
        }
        
        yield { type: 'done', hasToolCalls: toolCallAccumulator.size > 0 };
        break;
      }
    }
  } catch (e) {
    yield { type: 'error', error: (e as Error).message };
  }
}
