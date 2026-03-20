<script lang="ts" generics="T">
	import { slide } from 'svelte/transition';
	import type { TreeNode } from './types';
	import ItemTreeNode from './ItemTreeNode.svelte';

	export interface ItemTreeNodeProps<T> {
		/** The tree node to render */
		node: TreeNode<T>;
		/** Current depth level */
		depth?: number;
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
	}

	let {
		node,
		depth = 0,
		selectedId,
		onLeafClick,
		leafIcon,
		branchIcon,
		badge
	}: ItemTreeNodeProps<T> = $props();

	let expanded = $state(true);

	function handleClick() {
		if (node.isLeaf) {
			onLeafClick?.(node);
		} else {
			expanded = !expanded;
		}
	}

	const isSelected = $derived(selectedId === node.id);
	const paddingLeft = $derived(`${depth * 16 + 8}px`);
</script>

<div class="item-tree-node">
	<button
		type="button"
		onclick={handleClick}
		class="w-full flex items-center gap-2 py-2 px-2 text-left text-sm transition-colors hover:bg-gray-100 rounded-md"
		class:bg-blue-50={isSelected}
		class:text-blue-700={isSelected}
		class:font-medium={isSelected}
		style:padding-left={paddingLeft}
	>
		<!-- Expand/Collapse or Leaf Icon -->
		{#if !node.isLeaf}
			{#if branchIcon}
				{@render branchIcon(node, expanded)}
			{:else}
				<span class="w-4 h-4 flex items-center justify-center text-gray-400 transition-transform" class:rotate-90={expanded}>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
					</svg>
				</span>
			{/if}
		{:else}
			{#if leafIcon}
				{@render leafIcon(node)}
			{:else}
				<span class="w-4 h-4 flex items-center justify-center">
					<svg class="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="4" />
					</svg>
				</span>
			{/if}
		{/if}

		<!-- Label -->
		<span class="flex-1 truncate">
			{node.label}
		</span>

		<!-- Badge -->
		{#if badge}
			{@render badge(node)}
		{/if}
	</button>

	<!-- Children -->
	{#if !node.isLeaf && expanded && node.children.length > 0}
		<div transition:slide={{ duration: 150 }}>
			{#each node.children as child (child.id)}
				<ItemTreeNode 
					node={child} 
					depth={depth + 1} 
					{selectedId}
					{onLeafClick}
					{leafIcon}
					{branchIcon}
					{badge}
				/>
			{/each}
		</div>
	{/if}
</div>
