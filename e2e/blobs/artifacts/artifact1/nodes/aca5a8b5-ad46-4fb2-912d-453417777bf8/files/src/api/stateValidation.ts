/**
 * State Validation Module
 *
 * Uses Zod v4 for runtime validation of state data.
 * Provides automatic fixing of common issues and warning collection.
 */

import { z } from 'zod'
import type { StateData, SettingDocument } from './types'

// ============================================================================
// Zod Schemas — mirrors TypeScript types in types.ts
// ============================================================================

const SettingDocumentSchema = z.object({
  name: z.string().min(1, 'Document name must not be empty'),
  content: z.string(),
  static_priority: z.number().optional(),
  disable: z.boolean().optional(),
  condition: z.string().optional(),
})

const BindSettingSchema = z.object({
  documents: z.array(SettingDocumentSchema),
}).optional()

const GameTimeSchema = z.object({
  year: z.number(),
  month: z.number(),
  day: z.number(),
  hour: z.number(),
  minute: z.number(),
})

const CreatureAttrFieldSchema = z.object({
  field_name: z.string(),
  hint: z.string(),
  field_display_name: z.string().optional(),
})

const RegistrySchema = z.object({
  creature_attr_fields: z.array(CreatureAttrFieldSchema).optional(),
}).optional()

const CustomComponentDefSchema = z.object({
  component_key: z.string().min(1, 'component_key is required'),
  component_name: z.string().optional(),
  is_array: z.boolean(),
  type_schema: z.any().optional(),
  data_registry: z.array(z.object({
    item_id: z.string().min(1),
    data: z.any(),
  })).optional(),
})

const CustomComponentRegistrySchema = z.object({
  custom_components: z.array(CustomComponentDefSchema),
}).optional()

const LogEntrySchema = z.object({
  content: z.string(),
  add_at: z.string(),
})

const LogSchema = z.object({
  entries: z.array(LogEntrySchema),
}).optional()

const DirectorNotesSchema = z.object({
  notes: z.array(z.string()),
  flags: z.record(z.string(), z.object({
    id: z.string(),
    value: z.boolean(),
    remark: z.string().optional(),
  })),
  stage_goal: z.string().nullable().optional(),
}).optional()

// ----- World -----

const WorldSnapshotSchema = z.looseObject({
  entity_id: z.number(),
  GameTime: GameTimeSchema.optional(),
  Registry: RegistrySchema,
  DirectorNotes: DirectorNotesSchema,
  CustomComponentRegistry: CustomComponentRegistrySchema,
  Log: LogSchema,
  BindSetting: BindSettingSchema,
})

// ----- Creature -----

const AppearanceSchema = z.object({
  body: z.string(),
  clothing: z.string(),
})

const CreatureSchema = z.looseObject({
  creature_id: z.string().min(1),
  name: z.string().min(1),
  organization_id: z.string().optional(),
  titles: z.array(z.string()).optional().default([]),
  appearance: AppearanceSchema.optional(),
  gender: z.string().optional(),
  race: z.string().optional(),
  emotion: z.string().optional(),
  attrs: z.record(z.string(), z.union([z.number(), z.string()])).optional().default({}),
  known_infos: z.array(z.string()).optional().default([]),
  goal: z.string().optional(),
})

const ItemSchema = z.object({
  id: z.string(),
  count: z.number(),
  name: z.string().optional().default(''),
  description: z.string().optional().default(''),
  details: z.array(z.string()).optional().default([]),
  equipped: z.boolean().optional(),
})

const InventorySchema = z.object({
  items: z.array(ItemSchema),
}).optional()

const StatusEffectSchema = z.object({
  instance_id: z.string().min(1),
  display_name: z.string().optional(),
  remark: z.string().optional(),
  data: z.any().optional(),
  add_at: z.string().optional(),
  last_update_at: z.string().optional(),
})

const StatusEffectsSchema = z.object({
  status_effects: z.array(StatusEffectSchema),
}).optional()

