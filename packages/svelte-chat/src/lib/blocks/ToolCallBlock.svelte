<!--
  ToolCallBlock.svelte - Tool call display component
  
  Displays tool call request and its result in a unified view
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'
  import type { ToolCallStatus } from '@pubwiki/chat'

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

<div 
  class="tool-call my-2 overflow-hidden rounded-xl border-2 transition-all {className}
    {isError ? 'border-red-500/50 bg-red-500/5' : ''}
    {isLoading ? 'border-blue-500/50 bg-blue-500/5' : ''}
    {!isError && !isLoading ? 'border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30' : ''}"
>
  <!-- Header -->
  <button
    type="button"
    onclick={() => expanded = !expanded}
    class="flex w-full items-center justify-between px-4 py-2.5 text-left transition-opacity hover:opacity-70"
  >
    <div class="flex items-center gap-2.5">
      <!-- Icon Container -->
      <div 
        class="flex items-center justify-center rounded-lg p-1.5
          {isError ? 'bg-red-500' : 'bg-blue-500'}"
      >
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
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        {/if}
      </div>

      <!-- Tool Name -->
      <span class="text-sm font-medium">
        {toolCallBlock.toolName || 'Unknown Tool'}
      </span>

      <!-- Status Badge -->
      {#if isCompleted}
        <div class="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5">
          <svg class="h-3 w-3 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span class="text-xs text-green-600 dark:text-green-400">Done</span>
        </div>
      {/if}
      {#if isLoading}
        <div class="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5">
          <svg class="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="text-xs text-blue-600 dark:text-blue-400">Running</span>
        </div>
      {/if}
      {#if isError}
        <div class="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5">
          <svg class="h-3 w-3 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span class="text-xs text-red-600 dark:text-red-400">Error</span>
        </div>
      {/if}
    </div>

    <!-- Expand/Collapse Icon -->
    <div class="flex items-center gap-2">
      <span class="text-xs opacity-60">
        {expanded ? 'Hide' : 'Details'}
      </span>
      <svg
        class="h-4 w-4 opacity-60 transition-transform {expanded ? '' : '-rotate-90'}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </button>

  <!-- Expanded content -->
  {#if expanded}
    <div class="space-y-3 border-t border-gray-200/50 px-4 py-3 dark:border-gray-700/50">
      <!-- Arguments -->
      {#if formattedArgs}
        <div>
          <div class="mb-1.5 text-xs font-semibold opacity-70">
            Arguments
          </div>
          <pre class="max-h-40 overflow-auto rounded-lg border border-gray-200/50 bg-white/50 p-3 text-xs dark:border-gray-700/50 dark:bg-gray-900/50"><code class="opacity-90">{formattedArgs}</code></pre>
        </div>
      {/if}

      <!-- Error Message -->
      {#if isError && toolCallBlock.content}
        <div>
          <div class="mb-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
            Error
          </div>
          <pre class="max-h-40 overflow-auto rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"><code>{toolCallBlock.content}</code></pre>
        </div>
      {/if}

      <!-- Loading State -->
      {#if isLoading}
        <div>
          <div class="mb-1.5 flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
            <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Executing...</span>
          </div>
        </div>
      {/if}

      <!-- Result -->
      {#if isCompleted && toolResultBlock}
        <div>
          <div class="mb-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
            Result
          </div>
          <pre class="max-h-60 overflow-auto rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-xs"><code class="opacity-90">{formattedResult}</code></pre>
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
