/**
 * TripleTranslator — Translates structured editor operations into triple operations.
 *
 * This is the **write path**: UI edits and AI tool calls produce TripleOperations,
 * which are then applied to the TripleStore (the single source of truth).
 *
 * The translator also handles full StateData → Triple bulk conversion for import.
 */

import type { Triple, Value } from '@pubwiki/rdfstore'
import type {
  StateData,
  WorldSnapshot,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  SettingDocument,
  StatusEffect,
  InventoryItem,
  Relationship,
  LogEntry,
  CreatureAttrField,
  CustomComponentDef,
  StoryHistoryEntry,
  GameInitialStory,
  GameWikiEntry,
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
  entitySubject,
  relationshipSubject,
  inventorySubject,
  statusEffectSubject,
  settingDocSubject,
  registryFieldSubject,
  customSchemaSubject,
  settingGraph,
} from './vocabulary'

// ---------------------------------------------------------------------------
// Triple Operation Types
// ---------------------------------------------------------------------------

export interface InsertOp {
  op: 'insert'
  subject: string
  predicate: string
  object: Value
  graph?: string
}

export interface DeleteOp {
  op: 'delete'
  subject: string
  predicate: string
  object?: Value
  graph?: string
}

export interface SetOp {
  op: 'set'
  subject: string
  predicate: string
  object: Value
  graph?: string
}

export type TripleOperation = InsertOp | DeleteOp | SetOp

// ---------------------------------------------------------------------------
// TripleTranslator
// ---------------------------------------------------------------------------

export class TripleTranslator {

  // =========================================================================
  // Full StateData → Triples (bulk import)
  // =========================================================================

  /** Convert an entire StateData to a flat list of triples for bulk import. */
  stateDataToTriples(state: StateData): Triple[] {
    const triples: Triple[] = []

    // World
    this.worldToTriples(state.World, triples)

    // Creatures
    for (const [i, c] of (state.Creatures ?? []).entries()) {
      this.creatureToTriples(c, i, triples)
    }

    // Regions
    for (const [i, r] of (state.Regions ?? []).entries()) {
      this.regionToTriples(r, i, triples)
    }

    // Organizations
    for (const [i, o] of (state.Organizations ?? []).entries()) {
      this.organizationToTriples(o, i, triples)
    }

    // Story history
    for (const [i, entry] of (state.StoryHistory ?? []).entries()) {
      this.storyEntryToTriples(entry, i, triples)
    }

    // Initial story
    if (state.GameInitialStory) {
      const s = `${SUBJECT_PREFIX.story}initial`
      triples.push({ subject: s, predicate: PW_STORY.initial_background, object: state.GameInitialStory.background, graph: GRAPH_PREFIX.story })
      triples.push({ subject: s, predicate: PW_STORY.initial_start_story, object: state.GameInitialStory.start_story, graph: GRAPH_PREFIX.story })
    }

    // Wiki
    if (state.GameWikiEntry && Array.isArray(state.GameWikiEntry)) {
      const wikiRoot = `${SUBJECT_PREFIX.wiki}root`
      for (const [i, entry] of state.GameWikiEntry.entries()) {
        const ws = `${SUBJECT_PREFIX.wiki}entry_${i}`
        triples.push({ subject: wikiRoot, predicate: PW_WIKI.entry, object: ws, graph: GRAPH_PREFIX.story })
        triples.push({ subject: ws, predicate: PW_PRED.order, object: i, graph: GRAPH_PREFIX.story })
        triples.push({ subject: ws, predicate: PW_WIKI.title, object: entry.title, graph: GRAPH_PREFIX.story })
        triples.push({ subject: ws, predicate: PW_WIKI.content, object: entry.content, graph: GRAPH_PREFIX.story })
      }
    }

    // AppInfo
    if (state.AppInfo) {
      const s = `${SUBJECT_PREFIX.world}app`
      if (state.AppInfo.publish_type) triples.push({ subject: s, predicate: PW_APP.publish_type, object: state.AppInfo.publish_type, graph: GRAPH_PREFIX.app })
    }

    return triples
  }

  // =========================================================================
  // Entity-level triple generation (private helpers)
  // =========================================================================

