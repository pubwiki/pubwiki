<script lang="ts">
	import { getLocale, setLocale, locales, type Locale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	const languageNames: Record<Locale, string> = {
		en: 'English',
		zh: '中文'
	};

	let currentLocale = $state(getLocale());

	function handleChange(newLocale: Locale) {
		if (newLocale === currentLocale) return;
		setLocale(newLocale, { reload: true });
		currentLocale = newLocale;
		document.documentElement.lang = newLocale;
	}
</script>

<div class="flex items-center gap-2">
	<span class="text-xs text-gray-500">{m.footer_language()}:</span>
	<div class="flex gap-1">
		{#each locales as locale (locale)}
			<button
				onclick={() => handleChange(locale)}
				class="px-2 py-1 text-xs rounded transition {currentLocale === locale
					? 'bg-[#0969da] text-white'
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				{languageNames[locale]}
			</button>
		{/each}
	</div>
</div>
