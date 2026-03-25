<!--
  BuilderPhaseIndicator.svelte
  
  Horizontal phase progress bar for the WorldBuilder.
  Shows status of each phase: completed (green), active (blue), pending (gray).
-->
<script lang="ts">
  import {
    WBN_PHASE_IDS,
    WBN_PHASE_LABELS,
    type WBNPhaseId,
    type WBNPhaseStatus,
  } from '@pubwiki/world-editor';

  interface Props {
    currentPhase: WBNPhaseId;
    phaseStatuses: Record<WBNPhaseId, WBNPhaseStatus>;
    /** Fired when a completed phase is clicked (for rollback). */
    onphaseclick?: (phaseId: WBNPhaseId) => void;
  }

  let { currentPhase, phaseStatuses, onphaseclick }: Props = $props();

  // Drag-to-scroll state
  let scrollEl: HTMLDivElement | undefined = $state();
  let isDragging = $state(false);
  let didDrag = false;
  let startX = 0;
  let scrollLeft = 0;
  let pendingPointerId = -1;

  function handlePointerDown(e: PointerEvent) {
    if (!scrollEl) return;
    isDragging = true;
    didDrag = false;
    startX = e.clientX;
    scrollLeft = scrollEl.scrollLeft;
    pendingPointerId = e.pointerId;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging || !scrollEl) return;
    const dx = e.clientX - startX;
    if (!didDrag && Math.abs(dx) > 3) {
      didDrag = true;
      // Capture pointer only once drag starts, so clicks still reach buttons
      scrollEl.setPointerCapture(pendingPointerId);
    }
    if (didDrag) {
      scrollEl.scrollLeft = scrollLeft - dx;
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (didDrag && scrollEl) {
      scrollEl.releasePointerCapture(e.pointerId);
    }
    isDragging = false;
    pendingPointerId = -1;
  }

  function handlePhaseClick(phaseId: WBNPhaseId, status: WBNPhaseStatus) {
    if (didDrag) return;
    // Allow clicking the current phase (to return to current progress)
    // or any completed phase before the current one (to view its changes)
    if (phaseId === currentPhase) {
      onphaseclick?.(phaseId);
      return;
    }
    if (status !== 'completed') return;
    onphaseclick?.(phaseId);
  }

  function handleWheel(e: WheelEvent) {
    if (!scrollEl) return;
    if (e.deltaX !== 0) return; // let native horizontal scroll work
    e.preventDefault();
    scrollEl.scrollLeft += e.deltaY;
  }
</script>

<div
  class="phase-indicator flex items-center gap-1 px-3 pb-2 overflow-x-auto select-none"
  class:cursor-grabbing={isDragging}
  class:cursor-grab={!isDragging}
  bind:this={scrollEl}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onwheel={handleWheel}
>
  {#each WBN_PHASE_IDS as phaseId, i}
    {@const status = phaseStatuses[phaseId]}
    {@const isActive = phaseId === currentPhase}

    {#if i > 0}
      <!-- Connector line -->
      <div
        class="flex-shrink-0 w-3 h-px {status === 'completed' ? 'bg-green-400' : 'bg-gray-200'}"
      ></div>
    {/if}

    <!-- Phase dot + label -->
    <button
      class="flex items-center gap-1 flex-shrink-0 bg-transparent border-none p-0
        {status === 'completed' || phaseId === currentPhase ? 'cursor-pointer hover:opacity-70' : 'cursor-default'}
      "
      onclick={() => handlePhaseClick(phaseId, status)}
      type="button"
    >
      <!-- Status dot -->
      <div
        class="w-2 h-2 rounded-full flex-shrink-0
          {status === 'completed' ? 'bg-green-500' : ''}
          {status === 'generating' || (isActive && status === 'active') ? 'bg-blue-500 animate-pulse' : ''}
          {status === 'error' ? 'bg-red-500' : ''}
          {status === 'pending' ? 'bg-gray-300' : ''}
        "
      ></div>
      <!-- Label -->
      <span
        class="text-[10px] leading-none whitespace-nowrap
          {isActive ? 'font-semibold text-gray-700' : ''}
          {status === 'completed' ? 'text-green-600' : ''}
          {status === 'error' ? 'text-red-600' : ''}
          {status === 'pending' ? 'text-gray-400' : ''}
          {status === 'generating' ? 'text-blue-600' : ''}
        "
      >
        {WBN_PHASE_LABELS[phaseId]}
      </span>
    </button>
  {/each}
</div>

<style>
  .phase-indicator {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge */
  }
  .phase-indicator::-webkit-scrollbar {
    display: none; /* Chrome/Safari */
  }
</style>
