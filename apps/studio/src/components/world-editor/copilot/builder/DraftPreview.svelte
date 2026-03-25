<!--
  DraftPreview.svelte
  
  Card component to preview the Synopsis (draft) output.
  Shows tone, storyline, characters, regions, organizations.
-->
<script lang="ts">
  import type { WBNDraftOutput } from '@pubwiki/world-editor';

  interface Props {
    draft: WBNDraftOutput;
  }

  let { draft }: Props = $props();

  let showFullStoryline = $state(false);

  let truncatedStoryline = $derived(
    draft.storyline.length > 200 && !showFullStoryline
      ? draft.storyline.slice(0, 200) + '...'
      : draft.storyline
  );
</script>

<div class="space-y-3">
  <!-- Tone -->
  {#if draft.tone}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Tone</h4>
      <p class="text-sm text-gray-700">{draft.tone}</p>
    </div>
  {/if}

  <!-- Opening -->
  {#if draft.opening}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Opening</h4>
      <p class="text-sm text-gray-600 italic leading-relaxed">{draft.opening}</p>
    </div>
  {/if}

  <!-- Storyline -->
  {#if draft.storyline}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Storyline</h4>
      <p class="text-sm text-gray-600 leading-relaxed">{truncatedStoryline}</p>
      {#if draft.storyline.length > 200}
        <button
          class="text-xs text-purple-500 hover:text-purple-700 mt-1"
          onclick={() => showFullStoryline = !showFullStoryline}
        >
          {showFullStoryline ? 'Show less' : 'Show more'}
        </button>
      {/if}
    </div>
  {/if}

  <!-- Protagonist -->
  {#if draft.protagonist}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Protagonist</h4>
      <p class="text-sm text-gray-700">{draft.protagonist}</p>
    </div>
  {/if}

  <!-- Characters -->
  {#if draft.creatures?.length}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        Characters ({draft.creatures.length})
      </h4>
      <div class="flex flex-wrap gap-1.5">
        {#each draft.creatures as creature}
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
              {creature.is_player ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}
            "
          >
            {creature.name}
            {#if creature.is_player}
              <span class="text-[9px] font-medium">(PC)</span>
            {/if}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Regions -->
  {#if draft.regions?.length}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        Regions ({draft.regions.length})
      </h4>
      <div class="flex flex-wrap gap-1.5">
        {#each draft.regions as region}
          <span class="inline-flex px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700">
            {region.name}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Organizations -->
  {#if draft.organizations?.length}
    <div>
      <h4 class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        Organizations ({draft.organizations.length})
      </h4>
      <div class="flex flex-wrap gap-1.5">
        {#each draft.organizations as org}
          <span class="inline-flex px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700">
            {org.name}
          </span>
        {/each}
      </div>
    </div>
  {/if}
</div>
