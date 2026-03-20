<script lang="ts">
	import {
		getPendingVfsDeleteConfirmation,
		respondVfsDeleteConfirmation
	} from '$lib/state/vfs-delete-confirm.svelte';
	import { nodeStore } from '$lib/persistence';
	import * as m from '$lib/paraglide/messages';

	const pending = $derived(getPendingVfsDeleteConfirmation());
	
	// Get node name from nodeStore (FlowNodeData only has id and type)
	function getNodeName(nodeId: string): string {
		const nodeData = nodeStore.get(nodeId);
		return nodeData?.name || m.common_unnamed();
	}
</script>

{#if pending}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
		onclick={(e) => {
			if (e.target === e.currentTarget) respondVfsDeleteConfirmation(false);
		}}
	>
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
			<!-- Header -->
			<div class="px-6 py-4 border-b border-gray-200 bg-red-50">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
						<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</div>
					<h2 class="text-lg font-semibold text-gray-900">{m.studio_vfs_delete_confirm_title()}</h2>
				</div>
			</div>

			<!-- Content -->
			<div class="px-6 py-4">
				<p class="text-gray-700 mb-4">{m.studio_vfs_delete_confirm_message()}</p>

				<!-- List of VFS nodes being deleted -->
				{#if pending.vfsNodes.length > 0}
					<div class="mb-4">
						<p class="text-sm font-medium text-gray-600 mb-2">
							{m.studio_vfs_delete_confirm_nodes_label({ count: pending.vfsNodes.length })}
						</p>
						<div
							class="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto border border-gray-200"
						>
							{#each pending.vfsNodes as node (node.id)}
								<div class="flex items-center gap-2 text-sm text-gray-700 py-1">
									<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
										/>
									</svg>
								<span>{getNodeName(node.id)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
					<div class="flex items-start gap-2">
						<svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>{m.studio_vfs_delete_confirm_warning()}</span>
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
				<button
					type="button"
					class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
					onclick={() => respondVfsDeleteConfirmation(false)}
				>
					{m.common_cancel()}
				</button>
				<button
					type="button"
					class="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-red-600 rounded-lg hover:bg-red-700 transition-colors"
					onclick={() => respondVfsDeleteConfirmation(true)}
				>
					{m.studio_vfs_delete_confirm_button()}
				</button>
			</div>
		</div>
	</div>
{/if}