  private worldToTriples(world: WorldSnapshot, out: Triple[]): void {
    const s = entitySubject('world', world.entity_id)
    const g = GRAPH_PREFIX.world

    out.push({ subject: s, predicate: PW_PRED.type, object: 'World', graph: g })

    if (world.game_time) {
      out.push({ subject: s, predicate: PW_WORLD.game_time, object: JSON.stringify(world.game_time), graph: g })
    }

    if (world.director_notes) {
      out.push({ subject: s, predicate: PW_WORLD.director_notes, object: JSON.stringify(world.director_notes), graph: g })
    }

    // Registry fields
    for (const field of world.registry ?? []) {
      this.registryFieldToTriples(world.entity_id, field, out, g)
    }

    // Custom component definitions
    for (const def of world.custom_component_registry ?? []) {
      this.customComponentDefToTriples(world.entity_id, def, out, g)
    }

    // Log
    this.logToTriples(s, world.log, out, g, PW_WORLD.log_entry)

    // Setting documents
    this.settingDocsToTriples(s, 'world', world.entity_id, world.bind_setting?.documents, out)
  }

  private creatureToTriples(creature: CreatureSnapshot, order: number, out: Triple[]): void {
    const s = entitySubject('creature', creature.creature_id)
    const g = GRAPH_PREFIX.creature

    out.push({ subject: s, predicate: PW_PRED.type, object: 'Creature', graph: g })
    out.push({ subject: s, predicate: PW_PRED.name, object: creature.creature.name, graph: g })
    out.push({ subject: s, predicate: PW_PRED.order, object: order, graph: g })

    if (creature.creature.gender) out.push({ subject: s, predicate: PWC_PRED.gender, object: creature.creature.gender, graph: g })
    if (creature.creature.race) out.push({ subject: s, predicate: PWC_PRED.race, object: creature.creature.race, graph: g })
    if (creature.creature.personality) out.push({ subject: s, predicate: PWC_PRED.personality, object: creature.creature.personality, graph: g })
    if (creature.creature.description) out.push({ subject: s, predicate: PW_PRED.description, object: creature.creature.description, graph: g })
    if (creature.creature.emotion) out.push({ subject: s, predicate: PWC_PRED.emotion, object: creature.creature.emotion, graph: g })
    if (creature.creature.goal) out.push({ subject: s, predicate: PWC_PRED.goal, object: creature.creature.goal, graph: g })
    if (creature.creature.organization_id) out.push({ subject: s, predicate: PWC_PRED.organization, object: creature.creature.organization_id, graph: g })

    // Array fields serialized as JSON
    if (creature.creature.titles && creature.creature.titles.length > 0) {
      out.push({ subject: s, predicate: PWC_PRED.titles, object: JSON.stringify(creature.creature.titles), graph: g })
    }
    if (creature.creature.known_infos && creature.creature.known_infos.length > 0) {
      out.push({ subject: s, predicate: PWC_PRED.known_infos, object: JSON.stringify(creature.creature.known_infos), graph: g })
    }
    if (creature.creature.attrs && Object.keys(creature.creature.attrs).length > 0) {
      out.push({ subject: s, predicate: PWC_PRED.attrs, object: JSON.stringify(creature.creature.attrs), graph: g })
    }

    // Appearance
    if (creature.creature.appearance) {
      if (creature.creature.appearance.body) out.push({ subject: s, predicate: PWC_PRED.appearance_body, object: creature.creature.appearance.body, graph: g })
      if (creature.creature.appearance.clothing) out.push({ subject: s, predicate: PWC_PRED.appearance_clothing, object: creature.creature.appearance.clothing, graph: g })
    }

    if (creature.is_player) out.push({ subject: s, predicate: PWC_PRED.is_player, object: true, graph: g })

    // Location
    if (creature.location) {
      if (creature.location.region_id) out.push({ subject: s, predicate: PWC_PRED.location_region, object: creature.location.region_id, graph: g })
      if (creature.location.point) out.push({ subject: s, predicate: PWC_PRED.location_point, object: creature.location.point, graph: g })
    }

    // Relationships
    for (const rel of creature.relationships ?? []) {
      this.relationshipToTriples(creature.creature_id, rel, out, g)
    }

    // Inventory
    for (const item of creature.inventory ?? []) {
      this.inventoryItemToTriples(creature.creature_id, item, out, g)
    }

    // Status effects
    for (const effect of creature.status_effects ?? []) {
      this.statusEffectToTriples(s, creature.creature_id, effect, out, g, PWC_PRED.status_effect)
    }

    // Custom components (array of { component_key, data })
    if (creature.custom_components) {
      for (const comp of creature.custom_components) {
        out.push({
          subject: s,
          predicate: `${PWC_PRED.custom_component_prefix}${comp.component_key}`,
          object: JSON.stringify(comp.data),
          graph: g,
        })
      }
    }

    // Log
    this.logToTriples(s, creature.log, out, g, PWC_PRED.log_entry)

    // Setting documents
    this.settingDocsToTriples(s, 'creature', creature.creature_id, creature.bind_setting?.documents, out)
  }

