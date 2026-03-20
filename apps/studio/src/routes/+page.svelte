<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { getCurrentProject, setCurrentProject } from '$lib/persistence';
	import * as m from '$lib/paraglide/messages';

	// On mount, check for current project and redirect accordingly
	$effect(() => {
		if (browser) {
			(async () => {
				// Preserve import parameter from URL
				const importArtifactId = $page.url.searchParams.get('import');
				console.log('[Studio Root] import parameter:', importArtifactId);
				
				// If importing, always create a new project
				if (importArtifactId) {
					const newProjectId = crypto.randomUUID();
					console.log('[Studio Root] Creating new project for import:', newProjectId);
					setCurrentProject(newProjectId);
					goto(resolve(`/${newProjectId}?import=${importArtifactId}`), { replaceState: true });
					return;
				}
				
				const currentProjectId = getCurrentProject();
				console.log('[Studio Root] current project:', currentProjectId);
				
				if (currentProjectId) {
					// Redirect to the existing current project
					console.log('[Studio Root] Redirecting to existing project');
					goto(resolve(`/${currentProjectId}`), { replaceState: true });
				} else {
					// Generate a new temporary UUID and redirect
					const tempId = crypto.randomUUID();
					setCurrentProject(tempId);
					console.log('[Studio Root] Redirecting to new project');
					goto(resolve(`/${tempId}`), { replaceState: true });
				}
			})();
		}
	});
</script>

<div class="h-screen w-full flex items-center justify-center">
	<div class="text-gray-500">{m.studio_loading()}</div>
</div>
