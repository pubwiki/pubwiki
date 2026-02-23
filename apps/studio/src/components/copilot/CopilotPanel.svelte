<!--
  CopilotPanel.svelte - Right-side collapsible chat panel for Copilot
  
  Features:
  - Collapsible to a floating button
  - Integrates with CopilotOrchestrator
  - Displays chat messages with tool call feedback
  - Shows node creation/connection activities
-->
<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import { 
    ChatMessages, 
    ChatInput, 
    createMessagesStore, 
    createChatInputStore, 
    createActiveChatStore,
    CHAT_CONTEXT_KEY,
    type ChatContext,
    type DisplayMessage
  } from '@pubwiki/svelte-chat';
  import type { UIMessageBlock } from '@pubwiki/svelte-chat';
  import { 
    CopilotOrchestrator, 
    createCopilotOrchestrator,
    type OrchestratorConfig,
    type CopilotSettings,
    type FlowCallbacks
  } from '$lib/copilot';
  import { getSettingsStore } from '@pubwiki/ui/stores';
  import { getStudioContext } from '$lib/state';
  import { persist } from '@pubwiki/ui/utils';
  import * as m from '$lib/paraglide/messages';
  import CopilotToolCallBlock from './CopilotToolCallBlock.svelte';

  interface Props {
    /** Project ID for VFS creation */
    projectId: string;
    /** Initially collapsed state */
    initialCollapsed?: boolean;
    class?: string;
  }

  let { 
    projectId,
    initialCollapsed = true,
    class: className = ''
  }: Props = $props();

  // ============================================================================
  // Studio Context
  // ============================================================================
  
  const studioContext = getStudioContext();

  // ============================================================================
  // State
  // ============================================================================
  
  let collapsed = $state(true);
  let orchestrator = $state<CopilotOrchestrator | null>(null);
  let error = $state<string | null>(null);
  
  // Initialize collapsed state from prop
  $effect(() => {
    collapsed = initialCollapsed;
  });
  
  // Persisted width
  const MIN_WIDTH = 360;
  const MAX_WIDTH = 600;
  const DEFAULT_WIDTH = 400;
  const persistedWidth = persist<number>('studio-copilot-width', DEFAULT_WIDTH);
  let panelWidth = $derived(persistedWidth.value);
  let isResizing = $state(false);
  let panelEl: HTMLDivElement | undefined = $state();

  // Create stores for chat UI
  const messagesStore = createMessagesStore();
  const inputStore = createChatInputStore();
  const activeChatStore = createActiveChatStore();

  // Activity log for showing orchestrator actions
  let activities = $state<Array<{
    id: string;
    type: 'node_created' | 'nodes_connected' | 'generation_started' | 'generation_completed';
    message: string;
    timestamp: number;
  }>>([]);

  // ============================================================================
  // LLM Configuration from Settings
  // ============================================================================
  
  // Get settings from settings store
  const settingsStore = getSettingsStore();
  
  // Check if LLM is configured using the api settings
  let isLLMConfigured = $derived(
    !!settingsStore.api.apiKey && 
    !!settingsStore.api.selectedModel && 
    !!settingsStore.effectiveBaseUrl
  );

  // ============================================================================
  // Context Setup
  // ============================================================================
  
  // Orchestrator handles the real chat, so pubchat is null
  // ChatMessages and ChatInput still work via stores
  setContext<ChatContext>(CHAT_CONTEXT_KEY, {
    pubchat: null,
    messagesStore,
    inputStore,
    activeChatStore
  });

  // ============================================================================
  // Orchestrator Setup
  // ============================================================================
  
  function initializeOrchestrator() {
    if (!isLLMConfigured) {
      error = 'Please configure LLM settings (API key, model, base URL) in Settings to use Copilot.';
      return;
    }
    
    error = null;
    
    const copilotSettings: CopilotSettings = {
      autoConfirm: {
        createNode: true,
        modifyContent: true,
        triggerGeneration: false,
        deleteNode: false,
        bulkFileChanges: 5,
      },
      granularity: 'auto',
    };
    
    // Create flow callbacks from studio context
    const flowCallbacks: FlowCallbacks = {
      getNodes: () => studioContext.nodes,
      getEdges: () => studioContext.edges,
      setNodes: studioContext.setNodes,
      updateNodes: studioContext.updateNodes,
      setEdges: studioContext.setEdges,
      updateEdges: studioContext.updateEdges,
    };
    
    const config: OrchestratorConfig = {
      llm: {
        apiKey: settingsStore.api.apiKey,
        model: settingsStore.api.selectedModel,
        baseUrl: settingsStore.effectiveBaseUrl,
        temperature: 0.7,
        maxTokens: 4096,
      },
      settings: copilotSettings,
      projectId,
      flowCallbacks,
      generationSettings: {
        api: {
          apiKey: settingsStore.api.apiKey,
          selectedModel: settingsStore.api.selectedModel,
        },
        effectiveBaseUrl: settingsStore.effectiveBaseUrl,
      },
      onNodeCreated: (nodeId, nodeType, nodeName) => {
        addActivity('node_created', `Created ${nodeType} node "${nodeName || nodeId}"`);
      },
      onNodesConnected: (sourceId, targetId) => {
        addActivity('nodes_connected', `Connected nodes`);
      },
      onGenerationStarted: (inputNodeId, generatedNodeId) => {
        addActivity('generation_started', `Started generation...`);
      },
      onGenerationCompleted: (generatedNodeId) => {
        addActivity('generation_completed', `Generation completed`);
      },
    };
    
    orchestrator = createCopilotOrchestrator(config);
  }
  
  function addActivity(type: typeof activities[number]['type'], message: string) {
    const activity = {
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      message,
      timestamp: Date.now(),
    };
    activities = [...activities.slice(-9), activity]; // Keep last 10
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      activities = activities.filter(a => a.id !== activity.id);
    }, 5000);
  }

  // Initialize on mount and when settings change
  $effect(() => {
    if (isLLMConfigured && !collapsed) {
      initializeOrchestrator();
    }
  });

  // ============================================================================
  // Chat Handling
  // ============================================================================
  
  async function handleSend(content: string) {
    if (!content.trim() || !orchestrator) return;
    
    // Add user message
    const userMessage: DisplayMessage = {
      id: `msg-${Date.now()}`,
      parentId: orchestrator.getHistoryId() || null,
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
        if (event.type === 'token') {
          if (!activeChatStore.firstTokenReceived) {
            activeChatStore.markFirstTokenReceived();
          }
          
          const currentBlocks = activeChatStore.streamingMessage?.blocks || [];
          const lastBlock = currentBlocks[currentBlocks.length - 1];
          
          if (lastBlock && lastBlock.type === 'markdown') {
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks.slice(0, -1),
              { ...lastBlock, content: lastBlock.content + event.token }
            ]);
          } else {
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks,
              { id: `block-${Date.now()}`, type: 'markdown', content: event.token }
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
            toolStatus: 'running'
          };
          activeChatStore.updateStreamingBlocks([
            ...(activeChatStore.streamingMessage?.blocks || []),
            toolBlock
          ]);
        } else if (event.type === 'tool_result') {
          const blocks = activeChatStore.streamingMessage?.blocks || [];
          // Update tool_call block status to completed
          const updatedBlocks = blocks.map(b => 
            b.toolCallId === event.id && b.type === 'tool_call'
              ? { ...b, toolStatus: 'completed' as const }
              : b
          );
          // Add tool_result block so it can be matched with tool_call
          const resultBlock: UIMessageBlock = {
            id: `result-${Date.now()}`,
            type: 'tool_result',
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            toolCallId: event.id,
          };
          activeChatStore.updateStreamingBlocks([...updatedBlocks, resultBlock]);
          activeChatStore.incrementIteration();
        } else if (event.type === 'done') {
          // Finalize message
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
        } else if (event.type === 'error') {
          console.error('Chat error:', event.error);
          activeChatStore.endGeneration();
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      activeChatStore.endGeneration();
    }
  }

  function handleAbort() {
    orchestrator?.abort();
    activeChatStore.endGeneration();
  }

  function handleClearHistory() {
    orchestrator?.resetHistory();
    messagesStore.setMessages([]);
    activities = [];
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
      // For right panel, moving left increases width
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

<!-- Collapsed Button (shown on the right when collapsed) -->
{#if collapsed}
  <button
    class="absolute top-4 right-4 z-30 p-2.5 bg-white border border-gray-200 text-gray-600 rounded-lg shadow-md hover:shadow-lg hover:border-gray-300 hover:text-gray-800 transition-all"
    onclick={toggle}
    title="Open Copilot"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  </button>
{/if}

<!-- Expanded Panel -->
{#if !collapsed}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    bind:this={panelEl}
    class="absolute top-4 right-4 bottom-4 z-20 bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col overflow-hidden {className}"
    style="width: {panelWidth}px;"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <!-- Resize Handle (left side for right panel) -->
    <div
      class="group absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-12 cursor-ew-resize z-10 flex items-center justify-center"
      onpointerdown={startResize}
      role="separator"
      aria-orientation="vertical"
    >
      <div class="w-0.5 h-8 rounded-full transition-all duration-150 {isResizing ? 'bg-purple-500 h-10 opacity-100' : 'bg-gray-400 opacity-0 group-hover:opacity-100 group-hover:h-10'}"></div>
    </div>

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span class="font-medium text-gray-700">Copilot</span>
        <span class="px-1.5 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded">Beta</span>
      </div>
      <div class="flex items-center gap-1">
        <!-- Clear History -->
        <button
          class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          onclick={handleClearHistory}
          title="Clear conversation"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <!-- Collapse -->
        <button
          class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          onclick={toggle}
          title="Close Copilot"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Activity Bar -->
    {#if activities.length > 0}
      <div class="px-4 py-2.5 bg-gray-50 border-b border-gray-200 space-y-1.5">
        {#each activities as activity (activity.id)}
          <div class="flex items-center gap-2 text-xs text-gray-600 animate-fade-in py-0.5">
            {#if activity.type === 'node_created'}
              <span class="w-4 h-4 flex items-center justify-center">
                <svg class="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                </svg>
              </span>
            {:else if activity.type === 'nodes_connected'}
              <span class="w-4 h-4 flex items-center justify-center">
                <svg class="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                </svg>
              </span>
            {:else if activity.type === 'generation_started'}
              <span class="w-4 h-4 flex items-center justify-center">
                <svg class="w-3 h-3 text-yellow-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
            {:else}
              <span class="w-4 h-4 flex items-center justify-center">
                <svg class="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </span>
            {/if}
            <span class="truncate">{activity.message}</span>
          </div>
        {/each}
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
          <button
            class="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
            onclick={() => {
              // TODO: Open settings modal
              console.log('Open settings');
            }}
          >
            Open Settings
          </button>
        </div>
      </div>
    {:else}
      <!-- Messages or Welcome -->
      <div class="flex-1 overflow-y-auto px-2">
        {#if messagesStore.messages.length === 0 && !activeChatStore.isGenerating && !activeChatStore.streamingMessage}
          <!-- Welcome message -->
          <div class="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
            <div class="w-12 h-12 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 class="text-base font-medium text-gray-700 mb-1">Copilot</h3>
            <p class="text-sm text-gray-500 mb-6 max-w-70">
              I can help you build flow graphs by creating nodes, connecting them, and executing tasks.
            </p>
            <div class="space-y-2 text-left w-full max-w-70">
              <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Try asking:</p>
              <button 
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Create a simple web page with HTML and CSS')}
              >
                Create a simple web page
              </button>
              <button 
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Show me the current graph structure')}
              >
                Show me the current graph
              </button>
              <button 
                class="w-full text-left px-3 py-2.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-100"
                onclick={() => handleSend('Create a Lua backend service')}
              >
                Create a Lua backend service
              </button>
            </div>
          </div>
        {:else}
          <!-- Chat Messages -->
          <ChatMessages 
            messages={messagesStore.messages}
            streamingMessage={activeChatStore.streamingMessage}
            isLoading={activeChatStore.isGenerating && !activeChatStore.firstTokenReceived}
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
          placeholder="Ask Copilot to help..."
          showAttachments={false}
          isGenerating={activeChatStore.isGenerating}
          onSend={handleSend}
          onAbort={handleAbort}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .animate-fade-in {
    animation: fade-in 0.2s ease-out;
  }
</style>
