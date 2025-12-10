<script lang="ts">
	import { SvelteFlow, Background, Controls, type Node, type Edge, Position } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import type { Artifact } from '$lib/types';

	let { artifact, dependencies } = $props<{ artifact: Artifact; dependencies: Artifact[] }>();

	// Prepare graph data using derived state
	let graph = $derived.by(() => {
		const allArtifacts = [artifact, ...dependencies];
		const artifactMap = new Map(allArtifacts.map((a) => [a.id, a]));
		
		// 1. Calculate Levels (Reverse BFS)
		const levels = new Map<string, number>();
		levels.set(artifact.id, 0);
		
		const queue = [artifact.id];
		
		let qIndex = 0;
		while(qIndex < queue.length) {
			const currId = queue[qIndex++];
			const currArt = artifactMap.get(currId);
			if (!currArt) continue;

			const currentLevel = levels.get(currId) || 0;

			const parents: string[] = [];
			if (currArt.lineage.parent_recipe_ids) parents.push(...currArt.lineage.parent_recipe_ids);
			if (currArt.lineage.parent_artifact_id) parents.push(currArt.lineage.parent_artifact_id);

			for (const pid of parents) {
				if (artifactMap.has(pid)) {
					if (!levels.has(pid)) {
						levels.set(pid, currentLevel - 1);
						queue.push(pid);
					} else {
						const existingLevel = levels.get(pid)!;
						if (currentLevel - 1 < existingLevel) {
							levels.set(pid, currentLevel - 1);
						}
					}
				}
			}
		}

		// 2. Group by level to assign X positions
		const levelGroups = new Map<number, string[]>();
		levels.forEach((lvl, id) => {
			if (!levelGroups.has(lvl)) levelGroups.set(lvl, []);
			levelGroups.get(lvl)!.push(id);
		});

		// 3. Create Nodes
		const newNodes: Node[] = [];
		const NODE_WIDTH = 250;
		const NODE_HEIGHT = 80;
		const X_GAP = 50;
		const Y_GAP = 150;

		levelGroups.forEach((ids, lvl) => {
			const totalWidth = ids.length * NODE_WIDTH + (ids.length - 1) * X_GAP;
			const startX = -totalWidth / 2;

			ids.forEach((id, index) => {
				const art = artifactMap.get(id)!;
				const isMain = id === artifact.id;
				
				newNodes.push({
					id: id,
					type: 'default', 
					data: { 
						label: art.title,
					},
					position: {
						x: startX + index * (NODE_WIDTH + X_GAP),
						y: lvl * Y_GAP
					},
					style: isMain ? 'background: #fff; border: 2px solid #0969da; width: 200px;' : 'background: #fff; width: 200px;',
					sourcePosition: Position.Bottom,
					targetPosition: Position.Top
				});
			});
		});

		// 4. Create Edges
		const newEdges: Edge[] = [];
		allArtifacts.forEach(art => {
			const parents: string[] = [];
			if (art.lineage.parent_recipe_ids) parents.push(...art.lineage.parent_recipe_ids);
			if (art.lineage.parent_artifact_id) parents.push(art.lineage.parent_artifact_id);

			parents.forEach(pid => {
				if (artifactMap.has(pid)) {
					newEdges.push({
						id: `${pid}-${art.id}`,
						source: pid,
						target: art.id,
						type: 'smoothstep',
					});
				}
			});
		});

		return { nodes: newNodes, edges: newEdges };
	});
</script>

<div class="w-full h-[600px] border border-gray-200 rounded-lg bg-gray-50">
	{#key artifact.id}
		<SvelteFlow 
			nodes={graph.nodes} 
			edges={graph.edges} 
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
