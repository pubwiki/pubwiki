<!--
  ListBlock.svelte - List data renderer
  
  Renders ordered/unordered lists from JSON content
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'
  import MarkdownBlock from './MarkdownBlock.svelte'

  interface Props {
    block: UIMessageBlock
    class?: string
  }

  let { block, class: className = '' }: Props = $props()

  // Parse list data
  let listData = $derived.by(() => {
    try {
      const data = JSON.parse(block.content)
      if (!data.items || !Array.isArray(data.items)) {
        return null
      }
      return { items: data.items as string[], ordered: data.ordered ?? false }
    } catch {
      return null
    }
  })

  let error = $derived(!listData)
</script>

{#if error}
  <div class="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 {className}">
    Error rendering list: Invalid format
  </div>
{:else if listData}
  <div class="my-4 {className}">
    {#if listData.ordered}
      <ol class="list-decimal space-y-2 pl-6">
        {#each listData.items as item (item)}
          <li class="text-sm text-gray-700 dark:text-gray-300">
            <MarkdownBlock content={item} />
          </li>
        {/each}
      </ol>
    {:else}
      <ul class="list-disc space-y-2 pl-6">
        {#each listData.items as item (item)}
          <li class="text-sm text-gray-700 dark:text-gray-300">
            <MarkdownBlock content={item} />
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
