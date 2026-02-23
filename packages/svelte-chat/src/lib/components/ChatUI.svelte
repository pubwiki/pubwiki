<!--
  ChatUI.svelte - Main chat container component
  
  Provides:
  - Chat context via Svelte context API
  - Layout structure (messages + input)
  - Integration with @pubwiki/chat core
-->
<script lang="ts" module>
  import type { PubChat, MessageNode } from '@pubwiki/chat'
  import type { UIMessageBlock, PreprocessParams, PreprocessFn } from '../types'
  import type { ActiveChatStore, ChatInputStore, MessagesStore, DisplayMessage } from '../stores'

  /** Chat context type */
  export interface ChatContext {
    /** PubChat instance, or null if chat is handled externally (e.g., by Orchestrator) */
    pubchat: PubChat | null
    messagesStore: MessagesStore
    inputStore: ChatInputStore
    activeChatStore: ActiveChatStore
  }

  /** Chat context key */
  export const CHAT_CONTEXT_KEY = Symbol('chat-context')
</script>

<script lang="ts">
  import { setContext } from 'svelte'
  import { createMessagesStore, createChatInputStore, createActiveChatStore } from '../stores'
  import ChatMessages from './ChatMessages.svelte'
  import ChatInput from './ChatInput.svelte'

  interface Props {
    /** PubChat instance for chat operations */
    pubchat: PubChat
    /** Initial messages to display */
    initialMessages?: DisplayMessage[]
    /** History ID for conversation continuity */
    historyId?: string
    /** Placeholder text for input */
    placeholder?: string
    /** Show attachment buttons */
    showAttachments?: boolean
    /** Show message avatars */
    showAvatars?: boolean
    /** Show message actions */
    showActions?: boolean
    /** Preprocess function to transform chat params before sending */
    preprocess?: PreprocessFn
    /** Custom message copy handler */
    onCopy?: (content: string) => void
    /** Called when a message is sent */
    onMessageSent?: (message: DisplayMessage) => void
    /** Called when a response is received */
    onResponseReceived?: (message: DisplayMessage) => void
    /** Called on error */
    onError?: (error: Error) => void
    class?: string
    children?: import('svelte').Snippet
  }

  let { 
    pubchat,
    initialMessages = [],
    historyId = $bindable(),
    placeholder = 'Type a message...',
    showAttachments = false,
    showAvatars = true,
    showActions = true,
    preprocess,
    onCopy,
    onMessageSent,
    onResponseReceived,
    onError,
    class: className = '',
    children
  }: Props = $props()

  // Create stores
  const messagesStore = createMessagesStore()
  const inputStore = createChatInputStore()
  const activeChatStore = createActiveChatStore()

  // Set initial messages
  $effect(() => {
    if (initialMessages.length > 0) {
      messagesStore.setMessages(initialMessages)
    }
  })

  // Provide context - use getter to capture reactive reference
  setContext<ChatContext>(CHAT_CONTEXT_KEY, {
    get pubchat() { return pubchat },
    messagesStore,
    inputStore,
    activeChatStore
  })

  // Handle send message
  async function handleSend(content: string, images?: string[], files?: string[]) {
    if (!content.trim()) return

    try {
      activeChatStore.startGeneration()
      
      // Create user message blocks
      const userBlocks: UIMessageBlock[] = [
        { id: `block-${Date.now()}`, type: 'markdown', content }
      ]
      
      // Add image blocks if present
      if (images && images.length > 0) {
        for (const img of images) {
          userBlocks.push({ id: `block-${Date.now()}-${Math.random()}`, type: 'image', content: img })
        }
      }

      // Add user message to store
      const userMessage: DisplayMessage = {
        id: `msg-${Date.now()}`,
        parentId: historyId || null,
        role: 'user',
        blocks: userBlocks,
        timestamp: Date.now()
      }
      messagesStore.addMessage(userMessage)
      onMessageSent?.(userMessage)

      // Clear input
      inputStore.reset()

      // Prepare chat params
      let chatParams: PreprocessParams = { content, historyId }
      
      // Apply preprocess if provided
      if (preprocess) {
        chatParams = await preprocess(chatParams)
      }

      // Stream response
      for await (const event of pubchat.streamChat(chatParams.content, chatParams.historyId)) {
        if (event.type === 'token') {
          if (!activeChatStore.firstTokenReceived) {
            activeChatStore.markFirstTokenReceived()
          }
          
          // Update streaming message
          const currentBlocks = activeChatStore.streamingMessage?.blocks || []
          const lastBlock = currentBlocks[currentBlocks.length - 1]
          
          if (lastBlock && lastBlock.type === 'markdown') {
            // Append to last block
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks.slice(0, -1),
              { ...lastBlock, content: lastBlock.content + event.token }
            ])
          } else {
            // Create new block
            activeChatStore.updateStreamingBlocks([
              ...currentBlocks,
              { id: `block-${Date.now()}`, type: 'markdown', content: event.token }
            ])
          }
        } else if (event.type === 'reasoning') {
          activeChatStore.updateStreamingReasoning(
            (activeChatStore.streamingMessage?.reasoning || '') + event.token
          )
        } else if (event.type === 'tool_call') {
          // Handle tool call
          const toolBlock: UIMessageBlock = {
            id: `block-${Date.now()}`,
            type: 'tool_call',
            content: '',
            toolCallId: event.id,
            toolName: event.name,
            toolArgs: event.args,
            toolStatus: 'running'
          }
          activeChatStore.updateStreamingBlocks([
            ...(activeChatStore.streamingMessage?.blocks || []),
            toolBlock
          ])
        } else if (event.type === 'tool_result') {
          // Update tool call status and add result
          const blocks = activeChatStore.streamingMessage?.blocks || []
          const updatedBlocks = blocks.map(b => 
            b.toolCallId === event.id 
              ? { ...b, toolStatus: 'completed' as const }
              : b
          )
          
          // Add result block
          updatedBlocks.push({
            id: `block-${Date.now()}`,
            type: 'tool_result',
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            toolCallId: event.id
          })
          
          activeChatStore.updateStreamingBlocks(updatedBlocks)
          activeChatStore.incrementIteration()
        } else if (event.type === 'done') {
          // Save completed message
          const assistantMessage: DisplayMessage = {
            id: event.message.id,
            parentId: userMessage.id,
            role: 'assistant',
            blocks: event.message.blocks,
            timestamp: Date.now(),
            model: event.message.model,
            metadata: {
              reasoning: activeChatStore.streamingMessage?.reasoning
            }
          }
          messagesStore.addMessage(assistantMessage)
          historyId = event.historyId
          onResponseReceived?.(assistantMessage)
        } else if (event.type === 'error') {
          activeChatStore.setError(event.error.message)
          onError?.(event.error)
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      activeChatStore.setError(err.message)
      onError?.(err)
    } finally {
      activeChatStore.endGeneration()
    }
  }

  // Handle abort
  function handleAbort() {
    activeChatStore.abort()
  }

  // Handle copy
  function handleCopy(content: string) {
    if (onCopy) {
      onCopy(content)
    } else {
      navigator.clipboard.writeText(content).catch(console.error)
    }
  }

  // Handle edit
  function handleEdit(messageId: string) {
    const message = messagesStore.getMessageById(messageId)
    if (message) {
      const content = message.blocks
        .filter(b => b.type === 'text' || b.type === 'markdown')
        .map(b => b.content)
        .join('')
      inputStore.setUserInput(content)
    }
  }

  // Handle regenerate
  async function handleRegenerate(messageId: string) {
    // Find previous user message
    const messages = messagesStore.messages
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex <= 0) return

    const userMessage = messages[messageIndex - 1]
    if (userMessage.role !== 'user') return

    // Remove assistant message
    messagesStore.removeMessage(messageId)

    // Get user content and resend
    const content = userMessage.blocks
      .filter(b => b.type === 'text' || b.type === 'markdown')
      .map(b => b.content)
      .join('')

    // Remove user message to avoid duplication (handleSend will re-add it)
    messagesStore.removeMessage(userMessage.id)

    await handleSend(content)
  }
