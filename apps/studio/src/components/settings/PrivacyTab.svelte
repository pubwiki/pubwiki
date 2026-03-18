<script lang="ts">
	import { type SettingsStore } from '@pubwiki/ui/stores';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		settings: SettingsStore;
	}

	let { settings }: Props = $props();

	let errorReporting = $state(false);

	// Sync from store on init (persist may load async via onMount in persist utility)
	$effect(() => {
		errorReporting = settings.privacy.errorReporting;
	});

	function handleToggle(enabled: boolean) {
		errorReporting = enabled;
		settings.setErrorReporting(enabled);
	}
</script>

<div class="p-6 space-y-6">
	<div>
		<h3 class="text-base font-semibold text-gray-900">{m.studio_settings_privacy()}</h3>
		<p class="text-sm text-gray-500 mt-1">{m.studio_settings_privacy_desc()}</p>
	</div>

	<div class="border-t border-gray-200 pt-4">
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<label for="error-reporting-toggle" class="text-sm font-medium text-gray-900">
					{m.studio_settings_error_reporting()}
				</label>
				<p class="text-xs text-gray-500 mt-1">
					{m.studio_settings_error_reporting_desc()}
				</p>
			</div>
			<button
				id="error-reporting-toggle"
				type="button"
				role="switch"
				aria-checked={errorReporting}
				aria-label={m.studio_settings_error_reporting()}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 {errorReporting ? 'bg-blue-600' : 'bg-gray-200'}"
				onclick={() => handleToggle(!errorReporting)}
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {errorReporting ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>
	</div>
</div>
