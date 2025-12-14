<script lang="ts">
  import '../app.css'
  import { browser } from '$app/environment'
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()

  let isDark = $state(false)

  // Initialize theme from localStorage or system preference
  $effect(() => {
    if (browser) {
      const stored = localStorage.getItem('theme')
      if (stored) {
        isDark = stored === 'dark'
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
    }
  })

  // Apply theme to document
  $effect(() => {
    if (browser) {
      document.documentElement.classList.toggle('dark', isDark)
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
    }
  })

  function toggleTheme() {
    isDark = !isDark
  }
</script>

<!-- Theme toggle button - fixed position -->
<button
  onclick={toggleTheme}
  class="fixed top-4 right-4 z-50 rounded-lg border border-gray-300 bg-white p-2 shadow-md transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
  {#if isDark}
    <!-- Sun icon -->
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  {:else}
    <!-- Moon icon -->
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  {/if}
</button>

{@render children()}
