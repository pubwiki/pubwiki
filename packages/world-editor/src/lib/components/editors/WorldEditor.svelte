<!--
  WorldEditor — Edit world-level data: game time, registries (skills, moves, items),
  switches, custom components, and world bind settings.
-->
<script lang="ts">
	import type { WorldSnapshot, Skill, Move, ItemDef, GameTime, CustomComponentDef } from '../../types/state-data.js';
	import { luaList, generateUniqueId } from '../../types/editor.js';
	import CollapsibleSection from '../primitives/CollapsibleSection.svelte';
	import FormField from '../primitives/FormField.svelte';
	import TextInput from '../primitives/TextInput.svelte';
	import TextArea from '../primitives/TextArea.svelte';
	import NumberInput from '../primitives/NumberInput.svelte';
	import StringArrayEditor from '../primitives/StringArrayEditor.svelte';
	import BindSettingEditor from './BindSettingEditor.svelte';

	interface Props {
		world: WorldSnapshot;
		onChange: (world: WorldSnapshot) => void;
	}

	let { world, onChange }: Props = $props();

	// Helpers to update nested fields immutably
	function updateWorld(patch: Partial<WorldSnapshot>) {
		onChange({ ...world, ...patch });
	}

	function updateGameTime(patch: Partial<GameTime>) {
		updateWorld({ GameTime: { ...(world.GameTime || { year: 1, month: 1, day: 1, hour: 0, minute: 0 }), ...patch } });
	}

	// ---- Skills ----
	let skills = $derived(luaList<Skill>(world.Registry?.skills));

	function addSkill() {
		const id = generateUniqueId('skill');
		const updated = [...skills, { id, name: '', description: '', details: [] }];
		updateWorld({ Registry: { ...world.Registry!, skills: updated } });
	}

	function updateSkill(index: number, patch: Partial<Skill>) {
		const updated = skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
		updateWorld({ Registry: { ...world.Registry!, skills: updated } });
	}

	function removeSkill(index: number) {
		const updated = skills.filter((_, i) => i !== index);
		updateWorld({ Registry: { ...world.Registry!, skills: updated } });
	}

	// ---- Moves ----
	let moves = $derived(luaList<Move>(world.Registry?.moves));

	function addMove() {
		const id = generateUniqueId('move');
		const updated = [...moves, { id, name: '', desc: '', details: [] }];
		updateWorld({ Registry: { ...world.Registry!, moves: updated } });
	}

	function updateMove(index: number, patch: Partial<Move>) {
		const updated = moves.map((m, i) => (i === index ? { ...m, ...patch } : m));
		updateWorld({ Registry: { ...world.Registry!, moves: updated } });
	}

	function removeMove(index: number) {
		const updated = moves.filter((_, i) => i !== index);
		updateWorld({ Registry: { ...world.Registry!, moves: updated } });
	}

	// ---- Items ----
	let items = $derived(luaList<ItemDef>(world.Registry?.items));

	function addItem() {
		const id = generateUniqueId('item');
		const updated = [...items, { id, name: '', description: '', detail: [] }];
		updateWorld({ Registry: { ...world.Registry!, items: updated } });
	}

	function updateItem(index: number, patch: Partial<ItemDef>) {
		const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
		updateWorld({ Registry: { ...world.Registry!, items: updated } });
	}

	function removeItem(index: number) {
		const updated = items.filter((_, i) => i !== index);
		updateWorld({ Registry: { ...world.Registry!, items: updated } });
	}

	// ---- Switches ----
	let switchFlags = $derived(Object.entries(world.Switches?.flags || {}));

	function addSwitch() {
		const key = `switch_${Date.now()}`;
		updateWorld({ Switches: { flags: { ...(world.Switches?.flags || {}), [key]: false } } });
	}

	function toggleSwitch(key: string) {
		const flags = { ...(world.Switches?.flags || {}) };
		flags[key] = !flags[key];
		updateWorld({ Switches: { flags } });
	}

	function removeSwitch(key: string) {
		const flags = { ...(world.Switches?.flags || {}) };
		delete flags[key];
		updateWorld({ Switches: { flags } });
	}

	// ---- Custom Components ----
	let customComponents = $derived(luaList<CustomComponentDef>(world.CustomComponentRegistry?.custom_components));

	function addCustomComponent() {
		const key = generateUniqueId('comp');
		const updated = [...customComponents, { component_key: key, component_name: '', is_array: false }];
		updateWorld({ CustomComponentRegistry: { custom_components: updated } });
	}

	function updateCustomComponent(index: number, patch: Partial<CustomComponentDef>) {
		const updated = customComponents.map((c, i) => (i === index ? { ...c, ...patch } : c));
		updateWorld({ CustomComponentRegistry: { custom_components: updated } });
	}

	function removeCustomComponent(index: number) {
		const updated = customComponents.filter((_, i) => i !== index);
		updateWorld({ CustomComponentRegistry: { custom_components: updated } });
	}

	// Game time
	let gt = $derived(world.GameTime || { year: 1, month: 1, day: 1, hour: 0, minute: 0 });
