<script lang="ts">
	/**
	 * VirtualConsoleList - Virtualized console log display
	 *
	 * Uses padding-based virtual scroll that supports variable-height items.
	 * Collapsed logs use a fixed row height; expanded logs are measured from
	 * the DOM so the spacer calculations stay accurate while scrolling.
	 */
	import { onMount, tick } from 'svelte';
	import type { ConsoleLogEntry } from '@pubwiki/sandbox-host';

	interface Props {
		logs: readonly ConsoleLogEntry[];
		getLogLevelColor: (level: ConsoleLogEntry['level']) => string;
		getLogLevelIcon: (level: ConsoleLogEntry['level']) => string;
	}

	let { logs, getLogLevelColor, getLogLevelIcon }: Props = $props();

	// ============================================================================
	// Constants
	// ============================================================================

	/** Fixed height of a collapsed (single-line) log entry */
	const COLLAPSED_HEIGHT = 28;
	/** Extra items to render above/below viewport */
	const OVERSCAN = 10;

	// ============================================================================
	// State
	// ============================================================================

	let containerRef = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let containerHeight = $state(200);
	let isAtBottom = $state(true);

	/** Set of expanded log indices */
	let expandedSet = $state(new Set<number>());
	/**
	 * Bumped after measuring an expanded element so that $derived values
	 * that read measuredHeights (a plain Map) are re-evaluated.
	 */
	let heightVersion = $state(0);

	/** Actual measured pixel heights for expanded items (non-reactive Map) */
	const measuredHeights = new Map<number, number>();

	// ============================================================================
	// Height helpers
	// ============================================================================

	function isExpandable(entry: ConsoleLogEntry): boolean {
		return entry.message.includes('\n') || !!entry.stack;
	}

	/** Get height for a specific log index */
	function getItemHeight(index: number): number {
		if (expandedSet.has(index)) {
			return measuredHeights.get(index) ?? estimateExpandedHeight(logs[index]);
		}
		return COLLAPSED_HEIGHT;
	}

	/** Rough height estimate based on line count (used before DOM measurement) */
	function estimateExpandedHeight(entry: ConsoleLogEntry): number {
		if (!entry) return COLLAPSED_HEIGHT;
		const msgLines = entry.message.split('\n').length;
		const stackLines = entry.stack ? entry.stack.split('\n').length : 0;
		// ~16px per line + 12px vertical padding
		return Math.max(COLLAPSED_HEIGHT, (msgLines + stackLines) * 16 + 12);
	}

	// ============================================================================
	// Virtual-scroll geometry (variable-height aware)
	// ============================================================================

	/**
	 * Binary-style index lookup: walk through sorted expanded indices to
	 * translate a pixel offset into a log index.  O(E) where E = number
	 * of expanded items (almost always < 10).
	 */
	function findIndexAt(y: number): number {
		// Ensures derived reactivity picks up measurement changes
		void heightVersion;

		if (y <= 0) return 0;
		if (expandedSet.size === 0) {
			return Math.min(logs.length - 1, Math.floor(y / COLLAPSED_HEIGHT));
		}

		const sorted = [...expandedSet]
			.filter((i) => i < logs.length)
			.sort((a, b) => a - b);

		let cum = 0;
		let lastIdx = 0;

		for (const expIdx of sorted) {
			const gap = expIdx - lastIdx;
			const gapHeight = gap * COLLAPSED_HEIGHT;
			if (cum + gapHeight > y) {
				return lastIdx + Math.floor((y - cum) / COLLAPSED_HEIGHT);
			}
			cum += gapHeight;

			const h = getItemHeight(expIdx);
			if (cum + h > y) return expIdx;
			cum += h;
			lastIdx = expIdx + 1;
		}

		const remaining = y - cum;
		return Math.min(logs.length - 1, lastIdx + Math.floor(remaining / COLLAPSED_HEIGHT));
	}

	/** Cumulative pixel height of all items before `index` */
	function offsetBefore(index: number): number {
		void heightVersion;

		let offset = index * COLLAPSED_HEIGHT;
		for (const idx of expandedSet) {
			if (idx < index && idx < logs.length) {
				offset += getItemHeight(idx) - COLLAPSED_HEIGHT;
			}
		}
		return offset;
	}

	// ============================================================================
	// Derived (reactive)
	// ============================================================================

	const totalHeight = $derived.by(() => {
		void heightVersion;
		let total = logs.length * COLLAPSED_HEIGHT;
		for (const idx of expandedSet) {
			if (idx < logs.length) {
				total += getItemHeight(idx) - COLLAPSED_HEIGHT;
			}
		}
		return total;
	});

	const startIndex = $derived.by(() => {
		void heightVersion;
		return Math.max(0, findIndexAt(scrollTop) - OVERSCAN);
	});

	const endIndex = $derived.by(() => {
		void heightVersion;
		return Math.min(
			logs.length,
			findIndexAt(scrollTop + containerHeight) + 1 + OVERSCAN
		);
	});

	const visibleLogs = $derived(logs.slice(startIndex, endIndex));

	const topPadding = $derived.by(() => {
		void heightVersion;
		return offsetBefore(startIndex);
	});

	const bottomPadding = $derived.by(() => {
		void heightVersion;
		return Math.max(0, totalHeight - offsetBefore(endIndex));
	});

	// ============================================================================
	// Expand / collapse
	// ============================================================================

	function toggleExpand(logIndex: number) {
		const next = new Set(expandedSet);
		if (next.has(logIndex)) {
			next.delete(logIndex);
			measuredHeights.delete(logIndex);
		} else {
			next.add(logIndex);
		}
		expandedSet = next;

		// Measure the actual height from the DOM after it renders
		if (expandedSet.has(logIndex)) {
			tick().then(() => {
				const el = containerRef?.querySelector(
					`[data-log-idx="${logIndex}"]`
				) as HTMLElement | null;
				if (el) {
					measuredHeights.set(logIndex, el.offsetHeight);
					heightVersion++; // trigger spacer recalc
				}
			});
		}
	}

	// Reset expand state when logs are cleared
	$effect(() => {
		if (logs.length === 0) {
			expandedSet = new Set();
			measuredHeights.clear();
			// Use fixed assignment instead of heightVersion++ to avoid creating
			// a read dependency on heightVersion, which would cause an infinite
			// effect loop (effect_update_depth_exceeded).
			heightVersion = 0;
		}
	});

	// ============================================================================
	// Scroll handling
	// ============================================================================

	function handleScroll() {
		if (!containerRef) return;
		scrollTop = containerRef.scrollTop;
		isAtBottom =
			containerRef.scrollTop + containerRef.clientHeight >=
			containerRef.scrollHeight - 2;
	}

	function scrollToBottom() {
		if (!containerRef) return;
		containerRef.scrollTop = containerRef.scrollHeight;
		isAtBottom = true;
	}

	// Auto-scroll when new logs arrive and user is at bottom
	$effect(() => {
		const _len = logs.length;
		if (isAtBottom && containerRef && _len > 0) {
			tick().then(() => {
				if (containerRef) {
					containerRef.scrollTop = containerRef.scrollHeight;
				}
			});
		}
	});

	// ============================================================================
	// Lifecycle
	// ============================================================================

	onMount(() => {
		if (containerRef) {
			containerHeight = containerRef.clientHeight;

			const ro = new ResizeObserver((entries) => {
				for (const entry of entries) {
					containerHeight = entry.contentRect.height;
				}
			});
			ro.observe(containerRef);
			scrollToBottom();
			return () => ro.disconnect();
		}
	});

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString();
	}
