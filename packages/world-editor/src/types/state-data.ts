/**
 * StateData — Core data model for the world editor.
 *
 * Based on an ECS (Entity-Component-System) architecture.
 * Each entity type is a snapshot containing components.
 *
 * StateData serves as a **materialized view** over the underlying TripleStore.
 * All writes go through TripleStore; StateData is the derived read model.
 */

// ---------------------------------------------------------------------------
// Setting Documents (RAG-ready)
// ---------------------------------------------------------------------------

/** A setting document bound to an entity, used for LLM retrieval. */
export interface SettingDocument {
  /** Document name / title */
  name: string
  /** Full document content */
  content: string
  /** Static priority for retrieval ranking (higher = more important) */
  static_priority?: number
  /** Natural-language condition for LLM recall (e.g. "when introducing character background") */
  condition?: string
  /** Whether this document is disabled */
  disable?: boolean
}

/** Component: binds setting documents to an entity */
export interface BindSetting {
  documents: SettingDocument[]
}

// ---------------------------------------------------------------------------
// Common Components
// ---------------------------------------------------------------------------

/** A log entry recording state changes or events */
export interface LogEntry {
  timestamp: string
  content: string
}

/** Status effect applied to an entity */
export interface StatusEffect {
  /** Unique instance identifier */
  instance_id: string
  /** Display name for the effect */
  display_name?: string
  /** Remark: source, conditions, details */
  remark?: string
  /** Free-form data attached to this effect */
  data?: unknown
  /** When the effect was added */
  add_at?: string
  /** When the effect was last updated */
  last_update_at?: string
}

/** Metadata for an entity */
export interface Metadata {
  name: string
  desc: string
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Structured game time */
export interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** Creature attribute field definition (part of Registry) */
export interface CreatureAttrField {
  field_name: string
  hint: string
  field_display_name?: string
}

/** JSON Schema fragment for describing custom component data structure */
export interface TypeSchema {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  properties?: Record<string, TypeSchema>
  required?: string[]
  items?: TypeSchema
  additionalProperties?: boolean | TypeSchema
  oneOf?: TypeSchema[]
}

/** Custom component definition stored in World.CustomComponentRegistry */
export interface CustomComponentDef {
  component_key: string
  component_name: string
  is_array: boolean
  type_schema?: TypeSchema
  data_registry?: Array<{ item_id: string; data: unknown }>
}

/** Director notes — multi-faceted authoring state for AI */
export interface DirectorNotes {
  notes: string[]
  flags: Record<string, { id: string; value: boolean; remark?: string }>
  stage_goal?: string | null
}

/** World-level snapshot (always required) */
export interface WorldSnapshot {
  entity_id: string

  // Core components
  game_time?: GameTime
  /** Registry of creature attribute field definitions */
  registry?: CreatureAttrField[]
  /** Director notes — structured authoring state for AI */
  director_notes?: DirectorNotes
  /** Custom component definitions that entities can use */
  custom_component_registry?: CustomComponentDef[]

  // Auxiliary
  log?: LogEntry[]
  bind_setting?: BindSetting
}

// ---------------------------------------------------------------------------
// Creature (Character)
// ---------------------------------------------------------------------------

/** Appearance sub-component */
export interface Appearance {
  body?: string
  clothing?: string
  features?: string
}

/** Dynamic attribute values: key → number | string */
export type Attributes = Record<string, number | string>

/** Core creature data */
export interface CreatureComponent {
  name: string
  organization_id?: string
  titles?: string[]
  gender?: string
  race?: string
  emotion?: string
  appearance?: Appearance
  attrs?: Attributes
  known_infos?: string[]
  goal?: string
  personality?: string
  description?: string
}

/** A relationship to another creature */
export interface Relationship {
  target_id: string
  name: string
  value?: number
  description?: string
}

/** An inventory item */
export interface InventoryItem {
  id: string
  name: string
  count: number
  description?: string
  /** Additional detail lines */
  details?: string[]
  /** Whether the item is currently equipped */
  equipped?: boolean
}

/** Location reference */
export interface LocationRef {
  region_id?: string
  point?: string
}

/** A custom component instance bound to an entity */
export interface CustomComponentInstance {
  component_key: string
  data: unknown
}

/** Custom component data on an entity — array of component instances */
export type CustomComponents = CustomComponentInstance[]

/** Creature entity snapshot */
export interface CreatureSnapshot {
  creature_id: string

