<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getWorldEditorContext } from '../state/context';
	import { validateStateData } from '@pubwiki/world-editor';

	const ctx = getWorldEditorContext();

	const stats = $derived({
		creatures: ctx.stateData.Creatures?.length ?? 0,
		regions: ctx.stateData.Regions?.length ?? 0,
		organizations: ctx.stateData.Organizations?.length ?? 0,
		documents: countDocuments(ctx.stateData)
	});

	const errors = $derived(validateStateData(ctx.stateData));

	function countDocuments(data: typeof ctx.stateData): number {
		let count = data.World.bind_setting?.documents?.length ?? 0;
		for (const c of data.Creatures ?? []) count += c.bind_setting?.documents?.length ?? 0;
		for (const r of data.Regions ?? []) count += r.bind_setting?.documents?.length ?? 0;
		for (const o of data.Organizations ?? []) count += o.bind_setting?.documents?.length ?? 0;
		return count;
	}

	const statCards = $derived([
		{
			label: m.we_dashboard_stats_creatures(),
			value: stats.creatures,
			tab: 'characters',
			color: 'var(--we-accent)',
			icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'
		},
		{
			label: m.we_dashboard_stats_regions(),
			value: stats.regions,
			tab: 'regions',
			color: 'var(--we-accent-olive)',
			icon: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'
		},
		{
			label: m.we_dashboard_stats_organizations(),
			value: stats.organizations,
			tab: 'organizations',
			color: 'var(--we-accent-plum)',
			icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'
		},
		{
			label: m.we_dashboard_stats_documents(),
			value: stats.documents,
			tab: 'world',
			color: 'var(--we-accent-ochre)',
			icon: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'
		}
	]);
</script>

<div class="flex-1 overflow-y-auto p-6">
	<h2 class="font-serif font-bold text-xl text-[var(--we-text-primary)] mb-6">
		{m.we_dashboard_title()}
	</h2>

	<!-- Stats grid -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
		{#each statCards as card}
			<button
				class="border-2 rounded-lg p-5 text-left transition-all cursor-pointer hover:scale-[1.02] hover:-translate-y-0.5"
				style="background: var(--we-bg-card); border-color: var(--we-border); box-shadow: var(--we-shadow-sm);"
				onmouseenter={(e) => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.boxShadow = 'var(--we-shadow-md)'; }}
				onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--we-border)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-sm)'; }}
				onclick={() => ctx.navigateTab(card.tab)}
			>
				<div class="flex items-start justify-between mb-3">
					<div class="p-2 rounded-md" style="background: color-mix(in srgb, {card.color} 12%, transparent);">
						<svg class="w-5 h-5" style="color: {card.color};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							{@html card.icon}
						</svg>
					</div>
				</div>
				<div class="text-3xl font-bold font-serif" style="color: {card.color};">{card.value}</div>
				<div class="text-sm mt-1" style="color: var(--we-text-secondary);">{card.label}</div>
			</button>
		{/each}
	</div>

	<!-- Validation panel -->
	<div class="mb-8">
		<h3 class="text-sm font-semibold text-[var(--we-text-primary)] mb-3">
			{m.we_dashboard_validation_title()}
		</h3>
		{#if errors.length === 0}
			<div
				class="bg-green-50 border border-green-200 rounded-md p-3 flex items-center gap-2"
			>
				<svg
					class="w-4 h-4 text-green-500 shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
					<path d="m9 11 3 3L22 4" />
				</svg>
				<span class="text-sm text-green-700">{m.we_dashboard_validation_ok()}</span>
			</div>
		{:else}
			<div class="bg-red-50 border border-red-200 rounded-md p-3">
				<div class="flex items-center gap-2 mb-2">
					<svg
						class="w-4 h-4 text-red-500 shrink-0"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" x2="12" y1="8" y2="12" />
						<line x1="12" x2="12.01" y1="16" y2="16" />
					</svg>
					<span class="text-sm font-semibold text-red-700">
						{m.we_dashboard_validation_errors({ count: errors.length })}
					</span>
				</div>
				<ul class="text-xs text-red-600 space-y-1 ml-6 list-disc">
					{#each errors as error}
						<li><span class="font-mono">{error.path}</span>: {error.message}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<!-- Quick links -->
	<div>
		<h3 class="text-sm font-semibold mb-3" style="color: var(--we-text-primary);">
			{m.we_dashboard_quick_links()}
		</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
			{#each [
				{ tab: 'characters', label: m.we_tab_characters(), icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', color: 'var(--we-accent)' },
				{ tab: 'regions', label: m.we_tab_regions(), icon: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>', color: 'var(--we-accent-olive)' },
				{ tab: 'organizations', label: m.we_tab_organizations(), icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01"/>', color: 'var(--we-accent-plum)' },
				{ tab: 'world', label: m.we_tab_world(), icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>', color: 'var(--we-accent-ochre)' },
				{ tab: 'story', label: m.we_tab_story(), icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', color: 'var(--we-text-secondary)' },
				{ tab: 'wiki', label: m.we_tab_wiki(), icon: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19v16H6.5a2.5 2.5 0 0 0 0 5H19"/>', color: 'var(--we-text-secondary)' }
			] as link}
				<button
					class="flex items-center gap-3 px-4 py-3 rounded-md border-2 text-sm transition-all cursor-pointer hover:scale-[1.01]"
					style="background: var(--we-bg-card); border-color: var(--we-border); color: var(--we-text-secondary); box-shadow: var(--we-shadow-sm);"
					onmouseenter={(e) => { e.currentTarget.style.borderColor = link.color; e.currentTarget.style.boxShadow = 'var(--we-shadow-md)'; e.currentTarget.style.color = 'var(--we-text-primary)'; }}
					onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--we-border)'; e.currentTarget.style.boxShadow = 'var(--we-shadow-sm)'; e.currentTarget.style.color = 'var(--we-text-secondary)'; }}
					onclick={() => ctx.navigateTab(link.tab)}
				>
					<svg class="w-5 h-5 shrink-0" style="color: {link.color};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						{@html link.icon}
					</svg>
					<span class="font-medium">{link.label}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
