<!--
  BlockRenderer.svelte - Core block rendering system
  
  Renders MessageBlock arrays with support for:
  - Tool call grouping (tool_call + tool_result)
  - Multiple block types
-->
<script lang="ts">
  import type { UIMessageBlock, RenderGroup, ToolCallRenderer } from '../types'
  import { groupBlocksForRender } from '../types'
  
  import MarkdownBlock from './MarkdownBlock.svelte'
  import CodeBlock from './CodeBlock.svelte'
  import DefaultToolCallBlock from './ToolCallBlock.svelte'
  import ReasoningBlock from './ReasoningBlock.svelte'
  import TableBlock from './TableBlock.svelte'
  import ListBlock from './ListBlock.svelte'
  import ImageBlock from './ImageBlock.svelte'
  import HtmlBlock from './HtmlBlock.svelte'
  import CustomBlock from './CustomBlock.svelte'
  import IterationLimitPrompt from './IterationLimitPrompt.svelte'

  interface Props {
    blocks: UIMessageBlock[]
    /** Custom renderer for tool call blocks */
    toolCallRenderer?: ToolCallRenderer
    /** Callback for iteration limit continue action */
    onIterationContinue?: (blockId: string) => void
    /** Callback for iteration limit stop action */
    onIterationStop?: (blockId: string) => void
    class?: string
  }

  let { 
    blocks, 
    toolCallRenderer,
    onIterationContinue,
    onIterationStop,
    class: className = '' 
  }: Props = $props()

  // Use custom renderer if provided, otherwise use default
  let ToolCallBlock = $derived(toolCallRenderer ?? DefaultToolCallBlock)

  /**
   * Group blocks for rendering (merge tool_call + tool_result)
   */
  let groups = $derived(groupBlocksForRender(blocks || []))
</script>

{#if blocks.length === 0}
  <!-- Empty state -->
{:else}
  {#each groups as group (group.id)}
    {#if group.type === 'tool_call_group'}
      <ToolCallBlock 
        toolCallBlock={group.toolCallBlock} 
        toolResultBlock={group.toolResultBlock}
        class={className}
      />
    {:else}
      <!-- Single block rendering -->
      {#if group.block.type === 'text'}
        <span class="whitespace-pre-wrap">{group.block.content}</span>
      {:else if group.block.type === 'markdown'}
        <MarkdownBlock content={group.block.content} class={className} />
      {:else if group.block.type === 'code'}
        <CodeBlock block={group.block} class={className} />
      {:else if group.block.type === 'reasoning'}
        <ReasoningBlock content={group.block.content} class={className} />
      {:else if group.block.type === 'table'}
        <TableBlock block={group.block} class={className} />
      {:else if group.block.type === 'list'}
        <ListBlock block={group.block} class={className} />
      {:else if group.block.type === 'image'}
        <ImageBlock src={group.block.content} class={className} />
      {:else if group.block.type === 'html'}
        <HtmlBlock content={group.block.content} class={className} />
      {:else if group.block.type === 'custom'}
        <CustomBlock block={group.block} class={className} />
      {:else if group.block.type === 'iteration_limit_prompt'}
        <IterationLimitPrompt 
          block={group.block} 
          onContinue={onIterationContinue}
          onStop={onIterationStop}
          class={className}
        />
      {:else if group.block.type === 'tool_call' || group.block.type === 'tool_result'}
        <!-- These are handled by tool_call_group, skip if standalone -->
      {:else}
        <!-- Unknown block type warning -->
        <div class="my-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
          Unknown block type: {group.block.type}
        </div>
      {/if}
    {/if}
  {/each}
{/if}
