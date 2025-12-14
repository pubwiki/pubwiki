/**
 * Messages Store - Svelte 5 Runes
 * 
 * Manages message list state for a chat session
 */

import type { MessageNode } from '@pubwiki/chat'
import type { UIMessageBlock } from '../types'

/**
 * Message for display in the UI
 */
export interface DisplayMessage extends Omit<MessageNode, 'blocks'> {
  /** Message content blocks with UI-extended types */
  blocks: UIMessageBlock[]
  /** Whether the message is being edited */
  isEditing?: boolean
  /** Original content before editing */
  originalContent?: string
}

/**
 * Creates a reactive messages store
 */
export function createMessagesStore() {
  let messages = $state<DisplayMessage[]>([])
  let isLoading = $state(false)

  return {
    /** Current messages list */
    get messages() { return messages },
    
    /** Whether messages are loading */
    get isLoading() { return isLoading },
    
    /** Set all messages */
    setMessages(newMessages: DisplayMessage[]) {
      messages = newMessages
    },
    
    /** Add a message */
    addMessage(message: DisplayMessage) {
      messages = [...messages, message]
    },
    
    /** Update a message by ID */
    updateMessage(id: string, updates: Partial<DisplayMessage>) {
      messages = messages.map(msg => 
        msg.id === id ? { ...msg, ...updates } : msg
      )
    },
    
    /** Update message blocks */
    updateMessageBlocks(id: string, blocks: UIMessageBlock[]) {
      messages = messages.map(msg =>
        msg.id === id ? { ...msg, blocks } : msg
      )
    },
    
    /** Append content to a message's last text/markdown block */
    appendToLastBlock(id: string, content: string) {
      messages = messages.map(msg => {
        if (msg.id !== id) return msg
        
        const blocks = [...msg.blocks]
        const lastBlock = blocks[blocks.length - 1]
        
        if (lastBlock && (lastBlock.type === 'text' || lastBlock.type === 'markdown')) {
          blocks[blocks.length - 1] = {
            ...lastBlock,
            content: lastBlock.content + content
          }
        } else {
          // Create new markdown block
          blocks.push({
            id: `block-${Date.now()}`,
            type: 'markdown',
            content
          })
        }
        
        return { ...msg, blocks }
      })
    },
    
    /** Add a block to a message */
    addBlock(messageId: string, block: UIMessageBlock) {
      messages = messages.map(msg =>
        msg.id === messageId 
          ? { ...msg, blocks: [...msg.blocks, block] }
          : msg
      )
    },
    
    /** Update a specific block in a message */
    updateBlock(messageId: string, blockId: string, updates: Partial<UIMessageBlock>) {
      messages = messages.map(msg => {
        if (msg.id !== messageId) return msg
        
        return {
          ...msg,
          blocks: msg.blocks.map(block =>
            block.id === blockId ? { ...block, ...updates } : block
          )
        }
      })
    },
    
    /** Remove a message */
    removeMessage(id: string) {
      messages = messages.filter(msg => msg.id !== id)
    },
    
    /** Clear all messages */
    clear() {
      messages = []
    },
    
    /** Set loading state */
    setLoading(loading: boolean) {
      isLoading = loading
    },
    
    /** Get message by ID */
    getMessageById(id: string): DisplayMessage | undefined {
      return messages.find(msg => msg.id === id)
    },
    
    /** Get last message */
    getLastMessage(): DisplayMessage | undefined {
      return messages[messages.length - 1]
    }
  }
}

/** Messages store type */
export type MessagesStore = ReturnType<typeof createMessagesStore>