const CustomComponentsSchema = z.object({
  custom_components: z.array(z.object({
    component_key: z.string(),
    data: z.any(),
  })),
}).optional()

const RelationshipSchema = z.object({
  target_creature_id: z.string(),
  name: z.string(),
  value: z.number(),
})

const RelationshipComponentSchema = z.object({
  relationships: z.array(RelationshipSchema),
}).optional()

const LocationRefSchema = z.object({
  region_id: z.string(),
  location_id: z.string(),
}).optional()

const IsPlayerSchema = z.object({}).optional()

const CreatureSnapshotSchema = z.looseObject({
  entity_id: z.number(),
  Creature: CreatureSchema.optional(),
  LocationRef: LocationRefSchema,
  Inventory: InventorySchema,
  StatusEffects: StatusEffectsSchema,
  CustomComponents: CustomComponentsSchema,
  Relationship: RelationshipComponentSchema,
  Log: LogSchema,
  IsPlayer: IsPlayerSchema,
  BindSetting: BindSettingSchema,
})

// ----- Region -----

const LocationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
})

const PathSchema = z.object({
  src_location: z.string(),
  src_region: z.string(),
  discovered: z.boolean(),
  to_region: z.string(),
  to_location: z.string(),
  description: z.string(),
})

const RegionSchema = z.object({
  region_id: z.string().min(1),
  region_name: z.string(),
  description: z.string(),
  locations: z.array(LocationSchema).optional(),
  paths: z.array(PathSchema).optional(),
})

const MetadataSchema = z.object({
  name: z.string(),
  desc: z.string(),
}).optional()

const RegionSnapshotSchema = z.looseObject({
  entity_id: z.number(),
  Metadata: MetadataSchema,
  Region: RegionSchema.optional(),
  StatusEffects: StatusEffectsSchema,
  Log: LogSchema,
  BindSetting: BindSettingSchema,
})

// ----- Organization -----

const OrganizationSchema = z.object({
  organization_id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  territories: z.array(z.object({
    region_id: z.string(),
    location_id: z.string(),
  })).optional(),
})

const OrganizationSnapshotSchema = z.looseObject({
  entity_id: z.number(),
  Organization: OrganizationSchema.optional(),
  StatusEffects: StatusEffectsSchema,
  Log: LogSchema,
  BindSetting: BindSettingSchema,
})

// ----- Story & Initial -----

const StoryHistoryEntrySchema = z.object({
  turn_id: z.string(),
  story: z.object({
    content: z.any(),
    checkpoint_id: z.string().optional(),
  }),
})

const GameInitialStorySchema = z.object({
  background: z.string(),
  start_story: z.string(),
}).optional()

const GameWikiEntrySchema = z.array(z.object({
  title: z.string(),
  content: z.string(),
})).optional()

const AppInfoSchema = z.object({
  publish_type: z.enum(['EDITOR', 'INK', 'TEST', 'CUSTOM_TEMPLATE', 'CUSTOM']).optional(),
}).optional()

// ----- Full StateData -----

const StateDataSchema = z.looseObject({
  World: WorldSnapshotSchema,
  Creatures: z.array(CreatureSnapshotSchema).optional(),
  Regions: z.array(RegionSnapshotSchema).optional(),
  Organizations: z.array(OrganizationSnapshotSchema).optional(),
  StoryHistory: z.array(StoryHistoryEntrySchema).optional(),
  GameInitialStory: GameInitialStorySchema,
  GameWikiEntry: GameWikiEntrySchema,
  AppInfo: AppInfoSchema,
  _save_version: z.literal('v2').optional(),
})

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationWarning {
  index?: number
  field?: string
  message: string
}

export interface ValidateAndCleanResult<T> {
  value: T
  warnings: ValidationWarning[]
  hasChanges: boolean
}

export interface FullStateValidationResult {
  valid: boolean
  errors: string[]
  warnings: ValidationWarning[]
  autoFixes: string[]
}

