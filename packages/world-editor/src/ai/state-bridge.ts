/**
 * State Bridge — JSON operation dispatch + deepMerge + validation + TripleStore commit
 *
 * This is the core execution engine that replaces `new Function()` JS execution.
 * AI generates structured JSON operations, this module dispatches them to the
 * appropriate TripleTranslator methods.
 *
 * See llm-docs/world-editor-ai-migration-plan.md §3 for design details.
 */

import type { TripleOperation } from '../rdf/index'
import { GRAPH_PREFIX, PW_PRED, entitySubject } from '../rdf/index'
import type {
  StateData,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  WorldSnapshot,
  GameInitialStory,
  StoryHistoryEntry,
} from '../types/index'
import {
  createDefaultCreatureSnapshot,
  createDefaultRegionSnapshot,
  createDefaultOrganizationSnapshot,
} from '../types/index'
import type { StateOperation, WorldEditorAIContext, FullStateValidationResult, ValidationWarning } from './types'
import type { StateChangeEntry, StateChangeChild } from './world-builder/types'

// ============================================================================
// Field Key Formatting
// ============================================================================

/** ID fields to exclude from children listing */
const ID_KEYS = new Set(['creature_id', 'region_id', 'organization_id', 'entity_id'])

/** Known key → friendly label overrides */
const FIELD_LABELS: Record<string, string> = {
  game_time: 'Game Time',
  registry: 'Attribute Fields',
  director_notes: 'Director Notes',
  custom_component_registry: 'Custom Component Registry',
  bind_setting: 'Bind Setting',
  creature: 'Base Info',
  region: 'Base Info',
  organization: 'Base Info',
  is_player: 'Player Character',
  status_effects: 'Status Effects',
  custom_components: 'Custom Components',
  log: 'Log',
  inventory: 'Inventory',
  relationships: 'Relationships',
  location: 'Location',
  metadata: 'Metadata',
}

/** Convert a data key to a display label */
function formatFieldKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  // snake_case / camelCase → Title Case
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Extract children from an operation's data record, filtering out ID keys */
export function extractChildren(data: Record<string, unknown>): StateChangeChild[] {
  return Object.keys(data)
    .filter((k) => !ID_KEYS.has(k))
    .map((k) => ({ key: k, label: formatFieldKey(k) }))
}

// ============================================================================
// Deep Merge
// ============================================================================

/**
 * Recursive deep merge: objects recurse, arrays replace, primitives overwrite.
 * Unmentioned fields are preserved (merge semantics, not replace).
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const srcVal = source[key]
    const tgtVal = (target as Record<string, unknown>)[key]

    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      tgtVal !== undefined &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      // Both are plain objects → recurse
      ;(result as Record<string, unknown>)[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      )
    } else {
      // Arrays, primitives, null → overwrite
      ;(result as Record<string, unknown>)[key] = srcVal
    }
  }
  return result
}

// ============================================================================
// Entity Default Fillers
// ============================================================================

/**
 * Ensure a creature snapshot has all required default fields.
 * Merges AI-provided data onto a default creature template.
 */
function ensureCreatureDefaults(creatureId: string, data: Record<string, unknown>): CreatureSnapshot {
  const base = createDefaultCreatureSnapshot(creatureId)
  const merged = deepMerge(base as unknown as Record<string, unknown>, data) as unknown as CreatureSnapshot
  // Ensure creature_id is always correct
  merged.creature_id = creatureId
  return merged
}

/**
 * Ensure a region snapshot has all required default fields.
 */
function ensureRegionDefaults(regionId: string, data: Record<string, unknown>): RegionSnapshot {
  const base = createDefaultRegionSnapshot(regionId)
  const merged = deepMerge(base as unknown as Record<string, unknown>, data) as unknown as RegionSnapshot
  merged.region_id = regionId
  return merged
}

/**
 * Ensure an organization snapshot has all required default fields.
 */
function ensureOrganizationDefaults(orgId: string, data: Record<string, unknown>): OrganizationSnapshot {
  const base = createDefaultOrganizationSnapshot(orgId)
  const merged = deepMerge(base as unknown as Record<string, unknown>, data) as unknown as OrganizationSnapshot
  merged.organization_id = orgId
  return merged
}

// ============================================================================
// State Validation (simplified version compatible with original validateFullState)
// ============================================================================

/**
 * Validate the entire state object.
 * Returns errors (block commit), warnings (informational), and autoFixes (mutations applied).
 * Auto-fixes mutate the state object in-place to correct common AI mistakes.
 *
 * Operates on the new snake_case StateData format.
 */
