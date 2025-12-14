<!--
  CustomBlock.svelte - Custom block renderer placeholder
  
  Displays custom blocks that need external renderer implementation
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'

  interface Props {
    block: UIMessageBlock
    class?: string
  }

  let { block, class: className = '' }: Props = $props()

  let rendererName = $derived(block.metadata?.renderer as string | undefined)
</script>

<div class="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20 {className}">
  {#if rendererName}
    <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
      <span>✨</span>
      <span>Custom Renderer: {rendererName}</span>
    </div>
  {:else}
    <div class="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
      Custom block (no renderer specified)
    </div>
  {/if}
  <pre class="overflow-auto rounded bg-white/50 p-3 text-xs dark:bg-black/20"><code>{block.content}</code></pre>
</div>

<style>
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
</style>
