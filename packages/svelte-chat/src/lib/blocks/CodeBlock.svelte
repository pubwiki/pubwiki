<!--
  CodeBlock.svelte - Code block renderer
  
  Renders code blocks with:
  - Language detection
  - Copy to clipboard
  - Download as file
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'

  interface Props {
    block: UIMessageBlock
    class?: string
  }

  let { block, class: className = '' }: Props = $props()

  // Parse code content
  let codeData = $derived.by(() => {
    try {
      const data = JSON.parse(block.content)
      return { code: data.code || block.content, language: data.language || 'text' }
    } catch {
      return { code: block.content, language: 'text' }
    }
  })

  let copied = $state(false)

  // Programming language extensions
  const languageExtensions: Record<string, string> = {
    javascript: '.js',
    python: '.py',
    java: '.java',
    c: '.c',
    cpp: '.cpp',
    'c++': '.cpp',
    'c#': '.cs',
    ruby: '.rb',
    php: '.php',
    swift: '.swift',
    'objective-c': '.m',
    kotlin: '.kt',
    typescript: '.ts',
    go: '.go',
    perl: '.pl',
    rust: '.rs',
    scala: '.scala',
    haskell: '.hs',
    lua: '.lua',
    shell: '.sh',
    sql: '.sql',
    html: '.html',
    css: '.css'
  }

  function generateRandomString(length: number): string {
    const chars = 'abcdefghjklmnpqrstuvwxy3456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(codeData.code)
      copied = true
      setTimeout(() => {
        copied = false
      }, 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  function downloadAsFile() {
    const fileExtension = languageExtensions[codeData.language.toLowerCase()] || '.file'
    const suggestedFileName = `file-${generateRandomString(3)}${fileExtension}`
    const fileName = window.prompt('Enter file name', suggestedFileName)

    if (!fileName) return

    const blob = new Blob([codeData.code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = fileName
    link.href = url
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
</script>

<div class="codeblock relative w-full overflow-hidden rounded-lg bg-zinc-950 font-sans {className}">
  <!-- Header -->
  <div class="flex w-full items-center justify-between bg-zinc-700 px-4 py-1.5 text-white">
    <span class="text-xs lowercase text-zinc-300">{codeData.language}</span>
    <div class="flex items-center space-x-1">
      <!-- Download button -->
      <button
        type="button"
        onclick={downloadAsFile}
        class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        title="Download as file"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>

      <!-- Copy button -->
      <button
        type="button"
        onclick={copyToClipboard}
        class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {#if copied}
          <svg class="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        {:else}
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
  
  <!-- Code content -->
  <div class="overflow-x-auto">
    <pre class="m-0 w-full bg-transparent p-4"><code class="text-sm text-zinc-100" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">{codeData.code}</code></pre>
  </div>
</div>