</script>

<div class="chat-ui flex h-full flex-col {className}">
  {#if children}
    {@render children()}
  {:else}
    <ChatMessages
      messages={messagesStore.messages}
      streamingMessage={activeChatStore.streamingMessage}
      isLoading={activeChatStore.isGenerating && !activeChatStore.firstTokenReceived}
      showAvatars={showAvatars}
      showActions={showActions}
      onCopy={handleCopy}
      onEdit={handleEdit}
      onRegenerate={handleRegenerate}
    />
    <ChatInput
      bind:value={inputStore.userInput}
      {placeholder}
      isGenerating={activeChatStore.isGenerating}
      {showAttachments}
      selectedImages={inputStore.selectedImages}
      selectedFiles={inputStore.selectedFiles}
      onSend={handleSend}
      onAbort={handleAbort}
      onImageRemove={(url: string) => inputStore.removeImage(url)}
      onFileRemove={(id: string) => inputStore.removeFile(id)}
    />
  {/if}

  <!-- Error display -->
  {#if activeChatStore.error}
    <div class="absolute bottom-20 left-4 right-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
      <div class="flex items-center justify-between">
        <span>{activeChatStore.error}</span>
        <button
          type="button"
          onclick={() => activeChatStore.setError(null)}
          aria-label="Dismiss error"
          class="text-red-500 hover:text-red-700"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  {/if}
</div>