// ============================================================================
// Legacy Migration (run before validation)
// ============================================================================

/**
 * Migrate legacy state data in-place.
 * - Renames `CreatureAttributes` → `Creature` on each creature entity
 * - Ensures `known_infos` array exists on each Creature component
 */
export function migrateStateData(state: Record<string, any>): void {
  const creatures = state?.Creatures
  if (!Array.isArray(creatures)) return
  for (const c of creatures) {
    if (c.CreatureAttributes && !c.Creature) {
      c.Creature = c.CreatureAttributes
      delete c.CreatureAttributes
    }
    if (c.Creature && !Array.isArray(c.Creature.known_infos)) {
      c.Creature.known_infos = []
    }
  }
}

// ============================================================================
// Auto-Fix: correct common AI mistakes in-place, return list of fixes
// ============================================================================

function autoFixState(state: Record<string, any>): string[] {
  const fixes: string[] = []

  // --- Creatures ---
  const creatures = Array.isArray(state.Creatures) ? state.Creatures : []
  creatures.forEach((c: any, i: number) => {
    if (!c || typeof c !== 'object') return

    // Auto-assign entity_id
    if (typeof c.entity_id !== 'number') {
      c.entity_id = i + 1
      fixes.push(`Creatures[${i}]: auto-assigned entity_id=${i + 1}`)
    }

    const attrs = c.Creature
    if (attrs && typeof attrs === 'object') {
      // Move description → appearance.body
      if (typeof attrs.description === 'string' && attrs.description.length > 0) {
        if (!attrs.appearance || typeof attrs.appearance !== 'object') {
          attrs.appearance = { body: '', clothing: '' }
        }
        attrs.appearance.body = attrs.appearance.body
          ? attrs.appearance.body + '\n' + attrs.description
          : attrs.description
        delete attrs.description
        fixes.push(`Creatures[${i}]: auto-moved description → appearance.body`)
      }

      // Ensure titles is array
      if (!Array.isArray(attrs.titles)) {
        attrs.titles = attrs.titles ? [String(attrs.titles)] : []
      }

      // Ensure known_infos is array
      if (!Array.isArray(attrs.known_infos)) {
        attrs.known_infos = []
      }

      // Ensure attrs is object
      if (typeof attrs.attrs !== 'object' || attrs.attrs === null) {
        attrs.attrs = {}
      }
    }

    // Fix IsPlayer: true → {}
    if (c.IsPlayer !== undefined) {
      if (typeof c.IsPlayer !== 'object' || c.IsPlayer === null || Array.isArray(c.IsPlayer)) {
        const old = Array.isArray(c.IsPlayer) ? '[]' : String(c.IsPlayer)
        c.IsPlayer = {}
        fixes.push(`Creatures[${i}]: auto-fixed IsPlayer from ${old} → {}`)
      }
    }

    // Fix Inventory items
    if (c.Inventory?.items && Array.isArray(c.Inventory.items)) {
      c.Inventory.items.forEach((item: any, j: number) => {
        if (!item || typeof item !== 'object') return
        if ('item_id' in item && !('id' in item)) {
          item.id = item.item_id
          delete item.item_id
          fixes.push(`Creatures[${i}].Inventory.items[${j}]: auto-renamed item_id → id`)
        }
        if ('quantity' in item && !('count' in item)) {
          item.count = item.quantity
          delete item.quantity
          fixes.push(`Creatures[${i}].Inventory.items[${j}]: auto-renamed quantity → count`)
        }
      })
    }
  })

  // --- Regions: auto-assign entity_id ---
  const regions = Array.isArray(state.Regions) ? state.Regions : []
  regions.forEach((r: any, i: number) => {
    if (r && typeof r === 'object' && typeof r.entity_id !== 'number') {
      r.entity_id = creatures.length + i + 1
      fixes.push(`Regions[${i}]: auto-assigned entity_id`)
    }
  })

  // --- Organizations: auto-assign entity_id ---
  const orgs = Array.isArray(state.Organizations) ? state.Organizations : []
  orgs.forEach((o: any, i: number) => {
    if (o && typeof o === 'object' && typeof o.entity_id !== 'number') {
      o.entity_id = creatures.length + regions.length + i + 1
      fixes.push(`Organizations[${i}]: auto-assigned entity_id`)
    }
  })

  return fixes
}

