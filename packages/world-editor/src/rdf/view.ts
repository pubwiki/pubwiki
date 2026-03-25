/**
 * StateDataView — Materializes TripleStore contents into a StateData structure.
 *
 * This is the **read path**: queries triples from the store and builds
 * the structured StateData object that the editor UI binds to.
 *
 * Supports both:
 * - Full materialization (initial load)
 * - Incremental patching (after TripleStore change events)
 */

import type { Triple, TripleStore, ChangeEvent } from '@pubwiki/rdfstore'
import type {
  StateData,
  WorldSnapshot,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  CreatureComponent,
  Appearance,
  RegionComponent,
  OrganizationComponent,
  GameTime,
  SettingDocument,
  InventoryItem,
  Relationship,
  StatusEffect,
  LogEntry,
  CreatureAttrField,
  CustomComponentDef,
  StoryHistoryEntry,
  GameInitialStory,
  GameWikiEntry,
  AppInfo,
  CustomComponents,
  Metadata,
  LocationRef,
  BindSetting,
  DirectorNotes,
  Location,
  RegionPath,
  Territory,
} from '../types/state-data'
import {
  PW_PRED,
  PW_WORLD,
  PWC_PRED,
  PWR_PRED,
  PWO_PRED,
  PWS_PRED,
  PWI_PRED,
  PW_STATUS,
  PW_REGISTRY,
  PW_SCHEMA,
  PW_STORY,
  PW_WIKI,
  PW_APP,
  SUBJECT_PREFIX,
  GRAPH_PREFIX,
  extractEntityId,
  isEntitySubject,
} from './vocabulary'

// ---------------------------------------------------------------------------
// StateDataView
// ---------------------------------------------------------------------------

export class StateDataView {
  private unsubscribe: (() => void) | null = null

  /** Callback invoked when the StateData is updated (for reactive integration). */
  onChange: ((state: StateData) => void) | null = null

  /**
   * Full materialization: query all triples and build the complete StateData.
   * Call this once at load time.
   */
  materialize(store: TripleStore): StateData {
    const allTriples = store.getAll()
    return this.buildStateData(allTriples)
  }

  /**
   * Subscribe to TripleStore change events and incrementally update StateData.
   * Returns the initial materialized state.
   */
  materializeAndSubscribe(store: TripleStore): StateData {
    let state = this.materialize(store)

    this.unsubscribe?.()
    this.unsubscribe = store.on('change', (changes: ChangeEvent[]) => {
      state = this.applyChanges(state, changes, store)
      this.onChange?.(state)
    })

    return state
  }

  /** Stop listening to store changes. */
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  // =========================================================================
  // Full materialization (Triples → StateData)
  // =========================================================================

  buildStateData(triples: Triple[]): StateData {
    // Group triples by subject for efficient access
    const bySubject = new Map<string, Triple[]>()
    for (const t of triples) {
      let arr = bySubject.get(t.subject)
      if (!arr) {
        arr = []
        bySubject.set(t.subject, arr)
      }
      arr.push(t)
    }

    const state: StateData = {
      World: this.materializeWorld(bySubject),
      Creatures: this.materializeCreatures(bySubject),
      Regions: this.materializeRegions(bySubject),
      Organizations: this.materializeOrganizations(bySubject),
      StoryHistory: this.materializeStoryHistory(bySubject),
      _save_version: 'v2',
    }

    // Optional sections
    const initialStory = this.materializeInitialStory(bySubject)
    if (initialStory) state.GameInitialStory = initialStory

    const wiki = this.materializeWiki(bySubject)
    if (wiki) state.GameWikiEntry = wiki

    const appInfo = this.materializeAppInfo(bySubject)
    if (appInfo) state.AppInfo = appInfo

    return state
  }

  // =========================================================================
  // World
  // =========================================================================