  private regionToTriples(region: RegionSnapshot, order: number, out: Triple[]): void {
    const s = entitySubject('region', region.region_id)
    const g = GRAPH_PREFIX.region

    out.push({ subject: s, predicate: PW_PRED.type, object: 'Region', graph: g })
    out.push({ subject: s, predicate: PW_PRED.name, object: region.region.name, graph: g })
    out.push({ subject: s, predicate: PW_PRED.order, object: order, graph: g })

    if (region.region.description) {
      out.push({ subject: s, predicate: PW_PRED.description, object: region.region.description, graph: g })
    }

    // Locations (serialized as JSON)
    if (region.region.locations && region.region.locations.length > 0) {
      out.push({ subject: s, predicate: PWR_PRED.locations, object: JSON.stringify(region.region.locations), graph: g })
    }

    // Paths (serialized as JSON)
    if (region.region.paths && region.region.paths.length > 0) {
      out.push({ subject: s, predicate: PWR_PRED.paths, object: JSON.stringify(region.region.paths), graph: g })
    }

    // Metadata
    if (region.metadata) {
      if (region.metadata.name) out.push({ subject: s, predicate: PWR_PRED.metadata_name, object: region.metadata.name, graph: g })
      if (region.metadata.desc) out.push({ subject: s, predicate: PWR_PRED.metadata_desc, object: region.metadata.desc, graph: g })
    }

    // Status effects
    for (const effect of region.status_effects ?? []) {
      this.statusEffectToTriples(s, region.region_id, effect, out, g, PWR_PRED.status_effect)
    }

    // Log
    this.logToTriples(s, region.log, out, g, PWR_PRED.log_entry)

    // Setting documents
    this.settingDocsToTriples(s, 'region', region.region_id, region.bind_setting?.documents, out)
  }

  private organizationToTriples(org: OrganizationSnapshot, order: number, out: Triple[]): void {
    const s = entitySubject('organization', org.organization_id)
    const g = GRAPH_PREFIX.organization

    out.push({ subject: s, predicate: PW_PRED.type, object: 'Organization', graph: g })
    out.push({ subject: s, predicate: PW_PRED.name, object: org.organization.name, graph: g })
    out.push({ subject: s, predicate: PW_PRED.order, object: order, graph: g })

    if (org.organization.description) {
      out.push({ subject: s, predicate: PW_PRED.description, object: org.organization.description, graph: g })
    }

    if (org.organization.territories && org.organization.territories.length > 0) {
      out.push({ subject: s, predicate: PWO_PRED.territories, object: JSON.stringify(org.organization.territories), graph: g })
    }

    // Status effects
    for (const effect of org.status_effects ?? []) {
      this.statusEffectToTriples(s, org.organization_id, effect, out, g, PWO_PRED.status_effect)
    }

    // Log
    this.logToTriples(s, org.log, out, g, PWO_PRED.log_entry)

    // Setting documents
    this.settingDocsToTriples(s, 'org', org.organization_id, org.bind_setting?.documents, out)
  }

  // =========================================================================
  // Component-level triple generation
  // =========================================================================