// ============================================================================
// Full State Validation (Zod-based)
// ============================================================================

/**
 * Validate the entire state object using Zod schemas.
 * Auto-fixes are applied BEFORE Zod validation.
 * Returns errors (block), warnings (informational), and autoFixes applied.
 */
export function validateFullState(state: unknown): FullStateValidationResult {
  const warnings: ValidationWarning[] = []
  const autoFixes: string[] = []

  // 1. Basic object check
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['state must be an object'], warnings: [], autoFixes: [] }
  }

  const s = state as Record<string, any>

  // 2. Quick structural guard — World must exist
  if (!s.World || typeof s.World !== 'object') {
    return { valid: false, errors: ['state.World is required and must be an object'], warnings: [], autoFixes: [] }
  }

  // 3. Auto-fix common issues before Zod validation
  autoFixes.push(...autoFixState(s))

  // 4. Zod validation
  const result = StateDataSchema.safeParse(s)

  if (!result.success) {
    const errors: string[] = []
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')
      errors.push(path ? `${path}: ${issue.message}` : issue.message)
    }
    return { valid: false, errors, warnings, autoFixes }
  }

  // 5. Semantic warnings (non-blocking)
  // Duplicate creature IDs
  const creatures = Array.isArray(s.Creatures) ? s.Creatures : []
  const creatureIds = new Set<string>()
  creatures.forEach((c: any, i: number) => {
    const id = c.Creature?.creature_id
    if (id) {
      if (creatureIds.has(id)) {
        warnings.push({ field: `Creatures[${i}]`, message: `Duplicate creature_id "${id}"` })
      }
      creatureIds.add(id)
    }
  })

  // Duplicate region IDs
  const regions = Array.isArray(s.Regions) ? s.Regions : []
  const regionIds = new Set<string>()
  regions.forEach((r: any, i: number) => {
    const id = r.Region?.region_id
    if (id) {
      if (regionIds.has(id)) {
        warnings.push({ field: `Regions[${i}]`, message: `Duplicate region_id "${id}"` })
      }
      regionIds.add(id)
    }
  })

  // Duplicate organization IDs
  const orgs = Array.isArray(s.Organizations) ? s.Organizations : []
  const orgIds = new Set<string>()
  orgs.forEach((o: any, i: number) => {
    const id = o.Organization?.organization_id
    if (id) {
      if (orgIds.has(id)) {
        warnings.push({ field: `Organizations[${i}]`, message: `Duplicate organization_id "${id}"` })
      }
      orgIds.add(id)
    }
  })

  return { valid: true, errors: [], warnings, autoFixes }
}

// ============================================================================
// SettingDocument Validation (for editor path-based validation)
// ============================================================================

/**
 * Validate and clean SettingDocuments array
 */
export function validateSettingDocuments(
  documents: unknown,
  _state: StateData
): ValidateAndCleanResult<SettingDocument[]> {
  const warnings: ValidationWarning[] = []
  const cleanedDocs: SettingDocument[] = []

  if (!Array.isArray(documents)) {
    return { value: [], warnings: [{ message: 'SettingDocuments must be an array' }], hasChanges: true }
  }

  for (let i = 0; i < documents.length; i++) {
    const result = SettingDocumentSchema.safeParse(documents[i])
    if (!result.success) {
      const errors = result.error.issues.map(issue => issue.message).join('; ')
      warnings.push({ index: i, message: `Invalid document: ${errors}` })
      continue
    }
    cleanedDocs.push(result.data as SettingDocument)
  }

  return { value: cleanedDocs, warnings, hasChanges: cleanedDocs.length !== documents.length }
}

