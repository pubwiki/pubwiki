<!--
  ChatMessages.svelte - Message list component
  
  Displays a list of messages with:
  - Auto-scroll to bottom on new messages
  - Scroll to bottom button
  - Loading state
-->
<script lang="ts">
  import type { DisplayMessage } from '../stores/messages.svelte'
  import type { UIMessageBlock, ToolCallRenderer } from '../types'
  import Message from './Message.svelte'

  interface Props {
    messages: DisplayMessage[]
    streamingMessage?: {
      id: string
      role: 'assistant'
      blocks: UIMessageBlock[]
      model?: string
      reasoning?: string
    } | null
    isLoading?: boolean
    showAvatars?: boolean
    showActions?: boolean
    showEmptyState?: boolean
    /** Custom renderer for tool call blocks */
    toolCallRenderer?: ToolCallRenderer
    onCopy?: (content: string) => void
    onEdit?: (id: string) => void
    onRegenerate?: (id: string) => void
    onIterationContinue?: (blockId: string) => void
    onIterationStop?: (blockId: string) => void
    class?: string
  }

  let { 
    messages, 
    streamingMessage,
    isLoading = false,
    showAvatars = true,
    showActions = true,
    showEmptyState = true,
    toolCallRenderer,
    onCopy,
    onEdit,
    onRegenerate,
    onIterationContinue,
    onIterationStop,
    class: className = '' 
  }: Props = $props()

  let container: HTMLDivElement
  let showScrollButton = $state(false)
  
  // Track whether user has manually scrolled away from bottom
  let userScrolledAway = $state(false)

  // Check if container is actually scrollable
  function isScrollable(): boolean {
    if (!container) return false
    return container.scrollHeight > container.clientHeight
  }

  // Check if scrolled to bottom (with threshold)
  function isNearBottom(): boolean {
    if (!container) return true
    if (!isScrollable()) return true  // If not scrollable, consider it "at bottom"
    const threshold = 100
    const { scrollTop, scrollHeight, clientHeight } = container
    return scrollHeight - scrollTop - clientHeight < threshold
  }

  // Handle wheel event - this only fires on user interaction, not programmatic scroll
  function handleWheel(e: WheelEvent) {
    // Only handle if container is scrollable
    if (!isScrollable()) return
    
    // User scrolling up
    if (e.deltaY < 0) {
      userScrolledAway = true
      showScrollButton = true
    }
    // User scrolling down - check if reached bottom after a short delay
    else if (e.deltaY > 0) {
      setTimeout(() => {
        if (isNearBottom()) {
          userScrolledAway = false
          showScrollButton = false
        }
      }, 50)
    }
  }

  // Handle scroll event - update the scroll button visibility based on actual scroll position
  function handleScroll() {
    if (!container) return
    
    // If not scrollable, never show the button
    if (!isScrollable()) {
      showScrollButton = false
      userScrolledAway = false
      return
    }
    
    const nearBottom = isNearBottom()
    
    if (nearBottom) {
      userScrolledAway = false
      showScrollButton = false
    } else {
      userScrolledAway = true
      showScrollButton = true
    }
  }

  // Scroll to bottom
  function scrollToBottom(smooth = true) {
    if (!container) return
    userScrolledAway = false
    showScrollButton = false
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant'
    })
  }

  // Auto-scroll when messages change (only if user hasn't scrolled away)
  $effect(() => {
    // Access messages and streamingMessage to trigger effect
    messages
    streamingMessage
    
    // Only auto-scroll if user hasn't manually scrolled away
    if (!userScrolledAway && container) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (!userScrolledAway) {
          container.scrollTop = container.scrollHeight
        }
      })
    }
  })
</script>

<div 
  bind:this={container}
  onscroll={handleScroll}
  onwheel={handleWheel}
  class="chat-messages relative h-full overflow-y-auto px-4 {className}"
>
  <!-- Messages list -->
  <div class="min-h-full flex flex-col">
    <!-- Empty state - shown when no content -->
    {#if showEmptyState && messages.length === 0 && !streamingMessage && !isLoading}
      <div class="flex flex-1 items-center justify-center">
        <div class="text-center text-zinc-500 dark:text-zinc-400">
          <svg class="mx-auto h-12 w-12 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p class="mt-2 text-sm">No messages yet</p>
          <p class="text-xs text-zinc-400 dark:text-zinc-500">Start a conversation</p>
        </div>
      </div>
    {:else}
      <!-- Content area -->
      <div class="space-y-0 pb-4">
        {#each messages as message (message.id)}
          <Message
            id={message.id}
            role={message.role}
            blocks={message.blocks}
            reasoning={message.metadata?.reasoning as string | undefined}
            model={message.model}
            timestamp={message.timestamp}
            showAvatar={showAvatars}
            showActions={showActions}
            {toolCallRenderer}
            {onCopy}
            {onEdit}
            {onRegenerate}
            {onIterationContinue}
            {onIterationStop}
          />
        {/each}

        <!-- Streaming message -->
        {#if streamingMessage}
          <Message
            id={streamingMessage.id}
            role="assistant"
            blocks={streamingMessage.blocks}
            reasoning={streamingMessage.reasoning}
            model={streamingMessage.model}
            isStreaming={true}
            showAvatar={showAvatars}
            showActions={false}
            {toolCallRenderer}
          />
        {/if}

        <!-- Loading indicator -->
        {#if isLoading && !streamingMessage}
          <div class="flex items-center gap-2 py-4 text-zinc-500 dark:text-zinc-400">
            <div class="flex space-x-1">
              <span class="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-600" style="animation-delay: 0ms"></span>
              <span class="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-600" style="animation-delay: 150ms"></span>
              <span class="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-600" style="animation-delay: 300ms"></span>
            </div>
            <span class="text-sm">Thinking...</span>
          </div>
        {/if}
      </div>

      <!-- Scroll to bottom button - sticky at bottom of scroll container -->
      {#if showScrollButton}
        <div class="sticky bottom-4 flex justify-center pointer-events-none">
          <button
            type="button"
            onclick={() => scrollToBottom()}
            aria-label="Scroll to bottom"
            class="pointer-events-auto rounded-full bg-zinc-800 p-2 text-white shadow-lg transition-all hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-800 dark:hover:bg-zinc-300"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  @keyframes bounce {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
  }

  .animate-bounce {
    animation: bounce 0.6s infinite;
  }
</style>
