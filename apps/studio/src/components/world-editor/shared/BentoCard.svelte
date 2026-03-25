<script lang="ts">
	interface Props {
		/** Icon SVG markup (injected via {@html}) */
		icon?: string;
		/** Icon color (CSS value) */
		iconColor?: string;
		/** Card title */
		label: string;
		/** Optional count badge (e.g., "3 items") */
		badge?: string;
		/** Optional preview text */
		preview?: string;
		/** Click handler */
		onclick?: () => void;
	}

	let { icon, iconColor = 'var(--we-accent)', label, badge, preview, onclick }: Props = $props();
</script>

<button
	class="text-left p-5 rounded-lg border-2 transition-all flex flex-col gap-2.5 cursor-pointer hover:scale-[1.01]"
	style="background: var(--we-bg-card); border-color: var(--we-border); box-shadow: var(--we-shadow-sm);"
	onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--we-border-hover)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-md)'; }}
	onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--we-border)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-sm)'; }}
	{onclick}
>
	<div class="flex items-center gap-2.5">
		{#if icon}
			<div class="p-1.5 rounded-md" style="background: color-mix(in srgb, {iconColor} 12%, transparent);">
				<svg class="w-4 h-4 shrink-0" style="color: {iconColor};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{@html icon}
				</svg>
			</div>
		{/if}
		<span class="text-sm font-serif font-bold truncate" style="color: var(--we-text-primary);">{label}</span>
		{#if badge}
			<span class="ml-auto text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0" style="background: var(--we-bg-secondary); color: var(--we-text-tertiary);">{badge}</span>
		{/if}
	</div>
	{#if preview}
		<p class="text-xs leading-relaxed line-clamp-2" style="color: var(--we-text-secondary);">{preview}</p>
	{/if}
</button>
