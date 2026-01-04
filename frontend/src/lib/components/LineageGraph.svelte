<script lang="ts">
	import { SvelteFlow, Background, Controls, type Node, type Edge, Position } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import type { ArtifactListItem, ArtifactLineageItem } from '$lib/types';
	import LineageNode from './LineageNode.svelte';

	let { artifact, parents, children }: {
		artifact: ArtifactListItem; 
		parents: ArtifactLineageItem[];
		children: ArtifactLineageItem[];
	} = $props();

	const nodeTypes = {
		lineage: LineageNode
	};

	// Build tree structure from flat array using parentId
	function buildTree(items: ArtifactLineageItem[]): Map<string | null, ArtifactLineageItem[]> {
		const tree = new Map<string | null, ArtifactLineageItem[]>();
		for (const item of items) {
			const key = item.parentId ?? null;
			if (!tree.has(key)) tree.set(key, []);
			tree.get(key)!.push(item);
		}
		return tree;
	}

	// Calculate tree depth
	function getTreeDepth(tree: Map<string | null, ArtifactLineageItem[]>, rootKey: string | null): number {
		const children = tree.get(rootKey);
		if (!children || children.length === 0) return 0;
		let maxDepth = 0;
		for (const child of children) {
			const depth = getTreeDepth(tree, child.artifact.id);
			maxDepth = Math.max(maxDepth, depth);
		}
		return maxDepth + 1;
	}

	// Calculate subtree width (number of leaf nodes)
	function getSubtreeWidth(tree: Map<string | null, ArtifactLineageItem[]>, nodeId: string | null): number {
		const children = tree.get(nodeId);
		if (!children || children.length === 0) return 1;
		return children.reduce((sum, child) => sum + getSubtreeWidth(tree, child.artifact.id), 0);
	}

	// Prepare graph data using derived state
	let graph = $derived.by(() => {
		const newNodes: Node[] = [];
		const newEdges: Edge[] = [];
		
		const NODE_WIDTH = 190;
		const NODE_HEIGHT = 80;
		const Y_GAP = 100;
		const X_GAP = 20;

		const parentTree = buildTree(parents);
		const childTree = buildTree(children);

		// Current artifact at center (y = 0)
		const currentY = 0;

		// Add current artifact node
		newNodes.push({
			id: artifact.id,
			type: 'lineage',
			data: { 
				artifact, 
				isCurrent: true,
				hasParent: parents.length > 0,
				hasChildren: children.length > 0
			},
			position: { x: 0, y: currentY },
			sourcePosition: Position.Bottom,
			targetPosition: Position.Top
		});

		// Recursively add parent nodes (going upward, y decreases)
		function addParentNodes(
			parentId: string | null, 
			targetNodeId: string, 
			level: number, 
			xOffset: number
		): number {
			const items = parentTree.get(parentId);
			if (!items || items.length === 0) return xOffset;

			let currentX = xOffset;
			for (const item of items) {
				const subtreeWidth = getSubtreeWidth(parentTree, item.artifact.id);
				const nodeX = currentX + (subtreeWidth * (NODE_WIDTH + X_GAP)) / 2 - NODE_WIDTH / 2;
				const nodeY = -(level * (NODE_HEIGHT + Y_GAP));

				// Check if this node has ancestors
				const hasAncestors = parentTree.has(item.artifact.id);

				newNodes.push({
					id: item.artifact.id,
					type: 'lineage',
					data: { 
						lineageItem: item,
						hasParent: hasAncestors,
						hasChildren: true // parent nodes always connect downward
					},
					position: { x: nodeX, y: nodeY },
					sourcePosition: Position.Bottom,
					targetPosition: Position.Top
				});

				// Edge from this parent to its child (could be current artifact or another parent)
				newEdges.push({
					id: `${item.artifact.id}->${targetNodeId}`,
					source: item.artifact.id,
					target: targetNodeId,
					type: 'smoothstep'
				});

				// Recursively add ancestors
				addParentNodes(item.artifact.id, item.artifact.id, level + 1, currentX);

				currentX += subtreeWidth * (NODE_WIDTH + X_GAP);
			}

			return currentX;
		}

		// Recursively add child nodes (going downward, y increases)
		function addChildNodes(
			parentId: string | null, 
			sourceNodeId: string, 
			level: number, 
			xOffset: number
		): number {
			const items = childTree.get(parentId);
			if (!items || items.length === 0) return xOffset;

			let currentX = xOffset;
			for (const item of items) {
				const subtreeWidth = getSubtreeWidth(childTree, item.artifact.id);
				const nodeX = currentX + (subtreeWidth * (NODE_WIDTH + X_GAP)) / 2 - NODE_WIDTH / 2;
				const nodeY = level * (NODE_HEIGHT + Y_GAP);

				// Check if this node has descendants
				const hasDescendants = childTree.has(item.artifact.id);

				newNodes.push({
					id: item.artifact.id,
					type: 'lineage',
					data: { 
						lineageItem: item,
						hasParent: true, // child nodes always connect upward
						hasChildren: hasDescendants
					},
					position: { x: nodeX, y: nodeY },
					sourcePosition: Position.Bottom,
					targetPosition: Position.Top
				});

				// Edge from source to this child
				newEdges.push({
					id: `${sourceNodeId}->${item.artifact.id}`,
					source: sourceNodeId,
					target: item.artifact.id,
					type: 'smoothstep'
				});

				// Recursively add descendants
				addChildNodes(item.artifact.id, item.artifact.id, level + 1, currentX);

				currentX += subtreeWidth * (NODE_WIDTH + X_GAP);
			}

			return currentX;
		}

		// Calculate initial x offsets to center the trees
		const parentTreeWidth = getSubtreeWidth(parentTree, null) * (NODE_WIDTH + X_GAP);
		const childTreeWidth = getSubtreeWidth(childTree, null) * (NODE_WIDTH + X_GAP);
		const maxTreeWidth = Math.max(parentTreeWidth, childTreeWidth, NODE_WIDTH);

		const parentStartX = -maxTreeWidth / 2;
		const childStartX = -maxTreeWidth / 2;

		// Add all parent nodes (level 1 = direct parents)
		addParentNodes(null, artifact.id, 1, parentStartX);

		// Add all child nodes (level 1 = direct children)
		addChildNodes(null, artifact.id, 1, childStartX);

		return { nodes: newNodes, edges: newEdges };
	});
</script>

<div class="w-full h-[600px] border border-gray-200 rounded-lg bg-gray-50">
	{#key artifact.id}
		<SvelteFlow 
			nodes={graph.nodes} 
			edges={graph.edges}
			{nodeTypes}
			fitView
            defaultEdgeOptions={{
            animated: false
        }}
        nodesDraggable={false} 
        elementsSelectable={false}
        preventScrolling={false} 
        proOptions={{ hideAttribution: true }}
		>
			<Controls />
			<Background />
		</SvelteFlow>
	{/key}
</div>