export function validateFullState(state: unknown): FullStateValidationResult {
  const errors: string[] = []
  const warnings: ValidationWarning[] = []
  const autoFixes: string[] = []

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['state must be an object'], warnings: [], autoFixes: [] }
  }

  const s = state as Record<string, unknown>

  // World must exist
  if (!s.World || typeof s.World !== 'object') {
    errors.push('state.World is required and must be an object')
  }

  // Array fields must be arrays
  const arrayFields = ['Creatures', 'Regions', 'Organizations', 'StoryHistory'] as const
  for (const field of arrayFields) {
    if (s[field] !== undefined && !Array.isArray(s[field])) {
      errors.push(`state.${field} must be an array (got ${typeof s[field]})`)
    }
  }

  // Creature validation
  const creatures = Array.isArray(s.Creatures) ? s.Creatures : []
  const VALID_CREATURE_COMPONENT_FIELDS = new Set([
    'name', 'organization_id', 'titles',
    'appearance', 'gender', 'race', 'emotion', 'attrs',
    'known_infos', 'goal', 'personality', 'description',
  ])

  creatures.forEach((c: unknown, i: number) => {
    if (!c || typeof c !== 'object') {
      errors.push(`Creatures[${i}] must be an object`)
      return
    }
    const snapshot = c as Record<string, unknown>

    // creature_id is required on the snapshot level
    if (!snapshot.creature_id || typeof snapshot.creature_id !== 'string') {
      errors.push(`Creatures[${i}].creature_id is required (string)`)
    }

    // creature component is required
    const comp = snapshot.creature as Record<string, unknown> | undefined
    if (!comp || typeof comp !== 'object') {
      errors.push(`Creatures[${i}].creature is required`)
      return
    }
    if (!comp.name || typeof comp.name !== 'string') {
      errors.push(`Creatures[${i}].creature.name is required (string)`)
    }

    // Field whitelist + auto-fix description → appearance.body
    for (const key of Object.keys(comp)) {
      if (!VALID_CREATURE_COMPONENT_FIELDS.has(key)) {
        warnings.push({
          field: `Creatures[${i}].creature.${key}`,
          message: `Unknown field "${key}" in creature component. Valid fields: ${[...VALID_CREATURE_COMPONENT_FIELDS].join(', ')}`,
        })
      }
    }

    // Auto-fix description → appearance.body
    if (comp.description && typeof comp.description === 'string' && comp.description.length > 0) {
      if (!comp.appearance || typeof comp.appearance !== 'object') {
        comp.appearance = { body: '', clothing: '' }
      }
      const app = comp.appearance as Record<string, unknown>
      if (app.body && typeof app.body === 'string') {
        app.body = app.body + '\n' + comp.description
      } else {
        app.body = comp.description
      }
      delete comp.description
      autoFixes.push(`Creatures[${i}]: auto-moved description → appearance.body`)
    }

    // Inventory auto-fix (inventory is InventoryItem[] directly on snapshot)
    if (Array.isArray(snapshot.inventory)) {
      ;(snapshot.inventory as unknown[]).forEach((item: unknown, j: number) => {
        if (!item || typeof item !== 'object') return
        const itemObj = item as Record<string, unknown>

        if ('item_id' in itemObj && !('id' in itemObj)) {
          itemObj.id = itemObj.item_id
          delete itemObj.item_id
          autoFixes.push(`Creatures[${i}].inventory[${j}]: auto-renamed item_id → id`)
        }
        if ('quantity' in itemObj && !('count' in itemObj)) {
          itemObj.count = itemObj.quantity
          delete itemObj.quantity
          autoFixes.push(`Creatures[${i}].inventory[${j}]: auto-renamed quantity → count`)
        }
      })
    }
  })

  // Registry validation (world.registry is CreatureAttrField[])
  // Note: registry is a flat array of field definitions, not {items,skills}
  // No complex validation needed here — just check it's an array if present
  if (s.World && typeof s.World === 'object') {
    const world = s.World as Record<string, unknown>
    if (world.registry !== undefined && !Array.isArray(world.registry)) {
      warnings.push({
        field: 'World.registry',
        message: 'registry should be an array of CreatureAttrField',
      })
    }
  }

  // Inventory referential integrity — skip for now since registry is AttrFields, not items
  // (The old format had World.Registry.items for item definitions, but the new format doesn't.)

  // GameInitialStory validation
  if (s.GameInitialStory !== undefined) {
    if (typeof s.GameInitialStory !== 'object' || s.GameInitialStory === null) {
      errors.push('GameInitialStory must be an object')
    }
  }

  return { valid: errors.length === 0, errors, warnings, autoFixes }
}

