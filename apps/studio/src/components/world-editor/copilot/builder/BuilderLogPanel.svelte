<!--
  BuilderLogPanel.svelte
  
  Collapsible event log showing generation progress events.
  Displayed in both ProgressView and ReviewView for transparency.
-->
<script lang="ts">
  export interface LogEntry {
    timestamp: number;
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
  }

  interface Props {
    entries: LogEntry[];
  }

  let { entries }: Props = $props();
  let expanded = $state(false);

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  const typeStyles: Record<LogEntry['type'], string> = {
    info: 'text-gray-400',
    warning: 'text-amber-500',
    error: 'text-red-500',
    success: 'text-green-500',
  };
</script>

{#if entries.length > 0}
  <div class="border-t border-gray-100">
    <button
      class="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
      onclick={() => expanded = !expanded}
    >
      <svg class="w-3 h-3 transition-transform {expanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      Event Log
      <span class="ml-auto px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-400 rounded-full">{entries.length}</span>
    </button>

    {#if expanded}
      <div class="max-h-40 overflow-y-auto px-3 pb-2 space-y-0.5">
        {#each entries as entry}
          <div class="flex items-start gap-1.5 text-[11px] leading-tight">
            <span class="text-gray-300 whitespace-nowrap font-mono">{formatTime(entry.timestamp)}</span>
            <span class="{typeStyles[entry.type]} truncate">{entry.message}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
