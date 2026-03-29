/**
 * RDF Vocabulary constants for the game-sdk.
 *
 * Mirrors the predicates defined in @pubwiki/world-editor rdf/vocabulary.ts
 * and the Lua-side rdf.lua. Game frontend developers use these constants
 * to query triple fields without hardcoding predicate strings.
 */

// ---------------------------------------------------------------------------
// Subject prefixes
// ---------------------------------------------------------------------------

export const SUBJECT = {
  world: 'world:',
  creature: 'creature:',
  region: 'region:',
  organization: 'org:',
  inventory: 'inv:',
  status_effect: 'se:',
  setting_doc: 'doc:',
  story: 'story:',
  wiki: 'wiki:',
} as const

// ---------------------------------------------------------------------------
// Named Graphs
// ---------------------------------------------------------------------------

export const GRAPH = {
  world: 'graph:world',
  creature: 'graph:creature',
  region: 'graph:region',
  organization: 'graph:org',
  setting: 'graph:setting',
  story: 'graph:story',
  app: 'graph:app',
} as const

// ---------------------------------------------------------------------------
// Namespace prefixes
// ---------------------------------------------------------------------------

const PW = 'pw:' as const
const PWC = 'pwc:' as const
const PWR = 'pwr:' as const
const PWO = 'pwo:' as const
const PWS = 'pws:' as const
const PWI = 'pwi:' as const

// ---------------------------------------------------------------------------
// Core predicates (pw:)
// ---------------------------------------------------------------------------

export const PW_PRED = {
  type: `${PW}type`,
  name: `${PW}name`,
  description: `${PW}description`,
  target: `${PW}target`,
  value: `${PW}value`,
  order: `${PW}order`,
} as const

// ---------------------------------------------------------------------------
// World predicates
// ---------------------------------------------------------------------------

export const PW_WORLD = {
  game_time: `${PW}gameTime`,
  director_notes: `${PW}directorNotes`,
  registry_field: `${PW}registryField`,
  custom_schema: `${PW}customSchema`,
  log_entry: `${PW}logEntry`,
  setting_doc: `${PW}settingDoc`,
  events: `${PW}events`,
  interaction: `${PW}interaction`,
  base_interaction: `${PW}baseInteraction`,
} as const

// ---------------------------------------------------------------------------
// Creature predicates (pwc:)
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
  location_region: `${PWC}locationRegion`,
  location_point: `${PWC}locationPoint`,
  inventory_item: `${PWC}inventoryItem`,
  status_effect: `${PWC}statusEffect`,
  custom_component_prefix: `${PWC}comp:`,
  setting_doc: `${PWC}settingDoc`,
  log_entry: `${PWC}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Region predicates (pwr:)
// ---------------------------------------------------------------------------

export const PWR_PRED = {
  locations: `${PWR}locations`,
  paths: `${PWR}paths`,
  metadata_name: `${PWR}metadataName`,
  metadata_desc: `${PWR}metadataDesc`,
  status_effect: `${PWR}statusEffect`,
  setting_doc: `${PWR}settingDoc`,
  log_entry: `${PWR}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Organization predicates (pwo:)
// ---------------------------------------------------------------------------

export const PWO_PRED = {
  territories: `${PWO}territories`,
  status_effect: `${PWO}statusEffect`,
  setting_doc: `${PWO}settingDoc`,
  log_entry: `${PWO}logEntry`,
} as const

// ---------------------------------------------------------------------------
// Setting document predicates (pws:)
// ---------------------------------------------------------------------------

export const PWS_PRED = {
  content: `${PWS}content`,
  priority: `${PWS}priority`,
  condition: `${PWS}condition`,
  disable: `${PWS}disable`,
} as const

// ---------------------------------------------------------------------------
// Inventory item predicates (pwi:)
// ---------------------------------------------------------------------------

export const PWI_PRED = {
  item_id: `${PWI}id`,
  count: `${PWI}count`,
  equipped: `${PWI}equipped`,
  details: `${PWI}details`,
} as const

// ---------------------------------------------------------------------------
// Status effect predicates
// ---------------------------------------------------------------------------

export const PW_STATUS = {
  display_name: `${PW}statusDisplayName`,
  remark: `${PW}statusRemark`,
  data: `${PW}statusData`,
  add_at: `${PW}statusAddAt`,
  last_update_at: `${PW}statusLastUpdateAt`,
} as const

// ---------------------------------------------------------------------------
// Story predicates
// ---------------------------------------------------------------------------

export const PW_STORY = {
  content: `${PW}storyContent`,
  timestamp: `${PW}storyTimestamp`,
  checkpoint_id: `${PW}storyCheckpointId`,
  initial_background: `${PW}initialBackground`,
  initial_start_story: `${PW}initialStartStory`,
  game_init_choice: `${PW}gameInitChoice`,
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Known JSON-serialized predicates — values are stored as strings and need JSON.parse() */
export const JSON_PREDICATES: ReadonlySet<string> = new Set([
  PW_WORLD.game_time,
  PW_WORLD.director_notes,
  PW_WORLD.events,
  PW_WORLD.interaction,
  PW_WORLD.base_interaction,
  PWC_PRED.titles,
  PWC_PRED.known_infos,
  PWC_PRED.attrs,
  PWR_PRED.locations,
  PWR_PRED.paths,
  PWO_PRED.territories,
  PWI_PRED.details,
  PW_STATUS.data,
  PW_STORY.content,
  PW_STORY.game_init_choice,
])

/** Extract the pure entity ID from a subject URI (e.g. "creature:npc_01" → "npc_01") */
export function extractId(subject: string): string {
  const idx = subject.indexOf(':')
  return idx === -1 ? subject : subject.substring(idx + 1)
}

/** Extract the subject prefix (e.g. "creature:npc_01" → "creature:") */
export function subjectPrefix(subject: string): string {
  const idx = subject.indexOf(':')
  return idx === -1 ? '' : subject.substring(0, idx + 1)
}
