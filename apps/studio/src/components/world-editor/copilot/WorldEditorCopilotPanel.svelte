<!--
  WorldEditorCopilotPanel.svelte
  
  AI Copilot panel for the World Editor (Simple Mode).
  Uses WorldEditorCopilotOrchestrator to manage chat with state manipulation tools.
-->
<script lang="ts">
  import { setContext } from 'svelte';
  import {
    ChatMessages,
    ChatInput,
    createMessagesStore,
    createChatInputStore,
    createActiveChatStore,
    CHAT_CONTEXT_KEY,
    type ChatContext,
    type DisplayMessage,
    type UIMessageBlock,
  } from '@pubwiki/svelte-chat';
  import {
    WorldEditorCopilotOrchestrator,
    type WorldEditorCopilotConfig,
    type WorldEditorAIContext,
    type QueryUserRequest,
    // WorldBuilder engine
    createWBNSession,
    streamAndApplyPhase,
    streamWorldBuilderRevision,
    advancePhase,
    initCreatureBatching,
    applyPhaseOutput,
    computePhaseChanges,
    createDefaultStateData,
    WBN_PHASE_IDS,
    WBN_PHASE_LABELS,
    type WBNSession,
    type WBNPhaseId,
    type WBNPhaseStatus,
    type WBNReferenceFile,
    type WBNStreamEvent,
    type WorldBuilderConfig,
    type WorldBuilderContext,
    type WorkspaceFileInfo,
    type LorebookData,
    type StateChangeEntry,
    WBNSessionStore,
    // Designer
    DesignerOrchestrator,
    type DesignerConfig,
  } from '@pubwiki/world-editor';
  import { getSettingsStore } from '@pubwiki/ui/stores';
  import { persist } from '@pubwiki/ui/utils';
  import { getWorldEditorContext } from '../state/context';
  import { getNodeVfs, type NodeVfs } from '$lib/vfs';
  import { nodeStore } from '$lib/persistence/node-store.svelte';
  import { VfsWorkspaceFileProvider } from './vfs-file-provider';
  import CopilotToolCallBlock from '../../copilot/CopilotToolCallBlock.svelte';
  import QueryUserFormBlock from './QueryUserFormBlock.svelte';
  import { ChatMessageStore } from './chat-message-store';
  import SandboxPreviewView from '../../nodes/sandbox/SandboxPreviewView.svelte';
  import { detectProject } from '@pubwiki/bundler';
  import type { ProjectConfig } from '@pubwiki/sandbox-host';
  // Builder views
  import BuilderPhaseIndicator from './builder/BuilderPhaseIndicator.svelte';
  import BuilderSetupView from './builder/BuilderSetupView.svelte';
  import BuilderProgressView from './builder/BuilderProgressView.svelte';
  import BuilderReviewView from './builder/BuilderReviewView.svelte';
  import BuilderLogPanel, { type LogEntry } from './builder/BuilderLogPanel.svelte';

  // ============================================================================
  // Props
  // ============================================================================

  interface Props {
    collapsed?: boolean;
    hideCollapsedButton?: boolean;
    class?: string;
    /** Panel width in px (bindable for parent to read) */
    copilotWidth?: number;
  }

  let {
    collapsed = $bindable(true),
    hideCollapsedButton = false,
    class: className = '',
    copilotWidth: _copilotWidth = $bindable(420),
  }: Props = $props();

  // ============================================================================
  // State
  // ============================================================================

  let orchestrator = $state<WorldEditorCopilotOrchestrator | null>(null);
  let error = $state<string | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);

  // Panel mode: chat (free-form copilot) vs builder (guided world-building wizard) vs designer (frontend code agent)
  type PanelMode = 'chat' | 'builder' | 'designer';
  const persistedPanelMode = persist<PanelMode>('world-editor-copilot-mode', 'chat');
  let panelMode = $state<PanelMode>(persistedPanelMode.value);

  // Sync panelMode to localStorage
  $effect(() => { persistedPanelMode.value = panelMode; });

  // Builder sub-state (for future Phase D implementation)
  type BuilderPhase = 'setup' | 'generating' | 'waiting' | 'revising' | 'error' | 'completed';
  let builderPhase = $state<BuilderPhase>('setup');

  // Mode switching is blocked when builder is actively generating/revising
  let canSwitchMode = $derived(
    panelMode === 'chat' || panelMode === 'designer' || builderPhase === 'setup' || builderPhase === 'waiting' || builderPhase === 'completed' || builderPhase === 'error'
  );

  // query_user state
  let pendingQueryRequest = $state<QueryUserRequest | null>(null);
  let queryFormSubmitted = $state(false);

  // Builder state
  let builderSession = $state<WBNSession | null>(null);
  let builderAbortController = $state<AbortController | null>(null);
  let builderStatusMessage = $state('');
  let builderCharCount = $state(0);
  let builderAiText = $state('');
  let builderPendingQuery = $state<QueryUserRequest | null>(null);
  let builderQuerySubmitted = $state(false);
  let builderQueryResolve = $state<((data: Record<string, unknown>) => void) | null>(null);
  let builderIsRevising = $state(false);

  // Designer state
  let designerOrchestrator = $state<DesignerOrchestrator | null>(null);
  let designerMessages = createMessagesStore();
  let designerInputStore = createChatInputStore();
  let designerActiveChatStore = createActiveChatStore();
  let designerShowPreview = $state(false);
  let designerPreviewVfs = $state<NodeVfs | null>(null);
  let designerProjectConfig = $state<ProjectConfig | null>(null);
  let designerEntryFile = $state('index.html');
  let builderRevisionLog = $state<Array<{ toolName: string; summary: string }>>([]);
  let builderError = $state<string | null>(null);
  let builderEventLog = $state<LogEntry[]>([]);
  let builderChanges = $state<StateChangeEntry[]>([]);

  // Rollback confirmation state
  let rollbackTarget = $state<WBNPhaseId | null>(null);

  // Phase history viewing state (view past phase changes without rollback)
  let viewingPhase = $state<WBNPhaseId | null>(null);
  let viewingChanges = $state<StateChangeEntry[]>([]);

  // Derive phase statuses from session
  let phaseStatuses = $derived.by((): Record<WBNPhaseId, WBNPhaseStatus> => {
    if (!builderSession) {
      const empty = {} as Record<WBNPhaseId, WBNPhaseStatus>;
      for (const id of WBN_PHASE_IDS) empty[id] = 'pending';
      return empty;
    }
    const statuses = {} as Record<WBNPhaseId, WBNPhaseStatus>;
    for (const id of WBN_PHASE_IDS) {
      statuses[id] = builderSession.phases[id].status;
    }
    return statuses;
  });

  // Chat stores
  const messagesStore = createMessagesStore();
  const inputStore = createChatInputStore();
  const activeChatStore = createActiveChatStore();

  // Panel width (persisted)
  const MIN_WIDTH = 360;
  const MAX_WIDTH = 600;
  const persistedWidth = persist<number>('world-editor-copilot-width', 420);
  let panelWidth = $derived(persistedWidth.value);
  let isResizing = $state(false);

  // Sync panelWidth to bindable prop so parent can read it
  $effect(() => { _copilotWidth = panelWidth; });

  // ============================================================================
  // LLM Configuration from Settings
  // ============================================================================

  const settingsStore = getSettingsStore();

  let isLLMConfigured = $derived(
    !!settingsStore.api.apiKey &&
    !!settingsStore.api.selectedModel &&
    !!settingsStore.effectiveBaseUrl
  );

  // ============================================================================
  // World Editor Context → AI Context
  // ============================================================================

  const weCtx = getWorldEditorContext();

  // File provider (lazy-initialized, needs async VFS)
  let fileProvider = $state<VfsWorkspaceFileProvider | null>(null);
  let fileList = $state<WorkspaceFileInfo[]>([]);
  let showFilesPanel = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);

  // WBN session persistence
  const sessionStore = new WBNSessionStore(weCtx.projectId);
  // Chat message persistence
  const chatStore = new ChatMessageStore(weCtx.projectId);

  async function ensureFileProvider(): Promise<VfsWorkspaceFileProvider> {
    if (fileProvider) return fileProvider;
    // Use a fixed virtual nodeId for copilot workspace files
    const vfs = await getNodeVfs(weCtx.projectId, '__copilot_files__');
    fileProvider = new VfsWorkspaceFileProvider(vfs);
    return fileProvider;
  }

  async function refreshFileList() {
    const provider = await ensureFileProvider();
    fileList = await provider.listFiles();
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const provider = await ensureFileProvider();
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      await provider.writeFile(file.name, new Uint8Array(buffer));
    }
    input.value = '';
    await refreshFileList();
  }

  async function handleDeleteFile(filename: string) {
    const provider = await ensureFileProvider();
    await provider.deleteFile(filename);
    await refreshFileList();
  }

  function createAIContext(): WorldEditorAIContext {
    return {
      store: weCtx.store,
      translator: weCtx.translator,
      view: weCtx.view,
      getState: () => $state.snapshot(weCtx.stateData),
      applyOps: (ops) => weCtx.applyOps(ops),
    };
  }

  /** Persist the current builder session (fire-and-forget). */
  function saveBuilderSession() {
    if (builderSession) {
      // Strip Svelte 5 $state proxies — IndexedDB structured clone cannot handle Proxy objects
      sessionStore.save($state.snapshot(builderSession)).catch((e) => console.warn('[WBN] Failed to save session:', e));
    }
  }

  /** Try to restore a saved builder session on mount. */
  async function restoreBuilderSession() {
    try {
      const saved = await sessionStore.load();
      if (saved && saved.status !== 'error') {
        builderSession = saved;
        // Determine builder phase from session state
        const currentPhaseStatus = saved.phases[saved.currentPhase].status;
        if (saved.status === 'completed') {
          builderPhase = 'completed';
        } else if (currentPhaseStatus === 'completed') {
          builderPhase = 'waiting';
        } else {
          builderPhase = 'waiting';
          // Reset the active phase to completed so user can retry or continue
          saved.phases[saved.currentPhase].status = 'completed';
        }
        // Reconstruct change report for current phase from saved outputs
        if (builderPhase === 'waiting' && saved.phases[saved.currentPhase].output) {
          builderChanges = computePhaseChanges(saved, saved.currentPhase);
        }
        panelMode = 'builder';
      }
    } catch (e) {
      console.warn('[WBN] Failed to restore session:', e);
    }
  }

  // ============================================================================
  // Context Setup
  // ============================================================================

  setContext<ChatContext>(CHAT_CONTEXT_KEY, {
    pubchat: null,
    messagesStore,
    inputStore,
    activeChatStore,
  });

  // ============================================================================
  // Orchestrator Setup
  // ============================================================================

  function initializeOrchestrator() {
    if (!isLLMConfigured) {
      error = 'Please configure LLM settings (API key, model, base URL) in Settings to use the World Editor Copilot.';
      return;
    }

    error = null;

    const config: WorldEditorCopilotConfig = {
      llm: {
        apiKey: settingsStore.api.apiKey,
        model: settingsStore.api.selectedModel,
        baseUrl: settingsStore.effectiveBaseUrl,
        temperature: 0.7,
        maxTokens: 4096,
      },
      aiContext: createAIContext(),
      fileProvider: fileProvider ?? undefined,
      getWorkspaceFiles: () => fileList,
    };

    orchestrator = new WorldEditorCopilotOrchestrator(config);

    // Eagerly initialize file provider in background
    ensureFileProvider().then(() => refreshFileList()).catch(() => {});

    // Also initialize designer orchestrator
    initializeDesignerOrchestrator();
  }

  function initializeDesignerOrchestrator() {
    if (!isLLMConfigured) return;

    const frontendVfsNode = nodeStore.findByMetadata('simple-mode-role', 'frontend-vfs');
    const frontendVfsNodeId = frontendVfsNode?.id ?? null;

    // Also find the sandbox node for entryFile
    const sandboxNode = nodeStore.findByMetadata('simple-mode-role', 'sandbox');
    if (sandboxNode && 'content' in sandboxNode && (sandboxNode as any).content?.entryFile) {
      designerEntryFile = (sandboxNode as any).content.entryFile;
    }

    // Cache the VFS instance
    let frontendVfs: import('@pubwiki/vfs').Vfs | null = null;
    let frontendVfsInitializing = false;

    async function ensureFrontendVfs() {
      if (frontendVfs || frontendVfsInitializing || !frontendVfsNodeId) return;
      frontendVfsInitializing = true;
      try {
        const nodeVfs = await getNodeVfs(weCtx.projectId, frontendVfsNodeId);
        frontendVfs = nodeVfs;
        // Store NodeVfs for preview and detect project config
        designerPreviewVfs = nodeVfs;
        const config = await detectProject('/tsconfig.json', nodeVfs);
        if (config?.isBuildable) {
          designerProjectConfig = config;
        }
      } catch (e) {
        console.warn('[Designer] Failed to get frontend VFS:', e);
      } finally {
        frontendVfsInitializing = false;
      }
    }

    // Start VFS init eagerly
    ensureFrontendVfs();

    const designerConfig: DesignerConfig = {
      llm: {
        apiKey: settingsStore.api.apiKey,
        model: settingsStore.api.selectedModel,
        baseUrl: settingsStore.effectiveBaseUrl,
        temperature: 0.7,
        maxTokens: 4096,
      },
      aiContext: createAIContext(),
      getFrontendVfs: () => frontendVfs,
    };

    designerOrchestrator = new DesignerOrchestrator(designerConfig);
  }

  // Guard: only restore once per panel lifetime
  let sessionRestored = false;

  // Initialize on mount and when settings change
  $effect(() => {
    if (isLLMConfigured && !collapsed) {
      initializeOrchestrator();
      // Try to restore saved state (only once)
      if (!sessionRestored) {
        sessionRestored = true;
        restoreBuilderSession();
        restoreChatMessages();
      }
    }
  });

  // Save session before page unload
  $effect(() => {
    function onBeforeUnload() {
      saveBuilderSession();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  });

  async function restoreChatMessages() {
    try {
      const saved = await chatStore.load();
      if (saved.length > 0) {
        messagesStore.setMessages(saved);
      }
    } catch (e) {
      console.warn('[Chat] Failed to restore messages:', e);
    }
  }

  function saveChatMessages() {
    chatStore.save($state.snapshot(messagesStore.messages)).catch((e) => console.warn('[Chat] Failed to save messages:', e));
  }

  // ============================================================================
  // Chat Handling
  // ============================================================================

  async function handleSend(content: string) {
    if (!content.trim() || !orchestrator) return;

    // Add user message
    const userMessage: DisplayMessage = {
      id: `msg-${Date.now()}`,
      parentId: null,
      role: 'user',
      blocks: [{ id: `block-${Date.now()}`, type: 'markdown', content }],
      timestamp: Date.now(),
    };
    messagesStore.addMessage(userMessage);
    inputStore.reset();

    // Start streaming
    activeChatStore.startGeneration();

    try {
      for await (const event of orchestrator.chat(content)) {
        if (event.type === 'query_user') {
          // Show the query_user form inline
          pendingQueryRequest = event.request;
          queryFormSubmitted = false;
          continue;
        }
        if (event.type === 'query_user_submitted') {
          continue;
        }
        if (event.type === 'token') {
          if (!activeChatStore.firstTokenReceived) {
            activeChatStore.markFirstTokenReceived();
          }

          const currentBlocks = activeChatStore.streamingMessage?.blocks || [];
          const lastBlock = currentBlocks[currentBlocks.length - 1];

          if (lastBlock && lastBlock.type === 'markdown') {
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks.slice(0, -1),
              { ...lastBlock, content: lastBlock.content + event.token },
            ]);
          } else {
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks,
              { id: `block-${Date.now()}`, type: 'markdown', content: event.token },
            ]);
          }
        } else if (event.type === 'tool_call') {
          const toolBlock: UIMessageBlock = {
            id: `block-${Date.now()}`,
            type: 'tool_call',
            content: '',
            toolCallId: event.id,
            toolName: event.name,
            toolArgs: event.args,
            toolStatus: 'running',
          };
          activeChatStore.updateStreamingBlocks([
            ...(activeChatStore.streamingMessage?.blocks || []),
            toolBlock,
          ]);
        } else if (event.type === 'tool_result') {
          const blocks = activeChatStore.streamingMessage?.blocks || [];
          const updatedBlocks = blocks.map((b) =>
            b.toolCallId === event.id && b.type === 'tool_call'
              ? { ...b, toolStatus: 'completed' as const }
              : b
          );
          const resultBlock: UIMessageBlock = {
            id: `result-${Date.now()}`,
            type: 'tool_result',
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            toolCallId: event.id,
          };
          activeChatStore.updateStreamingBlocks([...updatedBlocks, resultBlock]);
          activeChatStore.incrementIteration();
        } else if (event.type === 'done') {
          const assistantMessage: DisplayMessage = {
            id: event.message.id,
            parentId: userMessage.id,
            role: 'assistant',
            blocks: event.message.blocks as UIMessageBlock[],
            timestamp: event.message.timestamp,
            model: event.message.model,
          };
          messagesStore.addMessage(assistantMessage);
          activeChatStore.endGeneration();
          saveChatMessages();
        } else if (event.type === 'error') {
          console.error('World Editor Copilot error:', event.error);
          activeChatStore.endGeneration();
        }
      }
    } catch (err) {
      console.error('World Editor Copilot error:', err);
      activeChatStore.endGeneration();
    }
  }

  function handleAbort() {
    orchestrator?.abort();
    activeChatStore.endGeneration();
  }

  function handleClearHistory() {
    orchestrator?.reset();
    messagesStore.setMessages([]);
    pendingQueryRequest = null;
    queryFormSubmitted = false;
    chatStore.clear().catch(() => {});
  }

  function handleQueryUserSubmit(data: Record<string, unknown>) {
    if (!orchestrator) return;
    queryFormSubmitted = true;
    orchestrator.submitQueryUserForm(data);
  }

  // ============================================================================
  // Designer Chat Handling
  // ============================================================================

  async function handleDesignerSend(content: string) {
    if (!content.trim() || !designerOrchestrator) return;

    const userMessage: DisplayMessage = {
      id: `msg-${Date.now()}`,
      parentId: null,
      role: 'user',
      blocks: [{ id: `block-${Date.now()}`, type: 'markdown', content }],
      timestamp: Date.now(),
    };
    designerMessages.addMessage(userMessage);
    designerInputStore.reset();
    designerActiveChatStore.startGeneration();

    try {
      for await (const event of designerOrchestrator.chat(content)) {
        if (event.type === 'token') {
          if (!designerActiveChatStore.firstTokenReceived) {
            designerActiveChatStore.markFirstTokenReceived();
          }
          const currentBlocks = designerActiveChatStore.streamingMessage?.blocks || [];
          const lastBlock = currentBlocks[currentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'markdown') {
            designerActiveChatStore.updateStreamingBlocks([
              ...currentBlocks.slice(0, -1),
              { ...lastBlock, content: lastBlock.content + event.token },
            ]);
          } else {
            designerActiveChatStore.updateStreamingBlocks([
              ...currentBlocks,
              { id: `block-${Date.now()}`, type: 'markdown', content: event.token },
            ]);
          }
        } else if (event.type === 'tool_call') {
          const toolBlock: UIMessageBlock = {
            id: `block-${Date.now()}`,
            type: 'tool_call',
            content: '',
            toolCallId: event.id,
            toolName: event.name,
            toolArgs: event.args,
            toolStatus: 'running',
          };
          designerActiveChatStore.updateStreamingBlocks([
            ...(designerActiveChatStore.streamingMessage?.blocks || []),
            toolBlock,
          ]);
        } else if (event.type === 'tool_result') {
          const blocks = designerActiveChatStore.streamingMessage?.blocks || [];
          const updatedBlocks = blocks.map((b) =>
            b.toolCallId === event.id && b.type === 'tool_call'
              ? { ...b, toolStatus: 'completed' as const }
              : b
          );
          const resultBlock: UIMessageBlock = {
            id: `result-${Date.now()}`,
            type: 'tool_result',
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            toolCallId: event.id,
          };
          designerActiveChatStore.updateStreamingBlocks([...updatedBlocks, resultBlock]);
          designerActiveChatStore.incrementIteration();
        } else if (event.type === 'done') {
          const assistantMessage: DisplayMessage = {
            id: event.message.id,
            parentId: userMessage.id,
            role: 'assistant',
            blocks: event.message.blocks as UIMessageBlock[],
            timestamp: event.message.timestamp,
            model: event.message.model,
          };
          designerMessages.addMessage(assistantMessage);
          designerActiveChatStore.endGeneration();
        } else if (event.type === 'error') {
          console.error('Designer error:', event.error);
          designerActiveChatStore.endGeneration();
        }
      }
    } catch (err) {
      console.error('Designer error:', err);
      designerActiveChatStore.endGeneration();
    }
  }

  function handleDesignerAbort() {
    designerOrchestrator?.abort();
    designerActiveChatStore.endGeneration();
  }

  function handleDesignerClearHistory() {
    designerOrchestrator?.reset();
    designerMessages.setMessages([]);
  }

  // ============================================================================
  // Builder Engine
  // ============================================================================

  function getBuilderConfig(): WorldBuilderConfig {
    return {
      llm: {
        apiKey: settingsStore.api.apiKey,
        model: settingsStore.api.selectedModel,
        baseUrl: settingsStore.effectiveBaseUrl,
        temperature: 0.7,
        maxTokens: 20480,
      },
    };
  }

  function getBuilderContext(session: WBNSession, signal: AbortSignal): WorldBuilderContext {
    return {
      ctx: createAIContext(),
      session,
      queryUser: (request: QueryUserRequest) => {
        return new Promise<Record<string, unknown>>((resolve) => {
          builderPendingQuery = request;
          builderQuerySubmitted = false;
          builderQueryResolve = resolve;
        });
      },
      signal,
    };
  }

  function handleBuilderQuerySubmit(data: Record<string, unknown>) {
    builderQuerySubmitted = true;
    builderQueryResolve?.(data);
    builderQueryResolve = null;
  }

  async function handleBuilderStart(prompt: string, options: { referenceFile?: WBNReferenceFile; referenceLorebook?: LorebookData; clearBeforeGenerate: boolean }) {
    if (!isLLMConfigured) return;

    if (options.clearBeforeGenerate) {
      weCtx.store.clear();
    }

    const session = createWBNSession(prompt, options.referenceFile, options.referenceLorebook);
    builderSession = session;
    builderPhase = 'generating';
    builderError = null;
    builderRevisionLog = [];
    saveBuilderSession();

    await runBuilderPhase(session, 'synopsis');
  }

  async function runBuilderPhase(session: WBNSession, phaseId: WBNPhaseId) {
    builderPhase = 'generating';
    builderStatusMessage = '';
    builderCharCount = 0;
    builderAiText = '';
    builderPendingQuery = null;
    builderQuerySubmitted = false;
    builderError = null;
    builderEventLog = [{ timestamp: Date.now(), type: 'info', message: `Starting phase: ${WBN_PHASE_LABELS[phaseId]}` }];
    builderChanges = [];
    viewingPhase = null;
    viewingChanges = [];

    const abortController = new AbortController();
    builderAbortController = abortController;

    const config = getBuilderConfig();
    const wbCtx = getBuilderContext(session, abortController.signal);

    try {
      for await (const event of streamAndApplyPhase(config, wbCtx, phaseId)) {
        if (abortController.signal.aborted) break;
        handleBuilderEvent(event, phaseId);
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        builderError = (e as Error).message;
        builderPhase = 'error';
      }
    } finally {
      builderAbortController = null;
    }
  }

  function handleBuilderEvent(event: WBNStreamEvent, phaseId: WBNPhaseId) {
    const log = (type: LogEntry['type'], message: string) => {
      builderEventLog = [...builderEventLog, { timestamp: Date.now(), type, message }];
    };

    switch (event.type) {
      case 'extraction_progress':
        builderStatusMessage = event.message;
        builderAiText = '';
        log('info', event.message);
        break;
      case 'streaming_progress':
        builderCharCount = event.charCount;
        break;
      case 'ai_text':
        builderAiText += event.text;
        break;
      case 'query_user':
        log('info', 'Requesting user input...');
        break;
      case 'validation_retry':
        if (event.accepted) {
          builderStatusMessage = 'Validation issues accepted, proceeding...';
          log('warning', 'Validation issues accepted');
        } else {
          builderStatusMessage = `Validation retry ${event.attempt}: fixing errors...`;
          log('warning', `Validation retry ${event.attempt}: ${event.errors.length} errors`);
        }
        break;
      case 'draft_review':
        log('info', 'Draft review received');
        break;
      case 'phase_output':
        log('success', `Phase output generated (${phaseId})`);
        saveBuilderSession();
        break;
      case 'phase_applied':
        builderChanges = event.changes;
        for (const ch of event.changes) {
          log('info', `${ch.action}: ${ch.label}`);
        }
        break;
      case 'done':
        log('success', `Phase "${WBN_PHASE_LABELS[phaseId]}" completed`);
        if (phaseId === 'synopsis' && builderSession) {
          initCreatureBatching(builderSession);
        }
        builderPhase = 'waiting';
        builderRevisionLog = [];
        saveBuilderSession();
        // Auto-navigate to the relevant tab
        {
          const phaseTabMap: Record<string, string> = {
            synopsis: 'dashboard',
            initial_story: 'story',
            world_data: 'world',
            regions: 'regions',
            organizations: 'organizations',
            creatures: 'characters',
          };
          const tab = phaseTabMap[phaseId];
          if (tab) weCtx.navigateTab(tab);
        }
        break;
      case 'error':
        builderError = event.error;
        builderPhase = 'error';
        log('error', event.error);
        break;
    }
  }

  function handleBuilderCancel() {
    builderAbortController?.abort();
    builderAbortController = null;
    builderPhase = 'setup';
    builderSession = null;
  }

  async function handleBuilderRevise(message: string) {
    if (!builderSession || !isLLMConfigured) return;

    const phaseId = builderSession.currentPhase;
    builderIsRevising = true;

    const abortController = new AbortController();
    builderAbortController = abortController;

    const config = getBuilderConfig();
    const ctx = createAIContext();

    try {
      for await (const event of streamWorldBuilderRevision(
        config,
        builderSession,
        phaseId,
        message,
        ctx,
        abortController.signal,
      )) {
        if (abortController.signal.aborted) break;

        switch (event.type) {
          case 'revision_patch':
            builderRevisionLog = [...builderRevisionLog, { toolName: event.toolName, summary: event.summary }];
            break;
          case 'revision_done':
            break;
          case 'error':
            builderError = event.error;
            break;
          case 'done':
            break;
        }
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        builderError = (e as Error).message;
      }
    } finally {
      builderIsRevising = false;
      builderAbortController = null;
      saveBuilderSession();
    }
  }

  async function handleBuilderNext() {
    if (!builderSession) return;

    const hasNext = advancePhase(builderSession);
    if (!hasNext) {
      builderPhase = 'completed';
      builderSession.status = 'completed';
      saveBuilderSession();
      return;
    }

    await runBuilderPhase(builderSession, builderSession.currentPhase);
  }

  /** Regenerate the current phase from scratch (rollback to before it, then re-run). */
  function handleBuilderRegenerate() {
    if (!builderSession) return;

    const phaseId = builderSession.currentPhase;
    const phaseIdx = WBN_PHASE_IDS.indexOf(phaseId);
    if (phaseIdx < 0) return;

    // 1. Clear store and reinitialize with default world data
    weCtx.store.clear();
    const defaultState = createDefaultStateData();
    const initialTriples = weCtx.translator.stateDataToTriples(defaultState);
    weCtx.store.batchInsert(initialTriples);

    // 2. Re-apply all completed phases before the current one
    const ctx = createAIContext();
    for (let i = 0; i < phaseIdx; i++) {
      const pid = WBN_PHASE_IDS[i];
      if (builderSession.phases[pid].output) {
        applyPhaseOutput(builderSession, pid, ctx);
      }
    }

    // 3. Reset current phase and all subsequent
    for (let i = phaseIdx; i < WBN_PHASE_IDS.length; i++) {
      const pid = WBN_PHASE_IDS[i];
      builderSession.phases[pid].status = i === phaseIdx ? 'active' : 'pending';
      builderSession.phases[pid].output = undefined;
      builderSession.phases[pid].error = undefined;
    }

    // 4. Reset creature batching if needed
    if (phaseIdx <= WBN_PHASE_IDS.indexOf('creatures')) {
      builderSession.creatureBatching = undefined;
    }

    // 5. Update session and re-run
    builderSession.status = 'active';
    builderSession.updatedAt = Date.now();
    builderError = null;
    builderRevisionLog = [];
    builderChanges = [];
    saveBuilderSession();

    runBuilderPhase(builderSession, phaseId);
  }

  function handleBuilderReset() {
    builderAbortController?.abort();
    builderAbortController = null;
    builderSession = null;
    builderPhase = 'setup';
    builderError = null;
    builderRevisionLog = [];
    builderStatusMessage = '';
    builderCharCount = 0;
    builderAiText = '';
    builderPendingQuery = null;
    builderQuerySubmitted = false;
    builderQueryResolve = null;
    builderIsRevising = false;
    builderEventLog = [];
    sessionStore.delete().catch(() => {});
  }

  /** Rollback to a previously completed phase, re-applying all phases up to and including the target. */
  function handleBuilderRollback(targetPhaseId: WBNPhaseId) {
    if (!builderSession) return;

    const targetIdx = WBN_PHASE_IDS.indexOf(targetPhaseId);
    if (targetIdx < 0) return;

    // 1. Clear store and reinitialize with default world data
    weCtx.store.clear();
    const defaultState = createDefaultStateData();
    const initialTriples = weCtx.translator.stateDataToTriples(defaultState);
    weCtx.store.batchInsert(initialTriples);

    // 2. Re-apply all phases up to and including the target
    const ctx = createAIContext();
    let lastChanges: StateChangeEntry[] = [];
    for (let i = 0; i <= targetIdx; i++) {
      const phaseId = WBN_PHASE_IDS[i];
      if (builderSession.phases[phaseId].output) {
        const result = applyPhaseOutput(builderSession, phaseId, ctx);
        if (i === targetIdx) {
          lastChanges = result.changes;
        }
      }
    }

    // 3. Reset phases after the target
    for (let i = targetIdx + 1; i < WBN_PHASE_IDS.length; i++) {
      const phaseId = WBN_PHASE_IDS[i];
      builderSession.phases[phaseId].status = 'pending';
      builderSession.phases[phaseId].output = undefined;
      builderSession.phases[phaseId].error = undefined;
    }

    // 4. Mark target phase as completed (review state)
    builderSession.phases[targetPhaseId].status = 'completed';

    // 5. Reset creature batching if rolling back before creatures
    if (targetIdx < WBN_PHASE_IDS.indexOf('creatures')) {
      builderSession.creatureBatching = undefined;
    }

    // 6. Update session state
    builderSession.currentPhase = targetPhaseId;
    builderSession.status = 'active';
    builderSession.updatedAt = Date.now();

    // 7. Show review state with the re-applied changes
    builderPhase = 'waiting';
    builderError = null;
    builderRevisionLog = [];
    builderChanges = lastChanges;
    rollbackTarget = null;
    viewingPhase = null;
    viewingChanges = [];
    saveBuilderSession();
  }

  function handleExportJSON() {
    if (!builderSession) return;
    const exportData: Record<string, unknown> = {
      prompt: builderSession.initialPrompt,
      createdAt: builderSession.createdAt,
      phases: {} as Record<string, unknown>,
    };
    for (const phaseId of WBN_PHASE_IDS) {
      const phase = builderSession.phases[phaseId];
      if (phase.output) {
        (exportData.phases as Record<string, unknown>)[phaseId] = phase.output;
      }
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `world-builder-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================================================
  // Resize Handling
  // ============================================================================

  function startResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);

    function onPointerMove(e: PointerEvent) {
      const delta = startX - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      persistedWidth.value = newWidth;
    }

    function onPointerUp(e: PointerEvent) {
      isResizing = false;
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
    }

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
  }

  // ============================================================================
  // Toggle
  // ============================================================================

  function toggle() {
    collapsed = !collapsed;
    if (!collapsed && !orchestrator) {
      initializeOrchestrator();
    }
  }
</script>

<!-- Collapsed Button -->
{#if collapsed && !hideCollapsedButton}
  <button
    class="absolute top-4 right-4 z-30 p-2.5 bg-white border border-gray-200 text-gray-600 rounded-lg shadow-md hover:shadow-lg hover:border-gray-300 hover:text-gray-800 transition-all"
    onclick={toggle}
    title="Open World Editor Copilot"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  </button>
{/if}

<!-- Expanded Panel -->
{#if !collapsed}
  <div
    bind:this={panelEl}
    class="absolute top-4 right-4 bottom-4 z-20 bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col overflow-hidden {className}"
    style="width: {panelWidth}px;"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <!-- Resize Handle -->
    <div
      class="group absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-12 cursor-ew-resize z-10 flex items-center justify-center"
      onpointerdown={startResize}
      role="separator"
      aria-orientation="vertical"
    >
      <div class="w-0.5 h-8 rounded-full transition-all duration-150 {isResizing ? 'bg-purple-500 h-10 opacity-100' : 'bg-gray-400 opacity-0 group-hover:opacity-100 group-hover:h-10'}"></div>
    </div>

    <!-- Header -->
    <div class="border-b border-gray-200 bg-gray-50">
      <!-- Top row: mode tabs + actions -->
      <div class="flex items-center justify-between px-3 pt-2.5 pb-0">
        <!-- Mode Tabs -->
        <div class="flex items-center gap-0.5 rounded-lg bg-gray-200/70 p-0.5">
          <button
            class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {panelMode === 'chat' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
            onclick={() => { if (canSwitchMode) panelMode = 'chat'; }}
            disabled={!canSwitchMode && panelMode !== 'chat'}
            title="Free-form AI chat"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Chat
          </button>
          <button
            class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {panelMode === 'builder' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
            onclick={() => { if (canSwitchMode) panelMode = 'builder'; }}
            disabled={!canSwitchMode && panelMode !== 'builder'}
            title="Guided world-building wizard"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Builder
          </button>
          <button
            class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {panelMode === 'designer' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
            onclick={() => { if (canSwitchMode) panelMode = 'designer'; }}
            disabled={!canSwitchMode && panelMode !== 'designer'}
            title="AI frontend designer"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            Designer
          </button>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-0.5">
          <span class="px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-500 rounded">Beta</span>
          {#if panelMode === 'chat'}
            <!-- Clear History (chat mode only) -->
            <button
              class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              onclick={handleClearHistory}
              title="Clear conversation"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {:else if panelMode === 'builder' && builderPhase !== 'setup'}
            <!-- Reset Builder -->
            <button
              class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              onclick={handleBuilderReset}
              title="Reset Builder"
              disabled={builderPhase === 'generating' || builderIsRevising}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          {:else if panelMode === 'designer'}
            <!-- Preview Button -->
            <button
              class="p-1.5 transition-colors rounded-lg {designerProjectConfig ? 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50' : 'text-gray-300 cursor-not-allowed'}"
              onclick={() => { if (designerProjectConfig) designerShowPreview = true; }}
              disabled={!designerProjectConfig}
              title={designerProjectConfig ? 'Open preview' : 'Preview unavailable (project not detected)'}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <!-- Clear Designer History -->
            <button
              class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              onclick={handleDesignerClearHistory}
              title="Clear conversation"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {/if}
          <!-- Collapse -->
          <button
            class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            onclick={toggle}
            title="Close Copilot"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Phase history viewing bar -->
      {#if viewingPhase}
        <div class="flex items-center justify-between px-3 py-2.5 bg-blue-50 border-t border-blue-100">
          <span class="text-xs text-blue-700 font-medium truncate">
            {WBN_PHASE_LABELS[viewingPhase]}
          </span>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button
              class="px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
              onclick={() => { rollbackTarget = viewingPhase; }}
            >回退到此处</button>
            <button
              class="px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-md transition-colors"
              onclick={() => { viewingPhase = null; viewingChanges = []; }}
            >返回当前进度</button>
          </div>
        </div>
      {:else}
        <!-- Spacer below tabs -->
        <div class="h-2.5"></div>
      {/if}

      <!-- Phase indicator (builder mode, after setup) -->
      {#if panelMode === 'builder' && builderSession}
        <BuilderPhaseIndicator
          currentPhase={builderSession.currentPhase}
          {phaseStatuses}
          onphaseclick={(phaseId) => {
            if (builderSession) {
              if (phaseId === builderSession.currentPhase) {
                // Clicking current phase returns to current progress
                viewingPhase = null;
                viewingChanges = [];
              } else {
                viewingPhase = phaseId;
                viewingChanges = computePhaseChanges(builderSession, phaseId);
              }
            }
          }}
        />
      {/if}
    </div>

    <!-- Rollback confirmation overlay -->
    {#if rollbackTarget}
      <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
        <div class="bg-white rounded-xl shadow-lg p-5 mx-4 max-w-xs w-full space-y-3">
          <p class="text-sm font-medium text-gray-800">Rollback to "{WBN_PHASE_LABELS[rollbackTarget]}"?</p>
          <p class="text-xs text-gray-500">All progress from this phase onward will be discarded and the phase will be re-generated.</p>
          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              onclick={() => { rollbackTarget = null; }}
            >Cancel</button>
            <button
              class="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              onclick={() => { if (rollbackTarget) handleBuilderRollback(rollbackTarget); }}
            >Confirm Rollback</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Error State -->
    {#if error}
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="text-center max-w-xs">
          <div class="w-12 h-12 mx-auto mb-4 bg-yellow-100 rounded-full flex items-center justify-center">
            <svg class="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p class="text-sm text-gray-600 mb-4">{error}</p>
        </div>
      </div>

    {:else if panelMode === 'chat'}
      <!-- ============ CHAT MODE ============ -->

      <!-- Workspace Files Bar -->
      <div class="border-b border-gray-100">
        <button
          class="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          onclick={() => { showFilesPanel = !showFilesPanel; if (showFilesPanel) refreshFileList(); }}
        >
          <svg class="w-3 h-3 transition-transform {showFilesPanel ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Workspace Files
          {#if fileList.length > 0}
            <span class="ml-auto px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-500 rounded-full">{fileList.length}</span>
          {/if}
        </button>

        {#if showFilesPanel}
          <div class="px-3 pb-2 space-y-1.5">
            <!-- File list -->
            {#if fileList.length > 0}
              <div class="max-h-32 overflow-y-auto space-y-0.5">
                {#each fileList as file}
                  <div class="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-gray-50 group">
                    <span class="text-gray-400">
                      {#if file.type === 'image'}
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      {:else}
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      {/if}
                    </span>
                    <span class="text-gray-600 truncate flex-1">{file.name}</span>
                    <span class="text-[10px] text-gray-400">{(file.size / 1024).toFixed(1)}K</span>
                    <button
                      class="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-0.5"
                      onclick={() => handleDeleteFile(file.name)}
                      title="Remove file"
                    >
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Upload button -->
            <button
              class="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-xs text-gray-500 hover:text-purple-600 border border-dashed border-gray-200 hover:border-purple-300 rounded-lg transition-colors"
              onclick={() => fileInputEl?.click()}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Upload file
            </button>
            <input
              bind:this={fileInputEl}
              type="file"
              accept=".md,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.svg"
              multiple
              class="hidden"
              onchange={handleFileUpload}
            />
          </div>
        {/if}
      </div>

      <!-- Messages or Welcome -->
      <div class="flex-1 overflow-y-auto px-2">
        {#if messagesStore.messages.length === 0 && !activeChatStore.isGenerating && !activeChatStore.streamingMessage}
          <!-- Welcome message -->
          <div class="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
            <div class="w-12 h-12 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 class="text-base font-medium text-gray-700 mb-1">World Editor Copilot</h3>
            <p class="text-sm text-gray-500 mb-6 max-w-70">
              I can help you build and edit your world — characters, regions, organizations, and stories.
            </p>
            <div class="space-y-2 text-left w-full max-w-70">
              <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Try asking:</p>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Create a medieval fantasy world with a dark forest region')}
              >
                Create a medieval fantasy world
              </button>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Add a warrior character named Kael with a mysterious backstory')}
              >
                Add a warrior character
              </button>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Show me an overview of the current world state')}
              >
                Show the current world state
              </button>
            </div>
          </div>
        {:else}
          <ChatMessages
            messages={messagesStore.messages}
            streamingMessage={activeChatStore.streamingMessage}
            isLoading={activeChatStore.isGenerating && !activeChatStore.firstTokenReceived}
            showAvatars={true}
            showActions={false}
            showEmptyState={false}
            toolCallRenderer={CopilotToolCallBlock}
          />

          <!-- Inline QueryUser form (appears at bottom of messages when AI requests input) -->
          {#if pendingQueryRequest}
            <div class="px-2 py-2">
              <QueryUserFormBlock
                request={pendingQueryRequest}
                submitted={queryFormSubmitted}
                onsubmit={handleQueryUserSubmit}
              />
            </div>
          {/if}
        {/if}
      </div>

      <!-- Input -->
      <div class="border-t border-gray-200 p-4">
        <ChatInput
          placeholder="Ask World Copilot..."
          showAttachments={false}
          isGenerating={activeChatStore.isGenerating}
          onSend={handleSend}
          onAbort={handleAbort}
        />
      </div>

    {:else if panelMode === 'builder'}
      <!-- ============ BUILDER MODE ============ -->
      {#if viewingPhase && builderSession}
        <!-- Viewing a past phase's changes (read-only) -->
        <BuilderReviewView
          session={builderSession}
          phaseId={viewingPhase}
          isRevising={false}
          revisionLog={[]}
          changes={viewingChanges}
          onrevise={() => {}}
          onregenerate={() => {}}
          onnext={() => {}}
          onnavigate={(tab) => weCtx.navigateTab(tab)}
          readonly={true}
        />
      {:else if builderPhase === 'setup'}
        <div class="flex-1 overflow-y-auto">
          <BuilderSetupView onstart={handleBuilderStart} />
        </div>

      {:else if builderPhase === 'generating'}
        <BuilderProgressView
          phaseId={builderSession?.currentPhase ?? 'synopsis'}
          statusMessage={builderStatusMessage}
          charCount={builderCharCount}
          aiText={builderAiText}
          pendingQuery={builderPendingQuery}
          querySubmitted={builderQuerySubmitted}
          onquerysubmit={handleBuilderQuerySubmit}
          oncancel={handleBuilderCancel}
        />
        <BuilderLogPanel entries={builderEventLog} />

      {:else if builderPhase === 'waiting' && builderSession}
        <BuilderReviewView
          session={builderSession}
          phaseId={builderSession.currentPhase}
          isRevising={builderIsRevising}
          revisionLog={builderRevisionLog}
          changes={builderChanges}
          onrevise={handleBuilderRevise}
          onregenerate={handleBuilderRegenerate}
          onnext={handleBuilderNext}
          onnavigate={(tab) => weCtx.navigateTab(tab)}
        />
        <BuilderLogPanel entries={builderEventLog} />

      {:else if builderPhase === 'error'}
        <div class="flex-1 flex flex-col items-center justify-center p-6">
          <div class="w-12 h-12 mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p class="text-sm text-gray-600 mb-2">An error occurred</p>
          {#if builderError}
            <p class="text-xs text-gray-500 mb-4 max-w-60 text-center">{builderError}</p>
          {/if}
          <div class="flex gap-2">
            <button
              class="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              onclick={handleBuilderReset}
            >
              Start Over
            </button>
            {#if builderSession}
              <button
                class="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
                onclick={() => {
                  if (builderSession) {
                    builderSession.phases[builderSession.currentPhase].status = 'active';
                    runBuilderPhase(builderSession, builderSession.currentPhase);
                  }
                }}
              >
                Retry
              </button>
            {/if}
          </div>
        </div>

      {:else if builderPhase === 'completed'}
        <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div class="w-14 h-14 mb-4 bg-green-50 rounded-full flex items-center justify-center">
            <svg class="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 class="text-base font-medium text-gray-700 mb-2">World Complete!</h3>
          <p class="text-sm text-gray-500 mb-6 max-w-60">
            All phases have been generated. Your world is ready to explore and edit.
          </p>
          <div class="flex gap-2">
            <button
              class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              onclick={handleBuilderReset}
            >
              Build Another
            </button>
            <button
              class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              onclick={handleExportJSON}
              title="Download all phase outputs as JSON"
            >
              Export JSON
            </button>
            <button
              class="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
              onclick={() => panelMode = 'chat'}
            >
              Switch to Chat
            </button>
          </div>
        </div>
      {/if}

    {:else if panelMode === 'designer'}
      <!-- ============ DESIGNER MODE ============ -->

      <!-- Messages or Welcome -->
      <div class="flex-1 overflow-y-auto px-2">
        {#if designerMessages.messages.length === 0 && !designerActiveChatStore.isGenerating && !designerActiveChatStore.streamingMessage}
          <!-- Welcome message -->
          <div class="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
            <div class="w-12 h-12 mb-4 bg-indigo-100 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 class="text-base font-medium text-gray-700 mb-1">Frontend Designer</h3>
            <p class="text-sm text-gray-500 mb-6 max-w-70">
              I can create and modify the React frontend for your game. Describe what you want and I'll write the code.
            </p>
            <div class="space-y-2 text-left w-full max-w-70">
              <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Try asking:</p>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleDesignerSend('Show me the current project structure')}
              >
                Show me the project structure
              </button>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleDesignerSend('Add a character status panel showing HP and attributes')}
              >
                Add a character status panel
              </button>
              <button
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleDesignerSend('Change the dialog box style to use chat bubbles')}
              >
                Change dialog box to chat bubbles
              </button>
            </div>
          </div>
        {:else}
          <ChatMessages
            messages={designerMessages.messages}
            streamingMessage={designerActiveChatStore.streamingMessage}
            isLoading={designerActiveChatStore.isGenerating && !designerActiveChatStore.firstTokenReceived}
            showAvatars={true}
            showActions={false}
            showEmptyState={false}
            toolCallRenderer={CopilotToolCallBlock}
          />
        {/if}
      </div>

      <!-- Input -->
      <div class="border-t border-gray-200 p-4">
        <ChatInput
          placeholder="Describe a UI change..."
          showAttachments={false}
          isGenerating={designerActiveChatStore.isGenerating}
          onSend={handleDesignerSend}
          onAbort={handleDesignerAbort}
        />
      </div>

    {/if}
  </div>
{/if}

<!-- Designer Preview (rendered as portal outside panel) -->
{#if designerShowPreview && designerPreviewVfs && designerProjectConfig}
  <SandboxPreviewView
    vfs={designerPreviewVfs}
    projectConfig={designerProjectConfig}
    entryFile={designerEntryFile}
    name="Frontend Preview"
    onClose={() => { designerShowPreview = false; }}
    projectId={weCtx.projectId}
    vfsNodeId={nodeStore.findByMetadata('simple-mode-role', 'frontend-vfs')?.id}
  />
{/if}