  private materializeWorld(bySubject: Map<string, Triple[]>): WorldSnapshot {
    // Find world entity by subject prefix.
    // We do NOT require a pw:type triple for identification because:
    // 1. There is always exactly one world entity (excluding :app and :log: subjects)
    // 2. The type triple may be absent in stores from older sessions where the
    //    diff-based replaceWorld never inserted it (it was identical in old and new).
    let worldId = 'default'
    let worldTriples: Triple[] = []

    for (const [subject, triples] of bySubject) {
      if (subject.startsWith(SUBJECT_PREFIX.world) && !subject.includes(':app') && !subject.includes(':log:')) {
        worldId = extractEntityId(subject, 'world') ?? 'default'
        worldTriples = triples
        break
      }
    }

    const world: WorldSnapshot = {
      entity_id: worldId,
    }

    // Game time
    for (const t of worldTriples) {
      if (t.predicate === PW_WORLD.game_time) {
        try { world.game_time = JSON.parse(String(t.object)) as GameTime } catch { /* ignore */ }
      }
      if (t.predicate === PW_WORLD.director_notes) {
        try { world.director_notes = JSON.parse(String(t.object)) as DirectorNotes } catch { /* ignore */ }
      }
    }

    // Registry fields
    world.registry = this.materializeRegistryFields(worldId, bySubject, worldTriples)

    // Custom component definitions
    world.custom_component_registry = this.materializeCustomComponentDefs(worldId, bySubject, worldTriples)

    // Log
    world.log = this.materializeLogs(worldTriples, PW_WORLD.log_entry, bySubject)

    // Setting documents
    world.bind_setting = this.materializeSettingDocs('world', worldId, bySubject)

    return world
  }

  // =========================================================================
  // Creatures
  // =========================================================================

  private materializeCreatures(bySubject: Map<string, Triple[]>): CreatureSnapshot[] {
    const creatures: Array<{ snapshot: CreatureSnapshot; order: number }> = []

    for (const [subject, triples] of bySubject) {
      if (!isEntitySubject(subject, 'creature')) continue
      const typeTriple = triples.find(t => t.predicate === PW_PRED.type && t.object === 'Creature')
      if (!typeTriple) continue

      const creatureId = extractEntityId(subject, 'creature')!
      const snapshot = this.materializeOneCreature(creatureId, triples, bySubject)
      const orderTriple = triples.find(t => t.predicate === PW_PRED.order)
      creatures.push({ snapshot, order: typeof orderTriple?.object === 'number' ? orderTriple.object : 0 })
    }

    creatures.sort((a, b) => a.order - b.order)
    return creatures.map(c => c.snapshot)
  }

  private materializeOneCreature(
    creatureId: string, triples: Triple[], bySubject: Map<string, Triple[]>
  ): CreatureSnapshot {
    const appearance: Appearance = {}
    const creature: CreatureComponent = { name: '' }
    const location: LocationRef = {}
    const customComponents: CustomComponents = []

    for (const t of triples) {
      switch (t.predicate) {
        case PW_PRED.name: creature.name = String(t.object); break
        case PWC_PRED.gender: creature.gender = String(t.object); break
        case PWC_PRED.race: creature.race = String(t.object); break
        case PWC_PRED.personality: creature.personality = String(t.object); break
        case PW_PRED.description: creature.description = String(t.object); break
        case PWC_PRED.emotion: creature.emotion = String(t.object); break
        case PWC_PRED.goal: creature.goal = String(t.object); break
        case PWC_PRED.organization: creature.organization_id = String(t.object); break
        case PWC_PRED.appearance_body: appearance.body = String(t.object); break
        case PWC_PRED.appearance_clothing: appearance.clothing = String(t.object); break
        case PWC_PRED.titles:
          try { creature.titles = JSON.parse(String(t.object)) } catch { /* ignore */ }
          break
        case PWC_PRED.known_infos:
          try { creature.known_infos = JSON.parse(String(t.object)) } catch { /* ignore */ }
          break
        case PWC_PRED.attrs:
          try { creature.attrs = JSON.parse(String(t.object)) } catch { /* ignore */ }
          break
        case PWC_PRED.location_region: location.region_id = String(t.object); break
        case PWC_PRED.location_point: location.point = String(t.object); break
        default:
          // Custom components: pwc:comp:{componentKey} → JSON data
          if (t.predicate.startsWith(PWC_PRED.custom_component_prefix)) {
            const componentKey = t.predicate.substring(PWC_PRED.custom_component_prefix.length)
            if (componentKey) {
              let data: unknown
              try {
                data = JSON.parse(String(t.object))
              } catch {
                data = t.object
              }
              customComponents.push({ component_key: componentKey, data })
            }
          }
      }
    }

    creature.appearance = appearance

    const snapshot: CreatureSnapshot = {
      creature_id: creatureId,
      creature,
    }

    // Is player
    const isPlayerTriple = triples.find(t => t.predicate === PWC_PRED.is_player)
    if (isPlayerTriple && isPlayerTriple.object === true) snapshot.is_player = true

    // Location
    if (location.region_id || location.point) snapshot.location = location

    // Relationships
    snapshot.relationships = this.materializeRelationships(creatureId, triples, bySubject)

    // Inventory
    snapshot.inventory = this.materializeInventory(creatureId, triples, bySubject)

    // Status effects
    snapshot.status_effects = this.materializeStatusEffects(triples, PWC_PRED.status_effect, bySubject)

    // Custom components
    if (customComponents.length > 0) snapshot.custom_components = customComponents

    // Log
    snapshot.log = this.materializeLogs(triples, PWC_PRED.log_entry, bySubject)

    // Setting documents
    snapshot.bind_setting = this.materializeSettingDocs('creature', creatureId, bySubject)

    return snapshot
  }

