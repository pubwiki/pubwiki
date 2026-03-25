<!--
  QueryUserFormBlock.svelte
  
  Inline form rendered in the copilot panel when the AI requests user input
  via the query_user tool. Displays form fields, supports submit and "Let AI Decide".
-->
<script lang="ts">
  import type { QueryUserField, QueryUserRequest } from '@pubwiki/world-editor';

  // ============================================================================
  // Props
  // ============================================================================

  interface Props {
    request: QueryUserRequest;
    submitted?: boolean;
    onsubmit: (data: Record<string, unknown>) => void;
    class?: string;
  }

  let {
    request,
    submitted = false,
    onsubmit,
    class: className = '',
  }: Props = $props();

  // ============================================================================
  // Form State
  // ============================================================================

  let formData = $state<Record<string, unknown>>({});

  // Initialize defaults
  $effect(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of request.fields) {
      if (field.default_value !== undefined) {
        if (field.type === 'checkbox') {
          defaults[field.key] = field.default_value === 'true';
        } else if (field.type === 'multiselect') {
          defaults[field.key] = field.default_value ? [field.default_value] : [];
        } else {
          defaults[field.key] = field.default_value;
        }
      } else {
        defaults[field.key] = field.type === 'checkbox' ? false
          : field.type === 'multiselect' ? []
          : field.type === 'number' ? 0
          : '';
      }
    }
    formData = defaults;
  });

  // Track "Custom Input" mode for select fields
  let customInputMode = $state<Record<string, boolean>>({});

  // ============================================================================
  // Handlers
  // ============================================================================

  function handleSubmit() {
    if (submitted) return;
    onsubmit(formData);
  }

  function handleLetAIDecide() {
    if (submitted) return;
    // Set all empty fields to __AI_DECIDE__
    const data: Record<string, unknown> = {};
    for (const field of request.fields) {
      const val = formData[field.key];
      const isEmpty = val === '' || val === undefined || val === null
        || (Array.isArray(val) && val.length === 0);
      data[field.key] = isEmpty ? '__AI_DECIDE__' : val;
    }
    onsubmit(data);
  }

  function updateField(key: string, value: unknown) {
    formData = { ...formData, [key]: value };
  }

  function toggleMultiselect(key: string, option: string) {
    const current = (formData[key] as string[]) || [];
    if (current.includes(option)) {
      updateField(key, current.filter((v) => v !== option));
    } else {
      updateField(key, [...current, option]);
    }
  }

  function enableCustomInput(key: string) {
    customInputMode = { ...customInputMode, [key]: true };
    updateField(key, '');
  }
</script>

<div class="query-user-form rounded-lg border border-blue-200 bg-blue-50/50 p-4 {className}">
  <!-- Title -->
  <div class="mb-3 flex items-center gap-2">
    <svg class="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
    <h4 class="text-sm font-semibold text-blue-900">{request.title}</h4>
  </div>

  <!-- Fields -->
  <div class="space-y-3">
    {#each request.fields as field (field.key)}
      <div class="field-group">
        <label class="mb-1 block text-xs font-medium text-gray-700" for={`quf-${field.key}`}>
          {field.label}
          {#if field.required}
            <span class="text-red-400">*</span>
          {/if}
        </label>

        {#if submitted}
          <!-- Read-only display after submission -->
          <div class="rounded bg-white/80 px-2.5 py-1.5 text-sm text-gray-700">
            {#if formData[field.key] === '__AI_DECIDE__'}
              <span class="italic text-gray-400">AI will decide</span>
            {:else if field.type === 'checkbox'}
              {formData[field.key] ? '✓ Yes' : '✗ No'}
            {:else if field.type === 'multiselect'}
              {(formData[field.key] as string[])?.join(', ') || '—'}
            {:else}
              {formData[field.key] || '—'}
            {/if}
          </div>

        {:else if field.type === 'text'}
          <input
            id={`quf-${field.key}`}
            type="text"
            class="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder={field.placeholder || ''}
            value={formData[field.key] as string || ''}
            oninput={(e) => updateField(field.key, e.currentTarget.value)}
          />

        {:else if field.type === 'textarea'}
          <textarea
            id={`quf-${field.key}`}
            class="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            rows={3}
            placeholder={field.placeholder || ''}
            value={formData[field.key] as string || ''}
            oninput={(e) => updateField(field.key, e.currentTarget.value)}
          ></textarea>

        {:else if field.type === 'select'}
          {#if customInputMode[field.key]}
            <input
              id={`quf-${field.key}`}
              type="text"
              class="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Enter custom value..."
              value={formData[field.key] as string || ''}
              oninput={(e) => updateField(field.key, e.currentTarget.value)}
            />
          {:else}
            <select
              id={`quf-${field.key}`}
              class="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={formData[field.key] as string || ''}
              onchange={(e) => {
                const val = e.currentTarget.value;
                if (val === '__CUSTOM__') {
                  enableCustomInput(field.key);
                } else {
                  updateField(field.key, val);
                }
              }}
            >
              <option value="">— Select —</option>
              {#each field.options || [] as option}
                <option value={option}>{option}</option>
              {/each}
              <option value="__CUSTOM__">Custom...</option>
            </select>
          {/if}

        {:else if field.type === 'multiselect'}
          <div class="flex flex-wrap gap-1.5">
            {#each field.options || [] as option}
              {@const selected = ((formData[field.key] as string[]) || []).includes(option)}
              <button
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs transition-colors {selected ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}"
                onclick={() => toggleMultiselect(field.key, option)}
              >
                {option}
              </button>
            {/each}
          </div>

        {:else if field.type === 'checkbox'}
          <label class="flex items-center gap-2">
            <input
              id={`quf-${field.key}`}
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
              checked={!!formData[field.key]}
              onchange={(e) => updateField(field.key, e.currentTarget.checked)}
            />
            <span class="text-sm text-gray-600">{field.placeholder || 'Yes'}</span>
          </label>

        {:else if field.type === 'number'}
          <input
            id={`quf-${field.key}`}
            type="number"
            class="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder={field.placeholder || ''}
            value={formData[field.key] as number || 0}
            oninput={(e) => updateField(field.key, Number(e.currentTarget.value))}
          />
        {/if}
      </div>
    {/each}
  </div>

  <!-- Actions -->
  {#if !submitted}
    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        onclick={handleLetAIDecide}
      >
        Let AI Decide
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        onclick={handleSubmit}
      >
        Submit
      </button>
    </div>
  {:else}
    <div class="mt-3 text-center text-xs text-gray-400">
      Submitted
    </div>
  {/if}
</div>