</script>

<div class="relative flex-1 overflow-hidden">
	{#if logs.length === 0}
		<div class="flex items-center justify-center h-full text-gray-500">No console output</div>
	{:else}
		<!-- Scrollable container -->
		<div
			bind:this={containerRef}
			class="absolute inset-0 overflow-auto font-mono text-xs"
			onscroll={handleScroll}
		>
			<!-- Top spacer -->
			<div style="height: {topPadding}px;"></div>

			<!-- Visible items (natural document flow — no transform) -->
			{#each visibleLogs as entry, i (startIndex + i)}
				{@const logIndex = startIndex + i}
				{@const expanded = expandedSet.has(logIndex)}
				{@const expandable = isExpandable(entry)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					data-log-idx={logIndex}
					class="px-3 py-1 border-b border-gray-800 hover:bg-gray-800/50 {getLogLevelColor(entry.level)}"
					class:cursor-pointer={expandable}
					style={expanded ? '' : `height: ${COLLAPSED_HEIGHT}px; overflow: hidden;`}
					onclick={() => expandable && toggleExpand(logIndex)}
				>
					<div
						class="flex items-start gap-2"
						style={expanded ? '' : `height: ${COLLAPSED_HEIGHT - 8}px;`}
					>
						<span class="flex-shrink-0 mt-0.5 select-none"
							><!-- eslint-disable svelte/no-at-html-tags -->{@html getLogLevelIcon(entry.level)}<!-- eslint-enable svelte/no-at-html-tags --></span
						>
						{#if expandable && !expanded}
							<span class="flex-shrink-0 text-gray-500 mt-0.5 select-none">▶</span>
						{:else if expandable && expanded}
							<span class="flex-shrink-0 text-gray-500 mt-0.5 select-none">▼</span>
						{/if}
						<div class="flex-1 min-w-0 overflow-hidden">
							{#if expanded}
								<pre class="whitespace-pre-wrap break-words leading-tight">{entry.message}</pre>
								{#if entry.stack}
									<pre
										class="text-gray-500 text-[10px] mt-1 whitespace-pre-wrap break-words">{entry.stack}</pre>
								{/if}
							{:else}
								<pre class="truncate leading-tight">{entry.message.split('\n')[0]}</pre>
							{/if}
						</div>
						<span class="flex-shrink-0 text-gray-600 text-[10px] select-none">
							{formatTime(entry.timestamp)}
						</span>
					</div>
				</div>
			{/each}

			<!-- Bottom spacer -->
			<div style="height: {bottomPadding}px;"></div>
		</div>

		<!-- Scroll to bottom button -->
		{#if !isAtBottom}
			<button
				class="absolute bottom-2 right-4 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg transition-colors flex items-center gap-1 z-10"
				onclick={scrollToBottom}
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 14l-7 7m0 0l-7-7m7 7V3"
					/>
				</svg>
				Bottom
			</button>
		{/if}
	{/if}
</div>