  private relationshipToTriples(ownerId: string, rel: Relationship, out: Triple[], graph: string): void {
    const ownerSubject = entitySubject('creature', ownerId)
    const relSubject = relationshipSubject(ownerId, rel.target_id)

    out.push({ subject: ownerSubject, predicate: PWC_PRED.relationship, object: relSubject, graph })
    out.push({ subject: relSubject, predicate: PW_PRED.target, object: entitySubject('creature', rel.target_id), graph })
    out.push({ subject: relSubject, predicate: PW_PRED.name, object: rel.name, graph })
    if (rel.value !== undefined) out.push({ subject: relSubject, predicate: PW_PRED.value, object: rel.value, graph })
    if (rel.description) out.push({ subject: relSubject, predicate: PW_PRED.description, object: rel.description, graph })
  }

  private inventoryItemToTriples(ownerId: string, item: InventoryItem, out: Triple[], graph: string): void {
    const ownerSubject = entitySubject('creature', ownerId)
    const itemSubject = inventorySubject(ownerId, item.id)

    out.push({ subject: ownerSubject, predicate: PWC_PRED.inventory_item, object: itemSubject, graph })
    out.push({ subject: itemSubject, predicate: PWI_PRED.item_id, object: item.id, graph })
    out.push({ subject: itemSubject, predicate: PW_PRED.name, object: item.name, graph })
    out.push({ subject: itemSubject, predicate: PWI_PRED.count, object: item.count, graph })
    if (item.description) out.push({ subject: itemSubject, predicate: PW_PRED.description, object: item.description, graph })
    if (item.details && item.details.length > 0) out.push({ subject: itemSubject, predicate: PWI_PRED.details, object: JSON.stringify(item.details), graph })
    if (item.equipped) out.push({ subject: itemSubject, predicate: PWI_PRED.equipped, object: true, graph })
  }

  private statusEffectToTriples(
    ownerSubject: string, ownerId: string,
    effect: StatusEffect, out: Triple[], graph: string, linkPred: string
  ): void {
    const effectSubject = statusEffectSubject(ownerId, effect.instance_id)

    out.push({ subject: ownerSubject, predicate: linkPred, object: effectSubject, graph })
    out.push({ subject: effectSubject, predicate: PW_PRED.name, object: effect.instance_id, graph })
    if (effect.display_name) out.push({ subject: effectSubject, predicate: PW_STATUS.display_name, object: effect.display_name, graph })
    if (effect.remark) out.push({ subject: effectSubject, predicate: PW_STATUS.remark, object: effect.remark, graph })
    if (effect.data !== undefined) out.push({ subject: effectSubject, predicate: PW_STATUS.data, object: JSON.stringify(effect.data), graph })
    if (effect.add_at) out.push({ subject: effectSubject, predicate: PW_STATUS.add_at, object: effect.add_at, graph })
    if (effect.last_update_at) out.push({ subject: effectSubject, predicate: PW_STATUS.last_update_at, object: effect.last_update_at, graph })
  }

  private settingDocsToTriples(
    ownerSubject: string, entityType: string, entityId: string,
    docs: SettingDocument[] | undefined, out: Triple[]
  ): void {
    if (!docs || docs.length === 0) return
    const g = settingGraph(entityType, entityId)

    for (const [i, doc] of docs.entries()) {
      const docSubject = settingDocSubject(entityId, doc.name)
      // Link from owner
      out.push({ subject: ownerSubject, predicate: PW_WORLD.setting_doc, object: docSubject, graph: g })
      out.push({ subject: docSubject, predicate: PW_PRED.order, object: i, graph: g })
      out.push({ subject: docSubject, predicate: PW_PRED.name, object: doc.name, graph: g })
      out.push({ subject: docSubject, predicate: PWS_PRED.content, object: doc.content, graph: g })
      if (doc.static_priority !== undefined) out.push({ subject: docSubject, predicate: PWS_PRED.priority, object: doc.static_priority, graph: g })
      if (doc.condition) out.push({ subject: docSubject, predicate: PWS_PRED.condition, object: doc.condition, graph: g })
      if (doc.disable) out.push({ subject: docSubject, predicate: PWS_PRED.disable, object: true, graph: g })
    }
  }

