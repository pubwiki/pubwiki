/**
 * RDF Vocabulary — Namespace and predicate definitions for the world editor.
 *
 * Defines the mapping between StateData fields and RDF predicates.
 * All subjects use the pattern "{type}:{id}" (e.g. "creature:npc_01").
 * Auxiliary resources use compound IDs (e.g. "rel:npc_01_npc_02", "inv:npc_01_sword").
 */

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

/** PubWiki core namespace */
export const PW = 'pw:' as const

/** Creature namespace */
export const PWC = 'pwc:' as const

/** Region namespace */
export const PWR = 'pwr:' as const

/** Organization namespace */
export const PWO = 'pwo:' as const

/** Setting document namespace */
export const PWS = 'pws:' as const

/** Item namespace */
export const PWI = 'pwi:' as const

// ---------------------------------------------------------------------------
// Subject prefixes
// ---------------------------------------------------------------------------

export const SUBJECT_PREFIX = {
  world: 'world:',
  creature: 'creature:',
  region: 'region:',
  organization: 'org:',
  relationship: 'rel:',
  inventory: 'inv:',
  status_effect: 'se:',
  setting_doc: 'doc:',
  story: 'story:',
  wiki: 'wiki:',
  registry_field: 'regfield:',
  custom_schema: 'cschema:',
} as const

// ---------------------------------------------------------------------------
// Graph prefixes (Named Graphs)
// ---------------------------------------------------------------------------

export const GRAPH_PREFIX = {
  /** World-level data */
  world: 'graph:world',
  /** Creature data for an artifact */
  creature: 'graph:creature',
  /** Region data for an artifact */
  region: 'graph:region',
  /** Organization data for an artifact */
  organization: 'graph:org',
  /** Setting documents */
  setting: 'graph:setting',
  /** Story and narrative data */
  story: 'graph:story',
  /** App metadata */
  app: 'graph:app',
} as const

// ---------------------------------------------------------------------------
// Predicates — Core (pw:)
// ---------------------------------------------------------------------------

/** Core predicates shared across entity types */
export const PW_PRED = {
  /** Entity type discriminator */
  type: `${PW}type`,
  /** Display name */
  name: `${PW}name`,
  /** Description */
  description: `${PW}description`,
  /** Relationship target */
  target: `${PW}target`,
  /** Numeric value (generic) */
  value: `${PW}value`,
  /** Ordering index for list membership */
  order: `${PW}order`,
} as const

// ---------------------------------------------------------------------------
// Predicates — World
// ---------------------------------------------------------------------------