  // =========================================================================
  // Regions
  // =========================================================================

  private materializeRegions(bySubject: Map<string, Triple[]>): RegionSnapshot[] {
    const regions: Array<{ snapshot: RegionSnapshot; order: number }> = []

    for (const [subject, triples] of bySubject) {
      if (!isEntitySubject(subject, 'region')) continue
      const typeTriple = triples.find(t => t.predicate === PW_PRED.type && t.object === 'Region')
      if (!typeTriple) continue

      const regionId = extractEntityId(subject, 'region')!
      const snapshot = this.materializeOneRegion(regionId, triples, bySubject)
      const orderTriple = triples.find(t => t.predicate === PW_PRED.order)
      regions.push({ snapshot, order: typeof orderTriple?.object === 'number' ? orderTriple.object : 0 })
    }

    regions.sort((a, b) => a.order - b.order)
    return regions.map(r => r.snapshot)
  }

  private materializeOneRegion(
    regionId: string, triples: Triple[], bySubject: Map<string, Triple[]>
  ): RegionSnapshot {
    const region: RegionComponent = { name: '' }
    let metadata: Metadata | undefined

    for (const t of triples) {
      switch (t.predicate) {
        case PW_PRED.name: region.name = String(t.object); break
        case PW_PRED.description: region.description = String(t.object); break
        case PWR_PRED.locations:
          try { region.locations = JSON.parse(String(t.object)) as Location[] } catch { /* ignore */ }
          break
        case PWR_PRED.paths:
          try { region.paths = JSON.parse(String(t.object)) as RegionPath[] } catch { /* ignore */ }
          break
        case PWR_PRED.metadata_name:
          if (!metadata) metadata = { name: '', desc: '' }
          metadata.name = String(t.object)
          break
        case PWR_PRED.metadata_desc:
          if (!metadata) metadata = { name: '', desc: '' }
          metadata.desc = String(t.object)
          break
      }
    }

    const snapshot: RegionSnapshot = {
      region_id: regionId,
      region,
    }

    if (metadata) snapshot.metadata = metadata
    snapshot.status_effects = this.materializeStatusEffects(triples, PWR_PRED.status_effect, bySubject)
    snapshot.log = this.materializeLogs(triples, PWR_PRED.log_entry, bySubject)
    snapshot.bind_setting = this.materializeSettingDocs('region', regionId, bySubject)

    return snapshot
  }

  // =========================================================================
  // Organizations
  // =========================================================================

  private materializeOrganizations(bySubject: Map<string, Triple[]>): OrganizationSnapshot[] {
    const orgs: Array<{ snapshot: OrganizationSnapshot; order: number }> = []

    for (const [subject, triples] of bySubject) {
      if (!isEntitySubject(subject, 'organization')) continue
      const typeTriple = triples.find(t => t.predicate === PW_PRED.type && t.object === 'Organization')
      if (!typeTriple) continue

      const orgId = extractEntityId(subject, 'organization')!
      const snapshot = this.materializeOneOrganization(orgId, triples, bySubject)
      const orderTriple = triples.find(t => t.predicate === PW_PRED.order)
      orgs.push({ snapshot, order: typeof orderTriple?.object === 'number' ? orderTriple.object : 0 })
    }

    orgs.sort((a, b) => a.order - b.order)
    return orgs.map(o => o.snapshot)
  }

