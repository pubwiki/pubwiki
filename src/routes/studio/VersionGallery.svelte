<script lang="ts">
	import type { NodeRef, NodeSnapshot } from './snapshot-store';
	import { snapshotStore } from './snapshot-store';

	interface Props {
		/** Current node ID */
		nodeId: string;
		/** Current content */
		currentContent: string;
		/** Current commit hash */
		currentCommit: string;
		/** Snapshot references */
		snapshotRefs: NodeRef[];
		/** Called when a version is selected to restore */
		onRestore?: (snapshotRef: NodeRef) => void;
		/** Called when gallery is closed */
		onClose?: () => void;
	}

	let { nodeId, currentContent, currentCommit, snapshotRefs, onRestore, onClose }: Props = $props();

	let containerRef: HTMLDivElement | null = $state(null);

	// Build version list (snapshots + current)
	interface VersionItem {
		commit: string;
		content: string;
		timestamp: number;
		isCurrent: boolean;
		ref?: NodeRef;
	}

	const versions = $derived.by(() => {
		const items: VersionItem[] = [];
		
		// Add historical versions from snapshots (not including current)
		for (const ref of snapshotRefs) {
			const snapshot = snapshotStore.get<string>(ref.id, ref.commit);
			if (snapshot) {
				items.push({
					commit: snapshot.commit,
					content: snapshot.content,
					timestamp: snapshot.timestamp,
					isCurrent: false,
					ref
				});
			}
		}
		
		// Sort by timestamp (newest first for display)
		return items.sort((a, b) => b.timestamp - a.timestamp);
	});

	let selectedIndex = $state(0); // Start with current (newest)

	// Handle click outside to close
	function handleClickOutside(event: MouseEvent) {
		if (containerRef && !containerRef.contains(event.target as Node)) {
			onClose?.();
		}
	}

	// Handle wheel event to prevent canvas scroll
	function handleWheel(e: WheelEvent) {
		e.stopPropagation();
	}

	// Setup click outside listener
	$effect(() => {
		// Add listener on next tick to avoid triggering on the click that opened the gallery
		const timeoutId = setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
		}, 0);
		
		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('click', handleClickOutside);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(0, selectedIndex - 1);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(versions.length - 1, selectedIndex + 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			handleRestore();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose?.();
		}
	}

	function handleRestore() {
		const version = versions[selectedIndex];
		// Don't restore if has same content hash as current
		if (version && version.ref && version.commit !== currentCommit) {
			onRestore?.(version.ref);
		}
		onClose?.();
	}

	function formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const today = new Date();
		const isToday = date.toDateString() === today.toDateString();
		if (isToday) {
			return 'Today';
		}
		return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function truncateContent(content: string, maxLength: number = 100): string {
		if (content.length <= maxLength) return content;
		return content.slice(0, maxLength) + '...';
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
	bind:this={containerRef}
	class="absolute left-full ml-2 top-0 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden"
	onkeydown={handleKeydown}
	onwheel={handleWheel}
	tabindex="0"
>
	<!-- Header -->
	<div class="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span class="text-sm font-medium text-gray-700">Version History</span>
		</div>
		<button
			class="p-1 hover:bg-gray-200 rounded transition-colors"
			onclick={() => onClose?.()}
			title="Close"
		>
			<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</div>

	<!-- Version list -->
	<div class="max-h-80 overflow-y-auto">
		{#each versions as version, i}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="px-3 py-2 border-b border-gray-100 cursor-pointer transition-colors {selectedIndex === i ? 'bg-blue-50' : 'hover:bg-gray-50'}"
				onclick={() => selectedIndex = i}
				ondblclick={handleRestore}
			>
				<div class="flex items-center justify-between mb-1">
					<span class="text-xs text-gray-400 font-mono">
						{version.commit.slice(0, 7)}
					</span>
					<div class="text-xs text-gray-400">
						{formatDate(version.timestamp)} {formatTime(version.timestamp)}
					</div>
				</div>
				<div class="text-sm text-gray-600 text-left line-clamp-2">
					{truncateContent(version.content)}
				</div>
			</div>
		{:else}
			<div class="px-3 py-4 text-sm text-gray-400 text-center">
				No version history
			</div>
		{/each}
	</div>

	<!-- Footer -->
	<div class="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
		<span class="text-xs text-gray-500">
			{versions.length} previous version{versions.length !== 1 ? 's' : ''}
		</span>
		<div class="flex items-center gap-2">
			<button
				class="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
				onclick={() => onClose?.()}
			>
				Cancel
			</button>
			{#if versions.length > 0 && versions[selectedIndex]?.commit !== currentCommit}
				<button
					class="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 rounded transition-colors"
					onclick={handleRestore}
				>
					Restore
				</button>
			{:else if versions.length > 0}
				<button
					class="px-2 py-1 text-xs bg-gray-300 text-gray-500 rounded cursor-not-allowed"
					disabled
					title="Content is same as current"
				>
					Restore
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
