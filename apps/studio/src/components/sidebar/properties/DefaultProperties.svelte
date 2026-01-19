<script lang="ts">
	/**
	 * DefaultProperties - Properties panel for other node types
	 * Displays read-only content
	 */
	import type { FlowNodeData } from '$lib/types/flow';
	import type { NodeContent } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: FlowNodeData;
	}

	let { nodeId, data }: Props = $props();

	// Get display content - content has getText() method
	let displayContent = $derived((data.content as NodeContent).getText());
</script>

<div class="flex items-center justify-between mb-2">
	<span class="text-xs font-medium text-gray-500">{m.studio_properties_content()}</span>
</div>

<!-- Readonly display -->
<div class="rounded-lg border border-gray-200 min-h-48">
	<div class="p-3 bg-gray-50 text-sm text-gray-600">
		{#if displayContent}
			<pre class="whitespace-pre-wrap font-mono text-xs">{displayContent}</pre>
		{:else}
			<span class="text-gray-400 italic">{m.studio_properties_no_content()}</span>
		{/if}
	</div>
</div>
