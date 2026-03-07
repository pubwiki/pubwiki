<!--
  InitialStoryEditor — Edit the game's initial story.
-->
<script lang="ts">
	import type { GameInitialStory } from '../../types/state-data.js';
	import FormField from '../primitives/FormField.svelte';
	import TextArea from '../primitives/TextArea.svelte';

	interface Props {
		story: GameInitialStory | undefined;
		onChange: (story: GameInitialStory) => void;
	}

	let { story, onChange }: Props = $props();

	let current = $derived(story || { background: '', start_story: '' });

	function update(patch: Partial<GameInitialStory>) {
		onChange({ ...current, ...patch });
	}
</script>

<div class="p-6">
	<div class="mb-4">
		<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">🎬 Initial Story</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">The opening background and starting narrative.</p>
	</div>

	<div class="space-y-4">
		<FormField label="Background" hint="what the player sees as the world introduction">
			<TextArea value={current.background} onchange={(v) => update({ background: v })} rows={6} placeholder="The world background story..." />
		</FormField>

		<FormField label="Start Story" hint="the opening scene narrative">
			<TextArea value={current.start_story} onchange={(v) => update({ start_story: v })} rows={8} placeholder="The opening scene..." />
		</FormField>
	</div>
</div>