  private materializeOneOrganization(
    orgId: string, triples: Triple[], bySubject: Map<string, Triple[]>
  ): OrganizationSnapshot {
    const org: OrganizationComponent = { name: '' }

    for (const t of triples) {
      switch (t.predicate) {
        case PW_PRED.name: org.name = String(t.object); break
        case PW_PRED.description: org.description = String(t.object); break
        case PWO_PRED.territories:
          try { org.territories = JSON.parse(String(t.object)) as Territory[] } catch { /* ignore */ }
          break
      }
    }

    const snapshot: OrganizationSnapshot = {
      organization_id: orgId,
      organization: org,
    }

    snapshot.status_effects = this.materializeStatusEffects(triples, PWO_PRED.status_effect, bySubject)
    snapshot.log = this.materializeLogs(triples, PWO_PRED.log_entry, bySubject)
    snapshot.bind_setting = this.materializeSettingDocs('org', orgId, bySubject)

    return snapshot
  }

  // =========================================================================
  // Component materializers
  // =========================================================================

  private materializeRelationships(
    _creatureId: string, ownerTriples: Triple[], bySubject: Map<string, Triple[]>
  ): Relationship[] {
    const rels: Relationship[] = []
    for (const t of ownerTriples) {
      if (t.predicate !== PWC_PRED.relationship) continue
      const relSubject = String(t.object)
      const relTriples = bySubject.get(relSubject)
      if (!relTriples) continue

      const rel: Relationship = { target_id: '', name: '' }
      for (const rt of relTriples) {
        if (rt.predicate === PW_PRED.target) {
          // Extract creature ID from "creature:xxx"
          const targetSubject = String(rt.object)
          rel.target_id = targetSubject.startsWith(SUBJECT_PREFIX.creature)
            ? targetSubject.substring(SUBJECT_PREFIX.creature.length)
            : targetSubject
        }
        if (rt.predicate === PW_PRED.name) rel.name = String(rt.object)
        if (rt.predicate === PW_PRED.value) rel.value = Number(rt.object)
        if (rt.predicate === PW_PRED.description) rel.description = String(rt.object)
      }
      rels.push(rel)
    }
    return rels
  }

  private materializeInventory(
    _ownerId: string, ownerTriples: Triple[], bySubject: Map<string, Triple[]>
  ): InventoryItem[] {
    const items: InventoryItem[] = []
    for (const t of ownerTriples) {
      if (t.predicate !== PWC_PRED.inventory_item) continue
      const itemSubject = String(t.object)
      const itemTriples = bySubject.get(itemSubject)
      if (!itemTriples) continue

      const item: InventoryItem = { id: '', name: '', count: 1 }
      for (const it of itemTriples) {
        if (it.predicate === PWI_PRED.item_id) item.id = String(it.object)
        if (it.predicate === PW_PRED.name) item.name = String(it.object)
        if (it.predicate === PWI_PRED.count) item.count = Number(it.object)
        if (it.predicate === PW_PRED.description) item.description = String(it.object)
        if (it.predicate === PWI_PRED.details) {
          try { item.details = JSON.parse(String(it.object)) } catch { /* ignore */ }
        }
        if (it.predicate === PWI_PRED.equipped) item.equipped = Boolean(it.object)
      }
      items.push(item)
    }
    return items
  }

  private materializeStatusEffects(
    ownerTriples: Triple[], linkPredicate: string, bySubject: Map<string, Triple[]>
  ): StatusEffect[] {
    const effects: StatusEffect[] = []
    for (const t of ownerTriples) {
      if (t.predicate !== linkPredicate) continue
      const effectSubject = String(t.object)
      const effectTriples = bySubject.get(effectSubject)
      if (!effectTriples) continue

      // Extract id from subject "se:ownerId_effectId"
      const parts = effectSubject.substring(SUBJECT_PREFIX.status_effect.length).split('_')
      const effectId = parts.length > 1 ? parts.slice(1).join('_') : parts[0] ?? effectSubject

      const effect: StatusEffect = { instance_id: effectId }
      for (const et of effectTriples) {
        if (et.predicate === PW_PRED.name) effect.instance_id = String(et.object)
        if (et.predicate === PW_STATUS.display_name) effect.display_name = String(et.object)
        if (et.predicate === PW_STATUS.remark) effect.remark = String(et.object)
        if (et.predicate === PW_STATUS.data) {
          try { effect.data = JSON.parse(String(et.object)) } catch { effect.data = et.object }
        }
        if (et.predicate === PW_STATUS.add_at) effect.add_at = String(et.object)
        if (et.predicate === PW_STATUS.last_update_at) effect.last_update_at = String(et.object)
      }
      effects.push(effect)
    }
    return effects
  }

