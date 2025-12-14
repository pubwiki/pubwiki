<!--
  Message.svelte - Single message component
  
  Displays a single message with:
  - Model icon / User icon
  - Message content (via BlockRenderer)
  - Reasoning display (for assistant messages)
  - Message actions (copy, edit, regenerate)
-->
<script lang="ts">
  import type { MessageRole } from '@pubwiki/chat'
  import type { UIMessageBlock } from '../types'
  import { BlockRenderer } from '../blocks'
  import ReasoningBlock from '../blocks/ReasoningBlock.svelte'

  interface Props {
    id: string
    role: MessageRole
    blocks: UIMessageBlock[]
    reasoning?: string
    model?: string
    timestamp?: number
    isStreaming?: boolean
    showAvatar?: boolean
    showActions?: boolean
    onCopy?: (content: string) => void
    onEdit?: (id: string) => void
    onRegenerate?: (id: string) => void
    onIterationContinue?: (blockId: string) => void
    onIterationStop?: (blockId: string) => void
    class?: string
  }

  let { 
    id,
    role, 
    blocks, 
    reasoning,
    model,
    timestamp,
    isStreaming = false,
    showAvatar = true,
    showActions = true,
    onCopy,
    onEdit,
    onRegenerate,
    onIterationContinue,
    onIterationStop,
    class: className = '' 
  }: Props = $props()

  let isHovering = $state(false)

  // Get text content for copy
  let textContent = $derived.by(() => {
    return blocks
      .filter(b => b.type === 'text' || b.type === 'markdown')
      .map(b => b.content)
      .join('')
  })

  // Role-based styling
  let isUser = $derived(role === 'user')
  let isAssistant = $derived(role === 'assistant')
  let isSystem = $derived(role === 'system')

  function handleCopy() {
    onCopy?.(textContent)
  }

  function handleEdit() {
    onEdit?.(id)
  }

  function handleRegenerate() {
    onRegenerate?.(id)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="message flex w-full justify-center {isAssistant ? 'bg-zinc-50/50 dark:bg-zinc-800/30' : ''} {className}"
  data-role={role}
  onmouseenter={() => isHovering = true}
  onmouseleave={() => isHovering = false}
>
  <div class="relative flex w-full max-w-3xl flex-col p-6">
    <!-- Actions (top right) -->
    {#if showActions}
      <div class="absolute right-4 top-6">
        <div class="flex items-center gap-1 opacity-0 transition-opacity {isHovering ? 'opacity-100' : ''}">
          <button
            type="button"
            onclick={handleCopy}
            class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            title="Copy"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {#if isUser}
            <button
              type="button"
              onclick={handleEdit}
              class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="Edit"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          {/if}
          {#if isAssistant && !isStreaming}
            <button
              type="button"
              onclick={handleRegenerate}
              class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="Regenerate"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="space-y-3">
      <!-- Header with icon and name -->
      <div class="flex items-center space-x-3">
        {#if showAvatar}
          {#if isAssistant}
            <!-- Assistant icon -->
            <div class="flex h-8 w-8 items-center justify-center rounded border border-purple-200 bg-purple-100 dark:border-purple-800 dark:bg-purple-900">
              <svg class="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          {:else if isUser}
            <!-- User icon -->
            <div class="flex h-8 w-8 items-center justify-center rounded border border-blue-200 bg-blue-100 dark:border-blue-800 dark:bg-blue-900">
              <svg class="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          {:else}
            <!-- System icon -->
            <div class="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
              <svg class="h-5 w-5 text-zinc-600 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
          {/if}
        {/if}
        
        <div class="font-semibold">
          {#if isAssistant}
            {model || 'Assistant'}
          {:else if isUser}
            User
          {:else}
            Prompt
          {/if}
        </div>
      </div>

      <!-- Loading indicator -->
      {#if isStreaming && blocks.length === 0}
        <div class="flex items-center gap-2">
          <span class="h-3 w-3 animate-pulse rounded-full bg-purple-500"></span>
        </div>
      {/if}

      <!-- Reasoning display -->
      {#if reasoning && isAssistant}
        <ReasoningBlock content={reasoning} />
      {/if}

      <!-- Message content -->
      <div class="message-content">
        <BlockRenderer 
          {blocks} 
          {onIterationContinue}
          {onIterationStop}
        />
      </div>
    </div>
  </div>
</div>

<style>
  .bg-secondary {
    background-color: var(--color-secondary, #f9fafb);
  }
  
  :global(.dark) .bg-secondary {
    background-color: var(--color-secondary-dark, #1f2937);
  }

  .message-content :global(p:first-child) {
    margin-top: 0;
  }

  .message-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .message-content :global(pre) {
    margin: 1rem 0;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .message-content :global(li) {
    margin: 0.25rem 0;
  }

  .message-content :global(h1),
  .message-content :global(h2),
  .message-content :global(h3),
  .message-content :global(h4) {
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    font-weight: 600;
  }

  .message-content :global(h1) {
    font-size: 1.5rem;
  }

  .message-content :global(h2) {
    font-size: 1.25rem;
  }

  .message-content :global(h3) {
    font-size: 1.125rem;
  }

  .message-content :global(blockquote) {
    border-left: 3px solid #d1d5db;
    padding-left: 1rem;
    margin: 1rem 0;
    color: #6b7280;
  }

  :global(.dark) .message-content :global(blockquote) {
    border-left-color: #4b5563;
    color: #9ca3af;
  }

  .message-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }

  .message-content :global(th),
  .message-content :global(td) {
    border: 1px solid #e5e7eb;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  :global(.dark) .message-content :global(th),
  :global(.dark) .message-content :global(td) {
    border-color: #374151;
  }

  .message-content :global(th) {
    background-color: #f9fafb;
    font-weight: 600;
  }

  :global(.dark) .message-content :global(th) {
    background-color: #1f2937;
  }

  .message-content :global(hr) {
    margin: 1.5rem 0;
    border: none;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .message-content :global(hr) {
    border-top-color: #374151;
  }

  .message-content :global(a) {
    color: #3b82f6;
    text-decoration: underline;
  }

  .message-content :global(a:hover) {
    color: #2563eb;
  }

  .message-content :global(code:not(pre code)) {
    background-color: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }

  :global(.dark) .message-content :global(code:not(pre code)) {
    background-color: #374151;
  }
</style>