  private logToTriples(
    ownerSubject: string, log: LogEntry[] | undefined,
    out: Triple[], graph: string, linkPred: string
  ): void {
    if (!log || log.length === 0) return
    for (const [i, entry] of log.entries()) {
      const logSubject = `${ownerSubject}:log:${i}`
      out.push({ subject: ownerSubject, predicate: linkPred, object: logSubject, graph })
      out.push({ subject: logSubject, predicate: PW_PRED.order, object: i, graph })
      out.push({ subject: logSubject, predicate: PW_STORY.timestamp, object: entry.timestamp, graph })
      out.push({ subject: logSubject, predicate: PW_STORY.content, object: entry.content, graph })
    }
  }

  private registryFieldToTriples(worldId: string, field: CreatureAttrField, out: Triple[], graph: string): void {
    const worldSubject = entitySubject('world', worldId)
    const fieldSubject = registryFieldSubject(worldId, field.field_name)

    out.push({ subject: worldSubject, predicate: PW_WORLD.registry_field, object: fieldSubject, graph })
    out.push({ subject: fieldSubject, predicate: PW_REGISTRY.field_name, object: field.field_name, graph })
    out.push({ subject: fieldSubject, predicate: PW_REGISTRY.hint, object: field.hint, graph })
    if (field.field_display_name) out.push({ subject: fieldSubject, predicate: PW_REGISTRY.field_display_name, object: field.field_display_name, graph })
  }

  private customComponentDefToTriples(worldId: string, def: CustomComponentDef, out: Triple[], graph: string): void {
    const worldSubject = entitySubject('world', worldId)
    const schemaSubject = customSchemaSubject(worldId, def.component_key)

    out.push({ subject: worldSubject, predicate: PW_WORLD.custom_schema, object: schemaSubject, graph })
    out.push({ subject: schemaSubject, predicate: PW_SCHEMA.component_key, object: def.component_key, graph })
    out.push({ subject: schemaSubject, predicate: PW_PRED.name, object: def.component_name, graph })
    out.push({ subject: schemaSubject, predicate: PW_SCHEMA.is_array, object: def.is_array, graph })
    if (def.type_schema) {
      out.push({ subject: schemaSubject, predicate: PW_SCHEMA.type_schema, object: JSON.stringify(def.type_schema), graph })
    }
    if (def.data_registry && def.data_registry.length > 0) {
      out.push({ subject: schemaSubject, predicate: PW_SCHEMA.data_registry, object: JSON.stringify(def.data_registry), graph })
    }
  }

  private storyEntryToTriples(entry: StoryHistoryEntry, order: number, out: Triple[]): void {
    const s = `${SUBJECT_PREFIX.story}${entry.turn_id}`
    const g = GRAPH_PREFIX.story

    out.push({ subject: s, predicate: PW_PRED.type, object: 'StoryEntry', graph: g })
    out.push({ subject: s, predicate: PW_PRED.order, object: order, graph: g })
    out.push({ subject: s, predicate: PW_STORY.content, object: JSON.stringify(entry.story.content), graph: g })
    if (entry.story.checkpoint_id) out.push({ subject: s, predicate: PW_STORY.checkpoint_id, object: entry.story.checkpoint_id, graph: g })
  }

  // =========================================================================
  // Incremental operations (for single-field edits)
  // =========================================================================

  /** Translate a creature field update to triple operations. */
  translateCreatureUpdate(
    creatureId: string,
    field: string,
    value: unknown
  ): TripleOperation[] {
    const s = entitySubject('creature', creatureId)
    const g = GRAPH_PREFIX.creature

    // Map field names to predicates
    const fieldMap: Record<string, string> = {
      'name': PW_PRED.name,
      'creature.name': PW_PRED.name,
      'creature.gender': PWC_PRED.gender,
      'creature.race': PWC_PRED.race,
      'creature.personality': PWC_PRED.personality,
      'creature.description': PW_PRED.description,
      'creature.emotion': PWC_PRED.emotion,
      'creature.goal': PWC_PRED.goal,
      'creature.organization_id': PWC_PRED.organization,
      'creature.appearance.body': PWC_PRED.appearance_body,
      'creature.appearance.clothing': PWC_PRED.appearance_clothing,
      'is_player': PWC_PRED.is_player,
      'location.region_id': PWC_PRED.location_region,
      'location.point': PWC_PRED.location_point,
    }

    const predicate = fieldMap[field]
    if (predicate) {
      return [{ op: 'set', subject: s, predicate, object: value as Value, graph: g }]
    }

    return []
  }

