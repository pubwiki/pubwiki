<!--
  ChatInput.svelte - Chat input component
  
  Features:
  - Auto-resizing textarea
  - Image/file attachment support
  - Send button
  - Keyboard shortcuts (Enter to send, Shift+Enter for newline)
-->
<script lang="ts">
  interface Props {
    value?: string
    placeholder?: string
    disabled?: boolean
    isGenerating?: boolean
    maxRows?: number
    showAttachments?: boolean
    selectedImages?: string[]
    selectedFiles?: string[]
    onSend?: (message: string, images?: string[], files?: string[]) => void
    onAbort?: () => void
    onImageSelect?: () => void
    onFileSelect?: () => void
    onImageRemove?: (url: string) => void
    onFileRemove?: (fileId: string) => void
    class?: string
  }

  let { 
    value = $bindable(''),
    placeholder = 'Ask anything. Type @  /  #  !',
    disabled = false,
    isGenerating = false,
    maxRows = 18,
    showAttachments = false,
    selectedImages = [],
    selectedFiles = [],
    onSend,
    onAbort,
    onImageSelect,
    onFileSelect,
    onImageRemove,
    onFileRemove,
    class: className = '' 
  }: Props = $props()

  let textarea: HTMLTextAreaElement
  let isComposing = $state(false)

  // Auto-resize textarea
  function autoResize() {
    if (!textarea) return
    textarea.style.height = 'auto'
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 24
    const maxHeight = lineHeight * maxRows
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }

  // Handle input
  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement
    value = target.value
    autoResize()
  }

  // Handle key down
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  // Handle send
  function handleSend() {
    if (!value.trim() || disabled || isGenerating) return
    
    onSend?.(value.trim(), selectedImages, selectedFiles)
    value = ''
    
    // Reset textarea height
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  // Handle abort
  function handleAbort() {
    onAbort?.()
  }

  // Handle composition (for IME input)
  function handleCompositionStart() {
    isComposing = true
  }

  function handleCompositionEnd() {
    isComposing = false
  }

  // Focus textarea on mount
  $effect(() => {
    textarea?.focus()
  })
</script>

<div class="chat-input px-4 pb-4 pt-2 {className}">
  <!-- Attachments preview -->
  {#if showAttachments && (selectedImages.length > 0 || selectedFiles.length > 0)}
    <div class="mb-3 flex flex-wrap gap-2">
      {#each selectedImages as image}
        <div class="relative">
          <img 
            src={image} 
            alt="Selected" 
            class="h-16 w-16 rounded-lg object-cover"
          />
          <button
            type="button"
            onclick={() => onImageRemove?.(image)}
            aria-label="Remove image"
            class="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600"
          >
            <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {/each}
      {#each selectedFiles as file}
        <div class="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
          <svg class="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="text-sm text-gray-600 dark:text-gray-400">{file}</span>
          <button
            type="button"
            onclick={() => onFileRemove?.(file)}
            aria-label="Remove file"
            class="text-gray-400 hover:text-red-500"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Input area -->
  <div class="relative flex min-h-[60px] w-full items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800/50">
    <!-- Attachment buttons (left side) -->
    {#if showAttachments}
      <div class="absolute bottom-2 left-3 flex gap-1">
        <button
          type="button"
          onclick={() => onImageSelect?.()}
          disabled={disabled || isGenerating}
          class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          title="Add image"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          type="button"
          onclick={() => onFileSelect?.()}
          disabled={disabled || isGenerating}
          class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          title="Add file"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
      </div>
    {/if}

    <!-- Textarea -->
    <textarea
      bind:this={textarea}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeyDown}
      oncompositionstart={handleCompositionStart}
      oncompositionend={handleCompositionEnd}
      {placeholder}
      disabled={disabled || isGenerating}
      rows="1"
      class="flex w-full resize-none rounded-md border-none bg-transparent py-4 text-base outline-none placeholder:text-zinc-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 {showAttachments ? 'pl-14' : 'pl-6'} pr-14 dark:text-zinc-100 dark:placeholder:text-zinc-500"
    ></textarea>

    <!-- Send/Abort button (right side) -->
    <div class="absolute bottom-2 right-3 cursor-pointer">
      {#if isGenerating}
        <button
          type="button"
          onclick={handleAbort}
          class="rounded bg-transparent p-1 transition-opacity hover:opacity-50 dark:text-zinc-100"
          title="Stop generating"
        >
          <svg class="h-[30px] w-[30px] animate-pulse text-foreground" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          type="button"
          onclick={handleSend}
          disabled={!value.trim() || disabled}
          class="rounded p-1 transition-all disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 bg-zinc-900 text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          title="Send message"
        >
          <svg class="h-[30px] w-[30px] p-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  textarea {
    max-height: 24rem;
    scrollbar-width: thin;
    line-height: 1.5;
  }

  textarea::-webkit-scrollbar {
    width: 4px;
  }

  textarea::-webkit-scrollbar-thumb {
    background-color: #d1d5db;
    border-radius: 2px;
  }
</style>
