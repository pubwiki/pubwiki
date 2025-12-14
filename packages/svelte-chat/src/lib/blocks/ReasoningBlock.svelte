<!--
  ReasoningBlock.svelte - Chain-of-thought reasoning display
  
  Displays AI reasoning/thinking content with collapsible UI.
  Supports both Anthropic-style thinking and OpenAI-style reasoning.
-->
<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte'

  interface Props {
    content: string
    tokenUsage?: number
    initialCollapsed?: boolean
    class?: string
  }

  let { 
    content, 
    tokenUsage,
    initialCollapsed = true,
    class: className = '' 
  }: Props = $props()

  let collapsed = $state(true)
  
  // Sync collapsed state with initialCollapsed prop
  $effect(() => {
    collapsed = initialCollapsed
  })
</script>

<div class="mb-4 overflow-hidden rounded-lg border-2 border-blue-200 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/20 {className}">
  <!-- Header - Always visible -->
  <button
    type="button"
    onclick={() => collapsed = !collapsed}
    class="flex w-full cursor-pointer items-center justify-between px-4 py-2 hover:bg-blue-100/50 dark:hover:bg-blue-900/30"
  >
    <div class="flex items-center gap-2">
      <!-- Brain icon -->
      <svg class="h-[18px] w-[18px] text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      <span class="text-sm font-medium text-blue-700 dark:text-blue-300">
        Reasoning
      </span>
      {#if tokenUsage}
        <span class="text-xs text-blue-500 dark:text-blue-400">
          ({tokenUsage} tokens)
        </span>
      {/if}
    </div>
    <div class="text-blue-600 dark:text-blue-400">
      {#if collapsed}
        <!-- Chevron Right -->
        <svg class="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      {:else}
        <!-- Chevron Down -->
        <svg class="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      {/if}
    </div>
  </button>

  <!-- Content - Collapsible -->
  {#if !collapsed && content}
    <div class="border-t border-blue-200 px-4 py-3 dark:border-blue-800">
      <div class="prose prose-sm max-w-none dark:prose-invert">
        <MarkdownBlock {content} />
      </div>
    </div>
  {/if}
</div>
