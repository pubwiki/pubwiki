<!--
  MarkdownBlock.svelte - Markdown content renderer
  
  Renders markdown content using marked library with support for:
  - GitHub Flavored Markdown
  - Tables
  - Code blocks
  - Line breaks
-->
<script lang="ts">
  import { marked } from 'marked'

  interface Props {
    content: string
    class?: string
  }

  let { content, class: className = '' }: Props = $props()

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: true
  })

  // Render markdown to HTML
  let html = $derived.by(() => {
    try {
      return marked.parse(content, { async: false }) as string
    } catch (e) {
      console.error('Markdown parsing error:', e)
      return content
    }
  })
</script>

<div class="prose prose-sm dark:prose-invert max-w-none {className}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>

<style>
  .prose {
    line-height: 1.6;
  }
  
  .prose :global(p) {
    margin: 0.5em 0;
  }
  
  .prose :global(p:first-child) {
    margin-top: 0;
  }
  
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  
  .prose :global(code) {
    background-color: rgba(0, 0, 0, 0.1);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  
  :global(.dark) .prose :global(code) {
    background-color: rgba(255, 255, 255, 0.1);
  }
  
  .prose :global(pre) {
    background-color: #1e1e1e;
    padding: 1em;
    border-radius: 0.5em;
    overflow-x: auto;
    margin: 1em 0;
  }
  
  .prose :global(pre code) {
    background: none;
    padding: 0;
    color: #d4d4d4;
  }
  
  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }
  
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid #e5e5e5;
    padding: 0.5em 1em;
    text-align: left;
  }
  
  :global(.dark) .prose :global(th),
  :global(.dark) .prose :global(td) {
    border-color: #404040;
  }
  
  .prose :global(th) {
    background-color: #f5f5f5;
    font-weight: 600;
  }
  
  :global(.dark) .prose :global(th) {
    background-color: #262626;
  }
  
  .prose :global(blockquote) {
    border-left: 4px solid #3b82f6;
    padding-left: 1em;
    margin: 1em 0;
    color: #6b7280;
  }
  
  :global(.dark) .prose :global(blockquote) {
    color: #9ca3af;
  }
  
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }
  
  .prose :global(li) {
    margin: 0.25em 0;
  }
  
  .prose :global(hr) {
    border: none;
    border-top: 1px solid #e5e5e5;
    margin: 1.5em 0;
  }
  
  :global(.dark) .prose :global(hr) {
    border-color: #404040;
  }
  
  .prose :global(a) {
    color: #3b82f6;
    text-decoration: underline;
  }
  
  .prose :global(a:hover) {
    color: #2563eb;
  }
  
  .prose :global(strong) {
    font-weight: 600;
  }
  
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    font-weight: 600;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  
  .prose :global(h1) {
    font-size: 1.5em;
  }
  
  .prose :global(h2) {
    font-size: 1.25em;
  }
  
  .prose :global(h3) {
    font-size: 1.1em;
  }
</style>
