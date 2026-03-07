// ============================================================================
// StateData Types — Platform-level world editor data model
// Ported from avg-game-template, cleaned up for platform reuse.
// ============================================================================

// Dynamic attributes: key = field name (defined by Registry.creature_attr_fields), value = number or string
export type Attributes = Record<string, number | string>;

// ============================================================================
// Base Component Types
// ============================================================================

export interface StatusEffect {
	instance_id: string;
	display_name?: string;
	remark?: string;
	data?: unknown;
	add_at?: string;
	last_update_at?: string;
}

export interface TypeSchema {
	type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null';
	description?: string;
	properties?: Record<string, TypeSchema>;
	required?: string[];
	items?: TypeSchema;
	additionalProperties?: boolean | TypeSchema;
	oneOf?: TypeSchema[];
}

export interface CustomComponentDef {
	component_key: string;
	component_name: string;
	is_array: boolean;
	data_registry?: Array<{ item_id: string; data: unknown }>;
	type_schema?: TypeSchema;
}

export interface Item {
	id: string;
	count: number;
}

export interface LocationRef {
	region_id: string;
	location_id: string;
}

export interface Location {
	id: string;
	name: string;
	description: string;
}

export interface Path {
	src_location: string;
	src_region: string;
	discovered: boolean;
	to_region: string;
	to_location: string;
	description: string;
}

export interface Move {
	id: string;
	name: string;
	desc: string;
	details: string[];
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	details: string[];
}

export interface ItemDef {
	id: string;
	name: string;
	description: string;
	detail: string[];
	equippable_slot?: 'head' | 'body' | 'hands' | 'legs' | 'feet' | 'accessory';
	equippable_attributes?: Partial<Attributes>;
}

export interface Relationship {
	target_creature_id: string;
	name: string;
	value: number;
}

// ============================================================================
// OCEAN Personality & PAD Emotion
// ============================================================================

export interface Personality {
	openness: number;
	conscientiousness: number;
	extraversion: number;
	agreeableness: number;
	neuroticism: number;
	remark?: string;
}

export interface Emotion {
	pleasure: number;
	arousal: number;
	dominance: number;
	remark?: string;
}

// ============================================================================
// Creature Components
// ============================================================================

export interface CreatureAttributes {
	creature_id: string;
	name: string;
	organization_id?: string;
	titles: string[];
	appearance?: {
		body: string;
		clothing: string;
	};
	personality?: Personality;
	emotion?: Emotion;
	skills: Record<string, number>;
	attrs: Attributes;
}

export interface IsPlayer {}

export interface Equipment {
	head?: string;
	body?: string;
	hands?: string;
	legs?: string;
	feet?: string;
	accessory_slots: number;
	accessories: string[];
}

export interface Inventory {
	items: Item[];
}

export interface StatusEffects {
	status_effects: StatusEffect[];
}

export interface CustomComponents {
	custom_components: Array<{
		component_key: string;
		data: unknown;
	}>;
}

export interface Moves {
	move_ids: string[];
}

export interface Relationship_Component {
	relationships: Relationship[];
}

// ============================================================================
// Setting Documents (RAG data source)
// ============================================================================

export interface SettingDocument {
	name: string;
	content: string;
	static_priority?: number;
	disable?: boolean;
	condition?: string;
}

export interface BindSetting {
	documents: SettingDocument[];
}

// ============================================================================
// World Components
// ============================================================================

export interface GameTime {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

export interface CreatureAttrField {
	field_name: string;
	hint: string;
	field_display_name?: string;
}

export interface Registry {
	npc_creature_ids: string[];
	player_creature_id: string;
	skills?: Skill[];
	moves?: Move[];
	items?: ItemDef[];
	creature_attr_fields?: CreatureAttrField[];
}

export interface CustomComponentRegistry {
	custom_components: CustomComponentDef[];
}

export interface Switches {
	flags: Record<string, boolean>;
}

export interface LogEntry {
	content: string;
	add_at: string;
}

export interface Log {
	entries: LogEntry[];
}

export interface Metadata {
	name: string;
	desc: string;
}

export interface LocationsAndPaths {
	region_id: string;
	region_name: string;
	description: string;
	locations?: Location[];
	paths?: Path[];
}

export interface Organization {
	organization_id: string;
	name: string;
	territories?: Array<{ region_id: string; location_id: string }>;
	description: string;
}

// ============================================================================
// Entity Snapshots
// ============================================================================

export interface WorldSnapshot {
	entity_id: number;
	GameTime?: GameTime;
	Registry?: Registry;
	Switches?: Switches;
	CustomComponentRegistry?: CustomComponentRegistry;
	Log?: Log;
	BindSetting?: BindSetting;
}

export interface CreatureSnapshot {
	entity_id: number;
	CreatureAttributes?: CreatureAttributes;
	LocationRef?: LocationRef;
	Inventory?: Inventory;
	Equipment?: Equipment;
	StatusEffects?: StatusEffects;
	CustomComponents?: CustomComponents;
	Moves?: Moves;
	Relationship?: Relationship_Component;
	Log?: Log;
	IsPlayer?: IsPlayer;
	BindSetting?: BindSetting;
}

export interface RegionSnapshot {
	entity_id: number;
	Metadata?: Metadata;
	LocationsAndPaths?: LocationsAndPaths;
	StatusEffects?: StatusEffects;
	Log?: Log;
	BindSetting?: BindSetting;
}

export interface OrganizationSnapshot {
	entity_id: number;
	Organization?: Organization;
	Inventory?: Inventory;
	StatusEffects?: StatusEffects;
	Log?: Log;
	BindSetting?: BindSetting;
}

// ============================================================================
// Story & App Info
// ============================================================================

export interface StoryHistoryEntry {
	turn_id: string;
	story: {
		content: unknown;
		checkpoint_id?: string;
	};
}

export interface GameInitialStory {
	background: string;
	start_story: string;
}

export type GameWikiEntry =
	| Array<{ title: string; content: string }>
	| undefined;

export type AppInfo = {
	name: string;
	slug: string;
	version?: string;
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
	tags?: string[];
	homepage?: string;
	publish_type?: 'EDITOR' | 'NOVEL' | 'INK' | 'TEST' | 'CUSTOM' | 'GALGAME';
};

// ============================================================================
// StateData — The root data model
// ============================================================================

export interface StateData {
	World: WorldSnapshot;
	Creatures?: CreatureSnapshot[];
	Regions?: RegionSnapshot[];
	Organizations?: OrganizationSnapshot[];
	StoryHistory?: StoryHistoryEntry[];
	GameInitialStory?: GameInitialStory;
	GameWikiEntry?: GameWikiEntry;
	AppInfo?: AppInfo;
}
