/**
 * WorldEditorCopilotOrchestrator
 *
 * Creates and configures a PubChat instance for the world editor AI copilot.
 * Registers all tools, sets system prompt, preprocesses user messages,
 * and manages the chat lifecycle.
 */

import {
  PubChat,
  MemoryMessageStore,
  createSystemMessage,
  type LLMConfig,
  type MessageStoreProvider,
} from '@pubwiki/chat'

import type {
  WorldEditorAIContext,
  SkillListItem,
  MemoryListItem,
  WorkspaceFileInfo,
  WorkspaceFileProvider,
  WorldEditorStreamEvent,
} from '../types'
import { COPILOT_SYSTEM_PROMPT } from './prompts/system-prompt'
import { generateUserMessagePrefix, COT_SUFFIX } from './prompts/context-prefix'
import { BUILTIN_SKILLS } from './prompts/skills'
import { getNudgeForTool } from './nudges'
import {
  createGetStateOverviewTool,
  createGetStateContentTool,
  createCheckStateErrorTool,
  createUpdateStateTool,
  resetSkillReadTracking,
} from './tools/state-tools'
import {
  createListSkillsTool,
  createGetSkillContentTool,
  type SkillProvider,
} from './tools/skill-tools'
import { createQueryUserTool } from './tools/query-user-tool'
import {
  createListMemoriesTool,
  createGetMemoryContentTool,
  createSaveMemoryTool,
  createDeleteMemoryTool,
} from './tools/memory-tools'
import {
  createListWorkspaceFilesTool,
  createGetWorkspaceFileContentTool,
  createUseWorkspaceFileAgentTool,
  createGetWorkspaceImageContentTool,
} from './tools/file-tools'
import type { MemoryStore } from '../services/memory-store'

// ============================================================================
// Configuration
// ============================================================================

export interface WorldEditorCopilotConfig {
  /** LLM configuration */
  llm: LLMConfig
  /** World editor AI context (state access) */
  aiContext: WorldEditorAIContext
  /** Optional skill provider for user-defined skills */
  skillProvider?: SkillProvider
  /** Optional memory store for working memory persistence */
  memoryStore?: MemoryStore
  /** Optional workspace file provider for user-uploaded files */
  fileProvider?: WorkspaceFileProvider
  /** Optional LLM config for the sub-agent (file processing). Falls back to `llm` if not set. */
  subAgentLlm?: LLMConfig
  /** Optional: get current working memories */
  getMemories?: () => MemoryListItem[]
  /** Optional: get current workspace files */
  getWorkspaceFiles?: () => WorkspaceFileInfo[]
  /** Optional: max tool iterations per turn (default 20) */
  maxIterations?: number
  /** Optional external message store (IDB-backed). Falls back to MemoryMessageStore. */
  messageStore?: MessageStoreProvider
  /** Optional: restore historyId from a persisted session. */
  initialHistoryId?: string | null
}

// ============================================================================
// Orchestrator
// ============================================================================

export class WorldEditorCopilotOrchestrator {
  private pubchat: PubChat
  private historyId: string | null = null
  private initialized = false
  private roundCount = 0

  private readonly config: WorldEditorCopilotConfig
  private readonly skillProvider: SkillProvider

  // query_user blocking mechanism
  private pendingQueryResolve: ((data: Record<string, unknown>) => void) | null = null
  private queryUserEventSink: ((event: WorldEditorStreamEvent) => void) | null = null

  constructor(config: WorldEditorCopilotConfig) {
    this.config = config
    this.skillProvider = config.skillProvider ?? {
      getUserSkills: () => [],
      getUserSkillContent: () => null,
    }

    // Create message store (use provided or fallback to in-memory)
    const messageStore = config.messageStore ?? new MemoryMessageStore()

    // Create PubChat instance
    this.pubchat = new PubChat({
      llm: config.llm,
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: config.maxIterations ?? 20,
      },
    })

    // Restore historyId if provided
    if (config.initialHistoryId) {
      this.historyId = config.initialHistoryId
      this.initialized = true
    }