  // Core
  creature: CreatureComponent
  /** Whether this creature is the player character */
  is_player?: boolean

  // Auxiliary
  location?: LocationRef
  inventory?: InventoryItem[]
  status_effects?: StatusEffect[]
  custom_components?: CustomComponents
  relationships?: Relationship[]
  bind_setting?: BindSetting
  log?: LogEntry[]
}

// ---------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------

/** A named location within a region */
export interface Location {
  id: string
  name: string
  description: string
}

/** A path / connection between regions */
export interface RegionPath {
  src_location: string
  src_region: string
  discovered: boolean
  to_region: string
  to_location: string
  description: string
}

/** Region core component */
export interface RegionComponent {
  name: string
  description?: string
  /** Named locations within this region */
  locations?: Location[]
  /** Connections to other regions */
  paths?: RegionPath[]
}

/** Region entity snapshot */
export interface RegionSnapshot {
  region_id: string

  // Core
  region: RegionComponent

  // Auxiliary
  metadata?: Metadata
  status_effects?: StatusEffect[]
  bind_setting?: BindSetting
  log?: LogEntry[]
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/** Territory reference */
export interface Territory {
  region_id: string
  location_id: string
}

/** Organization core component */
export interface OrganizationComponent {
  name: string
  description?: string
  /** Territories controlled by this organization */
  territories?: Territory[]
}

/** Organization entity snapshot */
export interface OrganizationSnapshot {
  organization_id: string

  // Core
  organization: OrganizationComponent

  // Auxiliary
  status_effects?: StatusEffect[]
  bind_setting?: BindSetting
  log?: LogEntry[]
}

// ---------------------------------------------------------------------------
// Story & Supplementary
// ---------------------------------------------------------------------------

/** A story history entry */
export interface StoryHistoryEntry {
  turn_id: string
  story: {
    content: unknown
    checkpoint_id?: string
  }
}

/** Initial story / opening scene */
export interface GameInitialStory {
  /** Background story visible to the player */
  background: string
  /** Opening story narration */
  start_story: string
}

/** Wiki / encyclopedia entry */
export type GameWikiEntry =
  | Array<{
      title: string
      content: string
    }>
  | undefined

/** Application metadata */
export interface AppInfo {
  publish_type?: 'EDITOR' | 'NOVEL' | 'INK' | 'TEST' | 'CUSTOM' | 'GALGAME'
}

// ---------------------------------------------------------------------------
// StateData (Root)
// ---------------------------------------------------------------------------

/** The root data structure for the world editor. */
export interface StateData {
  /** World-level state (always required) */
  World: WorldSnapshot
  /** Character list */
  Creatures?: CreatureSnapshot[]
  /** Region list */
  Regions?: RegionSnapshot[]
  /** Organization list */
  Organizations?: OrganizationSnapshot[]
  /** Story history */
  StoryHistory?: StoryHistoryEntry[]
  /** Opening story */
  GameInitialStory?: GameInitialStory
  /** Game encyclopedia */
  GameWikiEntry?: GameWikiEntry
  /** Application metadata */
  AppInfo?: AppInfo
  /** Save format version marker */
  _save_version?: 'v2'
}

// ---------------------------------------------------------------------------
// Entity Type Discriminator
// ---------------------------------------------------------------------------

/** The four entity types managed by the editor */
export type EntityType = 'world' | 'creature' | 'region' | 'organization'

/** Maps entity type to its snapshot type */
export type EntitySnapshotMap = {
  world: WorldSnapshot
  creature: CreatureSnapshot
  region: RegionSnapshot
  organization: OrganizationSnapshot
}

/** Extract the ID field name for a given entity type */
export type EntityIdField<T extends EntityType> =
  T extends 'world' ? 'entity_id' :
  T extends 'creature' ? 'creature_id' :
  T extends 'region' ? 'region_id' :
  T extends 'organization' ? 'organization_id' :
  never