  /** Translate a region field update to triple operations. */
  translateRegionUpdate(
    regionId: string,
    field: string,
    value: unknown
  ): TripleOperation[] {
    const s = entitySubject('region', regionId)
    const g = GRAPH_PREFIX.region

    const fieldMap: Record<string, string> = {
      'name': PW_PRED.name,
      'region.name': PW_PRED.name,
      'region.description': PW_PRED.description,
    }

    const predicate = fieldMap[field]
    if (predicate) {
      return [{ op: 'set', subject: s, predicate, object: value as Value, graph: g }]
    }

    return []
  }

  /** Translate an organization field update to triple operations. */
  translateOrganizationUpdate(
    orgId: string,
    field: string,
    value: unknown
  ): TripleOperation[] {
    const s = entitySubject('organization', orgId)
    const g = GRAPH_PREFIX.organization

    const fieldMap: Record<string, string> = {
      'name': PW_PRED.name,
      'organization.name': PW_PRED.name,
      'organization.description': PW_PRED.description,
      'organization.territories': PWO_PRED.territories,
    }

    const predicate = fieldMap[field]
    if (predicate) {
      return [{ op: 'set', subject: s, predicate, object: value as Value, graph: g }]
    }

    return []
  }

  /** Translate a world field update to triple operations. */
  translateWorldUpdate(
    worldId: string,
    field: string,
    value: unknown
  ): TripleOperation[] {
    const s = entitySubject('world', worldId)
    const g = GRAPH_PREFIX.world

    const fieldMap: Record<string, string> = {
      'game_time': PW_WORLD.game_time,
      'director_notes': PW_WORLD.director_notes,
    }

    const predicate = fieldMap[field]
    if (predicate) {
      return [{ op: 'set', subject: s, predicate, object: value as Value, graph: g }]
    }

    return []
  }

  // =========================================================================
  // Relationship operations
  // =========================================================================

  /** Translate adding a relationship between two creatures. */
  translateAddRelationship(
    fromId: string, toId: string, name: string, value?: number, description?: string
  ): TripleOperation[] {
    const g = GRAPH_PREFIX.creature
    const ownerSubject = entitySubject('creature', fromId)
    const relSubject = relationshipSubject(fromId, toId)

    const ops: TripleOperation[] = [
      { op: 'insert', subject: ownerSubject, predicate: PWC_PRED.relationship, object: relSubject, graph: g },
      { op: 'insert', subject: relSubject, predicate: PW_PRED.target, object: entitySubject('creature', toId), graph: g },
      { op: 'insert', subject: relSubject, predicate: PW_PRED.name, object: name, graph: g },
    ]
    if (value !== undefined) ops.push({ op: 'insert', subject: relSubject, predicate: PW_PRED.value, object: value, graph: g })
    if (description) ops.push({ op: 'insert', subject: relSubject, predicate: PW_PRED.description, object: description, graph: g })
    return ops
  }

  /** Translate removing a relationship. */
  translateRemoveRelationship(fromId: string, toId: string): TripleOperation[] {
    const g = GRAPH_PREFIX.creature
    const ownerSubject = entitySubject('creature', fromId)
    const relSubject = relationshipSubject(fromId, toId)

    return [
      { op: 'delete', subject: ownerSubject, predicate: PWC_PRED.relationship, object: relSubject, graph: g },
      { op: 'delete', subject: relSubject, predicate: PW_PRED.target, graph: g },
      { op: 'delete', subject: relSubject, predicate: PW_PRED.name, graph: g },
      { op: 'delete', subject: relSubject, predicate: PW_PRED.value, graph: g },
      { op: 'delete', subject: relSubject, predicate: PW_PRED.description, graph: g },
    ]
  }

  // =========================================================================
  // Inventory operations
  // =========================================================================

