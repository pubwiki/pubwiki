<script lang="ts">
	/**
	 * ArtifactCard - Reusable artifact display card component.
	 *
	 * Two variants:
	 * - 'marketplace': Exact replica of Hub homepage playing-card style.
	 * - 'compact': Small horizontal layout for sidebar/lineage contexts.
	 */

	interface Props {
		name: string;
		thumbnailUrl?: string | null;
		authorName?: string;
		description?: string | null;
		tags?: string[];
		variant?: 'marketplace' | 'compact';
		onclick?: () => void;
		onclickAuthor?: () => void;
		onCoverClick?: () => void;
		stats?: { viewCount?: number; favCount?: number };
	}

	let {
		name,
		thumbnailUrl,
		authorName,
		description,
		tags,
		variant = 'marketplace',
		onclick,
		onclickAuthor,
		onCoverClick,
		stats,
	}: Props = $props();

	// --- Playing-card 3D pointer tracking (marketplace only) ---
	let rafId: number | null = null;

	function handleCardPointerMove(e: PointerEvent) {
		if (rafId) return;
		const card = e.currentTarget as HTMLElement;
		const clientX = e.clientX;
		const clientY = e.clientY;
		rafId = requestAnimationFrame(() => {
			if (!card) { rafId = null; return; }
			const rect = card.getBoundingClientRect();
			const x = clientX - rect.left;
			const y = clientY - rect.top;
			const centerX = rect.width / 2;
			const centerY = rect.height / 2;
			const rotateX = (y - centerY) / 4;
			const rotateY = (centerX - x) / 4;
			card.style.setProperty('--rotateX', `${rotateX}deg`);
			card.style.setProperty('--rotateY', `${rotateY}deg`);
			rafId = null;
		});
	}

	function handleCardPointerLeave(e: PointerEvent) {
		if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
		const card = e.currentTarget as HTMLElement;
		card.style.setProperty('--rotateX', '0deg');
		card.style.setProperty('--rotateY', '0deg');
	}
</script>

