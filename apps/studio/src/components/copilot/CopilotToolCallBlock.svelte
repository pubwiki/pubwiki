<!--
  CopilotToolCallBlock.svelte - Custom tool call display for Copilot
  
  Displays tool call request and its result in Studio's style
-->
<script lang="ts">
  import type { ToolCallRendererProps } from '@pubwiki/svelte-chat';

  let { toolCallBlock, toolResultBlock, class: className = '' }: ToolCallRendererProps = $props();

  let expanded = $state(false);

  // Format tool arguments for display
  let formattedArgs = $derived.by(() => {
    const args = toolCallBlock.toolArgs;
    if (!args) return '';
    if (typeof args === 'string') {
      try {
        return JSON.stringify(JSON.parse(args), null, 2);
      } catch {
        return args;
      }
    }
    return JSON.stringify(args, null, 2);
  });

  // Format tool result for display
  let formattedResult = $derived.by(() => {
    if (!toolResultBlock?.content) return '';
    try {
      return JSON.stringify(JSON.parse(toolResultBlock.content), null, 2);
    } catch {
      return toolResultBlock.content;
    }
  });

  // Status states
  let isLoading = $derived(toolCallBlock.toolStatus === 'running' || toolCallBlock.toolStatus === 'pending');
  let isError = $derived(toolCallBlock.toolStatus === 'error');
  let isCompleted = $derived(toolCallBlock.toolStatus === 'completed');
</script>

<div class="tool-call {className}" style="margin: 1rem 0;">
  <div class="tool-call-container" class:expanded={expanded}>
    <!-- Header -->
    <button
      type="button"
      onclick={() => expanded = !expanded}
      class="tool-call-header flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
    >
      <!-- Status Icon -->
      <div class="tool-call-status flex h-6 w-6 shrink-0 items-center justify-center rounded"
        class:status-error={isError}
        class:status-loading={isLoading}
        class:status-success={isCompleted}
      >
        {#if isLoading}
          <svg class="h-3.5 w-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        {:else if isError}
          <svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        {:else}
          <svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        {/if}
      </div>

      <!-- Tool Name & Status -->
      <div class="flex flex-1 items-center gap-2 overflow-hidden">
        <span class="tool-call-name truncate text-sm font-medium">
          {toolCallBlock.toolName || 'Tool'}
        </span>
        <span class="tool-call-status-text text-xs">
          {#if isLoading}
            Running...
          {:else if isError}
            Failed
          {:else}
            ✓
          {/if}
        </span>
      </div>

      <!-- Expand Icon -->
      <svg
        class="tool-call-expand-icon h-4 w-4 shrink-0 transition-transform duration-200"
        class:rotate-180={expanded}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Expanded Details -->
    {#if expanded}
      <div class="tool-call-details space-y-2 px-3 pb-3">
        <!-- Arguments -->
        {#if formattedArgs}
          <div>
            <div class="tool-call-label mb-1 text-xs font-medium">Args</div>
            <pre class="tool-call-code max-h-32 overflow-auto rounded p-2 text-xs"><code>{formattedArgs}</code></pre>
          </div>
        {/if}

        <!-- Error -->
        {#if isError && toolCallBlock.content}
          <div>
            <div class="tool-call-error-label mb-1 text-xs font-medium">Error</div>
            <pre class="tool-call-error-code max-h-32 overflow-auto rounded p-2 text-xs"><code>{toolCallBlock.content}</code></pre>
          </div>
        {/if}

        <!-- Result -->
        {#if isCompleted && toolResultBlock}
          <div>
            <div class="tool-call-success-label mb-1 text-xs font-medium">Result</div>
            <pre class="tool-call-code tool-call-result max-h-48 overflow-auto rounded p-2 text-xs"><code>{formattedResult}</code></pre>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .tool-call pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-call code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  /* Container - unified background */
  .tool-call-container {
    background-color: #e4e4e7;
    border-radius: 0.5rem;
  }
  :global(.dark) .tool-call-container {
    background-color: #3f3f46;
  }

  /* Header */
  .tool-call-header {
    border-radius: 0.5rem;
  }
  .tool-call-header:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
  :global(.dark) .tool-call-header:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
  .tool-call-container.expanded .tool-call-header {
    border-radius: 0.5rem 0.5rem 0 0;
  }

  /* Status icons */
  .status-error {
    background-color: #ef4444;
  }
  .status-loading {
    background-color: #3b82f6;
  }
  .status-success {
    background-color: #22c55e;
  }

  /* Tool name */
  .tool-call-name {
    color: #27272a;
  }
  :global(.dark) .tool-call-name {
    color: #e4e4e7;
  }

  /* Status text */
  .tool-call-status-text {
    color: #71717a;
  }
  :global(.dark) .tool-call-status-text {
    color: #a1a1aa;
  }

  /* Expand icon */
  .tool-call-expand-icon {
    color: #a1a1aa;
  }
  :global(.dark) .tool-call-expand-icon {
    color: #71717a;
  }

  /* Labels */
  .tool-call-label {
    color: #71717a;
  }
  :global(.dark) .tool-call-label {
    color: #a1a1aa;
  }

  /* Code blocks */
  .tool-call-code {
    background-color: rgba(0, 0, 0, 0.06);
    color: #3f3f46;
  }
  :global(.dark) .tool-call-code {
    background-color: rgba(0, 0, 0, 0.3);
    color: #d4d4d8;
  }

  /* Hide scrollbar for result */
  .tool-call-result {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .tool-call-result::-webkit-scrollbar {
    display: none;
  }

  /* Error styling */
  .tool-call-error-label {
    color: #dc2626;
  }
  :global(.dark) .tool-call-error-label {
    color: #f87171;
  }

  .tool-call-error-code {
    background-color: rgba(239, 68, 68, 0.1);
    color: #b91c1c;
  }
  :global(.dark) .tool-call-error-code {
    background-color: rgba(127, 29, 29, 0.3);
    color: #fca5a5;
  }

  /* Success label */
  .tool-call-success-label {
    color: #16a34a;
  }
  :global(.dark) .tool-call-success-label {
    color: #4ade80;
  }
</style>