export const PW_WORLD = {
  game_time: `${PW}gameTime`,
  director_notes: `${PW}directorNotes`,
  /** Links to a registry field subject */
  registry_field: `${PW}registryField`,
  /** Links to a custom component schema subject */
  custom_schema: `${PW}customSchema`,
  /** Links to a log entry */
  log_entry: `${PW}logEntry`,
  /** Links to a setting document */
  setting_doc: `${PW}settingDoc`,
  /** Events component (JSON-serialized) */
  events: `${PW}events`,
  /** Interaction options (JSON-serialized) */
  interaction: `${PW}interaction`,
  /** Base interaction options (JSON-serialized, World only) */
  base_interaction: `${PW}baseInteraction`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Creature (pwc:)
// ---------------------------------------------------------------------------

export const PWC_PRED = {
  gender: `${PWC}gender`,
  race: `${PWC}race`,
  titles: `${PWC}titles`,
  emotion: `${PWC}emotion`,
  appearance_body: `${PWC}appearanceBody`,
  appearance_clothing: `${PWC}appearanceClothing`,
  attrs: `${PWC}attrs`,
  known_infos: `${PWC}knownInfos`,
  goal: `${PWC}goal`,
  personality: `${PWC}personality`,
  is_player: `${PWC}isPlayer`,
  organization: `${PWC}organization`,
  /** Location region reference */
  location_region: `${PWC}locationRegion`,
  /** Location point name */
  location_point: `${PWC}locationPoint`,
  /** Links to a relationship subject */
  relationship: `${PWC}relationship`,
  /** Links to an inventory item subject */
  inventory_item: `${PWC}inventoryItem`,
  /** Links to a status effect subject */
  status_effect: `${PWC}statusEffect`,
  /** Custom component value: pwc:comp:{component_name}:{field_name} */
  custom_component_prefix: `${PWC}comp:`,
  /** Links to a setting document */
  setting_doc: `${PWC}settingDoc`,
  /** Links to a log entry */
  log_entry: `${PWC}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Region (pwr:)
// ---------------------------------------------------------------------------

export const PWR_PRED = {
  /** Locations (serialized as JSON) */
  locations: `${PWR}locations`,
  /** Paths (serialized as JSON) */
  paths: `${PWR}paths`,
  /** Metadata name */
  metadata_name: `${PWR}metadataName`,
  /** Metadata desc */
  metadata_desc: `${PWR}metadataDesc`,
  status_effect: `${PWR}statusEffect`,
  setting_doc: `${PWR}settingDoc`,
  log_entry: `${PWR}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Organization (pwo:)
// ---------------------------------------------------------------------------

export const PWO_PRED = {
  territories: `${PWO}territories`,
  status_effect: `${PWO}statusEffect`,
  setting_doc: `${PWO}settingDoc`,
  log_entry: `${PWO}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Setting Document (pws:)
// ---------------------------------------------------------------------------

export const PWS_PRED = {
  content: `${PWS}content`,
  priority: `${PWS}priority`,
  condition: `${PWS}condition`,
  disable: `${PWS}disable`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Inventory Item (pwi:)
// ---------------------------------------------------------------------------

export const PWI_PRED = {
  item_id: `${PWI}id`,
  count: `${PWI}count`,
  equipped: `${PWI}equipped`,
  details: `${PWI}details`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Status Effect
// ---------------------------------------------------------------------------

export const PW_STATUS = {
  display_name: `${PW}statusDisplayName`,
  remark: `${PW}statusRemark`,
  data: `${PW}statusData`,
  add_at: `${PW}statusAddAt`,
  last_update_at: `${PW}statusLastUpdateAt`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Registry Field
// ---------------------------------------------------------------------------

export const PW_REGISTRY = {
  field_name: `${PW}fieldName`,
  hint: `${PW}fieldHint`,
  field_display_name: `${PW}fieldDisplayName`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Custom Component Schema
// ---------------------------------------------------------------------------

export const PW_SCHEMA = {
  /** Links to fields of the schema */
  field: `${PW}schemaField`,
  /** Component key identifier */
  component_key: `${PW}componentKey`,
  /** Whether the component is an array (multiple instances) */
  is_array: `${PW}isArray`,
  /** JSON Schema for the component data (serialized as JSON string) */
  type_schema: `${PW}typeSchema`,
  /** Pre-populated data registry (serialized as JSON string) */
  data_registry: `${PW}dataRegistry`,
  /** Component data (serialized as JSON string) */
  component_data: `${PW}componentData`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Story
// ---------------------------------------------------------------------------

export const PW_STORY = {
  content: `${PW}storyContent`,
  timestamp: `${PW}storyTimestamp`,
  checkpoint_id: `${PW}storyCheckpointId`,
  initial_background: `${PW}initialBackground`,
  initial_start_story: `${PW}initialStartStory`,
  /** Game init choice configuration (JSON-serialized) */
  game_init_choice: `${PW}gameInitChoice`,
} as const

// ---------------------------------------------------------------------------
// Predicates — Wiki
// ---------------------------------------------------------------------------

export const PW_WIKI = {
  title: `${PW}wikiTitle`,
  content: `${PW}wikiContent`,
  category: `${PW}wikiCategory`,
  /** Links from wiki root to entries */
  entry: `${PW}wikiEntry`,
} as const

// ---------------------------------------------------------------------------
// Predicates — AppInfo
// ---------------------------------------------------------------------------

export const PW_APP = {
  publish_type: `${PW}publishType`,
} as const

// ---------------------------------------------------------------------------
// Subject construction helpers
// ---------------------------------------------------------------------------

/** Build a subject URI for an entity */
export function entitySubject(type: 'world' | 'creature' | 'region' | 'organization', id: string): string {
  return `${SUBJECT_PREFIX[type]}${id}`
}

/** Build a subject for a relationship between two creatures */
export function relationshipSubject(fromId: string, toId: string): string {
  return `${SUBJECT_PREFIX.relationship}${fromId}_${toId}`
}

/** Build a subject for an inventory item */
export function inventorySubject(ownerId: string, itemId: string): string {
  return `${SUBJECT_PREFIX.inventory}${ownerId}_${itemId}`
}

/** Build a subject for a status effect */
export function statusEffectSubject(ownerId: string, effectId: string): string {
  return `${SUBJECT_PREFIX.status_effect}${ownerId}_${effectId}`
}

/** Build a subject for a setting document */
export function settingDocSubject(ownerId: string, docName: string): string {
  // Normalize name to be URI-safe
  const safe = docName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return `${SUBJECT_PREFIX.setting_doc}${ownerId}_${safe}`
}

/** Build a subject for a registry field */
export function registryFieldSubject(worldId: string, fieldName: string): string {
  const safe = fieldName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return `${SUBJECT_PREFIX.registry_field}${worldId}_${safe}`
}

/** Build a subject for a custom component schema */
export function customSchemaSubject(worldId: string, schemaName: string): string {
  const safe = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return `${SUBJECT_PREFIX.custom_schema}${worldId}_${safe}`
}

/** Build a graph name for setting documents bound to a specific entity */
export function settingGraph(entityType: string, entityId: string): string {
  return `${GRAPH_PREFIX.setting}:${entityType}:${entityId}`
}

// ---------------------------------------------------------------------------
// Subject parsing helpers
// ---------------------------------------------------------------------------

/** Parse a subject to extract its type prefix and ID */
export function parseSubject(subject: string): { prefix: string; id: string } | null {
  const colonIdx = subject.indexOf(':')
  if (colonIdx === -1) return null
  return {
    prefix: subject.substring(0, colonIdx + 1),
    id: subject.substring(colonIdx + 1),
  }
}

/** Check whether a subject belongs to a specific entity type */
export function isEntitySubject(subject: string, type: 'world' | 'creature' | 'region' | 'organization'): boolean {
  return subject.startsWith(SUBJECT_PREFIX[type])
}

/** Extract entity ID from a typed subject (e.g. "creature:npc_01" → "npc_01") */
export function extractEntityId(subject: string, type: 'world' | 'creature' | 'region' | 'organization'): string | null {
  const prefix = SUBJECT_PREFIX[type]
  if (!subject.startsWith(prefix)) return null
  return subject.substring(prefix.length)
}
