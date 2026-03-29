/**
 * Structured game entity types for @pubwiki/game-ui.
 *
 * These types match the data returned by backend ECS query services
 * (state:GetStateFromGame, ecs.system:Query.*, watch:* services).
 *
 * The naming follows the backend's component-based ECS convention:
 * each entity snapshot contains a set of named components.
 */

// ============================================================================
// Common Components
// ============================================================================

export interface Appearance {
  body?: string
  clothing?: string
}

export interface InventoryItem {
  id: string
  name: string
  count: number
  description?: string
  details?: string[]
  equipped?: boolean
}

export interface StatusEffect {
  instance_id: string
  display_name?: string
  remark?: string
  data?: unknown
  add_at?: string
  last_update_at?: string
}

export interface LocationRef {
  region_id?: string
  location_id?: string
}

export interface CustomComponentInstance {
  component_key: string
  data: unknown
}

export interface SettingDocument {
  name: string
  content: string
  static_priority?: number
  condition?: string
  disable?: boolean
}

export interface LogEntry {
  content: string
  add_at: string
}

export interface InteractionOption {
  id: string
  title: string
  usage?: string
  instruction: string
  memo?: string
}

export interface Interaction {
  options: InteractionOption[]
}

// ============================================================================
// Creature Entity (Player & NPC)
// ============================================================================

/** Core creature component — identity, personality, and attributes */
export interface CreatureComponent {
  creature_id: string
  name: string
  organization_id?: string
  titles?: string[]
  gender?: string
  race?: string
  emotion?: string
  appearance?: Appearance
  attrs?: Record<string, number | string>
  known_infos?: string[]
  goal?: string
  personality?: string
  description?: string
}

/** Full creature entity snapshot as returned by ECS query services */
export interface CreatureEntity {
  entity_id: number | string
  Creature: CreatureComponent
  IsPlayer?: Record<string, unknown>
  LocationRef?: LocationRef
  Inventory?: { items: InventoryItem[] }
  StatusEffects?: { status_effects: StatusEffect[] }
  CustomComponents?: { custom_components: CustomComponentInstance[] }
  Log?: { entries: LogEntry[] }
  BindSetting?: { documents: SettingDocument[] }
  Interaction?: Interaction
}

// ============================================================================
// Region Entity
// ============================================================================

export interface RegionLocation {
  id: string
  name: string
  description: string
}

export interface RegionPath {
  src_location: string
  src_region: string
  discovered: boolean
  to_region: string
  to_location: string
  description: string
}

export interface RegionComponent {
  region_id: string
  region_name: string
  description?: string
  locations?: RegionLocation[]
  paths?: RegionPath[]
}

export interface RegionEntity {
  entity_id: number | string
  Region: RegionComponent
  Metadata?: { name: string; desc: string }
  StatusEffects?: { status_effects: StatusEffect[] }
  Log?: { entries: LogEntry[] }
  BindSetting?: { documents: SettingDocument[] }
  Interaction?: Interaction
}

// ============================================================================
// Organization Entity
// ============================================================================

export interface Territory {
  region_id: string
  location_id: string
}

export interface OrganizationComponent {
  organization_id: string
  name: string
  description?: string
  territories?: Territory[]
}

export interface OrganizationEntity {
  entity_id: number | string
  Organization: OrganizationComponent
  StatusEffects?: { status_effects: StatusEffect[] }
  Log?: { entries: LogEntry[] }
  BindSetting?: { documents: SettingDocument[] }
  Interaction?: Interaction
}

// ============================================================================
// World Entity
// ============================================================================

export interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export interface CreatureAttrField {
  field_name: string
  hint: string
  field_display_name?: string
}

export interface CustomComponentDef {
  component_key: string
  component_name: string
  is_array: boolean
  type_schema?: unknown
  data_registry?: Array<{ item_id: string; data: unknown }>
}

export interface DirectorNotes {
  notes: string[]
  flags: Record<string, { id: string; value: boolean; remark?: string }>
  stage_goal?: string | null
}

export interface EventEntry {
  event_id: string
  title: string
  summary: string
  content: string
  related_entities?: string[]
  created_at?: string
  updated_at?: string
}

export interface BaseInteraction {
  creature_options: InteractionOption[]
  region_options: InteractionOption[]
  organization_options: InteractionOption[]
}

export interface WorldSnapshot {
  entity_id?: number | string
  GameTime?: GameTime
  Registry?: { creature_attr_fields?: CreatureAttrField[] }
  CustomComponentRegistry?: { custom_components: CustomComponentDef[] }
  DirectorNotes?: DirectorNotes
  Events?: { events: EventEntry[] }
  Log?: { entries: LogEntry[] }
  BindSetting?: { documents: SettingDocument[] }
  Interaction?: Interaction
  BaseInteraction?: BaseInteraction
}

// ============================================================================
// Watch Service Callback Types
// ============================================================================

/** Callback data from watch:Creatures */
export interface WatchCreaturesEvent {
  type: 'snapshot' | 'changes'
  added?: string[]
  deleted?: string[]
  modified?: string[]
  data: {
    player: CreatureEntity | null
    npcs: CreatureEntity[]
  }
}

/** Callback data from watch:Player */
export interface WatchPlayerEvent {
  type: 'snapshot' | 'changes'
  change?: 'added' | 'deleted' | 'modified'
  data: CreatureEntity | null
}

/** Callback data from watch:Regions */
export interface WatchRegionsEvent {
  type: 'snapshot' | 'changes'
  added?: string[]
  deleted?: string[]
  modified?: string[]
  data: {
    regions: RegionEntity[]
  }
}

/** Callback data from watch:Organizations */
export interface WatchOrganizationsEvent {
  type: 'snapshot' | 'changes'
  added?: string[]
  deleted?: string[]
  modified?: string[]
  data: {
    organizations: OrganizationEntity[]
  }
}

/** Callback data from watch:World */
export interface WatchWorldEvent {
  type: 'snapshot' | 'changes'
  changed_aspects?: string[]
  data: {
    World: WorldSnapshot
    StoryHistory?: unknown[]
    GameInitialStory?: { background: string; start_story: string }
    GameWikiEntry?: Array<{ title: string; content: string }>
    AppInfo?: { publish_type?: string }
    GameInitChoice?: unknown
  }
}

/** Callback data from watch:State */
export interface WatchStateEvent {
  type: 'snapshot' | 'changes'
  changed_categories?: string[]
  data: {
    World: WorldSnapshot
    Creatures?: CreatureEntity[]
    Regions?: RegionEntity[]
    Organizations?: OrganizationEntity[]
    StoryHistory?: unknown[]
    GameInitialStory?: { background: string; start_story: string }
    GameWikiEntry?: Array<{ title: string; content: string }>
    AppInfo?: { publish_type?: string }
    GameInitChoice?: unknown
  }
}
