<!--
  ImageBlock.svelte - Image renderer
  
  Renders images with lazy loading and error handling
-->
<script lang="ts">
  interface Props {
    src: string
    alt?: string
    class?: string
  }

  let { src, alt = 'Image', class: className = '' }: Props = $props()

  let loaded = $state(false)
  let error = $state(false)

  function handleLoad() {
    loaded = true
  }

  function handleError() {
    error = true
  }
</script>

<div class="my-2 {className}">
  {#if error}
    <div class="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-8 dark:border-gray-700 dark:bg-gray-800">
      <div class="text-center text-gray-500">
        <svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p class="mt-2 text-sm">Failed to load image</p>
      </div>
    </div>
  {:else}
    <div class="relative">
      {#if !loaded}
        <div class="absolute inset-0 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
          <svg class="h-8 w-8 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      {/if}
      <img
        {src}
        {alt}
        class="max-w-full rounded-lg transition-opacity duration-200 {loaded ? 'opacity-100' : 'opacity-0'}"
        loading="lazy"
        onload={handleLoad}
        onerror={handleError}
      />
    </div>
  {/if}
</div>

<style>
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }
</style>