/**
 * Format validation warnings for tool output.
 */
export function formatValidationWarnings(warnings: ValidationWarning[]): string {
  if (warnings.length === 0) return ''

  const lines = [`\n⚠️ Warnings (${warnings.length} issue${warnings.length > 1 ? 's' : ''}):`]
  for (const w of warnings) {
    if (w.index !== undefined) {
      lines.push(`  - Item ${w.index}: ${w.message}`)
    } else if (w.field) {
      lines.push(`  - Field "${w.field}": ${w.message}`)
    } else {
      lines.push(`  - ${w.message}`)
    }
  }
  return lines.join('\n')
}

// ============================================================================
// State Overview Generation
// ============================================================================

/** Fields whose string values should be truncated in overview */
const TRUNCATE_FIELDS = new Set([
  'content', 'background', 'start_story', 'dialogue', 'narration', 'body', 'clothing',
])

const TEXT_MAX_LENGTH = 80

function truncateStateForOverview(obj: unknown, key?: string): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (key && TRUNCATE_FIELDS.has(key) && obj.length > TEXT_MAX_LENGTH) {
      return obj.substring(0, TEXT_MAX_LENGTH) + `...(${obj.length}chars)`
    }
    return obj
  }
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map((item) => truncateStateForOverview(item, key))
  }
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = truncateStateForOverview(v, k)
  }
  return result
}

/**
 * Generate a truncated state overview, excluding StoryHistory.
 */
export function generateStateOverview(state: StateData): string {
  const slim: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(state)) {
    if (k === 'StoryHistory') continue
    slim[k] = truncateStateForOverview(v)
  }
  return JSON.stringify(slim, null, 2)
}

// ============================================================================
// Path-based access
// ============================================================================

/**
 * Get a value from a nested object by dot-notation path.
 * Supports array index notation: "Creatures[0].Creature.name"
 */
export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// ============================================================================
// Execute Update State — core dispatch function
// ============================================================================

/**
 * Execute an `update_state` tool call.
 * Dispatches each operation to the appropriate TripleTranslator method,
 * validates the result, then commits to the TripleStore.
 */