/**
 * Validate CustomComponentRegistry
 */
export function validateCustomComponentRegistry(
  value: unknown,
  _state: StateData
): ValidateAndCleanResult<unknown> {
  const result = CustomComponentRegistrySchema.safeParse(value)
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { value: null, warnings: [{ message: `Invalid CustomComponentRegistry: ${errors}` }], hasChanges: true }
  }
  return { value: result.data, warnings: [], hasChanges: false }
}

// ============================================================================
// Generic Value Validation for setStateContent
// ============================================================================

export function validateValueForPath(
  path: string,
  value: unknown,
  state: StateData
): ValidateAndCleanResult<unknown> {
  if (path.includes('BindSetting.documents')) {
    if (Array.isArray(value)) {
      return validateSettingDocuments(value, state)
    }
    const result = SettingDocumentSchema.safeParse(value)
    if (!result.success) {
      const errors = result.error.issues.map(issue => issue.message).join('; ')
      return { value: null, warnings: [{ message: `Invalid SettingDocument: ${errors}` }], hasChanges: true }
    }
    return { value: result.data, warnings: [], hasChanges: false }
  }

  if (path === 'World.CustomComponentRegistry' || path === 'World/CustomComponentRegistry') {
    return validateCustomComponentRegistry(value, state)
  }

  return { value, warnings: [], hasChanges: false }
}

// ============================================================================
// Format Validation Result for Tool Output
// ============================================================================

export function formatValidationWarnings(warnings: ValidationWarning[]): string {
  if (warnings.length === 0) return ''
  const lines = [`\n⚠️ Warnings (${warnings.length}):`]
  for (const w of warnings) {
    if (w.index !== undefined) lines.push(`  - Item ${w.index}: ${w.message}`)
    else if (w.field) lines.push(`  - ${w.field}: ${w.message}`)
    else lines.push(`  - ${w.message}`)
  }
  return lines.join('\n')
}

// ============================================================================
// Unified State Loading Validation
// ============================================================================

export interface ValidateAndLoadResult {
  state: StateData | null
  accepted: boolean
  errors: string[]
  warnings: string[]
  autoFixes: string[]
}

/**
 * Validate raw data from any source before loading into the editor.
 * Runs: migration → auto-fix → Zod validation.
 *
 * - Blocking errors → rejected (state=null)
 * - Warnings only → accepted with auto-fixes applied
 */
export function validateAndLoadState(
  raw: unknown,
  options?: { requireV2?: boolean }
): ValidateAndLoadResult {
  if (!raw || typeof raw !== 'object') {
    return { state: null, accepted: false, errors: ['Data is not an object'], warnings: [], autoFixes: [] }
  }

  const data = raw as Record<string, any>

  if (options?.requireV2 && data._save_version !== 'v2') {
    return { state: null, accepted: false, errors: ['Incompatible save version: missing _save_version="v2"'], warnings: [], autoFixes: [] }
  }

  if (!data.World || typeof data.World !== 'object') {
    return { state: null, accepted: false, errors: ['Missing or invalid World object — data is not a valid StateData'], warnings: [], autoFixes: [] }
  }

  // Legacy migration
  migrateStateData(data)

  // Full Zod validation (includes auto-fix)
  const result = validateFullState(data)

  if (!result.valid) {
    console.warn('[validateAndLoadState] Rejected:', result.errors)
    return {
      state: null,
      accepted: false,
      errors: result.errors,
      warnings: result.warnings.map(w => w.message),
      autoFixes: result.autoFixes,
    }
  }

  if (result.autoFixes.length > 0) {
    console.info('[validateAndLoadState] Auto-fixes:', result.autoFixes)
  }

  return {
    state: data as StateData,
    accepted: true,
    errors: [],
    warnings: result.warnings.map(w => w.message),
    autoFixes: result.autoFixes,
  }
}
