<!--
  BuilderSetupView.svelte
  
  Initial input screen for the WorldBuilder.
  Collects world description + optional reference file + optional lorebook.
-->
<script lang="ts">
  import { parseSillyTavernLorebook, type WBNReferenceFile, type LorebookData } from '@pubwiki/world-editor';

  interface Props {
    onstart: (prompt: string, options: { referenceFile?: WBNReferenceFile; referenceLorebook?: LorebookData; clearBeforeGenerate: boolean }) => void;
  }

  let { onstart }: Props = $props();

  let prompt = $state('');
  let referenceFile = $state<WBNReferenceFile | undefined>(undefined);
  let referenceLorebook = $state<LorebookData | undefined>(undefined);
  let lorebookError = $state<string | null>(null);
  let clearBeforeGenerate = $state(true);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let lorebookInputEl = $state<HTMLInputElement | null>(null);
  let isDragging = $state(false);
  let isDraggingLorebook = $state(false);

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) processFile(file);
  }

  async function processFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'txt';
    const type = (['md', 'json', 'txt'].includes(ext) ? ext : 'txt') as WBNReferenceFile['type'];

    const content = await file.text();
    referenceFile = {
      name: file.name,
      content,
      type,
      size: file.size,
    };
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function removeFile() {
    referenceFile = undefined;
    if (fileInputEl) fileInputEl.value = '';
  }

  // Lorebook handling
  function handleLorebookInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) processLorebookFile(file);
  }

  async function processLorebookFile(file: File) {
    lorebookError = null;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = parseSillyTavernLorebook(json, file.name);
      if (!parsed) {
        lorebookError = 'Not a valid SillyTavern character card';
        return;
      }
      referenceLorebook = parsed;
    } catch {
      lorebookError = 'Invalid JSON file';
    }
  }

  function handleLorebookDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingLorebook = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) processLorebookFile(file);
  }

  function handleLorebookDragOver(e: DragEvent) {
    e.preventDefault();
    isDraggingLorebook = true;
  }

  function handleLorebookDragLeave() {
    isDraggingLorebook = false;
  }

  function removeLorebook() {
    referenceLorebook = undefined;
    lorebookError = null;
    if (lorebookInputEl) lorebookInputEl.value = '';
  }

  function handleStart() {
    if (!prompt.trim()) return;
    onstart(prompt.trim(), { referenceFile, referenceLorebook, clearBeforeGenerate });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleStart();
    }
  }
</script>

<div class="flex flex-col items-center justify-center h-full px-6 py-8">
  <div class="w-14 h-14 mb-4 bg-purple-50 rounded-full flex items-center justify-center">
    <svg class="w-7 h-7 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  </div>
  <h3 class="text-base font-medium text-gray-700 mb-1">World Builder</h3>
  <p class="text-sm text-gray-500 mb-5 max-w-60 text-center">
    Describe your world concept and let AI generate characters, regions, organizations, and stories step by step.
  </p>

  <div class="w-full max-w-72 space-y-3">
    <!-- World description -->
    <textarea
      class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none"
      rows={4}
      placeholder="Describe your world concept..."
      bind:value={prompt}
      onkeydown={handleKeydown}
    ></textarea>

    <!-- File upload -->
    <div
      class="relative rounded-lg border border-dashed p-3 transition-colors
        {isDragging ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'}
      "
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      role="region"
      aria-label="File upload"
    >
      {#if referenceFile}
        <!-- File attached -->
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="text-xs text-gray-600 truncate flex-1">{referenceFile.name}</span>
          <button
            class="text-gray-400 hover:text-red-500 transition-colors p-0.5"
            onclick={removeFile}
            title="Remove file"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {:else}
        <!-- No file -->
        <div class="text-center">
          <p class="text-xs text-gray-400 mb-1">Reference file (optional)</p>
          <button
            class="text-xs text-purple-500 hover:text-purple-700 font-medium"
            onclick={() => fileInputEl?.click()}
          >
            Choose file
          </button>
          <span class="text-xs text-gray-400"> or drag & drop</span>
        </div>
      {/if}
      <input
        bind:this={fileInputEl}
        type="file"
        accept=".md,.txt,.json"
        class="hidden"
        onchange={handleFileInput}
      />
    </div>

    <!-- Lorebook upload -->
    <div
      class="relative rounded-lg border border-dashed p-3 transition-colors
        {isDraggingLorebook ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'}
      "
      ondrop={handleLorebookDrop}
      ondragover={handleLorebookDragOver}
      ondragleave={handleLorebookDragLeave}
      role="region"
      aria-label="Lorebook upload"
    >
      {#if referenceLorebook}
        <!-- Lorebook attached -->
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <div class="flex-1 min-w-0">
            <span class="text-xs text-gray-600 truncate block">{referenceLorebook.name}</span>
            <span class="text-[10px] text-gray-400">{referenceLorebook.entries.length} entries</span>
          </div>
          <button
            class="text-gray-400 hover:text-red-500 transition-colors p-0.5"
            onclick={removeLorebook}
            title="Remove lorebook"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {:else}
        <!-- No lorebook -->
        <div class="text-center">
          <p class="text-xs text-gray-400 mb-1">SillyTavern character card (optional)</p>
          <button
            class="text-xs text-purple-500 hover:text-purple-700 font-medium"
            onclick={() => lorebookInputEl?.click()}
          >
            Choose file
          </button>
          <span class="text-xs text-gray-400"> or drag & drop</span>
        </div>
      {/if}
      {#if lorebookError}
        <p class="text-[10px] text-red-500 mt-1">{lorebookError}</p>
      {/if}
      <input
        bind:this={lorebookInputEl}
        type="file"
        accept=".json"
        class="hidden"
        onchange={handleLorebookInput}
      />
    </div>

    <!-- Options -->
    <label class="flex items-center gap-2 px-1">
      <input
        type="checkbox"
        class="rounded border-gray-300 text-purple-600 focus:ring-purple-400 w-3.5 h-3.5"
        bind:checked={clearBeforeGenerate}
      />
      <span class="text-xs text-gray-500">Clear existing world data before generating</span>
    </label>

    <!-- Start button -->
    <button
      class="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors
        {prompt.trim() ? 'bg-purple-600 hover:bg-purple-700' : 'bg-purple-600 opacity-50 cursor-not-allowed'}
      "
      disabled={!prompt.trim()}
      onclick={handleStart}
    >
      Start Building
    </button>
  </div>
</div>
