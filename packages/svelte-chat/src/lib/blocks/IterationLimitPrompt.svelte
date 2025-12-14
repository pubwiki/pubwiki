<!--
  IterationLimitPrompt.svelte - Interactive iteration limit prompt
  
  Displays when tool calling reaches iteration limit,
  allows user to continue or stop
-->
<script lang="ts">
  import type { UIMessageBlock } from '../types'

  interface Props {
    block: UIMessageBlock
    onContinue?: (blockId: string) => void
    onStop?: (blockId: string) => void
    class?: string
  }

  let { block, onContinue, onStop, class: className = '' }: Props = $props()

  // Parse prompt data
  let promptData = $derived.by(() => {
    try {
      return JSON.parse(block.content) as {
        currentIteration: number
        maxIterations: number
        chatId?: string
        messageId?: string
      }
    } catch {
      return { currentIteration: 0, maxIterations: 10 }
    }
  })

  function handleContinue() {
    onContinue?.(block.id)
  }

  function handleStop() {
    onStop?.(block.id)
  }
</script>

<div class="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20 {className}">
  <div class="flex items-start gap-3">
    <span class="text-2xl">⚠️</span>
    <div class="flex-1">
      <h4 class="font-semibold text-amber-800 dark:text-amber-200">
        Iteration Limit Reached
      </h4>
      <p class="mt-1 text-sm text-amber-700 dark:text-amber-300">
        The assistant has reached {promptData.currentIteration} of {promptData.maxIterations} iterations.
        Would you like to continue?
      </p>
      <div class="mt-4 flex gap-3">
        <button
          type="button"
          onclick={handleContinue}
          class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
        >
          Continue
        </button>
        <button
          type="button"
          onclick={handleStop}
          class="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-600 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/30"
        >
          Stop
        </button>
      </div>
    </div>
  </div>
</div>
