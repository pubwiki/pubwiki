<!--
  CreaturesEditor — Edit creature entities (player + NPCs).
  3-column layout: left sidebar list, center form, right outline panel (future).
-->
<script lang="ts">
	import type { CreatureSnapshot, CreatureAttributes, Personality, Emotion } from '../../types/state-data.js';
	import { luaList, generateUniqueId } from '../../types/editor.js';
	import EntityListSidebar from '../primitives/EntityListSidebar.svelte';
	import CollapsibleSection from '../primitives/CollapsibleSection.svelte';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import StringArrayEditor from '../primitives/StringArrayEditor.svelte';
	import SliderInput from '../primitives/SliderInput.svelte';
	import BindSettingEditor from './BindSettingEditor.svelte';

	interface Props {
		creatures: CreatureSnapshot[];
		onChange: (creatures: CreatureSnapshot[]) => void;
	}

	let { creatures, onChange }: Props = $props();
	let selectedId = $state<string | null>(null);

	let listItems = $derived(
		creatures.map((c) => ({
			id: c.CreatureAttributes?.creature_id || `entity-${c.entity_id}`,
			name: c.CreatureAttributes?.name || '(unnamed)',
			subtitle: c.IsPlayer ? '⭐ Player' : 'NPC',
			icon: c.IsPlayer ? '⭐' : '👤'
		}))
	);

	let selectedIndex = $derived(
		selectedId ? creatures.findIndex((c) => (c.CreatureAttributes?.creature_id || `entity-${c.entity_id}`) === selectedId) : -1
	);
	let selected = $derived(selectedIndex >= 0 ? creatures[selectedIndex] : null);
	let attrs = $derived(selected?.CreatureAttributes);

	function updateCreature(index: number, patch: Partial<CreatureSnapshot>) {
		const updated = creatures.map((c, i) => (i === index ? { ...c, ...patch } : c));
		onChange(updated);
	}

	function updateAttrs(patch: Partial<CreatureAttributes>) {
		if (selectedIndex < 0 || !attrs) return;
		updateCreature(selectedIndex, { CreatureAttributes: { ...attrs, ...patch } });
	}

	function addCreature() {
		const id = generateUniqueId('creature');
		const newCreature: CreatureSnapshot = {
			entity_id: Date.now(),
			CreatureAttributes: {
				creature_id: id,
				name: '',
				titles: [],
				skills: {},
				attrs: {}
			},
			Log: { entries: [] }
		};
		onChange([...creatures, newCreature]);
		selectedId = id;
	}

	function removeCreature(id: string) {
		const updated = creatures.filter(
			(c) => (c.CreatureAttributes?.creature_id || `entity-${c.entity_id}`) !== id
		);
		onChange(updated);
		if (selectedId === id) selectedId = null;
	}

	// Personality helpers
	function updatePersonality(patch: Partial<Personality>) {
		if (!attrs) return;
		const defaultP: Personality = { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 };
		updateAttrs({ personality: { ...defaultP, ...attrs.personality, ...patch } });
	}

	// Emotion helpers
	function updateEmotion(patch: Partial<Emotion>) {
		if (!attrs) return;
		const defaultE: Emotion = { pleasure: 0, arousal: 0, dominance: 0 };
		updateAttrs({ emotion: { ...defaultE, ...attrs.emotion, ...patch } });
	}

	function togglePlayer() {
		if (selectedIndex < 0) return;
		const isCurrentlyPlayer = !!selected!.IsPlayer;
		if (isCurrentlyPlayer) {
			// Remove IsPlayer
			const { IsPlayer: _, ...rest } = selected!;
			updateCreature(selectedIndex, { ...rest, IsPlayer: undefined });
		} else {
			// Set as player — remove IsPlayer from all others first
			const updated = creatures.map((c, i) => {
				if (i === selectedIndex) return { ...c, IsPlayer: {} };
				const { IsPlayer: _, ...rest } = c;
				return rest as CreatureSnapshot;
			});
			onChange(updated);
		}
	}
</script>

