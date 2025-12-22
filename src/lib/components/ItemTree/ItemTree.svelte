<script lang="ts" generics="T">
	import ItemTreeNode from './ItemTreeNode.svelte';
	import type { TreeNode } from './types';

	interface Props {
		/** Tree structure to render */
		tree: TreeNode<T>[];
		/** Currently selected node id */
		selectedId?: string | null;
		/** Callback when a leaf node is clicked */
		onLeafClick?: (node: TreeNode<T>) => void;
		/** Optional custom icon snippet for leaf nodes */
		leafIcon?: import('svelte').Snippet<[TreeNode<T>]>;
		/** Optional custom icon snippet for branch nodes */
		branchIcon?: import('svelte').Snippet<[TreeNode<T>, boolean]>;
		/** Optional badge snippet */
		badge?: import('svelte').Snippet<[TreeNode<T>]>;
		/** Empty state message */
		emptyMessage?: string;
	}

	let {
		tree,
		selectedId,
		onLeafClick,
		leafIcon,
		branchIcon,
		badge,
		emptyMessage = 'No items'
	}: Props = $props();
</script>

<div class="item-tree">
	{#if tree.length === 0}
		<div class="text-sm text-gray-500 p-4 text-center">
			{emptyMessage}
		</div>
	{:else}
		<nav class="py-2">
			{#each tree as node (node.id)}
				<ItemTreeNode 
					{node} 
					{selectedId}
					{onLeafClick}
					{leafIcon}
					{branchIcon}
					{badge}
				/>
			{/each}
		</nav>
	{/if}
</div>
