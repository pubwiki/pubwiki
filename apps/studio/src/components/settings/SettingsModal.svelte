<script lang="ts">
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import ApiKeysTab from './ApiKeysTab.svelte';
	import PrivacyTab from './PrivacyTab.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Tab definitions - extensible for future settings
	const tabs = [
		{ id: 'api-keys' as const, label: m.studio_settings_api_keys(), icon: 'key' },
		{ id: 'privacy' as const, label: m.studio_settings_privacy(), icon: 'shield' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];
	let activeTab = $state<TabId>('api-keys');

	// Get settings store
	const settings = getSettingsStore();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col">
		<!-- Header -->
		<div class="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">{m.studio_settings_title()}</h2>
			<button
				type="button"
				class="text-gray-400 hover:text-gray-500 transition-colors"
				onclick={onClose}
				aria-label={m.common_cancel()}
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content: Left tabs + Right content -->
		<div class="flex flex-1 overflow-hidden">
			<!-- Left sidebar tabs -->
			<div class="w-48 bg-gray-50 border-r border-gray-200 py-4">
				<nav class="space-y-1 px-2">
					{#each tabs as tab}
						<button
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
								{activeTab === tab.id
									? 'bg-blue-100 text-blue-700'
									: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
							onclick={() => (activeTab = tab.id)}
						>
							{#if tab.icon === 'key'}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
								</svg>						{:else if tab.icon === 'shield'}
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>							{/if}
							{tab.label}
						</button>
					{/each}
				</nav>
			</div>

			<!-- Right content area -->
			<div class="flex-1 overflow-y-auto">
				{#if activeTab === 'api-keys'}
					<ApiKeysTab {settings} />
				{:else if activeTab === 'privacy'}
					<PrivacyTab {settings} />
				{/if}
			</div>
		</div>
	</div>
</div>