{#if variant === 'marketplace'}
	<!-- Fully self-contained card: no overflow/protrusion needed -->
	<div class="group relative bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100" style="aspect-ratio: 9 / 4;">
		<div class="flex h-full">
			<!-- Cover Image (Playing Card Style) - absolute positioned to overlap left edge -->
			<div class="relative" style="width: 38%;">
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="playing-card group/cover absolute z-10 {onclick || onCoverClick ? 'cursor-pointer' : ''}"
					style="--rotateX: 0deg; --rotateY: 0deg; width: 88%; aspect-ratio: 5 / 7; top: -10%; left: 3%;"
					onpointermove={handleCardPointerMove}
					onpointerleave={handleCardPointerLeave}
					onclick={onCoverClick || onclick}
					onkeydown={(onclick || onCoverClick) ? (e) => { if (e.key === 'Enter') (onCoverClick || onclick)?.(); } : undefined}
					role={(onclick || onCoverClick) ? 'button' : undefined}
					tabindex={(onclick || onCoverClick) ? 0 : undefined}
				>
					<div class="absolute inset-0 bg-black/15 rounded-lg translate-x-1 translate-y-1 blur-sm"></div>
					<div class="relative w-full h-full bg-white rounded-lg border-2 border-gray-200 shadow-lg overflow-hidden">
						<img
							src={thumbnailUrl || 'https://placehold.co/280x392/e5e7eb/9ca3af?text=No+Cover'}
							alt={name}
							class="w-full h-full object-cover"
							style="object-fit: cover;"
						/>
						<div class="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent pointer-events-none"></div>
					</div>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 p-4 flex flex-col min-w-0 overflow-hidden bg-gradient-to-br from-white to-gray-50/50">
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="block {onclick ? 'cursor-pointer' : ''}"
					onclick={onclick}
					onkeydown={onclick ? (e) => { if (e.key === 'Enter') onclick?.(); } : undefined}
					role={onclick ? 'button' : undefined}
					tabindex={onclick ? 0 : undefined}
				>
					<h3 class="font-bold text-gray-800 group-hover:text-gray-600 text-base leading-tight line-clamp-2 transition-colors" title={name}>
						{name || 'Untitled'}
					</h3>
				</div>

				{#if authorName}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="text-xs text-gray-500 mt-1 truncate transition-colors {onclickAuthor ? 'hover:text-gray-700 hover:underline cursor-pointer' : ''}"
						onclick={onclickAuthor ? (e) => { e.stopPropagation(); onclickAuthor?.(); } : undefined}
						onkeydown={onclickAuthor ? (e) => { if (e.key === 'Enter') onclickAuthor?.(); } : undefined}
						role={onclickAuthor ? 'button' : undefined}
						tabindex={onclickAuthor ? 0 : undefined}
					>
						by {authorName}
					</div>
				{/if}

				<p class="text-xs text-gray-500 leading-relaxed line-clamp-2 mt-2 flex-1">
					{description || ''}
				</p>

				{#if tags && tags.length > 0}
					<div class="relative mb-3 h-5 overflow-hidden">
						<div class="flex gap-1 absolute top-0 left-0 right-0">
					{#each tags as tag (tag)}
								<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full whitespace-nowrap">
									{tag}
								</span>
							{/each}
						</div>
						<div class="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-gray-50 to-transparent pointer-events-none"></div>
					</div>
				{/if}

				{#if stats}
					<div class="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-100 mt-auto">
						{#if stats.viewCount != null}
							<span class="flex items-center gap-1">
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
								{stats.viewCount.toLocaleString()}
							</span>
						{/if}
						{#if stats.favCount != null}
							<span class="flex items-center gap-1 text-rose-400">
								<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
								{stats.favCount}
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<!-- Compact card — small horizontal layout for sidebar/lineage -->
	<div class="flex gap-3 group">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-gray-100 shadow-sm {onclick ? 'cursor-pointer' : ''}"
			onclick={onclick}
			onkeydown={onclick ? (e) => { if (e.key === 'Enter') onclick?.(); } : undefined}
			role={onclick ? 'button' : undefined}
			tabindex={onclick ? 0 : undefined}
		>
			<img
				src={thumbnailUrl || 'https://placehold.co/64x64/e5e7eb/9ca3af?text=?'}
				alt={name}
				class="w-full h-full object-cover group-hover:opacity-90 transition"
			/>
		</div>
		<div class="flex-1 min-w-0">
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="text-sm font-bold text-gray-800 truncate transition-colors {onclick ? 'group-hover:text-gray-600 cursor-pointer' : ''}"
				onclick={onclick}
				onkeydown={onclick ? (e) => { if (e.key === 'Enter') onclick?.(); } : undefined}
				role={onclick ? 'button' : undefined}
				tabindex={onclick ? 0 : undefined}
			>
				{name || 'Untitled'}
			</div>
			{#if authorName}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="text-xs text-gray-500 truncate block transition-colors {onclickAuthor ? 'hover:text-gray-700 hover:underline cursor-pointer' : ''}"
					onclick={onclickAuthor ? (e) => { e.stopPropagation(); onclickAuthor?.(); } : undefined}
					onkeydown={onclickAuthor ? (e) => { if (e.key === 'Enter') onclickAuthor?.(); } : undefined}
					role={onclickAuthor ? 'button' : undefined}
					tabindex={onclickAuthor ? 0 : undefined}
				>
					by {authorName}
				</div>
			{/if}
			{#if description}
				<p class="text-xs text-gray-400 line-clamp-1 mt-0.5">{description}</p>
			{/if}
			{#if tags && tags.length > 0}
				<div class="flex flex-wrap gap-1 mt-1">
				{#each tags.slice(0, 3) as tag (tag)}
						<span class="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500 rounded">{tag}</span>
					{/each}
					{#if tags.length > 3}
						<span class="text-[10px] text-gray-400">+{tags.length - 3}</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.playing-card {
		transform-style: preserve-3d;
		will-change: transform;
		touch-action: none;
		transform: perspective(800px) rotateX(var(--rotateX)) rotateY(var(--rotateY)) rotate(-6deg) scale(1);
		transition: transform 0.15s ease-out;
	}

	.playing-card:hover {
		transform: perspective(800px) rotateX(var(--rotateX)) rotateY(var(--rotateY)) rotate(-6deg) scale(1.15);
	}
</style>
