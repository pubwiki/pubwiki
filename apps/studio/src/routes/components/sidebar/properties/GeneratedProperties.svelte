<script lang="ts">
	/**
	 * GeneratedProperties - Properties panel for GENERATED nodes
	 * Displays markdown-rendered content with regenerate option
	 */
	import type { GeneratedNodeData } from '../../../types';
	import { marked } from 'marked';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: GeneratedNodeData;
		onRegenerate: () => void;
	}

	let { nodeId, data, onRegenerate }: Props = $props();

	// Get display content
	let displayContent = $derived(data.content.getText());
</script>

<div class="flex items-center justify-between mb-2">
	<span class="text-xs font-medium text-gray-500">{m.studio_properties_content()}</span>
	<button
		class="px-2 py-1 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center gap-1"
		onclick={onRegenerate}
	>
		<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
		</svg>
		{m.studio_properties_regenerate()}
	</button>
</div>

<!-- Markdown rendered content -->
<div class="rounded-lg border border-gray-200 min-h-48">
	<div class="p-3 bg-green-50/30">
		<div class="prose prose-sm max-w-none text-left select-text">
			{@html marked.parse(displayContent || '')}
		</div>
	</div>
</div>
