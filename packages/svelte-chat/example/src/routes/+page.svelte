<!--
  Example: @pubwiki/svelte-chat Usage Demo
  
  This example demonstrates how to use the ChatUI component
  with the PubChat core library.
-->
<script lang="ts">
  import { PubChat, MemoryMessageStore, createVfs, type VfsProvider, type VfsStat } from '@pubwiki/chat'
  import { ChatUI } from '@pubwiki/svelte-chat'
  import { browser } from '$app/environment'

  // Theme state
  let isDark = $state(false)
  
  // Initialize from localStorage or system preference
  $effect(() => {
    if (browser) {
      const stored = localStorage.getItem('theme')
      if (stored) {
        isDark = stored === 'dark'
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
      updateTheme()
    }
  })
  
  function toggleTheme() {
    isDark = !isDark
    if (browser) {
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
      updateTheme()
    }
  }
  
  function updateTheme() {
    if (browser) {
      document.documentElement.classList.toggle('dark', isDark)
    }
  }

  // Simple in-memory VFS provider
  class MemoryVfsProvider implements VfsProvider {
    private files = new Map<string, Uint8Array>()
    private directories = new Set<string>(['/'])

    private normalizePath(path: string): string {
      if (!path.startsWith('/')) path = '/' + path
      if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)

      if (path == "") path = '/'
      return path
    }

    private getParentPath(path: string): string {
      const normalized = this.normalizePath(path)
      const lastSlash = normalized.lastIndexOf('/')
      if (lastSlash <= 0) return '/'
      return normalized.substring(0, lastSlash)
    }

    async id(path: string): Promise<string> { return this.normalizePath(path) }

    async readFile(path: string): Promise<Uint8Array> {
      const normalized = this.normalizePath(path)
      const content = this.files.get(normalized)
      if (!content) throw new Error(`ENOENT: no such file: ${normalized}`)
      return content
    }

    async writeFile(path: string, content: Uint8Array): Promise<void> {
      const normalized = this.normalizePath(path)
      const parent = this.getParentPath(normalized)
      if (parent !== '/' && !this.directories.has(parent)) {
        await this.mkdir(parent, { recursive: true })
      }
      this.files.set(normalized, content)
    }

    async unlink(path: string): Promise<void> {
      const normalized = this.normalizePath(path)
      if (!this.files.has(normalized)) throw new Error(`ENOENT: no such file: ${normalized}`)
      this.files.delete(normalized)
    }

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const normalized = this.normalizePath(path)
      if (options?.recursive) {
        const parts = normalized.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          this.directories.add(current)
        }
      } else {
        this.directories.add(normalized)
      }
    }

    async readdir(path: string): Promise<string[]> {
        console.log(this.files)
      const normalized = this.normalizePath(path)
      const prefix = normalized === '/' ? '/' : normalized + '/'
      const entries = new Set<string>()
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.substring(prefix.length)
          const firstPart = relative.split('/')[0]
          if (firstPart) entries.add(firstPart)
        }
      }
      for (const dirPath of this.directories) {
        if (dirPath.startsWith(prefix) && dirPath !== normalized) {
          const relative = dirPath.substring(prefix.length)
          const firstPart = relative.split('/')[0]
          if (firstPart) entries.add(firstPart)
        }
      }
      return Array.from(entries)
    }

    async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const normalized = this.normalizePath(path)
      if (options?.recursive) {
        const prefix = normalized + '/'
        for (const filePath of this.files.keys()) {
          if (filePath.startsWith(prefix)) this.files.delete(filePath)
        }
        for (const dirPath of this.directories) {
          if (dirPath.startsWith(prefix) || dirPath === normalized) this.directories.delete(dirPath)
        }
      } else {
        this.directories.delete(normalized)
      }
    }

    async stat(path: string): Promise<VfsStat> {
      const normalized = this.normalizePath(path)
      const now = new Date()
      if (this.files.has(normalized)) {
        return { isDirectory: false, isFile: true, size: this.files.get(normalized)!.length, createdAt: now, updatedAt: now }
      }
      if (this.directories.has(normalized)) {
        return { isDirectory: true, isFile: false, size: 0, createdAt: now, updatedAt: now }
      }
      throw new Error(`ENOENT: no such file or directory: ${normalized}`)
    }

    async exists(path: string): Promise<boolean> {
      const normalized = this.normalizePath(path)
      return this.files.has(normalized) || this.directories.has(normalized)
    }

    async rename(from: string, to: string): Promise<void> {
      const normalizedFrom = this.normalizePath(from)
      const normalizedTo = this.normalizePath(to)
      if (this.files.has(normalizedFrom)) {
        const content = this.files.get(normalizedFrom)!
        this.files.delete(normalizedFrom)
        this.files.set(normalizedTo, content)
      } else {
        throw new Error(`ENOENT: no such file: ${normalizedFrom}`)
      }
    }

    async copyFile(from: string, to: string): Promise<void> {
      const content = await this.readFile(from)
      await this.writeFile(to, content)
    }
  }

  // State for API key input
  let apiKey = $state('')
  let model = $state('google/gemini-2.5-flash')
  let baseUrl = $state('https://openrouter.ai/api/v1')
  let pubchat = $state<PubChat | null>(null)
  let isConfigured = $state(false)

  // Initialize PubChat with user-provided API key
  function initializeChat() {
    if (!apiKey.trim()) {
      alert('Please enter your API key')
      return
    }

    const chat = new PubChat({
      llm: {
        apiKey: apiKey.trim(),
        model,
        baseUrl: baseUrl.trim() || undefined
      },
      messageStore: new MemoryMessageStore(),
      toolCalling: {
        enabled: true,
        maxIterations: 10
      }
    })

    // Create and set up in-memory VFS
    const vfs = createVfs(new MemoryVfsProvider())
    chat.setVFS(vfs)

    pubchat = chat
    isConfigured = true
  }

  // Reset configuration
  function resetConfig() {
    pubchat = null
    isConfigured = false
    apiKey = ''
  }

  // Event handlers
  function handleMessageSent(message: any) {
    console.log('Message sent:', message)
  }

  function handleResponseReceived(message: any) {
    console.log('Response received:', message)
  }

  function handleError(error: Error) {
    console.error('Chat error:', error)
    alert(`Error: ${error.message}`)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content)
    console.log('Copied to clipboard')
  }
