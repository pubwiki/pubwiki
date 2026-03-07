// ============================================================================
// Editor-specific types
// ============================================================================

import type {
	StateData,
	WorldSnapshot,
	CreatureSnapshot,
	GameTime,
	Attributes,
	Skill,
	Move,
	ItemDef,
	CustomComponentDef,
	TypeSchema
} from './state-data.js';

export type TabType =
	| 'dashboard'
	| 'world'
	| 'creatures'
	| 'regions'
	| 'organizations'
	| 'settings'
	| 'initial-story'
	| 'story-history'
	| 'wiki'
	| 'app-info';

export interface ValidationError {
	path: string;
	message: string;
	severity: 'error' | 'warning';
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_ATTRS: Attributes = {};

export const DEFAULT_GAME_TIME: GameTime = {
	year: 1,
	month: 1,
	day: 1,
	hour: 0,
	minute: 0
};

export const createEmptyWorld = (): WorldSnapshot => ({
	entity_id: 1,
	GameTime: { ...DEFAULT_GAME_TIME },
	Registry: {
		npc_creature_ids: [],
		player_creature_id: '',
		skills: [],
		moves: [],
		items: []
	},
	Switches: {
		flags: {}
	},
	CustomComponentRegistry: {
		custom_components: []
	},
	Log: {
		entries: []
	}
});

export const createEmptyStateData = (): StateData => ({
	World: createEmptyWorld(),
	Creatures: [],
	Regions: [],
	Organizations: [],
	StoryHistory: [],
	GameInitialStory: { background: '', start_story: '' }
});

// ============================================================================
// Utility functions
// ============================================================================

/** Normalize a possibly-empty Lua table to a JS array */
export const luaList = <T>(v: T[] | undefined | null | Record<string, never>): T[] => {
	return Array.isArray(v) ? v : [];
};

/** Generate a default value for a given JSON Schema */
export const getDefaultValueForSchema = (schema: TypeSchema): unknown => {
	switch (schema.type) {
		case 'string':
			return '';
		case 'number':
		case 'integer':
			return 0;
		case 'boolean':
			return false;
		case 'object': {
			const obj: Record<string, unknown> = {};
			if (schema.properties && schema.required) {
				for (const key of luaList<string>(schema.required)) {
					if (schema.properties[key]) {
						obj[key] = getDefaultValueForSchema(schema.properties[key]);
					}
				}
			}
			return Object.keys(obj).length > 0 ? obj : {};
		}
		case 'array':
			return [];
		case 'null':
			return null;
		default:
			return undefined;
	}
};

/** Generate a unique ID with a prefix */
export const generateUniqueId = (prefix: string): string =>
	`${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ============================================================================
// Validation
// ============================================================================

export const validateStateData = (data: StateData): ValidationError[] => {
	const errors: ValidationError[] = [];

	if (!data.World) {
		errors.push({ path: 'World', message: 'Missing world data', severity: 'error' });
	} else {
		if (!data.World.GameTime) {
			errors.push({ path: 'World.GameTime', message: 'Missing game time', severity: 'warning' });
		}

		// Check Registry ID uniqueness
		const skillIds = new Set<string>();
		for (const [index, skill] of luaList<Skill>(data.World.Registry?.skills).entries()) {
			if (!skill.id) {
				errors.push({ path: `World.Registry.skills[${index}]`, message: 'Skill missing ID', severity: 'error' });
			} else if (skillIds.has(skill.id)) {
				errors.push({ path: `World.Registry.skills[${index}]`, message: `Duplicate skill ID: ${skill.id}`, severity: 'error' });
			} else {
				skillIds.add(skill.id);
			}
		}

		const moveIds = new Set<string>();
		for (const [index, move] of luaList<Move>(data.World.Registry?.moves).entries()) {
			if (!move.id) {
				errors.push({ path: `World.Registry.moves[${index}]`, message: 'Move missing ID', severity: 'error' });
			} else if (moveIds.has(move.id)) {
				errors.push({ path: `World.Registry.moves[${index}]`, message: `Duplicate move ID: ${move.id}`, severity: 'error' });
			} else {
				moveIds.add(move.id);
			}
		}

		const itemIds = new Set<string>();
		for (const [index, item] of luaList<ItemDef>(data.World.Registry?.items).entries()) {
			if (!item.id) {
				errors.push({ path: `World.Registry.items[${index}]`, message: 'Item missing ID', severity: 'error' });
			} else if (itemIds.has(item.id)) {
				errors.push({ path: `World.Registry.items[${index}]`, message: `Duplicate item ID: ${item.id}`, severity: 'error' });
			} else {
				itemIds.add(item.id);
			}
		}

		const componentKeys = new Set<string>();
		for (const [index, def] of luaList<CustomComponentDef>(data.World.CustomComponentRegistry?.custom_components).entries()) {
			if (!def.component_key) {
				errors.push({ path: `World.CustomComponentRegistry[${index}]`, message: 'Custom component missing key', severity: 'error' });
			} else if (componentKeys.has(def.component_key)) {
				errors.push({ path: `World.CustomComponentRegistry[${index}]`, message: `Duplicate component key: ${def.component_key}`, severity: 'error' });
			} else {
				componentKeys.add(def.component_key);
			}
		}
	}

	// Validate creatures
	const creatureIds = new Set<string>();
	for (const [index, creature] of luaList<CreatureSnapshot>(data.Creatures).entries()) {
		const creatureId = creature.CreatureAttributes?.creature_id;
		if (!creatureId) {
			errors.push({ path: `Creatures[${index}]`, message: 'Creature missing ID', severity: 'error' });
		} else if (creatureIds.has(creatureId)) {
			errors.push({ path: `Creatures[${index}]`, message: `Duplicate creature ID: ${creatureId}`, severity: 'error' });
		} else {
			creatureIds.add(creatureId);
		}
		if (!creature.CreatureAttributes?.name) {
			errors.push({ path: `Creatures[${index}]`, message: 'Creature missing name', severity: 'warning' });
		}
	}

	return errors;
};