  private materializeLogs(
    ownerTriples: Triple[], linkPredicate: string, bySubject: Map<string, Triple[]>
  ): LogEntry[] {
    const entries: Array<{ entry: LogEntry; order: number }> = []
    for (const t of ownerTriples) {
      if (t.predicate !== linkPredicate) continue
      const logSubject = String(t.object)
      const logTriples = bySubject.get(logSubject)
      if (!logTriples) continue

      const entry: LogEntry = { timestamp: '', content: '' }
      let order = 0
      for (const lt of logTriples) {
        if (lt.predicate === PW_STORY.timestamp) entry.timestamp = String(lt.object)
        if (lt.predicate === PW_STORY.content) entry.content = String(lt.object)
        if (lt.predicate === PW_PRED.order) order = Number(lt.object)
      }
      entries.push({ entry, order })
    }
    entries.sort((a, b) => a.order - b.order)
    return entries.map(e => e.entry)
  }

  private materializeSettingDocs(
    entityType: string, entityId: string, bySubject: Map<string, Triple[]>
  ): BindSetting {
    const graphName = `${GRAPH_PREFIX.setting}:${entityType}:${entityId}`
    const docs: Array<{ doc: SettingDocument; order: number }> = []

    for (const [subject, triples] of bySubject) {
      if (!subject.startsWith(SUBJECT_PREFIX.setting_doc)) continue
      // Check if any triple in this subject belongs to our graph
      const inGraph = triples.some(t => t.graph === graphName)
      if (!inGraph) continue

      const doc: SettingDocument = { name: '', content: '' }
      let order = 0
      for (const t of triples) {
        if (t.graph !== graphName) continue
        if (t.predicate === PW_PRED.name) doc.name = String(t.object)
        if (t.predicate === PWS_PRED.content) doc.content = String(t.object)
        if (t.predicate === PWS_PRED.priority) doc.static_priority = Number(t.object)
        if (t.predicate === PWS_PRED.condition) doc.condition = String(t.object)
        if (t.predicate === PWS_PRED.disable) doc.disable = Boolean(t.object)
        if (t.predicate === PW_PRED.order) order = Number(t.object)
      }
      docs.push({ doc, order })
    }

    docs.sort((a, b) => a.order - b.order)
    return { documents: docs.map(d => d.doc) }
  }

  private materializeRegistryFields(
    _worldId: string, bySubject: Map<string, Triple[]>, worldTriples: Triple[]
  ): CreatureAttrField[] {
    const fields: CreatureAttrField[] = []
    for (const t of worldTriples) {
      if (t.predicate !== PW_WORLD.registry_field) continue
      const fieldSubject = String(t.object)
      const fieldTriples = bySubject.get(fieldSubject)
      if (!fieldTriples) continue

      const field: CreatureAttrField = { field_name: '', hint: '' }
      for (const ft of fieldTriples) {
        if (ft.predicate === PW_REGISTRY.field_name) field.field_name = String(ft.object)
        if (ft.predicate === PW_REGISTRY.hint) field.hint = String(ft.object)
        if (ft.predicate === PW_REGISTRY.field_display_name) field.field_display_name = String(ft.object)
      }
      fields.push(field)
    }
    return fields
  }

  private materializeCustomComponentDefs(
    _worldId: string, bySubject: Map<string, Triple[]>, worldTriples: Triple[]
  ): CustomComponentDef[] {
    const defs: CustomComponentDef[] = []
    for (const t of worldTriples) {
      if (t.predicate !== PW_WORLD.custom_schema) continue
      const schemaSubject = String(t.object)
      const schemaTriples = bySubject.get(schemaSubject)
      if (!schemaTriples) continue

      const def: CustomComponentDef = { component_key: '', component_name: '', is_array: false }
      for (const st of schemaTriples) {
        if (st.predicate === PW_SCHEMA.component_key) def.component_key = String(st.object)
        if (st.predicate === PW_PRED.name) def.component_name = String(st.object)
        if (st.predicate === PW_SCHEMA.is_array) def.is_array = st.object === true || st.object === 'true'
        if (st.predicate === PW_SCHEMA.type_schema) {
          try { def.type_schema = JSON.parse(String(st.object)) } catch { /* ignore malformed */ }
        }
        if (st.predicate === PW_SCHEMA.data_registry) {
          try { def.data_registry = JSON.parse(String(st.object)) } catch { /* ignore malformed */ }
        }
      }
      defs.push(def)
    }
    return defs
  }

