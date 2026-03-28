/**
 * DesignerOrchestrator
 *
 * Creates and configures a PubChat instance for the Designer Agent mode.
 * Registers tools for Frontend VFS file operations and state reading.
 * Manages the chat lifecycle for frontend code generation.
 */

import {
  PubChat,
  MemoryMessageStore,
  createSystemMessage,
  type LLMConfig,
} from '@pubwiki/chat'

import type { Vfs } from '@pubwiki/vfs'
import type {
  WorldEditorAIContext,
  WorldEditorStreamEvent,
} from '../types'
import { DESIGNER_SYSTEM_PROMPT } from './system-prompt'
import {
  createListFrontendFilesTool,
  createReadFrontendFileTool,
  createWriteFrontendFileTool,
  createDeleteFrontendFileTool,
  createSearchFrontendFilesTool,
  type FrontendVfsGetter,
} from './tools/frontend-file-tools'
import {
  createGetStateOverviewTool,
  createGetStateContentTool,
} from '../copilot/tools/state-tools'
import {
  createListBackendServicesTool,
  createGetServiceDefinitionTool,
} from './tools/service-tools'
import {
  createGetConsoleLogsTool,
  createVerifyFrontendTool,
  createScreenshotTool,
  type SandboxConnectionGetter,
} from './tools/sandbox-tools'

// ============================================================================
// Configuration
// ============================================================================

export interface DesignerConfig {
  /** LLM configuration */
  llm: LLMConfig
  /** World editor AI context (state access — read-only for designer) */
  aiContext: WorldEditorAIContext
  /** Lazy getter for the Frontend VFS */
  getFrontendVfs: FrontendVfsGetter
  /** Lazy getter for the sandbox connection (may be null if preview not open) */
  getSandboxConnection?: SandboxConnectionGetter
  /** Optional: max tool iterations per turn (default 20) */
  maxIterations?: number
}

// ============================================================================
// Orchestrator
// ============================================================================

export class DesignerOrchestrator {
  private pubchat: PubChat
  private historyId: string | null = null
  private initialized = false

  constructor(private readonly config: DesignerConfig) {
    // Create message store
    const messageStore = new MemoryMessageStore()

    // Create PubChat instance
    this.pubchat = new PubChat({
      llm: config.llm,
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: config.maxIterations ?? 20,
      },
    })

    // Register all tools
    this.registerTools()
  }

  // --------------------------------------------------------------------------
  // Tool Registration
  // --------------------------------------------------------------------------

  private registerTools(): void {
    const { aiContext, getFrontendVfs, getSandboxConnection } = this.config

    // Frontend VFS file tools
    const fileTools = [
      createListFrontendFilesTool(getFrontendVfs),
      createReadFrontendFileTool(getFrontendVfs),
      createWriteFrontendFileTool(getFrontendVfs),
      createDeleteFrontendFileTool(getFrontendVfs),
      createSearchFrontendFilesTool(getFrontendVfs),
    ]

    // State tools (read-only subset)
    const stateTools = [
      createGetStateOverviewTool(aiContext),
      createGetStateContentTool(aiContext),
    ]

    // Backend service discovery tools
    const serviceTools = [
      createListBackendServicesTool(getFrontendVfs),
      createGetServiceDefinitionTool(getFrontendVfs),
    ]

    // Sandbox tools (preview interaction)
    const sandboxTools = getSandboxConnection ? [
      createGetConsoleLogsTool(getSandboxConnection),
      createVerifyFrontendTool(getSandboxConnection),
      createScreenshotTool(getSandboxConnection),
    ] : []

    // Register all tools
    for (const tool of [...fileTools, ...stateTools, ...serviceTools, ...sandboxTools]) {
      this.pubchat.registerTool({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        handler: tool.handler as (args: unknown) => Promise<unknown>,
        afterExecution: tool.afterExecution,
      })
    }
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  private async initialize(): Promise<void> {
    if (this.initialized) return

    const systemMessage = createSystemMessage(DESIGNER_SYSTEM_PROMPT, null)
    const [historyId] = await this.pubchat.addConversation([systemMessage])
    this.historyId = historyId
    this.initialized = true
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a message and stream the response.
   */
  async *chat(message: string): AsyncGenerator<WorldEditorStreamEvent> {
    await this.ensureInitialized()

    for await (const event of this.pubchat.streamChat(message, this.historyId!)) {
      yield event
      if (event.type === 'done') {
        this.historyId = event.historyId
      }
    }
  }

  /**
   * Abort the current streaming response.
   */
  abort(): void {
    this.pubchat.abort()
  }

  /**
   * Reset the conversation — clears history.
   */
  async reset(): Promise<void> {
    this.initialized = false
    this.historyId = null
  }
}
