<!--
  BuilderReviewView.svelte
  
  Review view shown after a WorldBuilder phase completes.
  For synopsis: shows DraftPreview.
  For data phases: shows summary + status.
  Allows revision or advancing to next phase.
-->
<script lang="ts">
  import {
    WBN_PHASE_LABELS,
    type WBNPhaseId,
    type WBNDraftOutput,
    type WBNSession,
    type StateChangeEntry,
    type StateChangeChild,
  } from '@pubwiki/world-editor';
  import DraftPreview from './DraftPreview.svelte';

  interface Props {
    session: WBNSession;
    phaseId: WBNPhaseId;
    isRevising: boolean;
    revisionLog: Array<{ toolName: string; summary: string }>;
    changes: StateChangeEntry[];
    onrevise: (message: string) => void;
    onregenerate: () => void;
    onnext: () => void;
    onnavigate: (tab: string) => void;
    readonly?: boolean;
  }

  let { session, phaseId, isRevising, revisionLog, changes, onrevise, onregenerate, onnext, onnavigate, readonly = false }: Props = $props();

  let revisionInput = $state('');
  let phaseLabel = $derived(WBN_PHASE_LABELS[phaseId] || phaseId);

  let draftOutput = $derived(
    phaseId === 'synopsis' ? (session.phases.synopsis.output as WBNDraftOutput | undefined) : undefined
  );

  let isLastPhase = $derived(phaseId === 'creatures');

  function handleRevise() {
    if (!revisionInput.trim()) return;
    onrevise(revisionInput.trim());
    revisionInput = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleRevise();
    }
  }
</script>

<div class="flex flex-1 min-h-0 flex-col">
  <!-- Scrollable content -->
  <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
    <!-- Success header -->
    <div class="text-center">
      <div class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        {phaseLabel} Complete
      </div>
    </div>

    <!-- Synopsis draft preview -->
    {#if draftOutput}
      <div class="bg-white border border-gray-100 rounded-lg p-4">
        <DraftPreview draft={draftOutput} />
      </div>
    {:else if changes.length > 0}
      <!-- Detailed change list -->
      <div class="space-y-1">
        <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1">
          {changes.length} changes applied
        </h4>
        {#each changes as ch}
          {@const actionStyle = ch.action === 'created' ? 'bg-green-400' : ch.action === 'deleted' ? 'bg-red-400' : 'bg-blue-400'}
          {@const actionLabel = ch.action === 'created' ? '+' : ch.action === 'deleted' ? '-' : '~'}
          <div>
            <button
              class="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors text-left group"
              onclick={() => onnavigate(ch.tab)}
            >
              <span class="flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white {actionStyle}">{actionLabel}</span>
              <span class="text-xs text-gray-700 truncate flex-1">{ch.label}</span>
              <span class="text-[10px] text-gray-400 capitalize">{ch.category}</span>
              <svg class="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {#if ch.children && ch.children.length > 0}
              <div class="ml-8 border-l border-gray-200 pl-2 py-0.5">
                {#each ch.children as child}
                  <div class="flex items-center gap-1.5 px-1 py-0.5">
                    <span class="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0"></span>
                    <span class="text-[11px] text-gray-500">{child.label}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- Fallback: no changes tracked -->
      <div class="bg-white border border-gray-100 rounded-lg p-4">
        <p class="text-sm text-gray-600">
          {phaseLabel} data has been generated and applied to your world.
        </p>
      </div>
    {/if}

    <!-- Revision log -->
    {#if !readonly && revisionLog.length > 0}
      <div class="space-y-1.5">
        <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Changes Made
        </h4>
        {#each revisionLog as entry}
          <div class="flex items-start gap-2 px-2 py-1.5 bg-gray-50 rounded-md">
            <div class="w-1 h-1 mt-1.5 bg-blue-400 rounded-full flex-shrink-0"></div>
            <div class="text-xs text-gray-600">
              <span class="font-medium text-gray-700">{entry.toolName}</span>: {entry.summary}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Revising indicator -->
    {#if !readonly && isRevising}
      <div class="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
        <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <span class="text-xs text-blue-700">AI is revising...</span>
      </div>
    {/if}
  </div>

  <!-- Footer: revision input + action buttons -->
  {#if !readonly}
  <div class="border-t border-gray-200 p-3 space-y-2 flex-shrink-0">
    <!-- Revision input -->
    <div class="flex gap-2">
      <textarea
        class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none"
        rows={2}
        placeholder="Feedback or revision requests..."
        bind:value={revisionInput}
        onkeydown={handleKeydown}
        disabled={isRevising}
      ></textarea>
    </div>

    <!-- Action buttons -->
    <div class="flex gap-2">
      {#if revisionInput.trim()}
        <button
          class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors
            {!isRevising
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
          "
          disabled={isRevising}
          onclick={handleRevise}
        >
          Revise
        </button>
      {:else}
        <button
          class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors
            {!isRevising
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
          "
          disabled={isRevising}
          onclick={onregenerate}
        >
          Regenerate
        </button>
      {/if}
      <button
        class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors
          {!isRevising
            ? 'bg-purple-600 text-white hover:bg-purple-700'
            : 'bg-purple-600 text-white opacity-50 cursor-not-allowed'}
        "
        disabled={isRevising}
        onclick={onnext}
      >
        {isLastPhase ? 'Finish' : 'Next Phase'}
      </button>
    </div>
  </div>
  {/if}
</div>