<div class="flex h-full">
	<!-- Left sidebar -->
	<EntityListSidebar
		title="Creatures"
		items={listItems}
		{selectedId}
		onSelect={(id) => (selectedId = id)}
		onAdd={addCreature}
		onRemove={removeCreature}
		addLabel="+ Add Creature"
	/>

	<!-- Main editor area -->
	<div class="flex-1 overflow-y-auto">
		{#if selected && attrs}
			<div class="space-y-2 p-4">
				<div class="mb-4 flex items-center gap-3">
					<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
						{attrs.name || '(unnamed)'}
					</h2>
					{#if selected.IsPlayer}
						<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
							Player
						</span>
					{/if}
				</div>

				<!-- Basic Info -->
				<CollapsibleSection title="Basic Info" icon="📋" outlineId="basic-info">
					<div class="grid grid-cols-2 gap-3">
						<FormField label="Creature ID">
							<TextInput value={attrs.creature_id} onchange={(v) => updateAttrs({ creature_id: v })} />
						</FormField>
						<FormField label="Name">
							<TextInput value={attrs.name} onchange={(v) => updateAttrs({ name: v })} />
						</FormField>
					</div>
					<FormField label="Organization ID">
						<TextInput value={attrs.organization_id ?? ''} onchange={(v) => updateAttrs({ organization_id: v || undefined })} />
					</FormField>
					<FormField label="Titles">
						<StringArrayEditor values={luaList(attrs.titles)} onChange={(v) => updateAttrs({ titles: v })} placeholder="Title..." addLabel="+ Add title" />
					</FormField>

					<div class="mt-2">
						<button
							type="button"
							class="rounded px-3 py-1 text-xs {selected.IsPlayer ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}"
							onclick={togglePlayer}
						>
							{selected.IsPlayer ? '⭐ Is Player' : 'Set as Player'}
						</button>
					</div>
				</CollapsibleSection>

				<!-- Appearance -->
				<CollapsibleSection title="Appearance" icon="👁️" outlineId="appearance">
					<FormField label="Body">
						<TextArea
							value={attrs.appearance?.body ?? ''}
							onchange={(v) => updateAttrs({ appearance: { body: v, clothing: attrs.appearance?.clothing ?? '' } })}
							rows={2}
							placeholder="Body description..."
						/>
					</FormField>
					<FormField label="Clothing">
						<TextArea
							value={attrs.appearance?.clothing ?? ''}
							onchange={(v) => updateAttrs({ appearance: { body: attrs.appearance?.body ?? '', clothing: v } })}
							rows={2}
							placeholder="Clothing description..."
						/>
					</FormField>
				</CollapsibleSection>

				<!-- Personality (OCEAN) -->
				<CollapsibleSection title="Personality (OCEAN)" icon="🧠" outlineId="personality">
					<div class="space-y-2">
						<SliderInput label="Openness" value={attrs.personality?.openness ?? 0} onchange={(v) => updatePersonality({ openness: v })} />
						<SliderInput label="Conscientiousness" value={attrs.personality?.conscientiousness ?? 0} onchange={(v) => updatePersonality({ conscientiousness: v })} />
						<SliderInput label="Extraversion" value={attrs.personality?.extraversion ?? 0} onchange={(v) => updatePersonality({ extraversion: v })} />
						<SliderInput label="Agreeableness" value={attrs.personality?.agreeableness ?? 0} onchange={(v) => updatePersonality({ agreeableness: v })} />
						<SliderInput label="Neuroticism" value={attrs.personality?.neuroticism ?? 0} onchange={(v) => updatePersonality({ neuroticism: v })} />
					</div>
					<FormField label="Remark">
						<TextArea value={attrs.personality?.remark ?? ''} onchange={(v) => updatePersonality({ remark: v })} rows={2} placeholder="Personality notes..." />
					</FormField>
				</CollapsibleSection>

				<!-- Emotion (PAD) -->
				<CollapsibleSection title="Emotion (PAD)" icon="💭" outlineId="emotion">
					<div class="space-y-2">
						<SliderInput label="Pleasure" value={attrs.emotion?.pleasure ?? 0} onchange={(v) => updateEmotion({ pleasure: v })} />
						<SliderInput label="Arousal" value={attrs.emotion?.arousal ?? 0} onchange={(v) => updateEmotion({ arousal: v })} />
						<SliderInput label="Dominance" value={attrs.emotion?.dominance ?? 0} onchange={(v) => updateEmotion({ dominance: v })} />
					</div>
					<FormField label="Remark">
						<TextArea value={attrs.emotion?.remark ?? ''} onchange={(v) => updateEmotion({ remark: v })} rows={2} placeholder="Emotion notes..." />
					</FormField>
				</CollapsibleSection>

				<!-- Setting Documents -->
				<CollapsibleSection title="Setting Documents" icon="📝" outlineId="creature-settings">
					<BindSettingEditor
						documents={selected.BindSetting?.documents || []}
						onChange={(docs) => updateCreature(selectedIndex, { BindSetting: { documents: docs } })}
					/>
				</CollapsibleSection>
			</div>
		{:else}
			<div class="flex h-full items-center justify-center text-gray-400">
				<p>Select a creature or create a new one</p>
			</div>
		{/if}
	</div>
</div>
