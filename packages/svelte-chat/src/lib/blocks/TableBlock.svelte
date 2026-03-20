<!--
  TableBlock.svelte - Table data renderer
  
  Renders structured table data from JSON content
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'

  interface Props {
    block: UIMessageBlock
    class?: string
  }

  let { block, class: className = '' }: Props = $props()

  // Parse table data
  let tableData = $derived.by(() => {
    try {
      const data = JSON.parse(block.content)
      if (!data.headers || !data.rows || !Array.isArray(data.headers) || !Array.isArray(data.rows)) {
        return null
      }
      return { headers: data.headers as string[], rows: data.rows as string[][] }
    } catch {
      return null
    }
  })

  let error = $derived(!tableData)
</script>

{#if error}
  <div class="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 {className}">
    Error rendering table: Invalid format
  </div>
{:else if tableData}
  <div class="my-4 overflow-x-auto {className}">
    <table class="min-w-full divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
      <thead class="bg-gray-50 dark:bg-gray-800">
        <tr>
          {#each tableData.headers as header (header)}
            <th
              class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400"
            >
              {header}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
        {#each tableData.rows as row (row)}
          <tr class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
            {#each row as cell (cell)}
              <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                {cell}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  table {
    border-collapse: separate;
    border-spacing: 0;
  }
</style>
