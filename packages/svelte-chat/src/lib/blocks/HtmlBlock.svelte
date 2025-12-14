<!--
  HtmlBlock.svelte - Raw HTML content renderer
  
  Renders HTML content with sanitization warning
  NOTE: Use with caution - HTML is rendered as-is
-->
<script lang="ts">
  interface Props {
    content: string
    class?: string
  }

  let { content, class: className = '' }: Props = $props()
</script>

<div class="prose prose-sm my-4 max-w-none dark:prose-invert {className}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html content}
</div>

<style>
  .prose {
    line-height: 1.6;
  }
</style>