    // Register all tools
    this.registerTools(config.aiContext)
  }

  // --------------------------------------------------------------------------
  // Tool Registration
  // --------------------------------------------------------------------------

  private registerTools(ctx: WorldEditorAIContext): void {
    // State tools
    const stateTools = [
      createGetStateOverviewTool(ctx),
      createGetStateContentTool(ctx),
      createCheckStateErrorTool(ctx),
      createUpdateStateTool(ctx),
    ]

    // Skill tools
    const skillTools = [
      createListSkillsTool(this.skillProvider),
      createGetSkillContentTool(this.skillProvider),
    ]

    // Query user tool (blocks until user submits a form)
    const queryUserTool = createQueryUserTool(async (request) => {
      return new Promise<Record<string, unknown>>((resolve) => {
        this.pendingQueryResolve = resolve
        // Emit the query_user event so the UI can render the form
        this.queryUserEventSink?.({ type: 'query_user', request })
      })
    })

    // Memory tools
    const getMemoryStore = () => this.config.memoryStore ?? null
    const memoryTools = [
      createListMemoriesTool(getMemoryStore),
      createGetMemoryContentTool(getMemoryStore),
      createSaveMemoryTool(getMemoryStore),
      createDeleteMemoryTool(getMemoryStore),
    ]

    // File tools
    const getFileProvider = () => this.config.fileProvider ?? null
    const getSubAgentConfig = () => this.config.subAgentLlm ?? this.config.llm
    const fileTools = [
      createListWorkspaceFilesTool(getFileProvider),
      createGetWorkspaceFileContentTool(getFileProvider),
      createUseWorkspaceFileAgentTool(getFileProvider, getSubAgentConfig),
      createGetWorkspaceImageContentTool(getFileProvider),
    ]

    // Register all tools with nudge wrapping
    for (const tool of [...stateTools, ...skillTools, queryUserTool, ...memoryTools, ...fileTools]) {
      const originalHandler = tool.handler
      const toolName = tool.name

      this.pubchat.registerTool({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        handler: async (args: unknown) => {
          const result = await originalHandler(args as never)
          // Append nudge to string results
          const nudge = getNudgeForTool(toolName)
          if (typeof result === 'string') {
            return `${result}\n\n${nudge}`
          }
          // For non-string results, wrap in object
          return { result, _nudge: nudge }
        },
      })
    }
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the conversation with the system prompt.
   * Called automatically on first chat().
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    const systemMessage = createSystemMessage(COPILOT_SYSTEM_PROMPT, null)
    const [historyId] = await this.pubchat.addConversation([systemMessage])
    this.historyId = historyId
    this.initialized = true
    this.roundCount = 0

    // Reset skill tracking for new session
    resetSkillReadTracking()
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // --------------------------------------------------------------------------
  // User Message Preprocessing
  // --------------------------------------------------------------------------

  /**
   * Build the full user message with dynamic prefix and optional CoT suffix.
   */
  private preprocessUserMessage(content: string): string {
    // Gather context for prefix
    const allSkills: SkillListItem[] = [
      ...BUILTIN_SKILLS,
      ...this.skillProvider.getUserSkills(),
    ]
    const memories = this.config.getMemories?.() ?? []
    const workspaceFiles = this.config.getWorkspaceFiles?.()

    // Generate dynamic prefix
    const prefix = generateUserMessagePrefix(allSkills, memories, workspaceFiles)

    // Append CoT suffix on first round only
    const suffix = this.roundCount === 0 ? COT_SUFFIX : ''

    this.roundCount++
    return `${prefix}${content}${suffix}`
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a message and stream the response.
   * Yields ChatStreamEvents and additional WorldEditorStreamEvents (e.g. query_user).
   */
  async *chat(message: string): AsyncGenerator<WorldEditorStreamEvent> {
    await this.ensureInitialized()

    const processedMessage = this.preprocessUserMessage(message)

    // Buffered events from async callbacks (query_user)
    const pendingEvents: WorldEditorStreamEvent[] = []
    this.queryUserEventSink = (event) => pendingEvents.push(event)

    try {
      for await (const event of this.pubchat.streamChat(processedMessage, this.historyId!)) {
        // Yield any pending query_user events that were queued during tool execution
        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!
        }

        yield event

        if (event.type === 'done') {
          this.historyId = event.historyId
        }
      }

      // Yield any remaining pending events
      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!
      }
    } finally {
      this.queryUserEventSink = null
    }
  }

  /**
   * Abort the current streaming response.
   */
  abort(): void {
    this.pubchat.abort()
  }

  /**
   * Submit query_user form data — resolves the pending Promise so LLM processing continues.
   */
  submitQueryUserForm(data: Record<string, unknown>): void {
    if (this.pendingQueryResolve) {
      this.pendingQueryResolve(data)
      this.pendingQueryResolve = null
    }
  }

  /**
   * Check if there is a pending query_user form waiting for user input.
   */
  get hasPendingQueryUser(): boolean {
    return this.pendingQueryResolve !== null
  }

  /**
   * Reset the conversation — clears history and skill tracking.
   */
  async reset(): Promise<void> {
    this.initialized = false
    this.historyId = null
    this.roundCount = 0
    resetSkillReadTracking()

    // Re-create PubChat with fresh message store
    const messageStore = this.config.messageStore ?? new MemoryMessageStore()
    this.pubchat = new PubChat({
      llm: this.config.llm,
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: this.config.maxIterations ?? 20,
      },
    })

    // Re-register tools
    this.registerTools(this.config.aiContext)
  }

  /**
   * Update LLM configuration (e.g., model change).
   */
  updateLLMConfig(llmConfig: Partial<LLMConfig>): void {
    Object.assign(this.config.llm, llmConfig)
  }

  /**
   * Get the current history ID (conversation position) for session persistence.
   */
  getHistoryId(): string | null {
    return this.historyId
  }
}