  /** Translate adding an inventory item. */
  translateAddInventoryItem(ownerId: string, item: InventoryItem): TripleOperation[] {
    const g = GRAPH_PREFIX.creature
    const ownerSubject = entitySubject('creature', ownerId)
    const itemSubject = inventorySubject(ownerId, item.id)

    const ops: TripleOperation[] = [
      { op: 'insert', subject: ownerSubject, predicate: PWC_PRED.inventory_item, object: itemSubject, graph: g },
      { op: 'insert', subject: itemSubject, predicate: PWI_PRED.item_id, object: item.id, graph: g },
      { op: 'insert', subject: itemSubject, predicate: PW_PRED.name, object: item.name, graph: g },
      { op: 'insert', subject: itemSubject, predicate: PWI_PRED.count, object: item.count, graph: g },
    ]
    if (item.description) ops.push({ op: 'insert', subject: itemSubject, predicate: PW_PRED.description, object: item.description, graph: g })
    if (item.details && item.details.length > 0) ops.push({ op: 'insert', subject: itemSubject, predicate: PWI_PRED.details, object: JSON.stringify(item.details), graph: g })
    if (item.equipped) ops.push({ op: 'insert', subject: itemSubject, predicate: PWI_PRED.equipped, object: true, graph: g })
    return ops
  }

  /** Translate removing an inventory item. */
  translateRemoveInventoryItem(ownerId: string, itemId: string): TripleOperation[] {
    const g = GRAPH_PREFIX.creature
    const ownerSubject = entitySubject('creature', ownerId)
    const itemSubject = inventorySubject(ownerId, itemId)

    return [
      { op: 'delete', subject: ownerSubject, predicate: PWC_PRED.inventory_item, object: itemSubject, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PWI_PRED.item_id, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PW_PRED.name, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PWI_PRED.count, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PW_PRED.description, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PWI_PRED.details, graph: g },
      { op: 'delete', subject: itemSubject, predicate: PWI_PRED.equipped, graph: g },
    ]
  }

  // =========================================================================
  // Entity-level CRUD operations
  // =========================================================================

  /** Generate triples for a new creature entity. */
  translateCreateCreature(creature: CreatureSnapshot, order: number): Triple[] {
    const out: Triple[] = []
    this.creatureToTriples(creature, order, out)
    return out
  }

  /** Generate triples for a new region entity. */
  translateCreateRegion(region: RegionSnapshot, order: number): Triple[] {
    const out: Triple[] = []
    this.regionToTriples(region, order, out)
    return out
  }

  /** Generate triples for a new organization entity. */
  translateCreateOrganization(org: OrganizationSnapshot, order: number): Triple[] {
    const out: Triple[] = []
    this.organizationToTriples(org, order, out)
    return out
  }

  /** Generate delete operations to remove all triples associated with an entity subject. */
  translateDeleteEntity(type: 'creature' | 'region' | 'organization', entityId: string): DeleteOp[] {
    const s = entitySubject(type, entityId)
    // We produce a "delete all by subject" — the view layer will need to also
    // clean up auxiliary subjects (relationships, inventory, etc.)
    // For now, we delete the main entity subject's triples.
    // The caller should use store.match({ subject: s }) to discover all predicates.
    return [{ op: 'delete', subject: s, predicate: '*' }]
  }

  // =========================================================================
  // Snapshot replacement (minimal delta)
  // =========================================================================