  // =========================================================================
  // Story / Wiki / AppInfo
  // =========================================================================

  private materializeStoryHistory(bySubject: Map<string, Triple[]>): StoryHistoryEntry[] {
    const entries: Array<{ entry: StoryHistoryEntry; order: number }> = []

    for (const [subject, triples] of bySubject) {
      if (!subject.startsWith(SUBJECT_PREFIX.story)) continue
      const typeTriple = triples.find(t => t.predicate === PW_PRED.type && t.object === 'StoryEntry')
      if (!typeTriple) continue

      const turnId = subject.substring(SUBJECT_PREFIX.story.length)
      const entry: StoryHistoryEntry = { turn_id: turnId, story: { content: '' } }
      let order = 0

      for (const t of triples) {
        if (t.predicate === PW_STORY.content) {
          try { entry.story.content = JSON.parse(String(t.object)) } catch { entry.story.content = String(t.object) }
        }
        if (t.predicate === PW_STORY.checkpoint_id) entry.story.checkpoint_id = String(t.object)
        if (t.predicate === PW_PRED.order) order = Number(t.object)
      }

      entries.push({ entry, order })
    }

    entries.sort((a, b) => a.order - b.order)
    return entries.map(e => e.entry)
  }

  private materializeInitialStory(bySubject: Map<string, Triple[]>): GameInitialStory | undefined {
    const subject = `${SUBJECT_PREFIX.story}initial`
    const triples = bySubject.get(subject)
    if (!triples) return undefined

    let background = ''
    let start_story = ''

    for (const t of triples) {
      if (t.predicate === PW_STORY.initial_background) background = String(t.object)
      if (t.predicate === PW_STORY.initial_start_story) start_story = String(t.object)
    }

    if (!background && !start_story) return undefined
    return { background, start_story }
  }

  private materializeWiki(bySubject: Map<string, Triple[]>): GameWikiEntry | undefined {
    const wikiRoot = `${SUBJECT_PREFIX.wiki}root`
    const rootTriples = bySubject.get(wikiRoot)
    if (!rootTriples) return undefined

    const entries: Array<{ entry: { title: string; content: string }; order: number }> = []

    for (const t of rootTriples) {
      if (t.predicate !== PW_WIKI.entry) continue
      const entrySubject = String(t.object)
      const entryTriples = bySubject.get(entrySubject)
      if (!entryTriples) continue

      const entry = { title: '', content: '' }
      let order = 0
      for (const et of entryTriples) {
        if (et.predicate === PW_WIKI.title) entry.title = String(et.object)
        if (et.predicate === PW_WIKI.content) entry.content = String(et.object)
        if (et.predicate === PW_PRED.order) order = Number(et.object)
      }
      entries.push({ entry, order })
    }

    entries.sort((a, b) => a.order - b.order)
    if (entries.length === 0) return undefined
    return entries.map(e => e.entry)
  }

  private materializeAppInfo(bySubject: Map<string, Triple[]>): AppInfo | undefined {
    const subject = `${SUBJECT_PREFIX.world}app`
    const triples = bySubject.get(subject)
    if (!triples) return undefined

    const info: AppInfo = {}
    for (const t of triples) {
      if (t.predicate === PW_APP.publish_type) info.publish_type = String(t.object) as AppInfo['publish_type']
    }

    if (!info.publish_type) return undefined
    return info
  }

  // =========================================================================
  // Incremental updates
  // =========================================================================

  /**
   * Apply a batch of ChangeEvents to the existing StateData.
   * For now, this does a full re-materialization. Phase 3 will optimize
   * this to targeted path patching.
   */
  applyChanges(_current: StateData, _changes: ChangeEvent[], store: TripleStore): StateData {
    // Phase 1: full re-materialization on any change
    // Phase 3 will implement surgical patching based on the changed subjects
    return this.materialize(store)
  }
}