export function executeUpdateState(
  operations: StateOperation[],
  ctx: WorldEditorAIContext,
): { text: string; changes: StateChangeEntry[] } {
  const allOps: TripleOperation[] = []
  const results: string[] = []
  const changes: StateChangeEntry[] = []
  const currentState = ctx.getState()

  for (const operation of operations) {
    switch (operation.op) {
      case 'upsert_creature': {
        const existing = currentState.Creatures?.find(
          (c) => c.creature_id === operation.creature_id,
        )
        if (existing) {
          const merged = deepMerge(
            structuredClone(existing) as unknown as Record<string, unknown>,
            operation.data,
          ) as unknown as CreatureSnapshot
          merged.creature_id = operation.creature_id
          const idx = currentState.Creatures!.indexOf(existing)
          allOps.push(...ctx.translator.replaceCreature(existing, merged, idx))
          results.push(`Updated creature "${operation.creature_id}"`)
          changes.push({ action: 'updated', category: 'creature', entityId: operation.creature_id, label: operation.creature_id, tab: 'characters', children: extractChildren(operation.data) })
        } else {
          const newCreature = ensureCreatureDefaults(operation.creature_id, operation.data)
          const order = currentState.Creatures?.length ?? 0
          const triples = ctx.translator.translateCreateCreature(newCreature, order)
          // translateCreateCreature returns Triple[], convert to InsertOp[]
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created creature "${operation.creature_id}"`)
          changes.push({ action: 'created', category: 'creature', entityId: operation.creature_id, label: operation.creature_id, tab: 'characters', children: extractChildren(operation.data) })
        }
        break
      }

      case 'replace_creature': {
        const existing = currentState.Creatures?.find(
          (c) => c.creature_id === operation.creature_id,
        )
        const data = structuredClone(operation.data) as Record<string, unknown>
        data.creature_id = operation.creature_id
        if (existing) {
          const idx = currentState.Creatures!.indexOf(existing)
          allOps.push(...ctx.translator.replaceCreature(existing, data as unknown as CreatureSnapshot, idx))
          results.push(`Replaced creature "${operation.creature_id}"`)
          changes.push({ action: 'replaced', category: 'creature', entityId: operation.creature_id, label: operation.creature_id, tab: 'characters', children: extractChildren(operation.data) })
        } else {
          const triples = ctx.translator.translateCreateCreature(
            data as unknown as CreatureSnapshot,
            currentState.Creatures?.length ?? 0,
          )
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created creature "${operation.creature_id}"`)
          changes.push({ action: 'created', category: 'creature', entityId: operation.creature_id, label: operation.creature_id, tab: 'characters', children: extractChildren(operation.data) })
        }
        break
      }

      case 'delete_creature': {
        allOps.push(...ctx.translator.translateDeleteEntity('creature', operation.creature_id))
        results.push(`Deleted creature "${operation.creature_id}"`)
        changes.push({ action: 'deleted', category: 'creature', entityId: operation.creature_id, label: operation.creature_id, tab: 'characters' })
        break
      }

      case 'upsert_region': {
        const existing = currentState.Regions?.find(
          (r) => r.region_id === operation.region_id,
        )
        if (existing) {
          const merged = deepMerge(
            structuredClone(existing) as unknown as Record<string, unknown>,
            operation.data,
          ) as unknown as RegionSnapshot
          merged.region_id = operation.region_id
          const idx = currentState.Regions!.indexOf(existing)
          allOps.push(...ctx.translator.replaceRegion(existing, merged, idx))
          results.push(`Updated region "${operation.region_id}"`)
          changes.push({ action: 'updated', category: 'region', entityId: operation.region_id, label: operation.region_id, tab: 'regions', children: extractChildren(operation.data) })
        } else {
          const newRegion = ensureRegionDefaults(operation.region_id, operation.data)
          const order = currentState.Regions?.length ?? 0
          const triples = ctx.translator.translateCreateRegion(newRegion, order)
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created region "${operation.region_id}"`)
          changes.push({ action: 'created', category: 'region', entityId: operation.region_id, label: operation.region_id, tab: 'regions', children: extractChildren(operation.data) })
        }
        break
      }

      case 'replace_region': {
        const existing = currentState.Regions?.find(
          (r) => r.region_id === operation.region_id,
        )
        const data = structuredClone(operation.data) as Record<string, unknown>
        data.region_id = operation.region_id
        if (existing) {
          const idx = currentState.Regions!.indexOf(existing)
          allOps.push(...ctx.translator.replaceRegion(existing, data as unknown as RegionSnapshot, idx))
          results.push(`Replaced region "${operation.region_id}"`)
          changes.push({ action: 'replaced', category: 'region', entityId: operation.region_id, label: operation.region_id, tab: 'regions', children: extractChildren(operation.data) })
        } else {
          const triples = ctx.translator.translateCreateRegion(
            data as unknown as RegionSnapshot,
            currentState.Regions?.length ?? 0,
          )
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created region "${operation.region_id}"`)
          changes.push({ action: 'created', category: 'region', entityId: operation.region_id, label: operation.region_id, tab: 'regions', children: extractChildren(operation.data) })
        }
        break
      }

      case 'delete_region': {
        allOps.push(...ctx.translator.translateDeleteEntity('region', operation.region_id))
        results.push(`Deleted region "${operation.region_id}"`)
        changes.push({ action: 'deleted', category: 'region', entityId: operation.region_id, label: operation.region_id, tab: 'regions' })
        break
      }

      case 'upsert_organization': {
        const existing = currentState.Organizations?.find(
          (o) => o.organization_id === operation.organization_id,
        )
        if (existing) {
          const merged = deepMerge(
            structuredClone(existing) as unknown as Record<string, unknown>,
            operation.data,
          ) as unknown as OrganizationSnapshot
          merged.organization_id = operation.organization_id
          const idx = currentState.Organizations!.indexOf(existing)
          allOps.push(...ctx.translator.replaceOrganization(existing, merged, idx))
          results.push(`Updated organization "${operation.organization_id}"`)
          changes.push({ action: 'updated', category: 'organization', entityId: operation.organization_id, label: operation.organization_id, tab: 'organizations', children: extractChildren(operation.data) })
        } else {
          const newOrg = ensureOrganizationDefaults(operation.organization_id, operation.data)
          const order = currentState.Organizations?.length ?? 0
          const triples = ctx.translator.translateCreateOrganization(newOrg, order)
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created organization "${operation.organization_id}"`)
          changes.push({ action: 'created', category: 'organization', entityId: operation.organization_id, label: operation.organization_id, tab: 'organizations', children: extractChildren(operation.data) })
        }
        break
      }

      case 'replace_organization': {
        const existing = currentState.Organizations?.find(
          (o) => o.organization_id === operation.organization_id,
        )
        const data = structuredClone(operation.data) as Record<string, unknown>
        data.organization_id = operation.organization_id
        if (existing) {
          const idx = currentState.Organizations!.indexOf(existing)
          allOps.push(...ctx.translator.replaceOrganization(existing, data as unknown as OrganizationSnapshot, idx))
          results.push(`Replaced organization "${operation.organization_id}"`)
          changes.push({ action: 'replaced', category: 'organization', entityId: operation.organization_id, label: operation.organization_id, tab: 'organizations', children: extractChildren(operation.data) })
        } else {
          const triples = ctx.translator.translateCreateOrganization(
            data as unknown as OrganizationSnapshot,
            currentState.Organizations?.length ?? 0,
          )
          allOps.push(...triples.map((t) => ({ op: 'insert' as const, ...t })))
          results.push(`Created organization "${operation.organization_id}"`)
          changes.push({ action: 'created', category: 'organization', entityId: operation.organization_id, label: operation.organization_id, tab: 'organizations', children: extractChildren(operation.data) })
        }
        break
      }

      case 'delete_organization': {
        allOps.push(...ctx.translator.translateDeleteEntity('organization', operation.organization_id))
        results.push(`Deleted organization "${operation.organization_id}"`)
        changes.push({ action: 'deleted', category: 'organization', entityId: operation.organization_id, label: operation.organization_id, tab: 'organizations' })
        break
      }

      case 'update_world': {
        console.log('[WBN] update_world: currentState.World =', JSON.stringify(currentState.World).slice(0, 200))
        console.log('[WBN] update_world: operation.data keys =', Object.keys(operation.data))
        const merged = deepMerge(
          structuredClone(currentState.World) as unknown as Record<string, unknown>,
          operation.data,
        ) as unknown as WorldSnapshot
        console.log('[WBN] update_world: merged keys =', Object.keys(merged))
        // Force-insert the type triple so the world entity is always identifiable
        // even if the store previously lost it (e.g. due to diff-only ops never inserting it).
        allOps.push({
          op: 'insert',
          subject: entitySubject('world', merged.entity_id),
          predicate: PW_PRED.type,
          object: 'World',
          graph: GRAPH_PREFIX.world,
        })
        const worldOps = ctx.translator.replaceWorld(currentState.World, merged)
        console.log('[WBN] update_world: generated', worldOps.length, 'triple ops + 1 type triple')
        allOps.push(...worldOps)
        results.push('Updated world data')
        changes.push({ action: 'updated', category: 'world', label: 'World', tab: 'world', children: extractChildren(operation.data) })
        break
      }

      case 'set_initial_story': {
        const old = currentState.GameInitialStory
        allOps.push(...ctx.translator.replaceInitialStory(old, operation.data as unknown as GameInitialStory))
        results.push('Updated initial story')
        changes.push({ action: 'updated', category: 'story', label: 'Initial Story', tab: 'story', children: extractChildren(operation.data as Record<string, unknown>) })
        break
      }

      case 'set_story_history': {
        allOps.push(
          ...ctx.translator.replaceStoryHistory(
            currentState.StoryHistory ?? [],
            operation.entries as StoryHistoryEntry[],
          ),
        )
        results.push('Updated story history')
        changes.push({ action: 'updated', category: 'story_history', label: 'Story History', tab: 'story', children: [{ key: 'entries', label: `${(operation.entries as unknown[]).length} entries` }] })
        break
      }
    }
  }

  // Validate: apply ops to a clone and validate
  // For now we validate the current state + operations by re-materializing
  // In a future optimization, we can apply ops to a temporary store
  // For now, commit first then validate the result
  console.log('[WBN] executeUpdateState: applying', allOps.length, 'total triple ops')
  ctx.applyOps(allOps)

  // Re-materialize to get the new state
  const newState = ctx.getState()
  console.log('[WBN] executeUpdateState: new World after apply =', JSON.stringify(newState.World).slice(0, 300))

  // Run validation on the new state
  const validation = validateFullState(newState)
  if (!validation.valid) {
    return {
      text: [
        `${results.length} operations executed, but validation found issues:`,
        ...validation.errors.map((e) => `  - ${e}`),
        ...results.map((r) => `  - ${r}`),
        '\nPlease use update_state to fix the above issues.',
      ].join('\n'),
      changes,
    }
  }

  // Build success result
  const lines = [`${results.length} operations executed`]
  lines.push(...results.map((r) => `  - ${r}`))

  if (validation.autoFixes.length > 0) {
    lines.push(`\nAuto-fixes (${validation.autoFixes.length}):`)
    lines.push(...validation.autoFixes.map((f) => `  - ${f}`))
  }

  const warningText = formatValidationWarnings(validation.warnings)
  if (warningText) {
    lines.push(warningText)
  }

  lines.push('\nState overview:')
  lines.push(generateStateOverview(newState))

  return { text: lines.join('\n'), changes }
}
