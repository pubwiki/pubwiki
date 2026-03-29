<script lang="ts">
	import { getSettingsStore } from '../../stores/settings.svelte';
	import ApiKeysTab from './ApiKeysTab.svelte';
	import PrivacyTab from './PrivacyTab.svelte';

	interface Props {
		onclose: (changed: boolean) => void;
	}

	let { onclose }: Props = $props();

	const tabs = [
		{ id: 'api-keys' as const, label: 'API Keys', icon: 'key' },
		{ id: 'privacy' as const, label: 'Privacy', icon: 'shield' },
	] as const;

	type TabId = (typeof tabs)[number]['id'];
	let activeTab = $state<TabId>('api-keys');

	const settings = getSettingsStore();

	// Track whether any settings were changed during this modal session
	let dirty = $state(false);

	// Snapshot initial state to detect changes on close
	let initialSnapshot = $state('');
	$effect(() => {
		// Take snapshot once on first render
		if (!initialSnapshot) {
			initialSnapshot = JSON.stringify(settings.api) + JSON.stringify(settings.privacy);
		}
	});

	function checkDirty(): boolean {
		const current = JSON.stringify(settings.api) + JSON.stringify(settings.privacy);
		return current !== initialSnapshot;
	}

	function handleClose() {
		onclose(checkDirty());
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={(e) => {
		if (e.target === e.currentTarget) handleClose();
	}}
>
	<div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col">
		<!-- Header -->
		<div class="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">Settings</h2>
			<button
				type="button"
				class="text-gray-400 hover:text-gray-500 transition-colors"
				onclick={handleClose}
				aria-label="Close"
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content -->
		<div class="flex flex-1 overflow-hidden">
			<!-- Left sidebar tabs -->
			<div class="w-48 bg-gray-50 border-r border-gray-200 py-4">
				<nav class="space-y-1 px-2">
					{#each tabs as tab (tab.id)}
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
								</svg>
							{:else if tab.icon === 'shield'}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
								</svg>
							{/if}
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
