/**
 * Chat Input Store - Svelte 5 Runes
 * 
 * Manages user input state for the chat interface
 */

/**
 * Creates a reactive chat input store
 */
export function createChatInputStore() {
  let userInput = $state('')
  let isComposing = $state(false)
  let selectedImages = $state<string[]>([])
  let selectedFiles = $state<string[]>([])

  return {
    /** Current user input text */
    get userInput() { return userInput },
    set userInput(value: string) { userInput = value },
    
    /** Whether IME composition is in progress */
    get isComposing() { return isComposing },
    
    /** Selected image URLs/paths */
    get selectedImages() { return selectedImages },
    
    /** Selected file IDs */
    get selectedFiles() { return selectedFiles },
    
    /** Set user input */
    setUserInput(value: string) {
      userInput = value
    },
    
    /** Clear user input */
    clearInput() {
      userInput = ''
    },
    
    /** Set composition state */
    setIsComposing(value: boolean) {
      isComposing = value
    },
    
    /** Add selected image */
    addImage(url: string) {
      selectedImages = [...selectedImages, url]
    },
    
    /** Remove selected image */
    removeImage(url: string) {
      selectedImages = selectedImages.filter(img => img !== url)
    },
    
    /** Clear all selected images */
    clearImages() {
      selectedImages = []
    },
    
    /** Add selected file */
    addFile(fileId: string) {
      selectedFiles = [...selectedFiles, fileId]
    },
    
    /** Remove selected file */
    removeFile(fileId: string) {
      selectedFiles = selectedFiles.filter(f => f !== fileId)
    },
    
    /** Clear all selected files */
    clearFiles() {
      selectedFiles = []
    },
    
    /** Reset all input state */
    reset() {
      userInput = ''
      isComposing = false
      selectedImages = []
      selectedFiles = []
    }
  }
}

/** Chat input store type */
export type ChatInputStore = ReturnType<typeof createChatInputStore>