</script>

<div class="space-y-2 p-4">
	<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">🌍 World Settings</h2>

	<!-- Game Time -->
	<CollapsibleSection title="Game Time" icon="⏰" outlineId="game-time">
		<div class="grid grid-cols-5 gap-3">
			<FormField label="Year">
				<NumberInput value={gt.year} onchange={(v) => updateGameTime({ year: v })} />
			</FormField>
			<FormField label="Month">
				<NumberInput value={gt.month} onchange={(v) => updateGameTime({ month: v })} min={1} max={12} />
			</FormField>
			<FormField label="Day">
				<NumberInput value={gt.day} onchange={(v) => updateGameTime({ day: v })} min={1} max={31} />
			</FormField>
			<FormField label="Hour">
				<NumberInput value={gt.hour} onchange={(v) => updateGameTime({ hour: v })} min={0} max={23} />
			</FormField>
			<FormField label="Minute">
				<NumberInput value={gt.minute} onchange={(v) => updateGameTime({ minute: v })} min={0} max={59} />
			</FormField>
		</div>
	</CollapsibleSection>

	<!-- Skills Registry -->
	<CollapsibleSection title="Skills Registry" icon="⚔️" badge={skills.length} outlineId="skills">
		{#each skills as skill, index (skill.id)}
			<div class="mb-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs font-mono text-gray-400">{skill.id}</span>
					<button
						type="button"
						class="text-xs text-red-400 hover:text-red-600"
						onclick={() => removeSkill(index)}
					>
						Remove
					</button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<FormField label="ID">
						<TextInput value={skill.id} onchange={(v) => updateSkill(index, { id: v })} />
					</FormField>
					<FormField label="Name">
						<TextInput value={skill.name} onchange={(v) => updateSkill(index, { name: v })} />
					</FormField>
				</div>
				<FormField label="Description">
					<TextArea value={skill.description} onchange={(v) => updateSkill(index, { description: v })} rows={2} />
				</FormField>
				<FormField label="Details (level descriptions)">
					<StringArrayEditor
						values={luaList(skill.details)}
						onChange={(v) => updateSkill(index, { details: v })}
						placeholder="Level description..."
						addLabel="+ Add level"
					/>
				</FormField>
			</div>
		{/each}
		<button
			type="button"
			class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
			onclick={addSkill}
		>
			+ Add Skill
		</button>
	</CollapsibleSection>

	<!-- Moves Registry -->
	<CollapsibleSection title="Moves Registry" icon="🎯" badge={moves.length} outlineId="moves">
		{#each moves as move, index (move.id)}
			<div class="mb-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs font-mono text-gray-400">{move.id}</span>
					<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeMove(index)}>
						Remove
					</button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<FormField label="ID">
						<TextInput value={move.id} onchange={(v) => updateMove(index, { id: v })} />
					</FormField>
					<FormField label="Name">
						<TextInput value={move.name} onchange={(v) => updateMove(index, { name: v })} />
					</FormField>
				</div>
				<FormField label="Description">
					<TextArea value={move.desc} onchange={(v) => updateMove(index, { desc: v })} rows={2} />
				</FormField>
				<FormField label="Details">
					<StringArrayEditor
						values={luaList(move.details)}
						onChange={(v) => updateMove(index, { details: v })}
						placeholder="Detail..."
						addLabel="+ Add detail"
					/>
				</FormField>
			</div>
		{/each}
		<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addMove}>
			+ Add Move
		</button>
	</CollapsibleSection>

	<!-- Items Registry -->
	<CollapsibleSection title="Items Registry" icon="🎒" badge={items.length} outlineId="items">
		{#each items as item, index (item.id)}
			<div class="mb-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs font-mono text-gray-400">{item.id}</span>
					<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeItem(index)}>
						Remove
					</button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<FormField label="ID">
						<TextInput value={item.id} onchange={(v) => updateItem(index, { id: v })} />
					</FormField>
					<FormField label="Name">
						<TextInput value={item.name} onchange={(v) => updateItem(index, { name: v })} />
					</FormField>
				</div>
				<FormField label="Description">
					<TextArea value={item.description} onchange={(v) => updateItem(index, { description: v })} rows={2} />
				</FormField>
				<FormField label="Detail">
					<StringArrayEditor
						values={luaList(item.detail)}
						onChange={(v) => updateItem(index, { detail: v })}
						addLabel="+ Add detail"
					/>
				</FormField>
			</div>
		{/each}
		<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addItem}>
			+ Add Item
		</button>
	</CollapsibleSection>

	<!-- Switches -->
	<CollapsibleSection title="Switches" icon="🔀" badge={switchFlags.length} outlineId="switches">
		{#each switchFlags as [key, value] (key)}
			<div class="mb-1.5 flex items-center gap-2">
				<input
					type="text"
					{value}
					class="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
					disabled
				/>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs {value ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}"
					onclick={() => toggleSwitch(key)}
				>
					{value ? 'ON' : 'OFF'}
				</button>
				<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeSwitch(key)}>
					✕
				</button>
			</div>
		{/each}
		<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addSwitch}>
			+ Add Switch
		</button>
	</CollapsibleSection>

	<!-- Custom Components -->
	<CollapsibleSection title="Custom Components" icon="🧩" badge={customComponents.length} outlineId="custom-components">
		{#each customComponents as comp, index (comp.component_key)}
			<div class="mb-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs font-mono text-gray-400">{comp.component_key}</span>
					<button type="button" class="text-xs text-red-400 hover:text-red-600" onclick={() => removeCustomComponent(index)}>
						Remove
					</button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<FormField label="Key">
						<TextInput value={comp.component_key} onchange={(v) => updateCustomComponent(index, { component_key: v })} />
					</FormField>
					<FormField label="Name">
						<TextInput value={comp.component_name} onchange={(v) => updateCustomComponent(index, { component_name: v })} />
					</FormField>
				</div>
				<div class="mt-1 flex items-center gap-2">
					<label class="text-xs text-gray-600 dark:text-gray-400">
						<input
							type="checkbox"
							checked={comp.is_array}
							onchange={(e) => updateCustomComponent(index, { is_array: e.currentTarget.checked })}
							class="mr-1 accent-amber-500"
						/>
						Is Array
					</label>
				</div>
			</div>
		{/each}
		<button type="button" class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600" onclick={addCustomComponent}>
			+ Add Component
		</button>
	</CollapsibleSection>

	<!-- World Bind Settings -->
	<CollapsibleSection title="Setting Documents" icon="📝" outlineId="world-settings">
		<BindSettingEditor
			documents={world.BindSetting?.documents || []}
			onChange={(docs) => updateWorld({ BindSetting: { documents: docs } })}
		/>
	</CollapsibleSection>
</div>