  /**
   * Compute replacement operations for a world snapshot.
   * Generates a minimal delta (delete old triples + insert new triples).
   */
  replaceWorld(oldWorld: WorldSnapshot, newWorld: WorldSnapshot): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    this.worldToTriples(oldWorld, oldTriples)
    this.worldToTriples(newWorld, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  /**
   * Compute replacement operations for a creature snapshot.
   */
  replaceCreature(oldCreature: CreatureSnapshot, newCreature: CreatureSnapshot, order: number): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    this.creatureToTriples(oldCreature, order, oldTriples)
    this.creatureToTriples(newCreature, order, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  /**
   * Compute replacement operations for a region snapshot.
   */
  replaceRegion(oldRegion: RegionSnapshot, newRegion: RegionSnapshot, order: number): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    this.regionToTriples(oldRegion, order, oldTriples)
    this.regionToTriples(newRegion, order, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  /**
   * Compute replacement operations for an organization snapshot.
   */
  replaceOrganization(oldOrg: OrganizationSnapshot, newOrg: OrganizationSnapshot, order: number): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    this.organizationToTriples(oldOrg, order, oldTriples)
    this.organizationToTriples(newOrg, order, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  /** Compute a unique key for a triple for delta comparison. */
  private static tripleKey(t: Triple): string {
    const o = typeof t.object === 'object' ? JSON.stringify(t.object) : String(t.object)
    return `${t.subject}\0${t.predicate}\0${o}\0${t.graph ?? ''}`
  }

  /** Compute the minimal set of delete + insert operations between two triple sets. */
  private static computeReplacementOps(oldTriples: Triple[], newTriples: Triple[]): TripleOperation[] {
    const oldKeys = new Set(oldTriples.map(TripleTranslator.tripleKey))
    const newKeys = new Set(newTriples.map(TripleTranslator.tripleKey))

    const ops: TripleOperation[] = []
    for (const t of oldTriples) {
      if (!newKeys.has(TripleTranslator.tripleKey(t))) {
        ops.push({ op: 'delete', subject: t.subject, predicate: t.predicate, object: t.object, graph: t.graph })
      }
    }
    for (const t of newTriples) {
      if (!oldKeys.has(TripleTranslator.tripleKey(t))) {
        ops.push({ op: 'insert', subject: t.subject, predicate: t.predicate, object: t.object, graph: t.graph })
      }
    }
    return ops
  }

  replaceInitialStory(oldStory: GameInitialStory | undefined, newStory: GameInitialStory | undefined): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    if (oldStory) {
      const s = `${SUBJECT_PREFIX.story}initial`
      oldTriples.push({ subject: s, predicate: PW_STORY.initial_background, object: oldStory.background, graph: GRAPH_PREFIX.story })
      oldTriples.push({ subject: s, predicate: PW_STORY.initial_start_story, object: oldStory.start_story, graph: GRAPH_PREFIX.story })
    }
    if (newStory) {
      const s = `${SUBJECT_PREFIX.story}initial`
      newTriples.push({ subject: s, predicate: PW_STORY.initial_background, object: newStory.background, graph: GRAPH_PREFIX.story })
      newTriples.push({ subject: s, predicate: PW_STORY.initial_start_story, object: newStory.start_story, graph: GRAPH_PREFIX.story })
    }
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  replaceStoryHistory(oldEntries: StoryHistoryEntry[], newEntries: StoryHistoryEntry[]): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    for (const [i, entry] of oldEntries.entries()) this.storyEntryToTriples(entry, i, oldTriples)
    for (const [i, entry] of newEntries.entries()) this.storyEntryToTriples(entry, i, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  replaceWiki(oldWiki: GameWikiEntry | undefined, newWiki: GameWikiEntry | undefined): TripleOperation[] {
    const oldTriples: Triple[] = []
    const newTriples: Triple[] = []
    this.wikiToTriples(oldWiki, oldTriples)
    this.wikiToTriples(newWiki, newTriples)
    return TripleTranslator.computeReplacementOps(oldTriples, newTriples)
  }

  private wikiToTriples(wiki: GameWikiEntry | undefined, out: Triple[]): void {
    if (!wiki || !Array.isArray(wiki)) return
    const wikiRoot = `${SUBJECT_PREFIX.wiki}root`
    for (const [i, entry] of wiki.entries()) {
      const ws = `${SUBJECT_PREFIX.wiki}entry_${i}`
      out.push({ subject: wikiRoot, predicate: PW_WIKI.entry, object: ws, graph: GRAPH_PREFIX.story })
      out.push({ subject: ws, predicate: PW_PRED.order, object: i, graph: GRAPH_PREFIX.story })
      out.push({ subject: ws, predicate: PW_WIKI.title, object: entry.title, graph: GRAPH_PREFIX.story })
      out.push({ subject: ws, predicate: PW_WIKI.content, object: entry.content, graph: GRAPH_PREFIX.story })
    }
  }
}
