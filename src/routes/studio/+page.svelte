<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { getCurrentProject, setCurrentProject } from './stores/db';
	import * as m from '$lib/paraglide/messages';

	// On mount, check for current project and redirect accordingly
	$effect(() => {
		if (browser) {
			(async () => {
				const currentProjectId = getCurrentProject();
				
				if (currentProjectId) {
					// Redirect to the existing current project
					goto(`/studio/${currentProjectId}`, { replaceState: true });
				} else {
					// Generate a new temporary UUID and redirect
					const tempId = crypto.randomUUID();
					setCurrentProject(tempId);
					goto(`/studio/${tempId}`, { replaceState: true });
				}
			})();
		}
	});
</script>

<div class="h-screen w-full flex items-center justify-center">
	<div class="text-gray-500">{m.studio_loading()}</div>
</div>
