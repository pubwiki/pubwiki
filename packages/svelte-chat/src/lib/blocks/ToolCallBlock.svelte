<!--
  ToolCallBlock.svelte - Tool call display component
  
  Displays tool call request and its result in a clean style
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'

  interface Props {
    toolCallBlock: UIMessageBlock
    toolResultBlock?: UIMessageBlock
    class?: string
  }

  let { toolCallBlock, toolResultBlock, class: className = '' }: Props = $props()

  let expanded = $state(false)

  // Format tool arguments for display
  let formattedArgs = $derived.by(() => {
    const args = toolCallBlock.toolArgs
    if (!args) return ''
    if (typeof args === 'string') {
      try {
        return JSON.stringify(JSON.parse(args), null, 2)
      } catch {
        return args
      }
    }
    return JSON.stringify(args, null, 2)
  })

  // Format tool result for display
  let formattedResult = $derived.by(() => {
    if (!toolResultBlock?.content) return ''
    try {
      return JSON.stringify(JSON.parse(toolResultBlock.content), null, 2)
    } catch {
      return toolResultBlock.content
    }
  })

  // Status states
  let isLoading = $derived(toolCallBlock.toolStatus === 'running' || toolCallBlock.toolStatus === 'pending')
  let isError = $derived(toolCallBlock.toolStatus === 'error')
  let isCompleted = $derived(toolCallBlock.toolStatus === 'completed')
</script>

<div class="tool-call {className}" style="margin: 1.5rem 0;">
  <!-- Header -->
  <button
    type="button"
    onclick={() => expanded = !expanded}
    class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors"
    style="background-color: #e4e4e7;"
  >
    <!-- Status Icon -->
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {isError ? 'bg-red-500' : isLoading ? 'bg-blue-500' : 'bg-green-500'}">
      {#if isLoading}
        <svg class="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      {:else if isError}
        <svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      {:else}
        <svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      {/if}
    </div>

    <!-- Tool Name & Status -->
    <div class="flex flex-1 flex-col gap-0.5 overflow-hidden">
      <span class="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {toolCallBlock.toolName || 'Tool'}
      </span>
      <span class="text-xs text-zinc-500 dark:text-zinc-400">
        {#if isLoading}
          Running...
        {:else if isError}
          Failed
        {:else}
          Completed
        {/if}
      </span>
    </div>

    <!-- Expand Icon -->
    <div class="flex items-center gap-2">
      <span class="text-xs text-zinc-400 dark:text-zinc-500">
        {expanded ? 'Hide' : 'Details'}
      </span>
      <svg
        class="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </button>

  <!-- Expanded Details -->
  {#if expanded}
    <div class="mt-2 space-y-4 rounded-lg px-4 py-4" style="background-color: #f4f4f5;">
      <!-- Arguments -->
      {#if formattedArgs}
        <div>
          <div class="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Arguments
          </div>
          <pre class="max-h-48 overflow-auto rounded-lg p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" style="background-color: #e4e4e7;"><code>{formattedArgs}</code></pre>
        </div>
      {/if}

      <!-- Error -->
      {#if isError && toolCallBlock.content}
        <div>
          <div class="mb-2 text-xs font-medium text-red-600 dark:text-red-400">
            Error
          </div>
          <pre class="max-h-48 overflow-auto rounded-lg bg-red-100 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300"><code>{toolCallBlock.content}</code></pre>
        </div>
      {/if}

      <!-- Result -->
      {#if isCompleted && toolResultBlock}
        <div>
          <div class="mb-2 text-xs font-medium text-green-600 dark:text-green-400">
            Result
          </div>
          <pre class="max-h-64 overflow-auto rounded-lg p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" style="background-color: #e4e4e7;"><code>{formattedResult}</code></pre>
        </div>
      {/if}
    </div>
  {/if}
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
</style>
