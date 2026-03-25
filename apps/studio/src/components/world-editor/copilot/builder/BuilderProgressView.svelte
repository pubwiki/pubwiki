<!--
  BuilderProgressView.svelte
  
  Shows real-time progress while a WorldBuilder phase is generating.
  Displays status messages, character count, and any inline query_user forms.
-->
<script lang="ts">
  import { WBN_PHASE_LABELS, type WBNPhaseId, type QueryUserRequest } from '@pubwiki/world-editor';
  import QueryUserFormBlock from '../QueryUserFormBlock.svelte';

  interface Props {
    phaseId: WBNPhaseId;
    statusMessage: string;
    charCount: number;
    aiText: string;
    pendingQuery: QueryUserRequest | null;
    querySubmitted: boolean;
    onquerysubmit: (data: Record<string, unknown>) => void;
    oncancel: () => void;
  }

  let {
    phaseId,
    statusMessage,
    charCount,
    aiText,
    pendingQuery,
    querySubmitted,
    onquerysubmit,
    oncancel,
  }: Props = $props();

  let phaseLabel = $derived(WBN_PHASE_LABELS[phaseId] || phaseId);
</script>

<div class="flex flex-1 min-h-0 flex-col">
  <!-- Scrollable content -->
  <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
    <!-- Phase generating header with spinner and char count -->
    <div class="text-center">
      <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
        Generating: {phaseLabel}
        <!-- Spinning loader -->
        <svg class="w-3.5 h-3.5 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        {#if charCount > 0}
          <span class="text-[10px] text-blue-400">{charCount.toLocaleString()} chars</span>
        {/if}
      </div>
    </div>

    <!-- Status message -->
    {#if statusMessage}
      <p class="text-xs text-gray-500 text-center italic">{statusMessage}</p>
    {/if}

    <!-- AI text output (for synopsis phase) -->
    {#if aiText}
      <div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
        {aiText}
      </div>
    {/if}

    <!-- Inline query_user form -->
    {#if pendingQuery}
      <div class="mt-2">
        <QueryUserFormBlock
          request={pendingQuery}
          submitted={querySubmitted}
          onsubmit={onquerysubmit}
        />
      </div>
    {/if}
  </div>

  <!-- Footer: Cancel button -->
  <div class="border-t border-gray-200 p-3 flex justify-center flex-shrink-0">
    <button
      class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      onclick={oncancel}
    >
      Cancel
    </button>
  </div>
</div>
