// @pubwiki/world-editor — Main entry point
// Components
export { default as StateDataEditor } from './components/StateDataEditor.svelte';

// Sub-editors (for advanced usage)
export {
	DashboardEditor,
	WorldEditor,
	CreaturesEditor,
	RegionsEditor,
	OrganizationsEditor,
	BindSettingEditor,
	SettingDocsEditor,
	InitialStoryEditor,
	StoryHistoryEditor,
	AppInfoEditor,
	EditorSidebar
} from './components/editors/index.js';

// Primitives
export {
	StringArrayEditor,
	CollapsibleSection,
	FormField,
	TextInput,
	TextArea,
	NumberInput,
	EntityListSidebar,
	SliderInput
} from './components/primitives/index.js';

// Types
export type {
	StateData,
	WorldSnapshot,
	CreatureSnapshot,
	RegionSnapshot,
	OrganizationSnapshot,
	StoryHistoryEntry,
	GameInitialStory,
	GameWikiEntry,
	AppInfo,
	Attributes,
	Personality,
	Emotion,
	SettingDocument,
	BindSetting,
	GameTime,
	Location,
	Path,
	Organization,
	TypeSchema,
	CreatureAttrField,
	Registry,
	CustomComponentRegistry,
	Switches,
	CustomComponentDef,
	Skill,
	Move,
	ItemDef,
	LogEntry,
	Log,
	Metadata,
	LocationsAndPaths,
	StatusEffect,
	LocationRef,
	Item,
	Relationship,
	CreatureAttributes,
	IsPlayer,
	Equipment,
	Inventory,
	StatusEffects,
	CustomComponents,
	Moves,
	Relationship_Component
} from './types/state-data.js';

export type { TabType, ValidationError } from './types/editor.js';

export {
	DEFAULT_ATTRS,
	DEFAULT_GAME_TIME,
	createEmptyWorld,
	createEmptyStateData,
	luaList,
	getDefaultValueForSchema,
	generateUniqueId,
	validateStateData
} from './types/editor.js';
