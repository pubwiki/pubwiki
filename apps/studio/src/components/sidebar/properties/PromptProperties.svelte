<script lang="ts">
	/**
	 * PromptProperties - Properties panel for PROMPT nodes
	 * Includes content editor with RefTagEditor
	 */
	import type { PromptNodeData, ContentBlock } from '$lib/types';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { RefTagEditor } from '../../editor';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: PromptNodeData;
	}

	let { nodeId, data }: Props = $props();

	// Content block change handler
	function handleBlocksChange(newBlocks: ContentBlock[]) {
		nodeStore.update(nodeId, (nodeData) => {
			const promptData = nodeData as PromptNodeData;
			return { ...promptData, content: promptData.content.withBlocks(newBlocks) };
		});
	}
</script>

<div class="flex items-center justify-between mb-2">
	<span class="text-xs font-medium text-gray-500">{m.studio_properties_content()}</span>
</div>

<!-- Content editor -->
<div class="rounded-lg border border-gray-200 min-h-48">
	<div class="properties-textarea">
		<RefTagEditor
			value={data.content.blocks}
			placeholder={m.studio_properties_enter_content()}
			onchange={handleBlocksChange}
			autoHeight
		/>
	</div>
</div>

<style>
	.properties-textarea :global(.rich-text-area) {
		min-height: 12rem;
		max-height: none;
		height: auto;
		overflow: visible;
	}

	.properties-textarea :global(.backdrop) {
		position: relative;
		right: 0;
		padding-right: 0.75rem;
		min-height: 12rem;
	}

	.properties-textarea :global(.input) {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		min-height: 12rem;
		height: 100%;
		overflow: hidden;
		resize: none;
	}
</style>
