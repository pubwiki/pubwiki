<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { ArtifactLineageItem, ArtifactListItem } from '@pubwiki/api';
	import ArtifactCard from './ArtifactCard.svelte';

	type NodeData = {
		lineageItem?: ArtifactLineageItem;
		artifact?: ArtifactListItem;
		isCurrent?: boolean;
		hasParent?: boolean;
		hasChildren?: boolean;
	};

	let { data }: { data: NodeData } = $props();
</script>

<div class="lineage-node" class:current={data.isCurrent}>
	{#if data.hasParent}
		<Handle type="target" position={Position.Top} />
	{/if}
	<ArtifactCard 
		lineageItem={data.lineageItem} 
		artifact={data.artifact} 
	/>
	{#if data.hasChildren}
		<Handle type="source" position={Position.Bottom} />
	{/if}
</div>

<style>
	.lineage-node {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		width: 180px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.lineage-node.current {
		border: 2px solid #0969da;
		box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.15);
	}

	.lineage-node :global(.svelte-flow__handle) {
		width: 6px;
		height: 6px;
		background: #d1d5db;
		border: none;
	}

	.lineage-node.current :global(.svelte-flow__handle) {
		background: #0969da;
	}
</style>