</script>

<svelte:head>
  <title>@pubwiki/svelte-chat Example</title>
</svelte:head>

<div class="mx-auto min-h-screen max-w-5xl bg-gray-100 p-5 dark:bg-zinc-950">
  {#if !isConfigured}
    <!-- Configuration Form -->
    <div class="mx-auto mt-20 max-w-md rounded-xl bg-white p-10 shadow-lg dark:bg-zinc-900">
      <div class="mb-3 flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-800 dark:text-gray-100">@pubwiki/svelte-chat Demo</h1>
        <button
          type="button"
          onclick={toggleTheme}
          class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {#if isDark}
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          {:else}
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          {/if}
        </button>
      </div>
      <p class="mb-6 text-gray-600 dark:text-gray-400">
        Enter your OpenAI API key to start chatting. Your key is only used locally.
      </p>
      
      <!-- Mock Demo Link -->
      <a 
        href="/mock"
        class="mb-6 block rounded-lg border border-blue-200 bg-blue-50 p-4 text-center transition-colors hover:bg-blue-100 dark:border-blue-900/30 dark:bg-blue-900/20"
      >
        <span class="font-medium text-blue-700 dark:text-blue-400">🎭 查看 Mock 数据演示</span>
        <span class="mt-1 block text-sm text-blue-600 dark:text-blue-500">无需 API Key，预览组件效果</span>
      </a>
      
      <form onsubmit={(e) => { e.preventDefault(); initializeChat(); }}>
        <div class="mb-5">
          <label for="api-key" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
          <input 
            id="api-key"
            type="password" 
            bind:value={apiKey}
            placeholder="sk-..."
            autocomplete="off"
            class="w-full rounded-lg border border-gray-300 px-4 py-3 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900"
          />
        </div>
        
        <div class="mb-5">
          <label for="model" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
          <select 
            id="model" 
            bind:value={model}
            class="w-full rounded-lg border border-gray-300 px-4 py-3 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900"
          >
            <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
          </select>
        </div>
        
        <div class="mb-5">
          <label for="base-url" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Base URL (optional)</label>
          <input 
            id="base-url"
            type="text" 
            bind:value={baseUrl}
            placeholder="https://api.openai.com/v1"
            class="w-full rounded-lg border border-gray-300 px-4 py-3 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900"
          />
        </div>
        
        <button 
          type="submit" 
          class="mt-2 w-full rounded-lg bg-blue-500 px-6 py-3.5 text-base font-medium text-white transition-colors hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
        >
          Start Chatting
        </button>
      </form>
    </div>
  {:else if pubchat}
    <!-- Chat Interface -->
    <div class="flex h-[calc(100vh-40px)] flex-col overflow-hidden rounded-xl bg-white shadow-lg dark:bg-zinc-900">
      <header class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 class="text-lg font-medium text-gray-800 dark:text-gray-200">Chat with {model}</h2>
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={toggleTheme}
            class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {#if isDark}
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            {:else}
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            {/if}
          </button>
          <button 
            onclick={resetConfig} 
            class="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
          >
            Change Settings
          </button>
        </div>
      </header>
      
      <div class="flex-1 overflow-hidden">
        <ChatUI 
          {pubchat}
          placeholder="Type your message here..."
          showAvatars={true}
          showActions={true}
          onMessageSent={handleMessageSent}
          onResponseReceived={handleResponseReceived}
          onError={handleError}
          onCopy={handleCopy}
        />
      </div>
    </div>
  {/if}
</div>
