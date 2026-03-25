/**
 * State Validation Module
 * 
 * Uses Zod v4 for runtime validation of state data before setting.
 * Provides automatic filtering of invalid items and warning collection.
 */

import { z } from 'zod'
import type { StateData, SettingDocument, CreatureSnapshot, RegionSnapshot, OrganizationSnapshot } from './types'

// ============================================================================
// SettingDocument Validation
// ============================================================================

/**
 * SettingDocument Schema (entity-scoped, uses `name` instead of `path`)
 */
const SettingDocumentSchema = z.object({
  name: z.string().min(1, { message: 'Document name must not be empty' }),
  content: z.string(),
  static_priority: z.number().optional(),
  condition: z.string().optional()  // Natural language condition for LLM recall
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

// ============================================================================
// Entity Name Extractors
// ============================================================================

/**
 * Get all creature names from state
 */
const getCreatureNames = (state: StateData): Set<string> => {
  const names = new Set<string>()
  const creatures = state.Creatures || []
  for (const c of creatures) {
    const name = c.Creature?.name
    if (name) names.add(name)
  }
  return names
}

/**
 * Get all region names from state
 */
const getRegionNames = (state: StateData): Set<string> => {
  const names = new Set<string>()
  const regions = state.Regions || []
  for (const r of regions) {
    const name = r.Metadata?.name
    if (name) names.add(name)
  }
  return names
}

/**
 * Get all organization names from state
 */
const getOrganizationNames = (state: StateData): Set<string> => {
  const names = new Set<string>()
  const orgs = state.Organizations || []
  for (const o of orgs) {
    const name = o.Organization?.name
    if (name) names.add(name)
  }
  return names
}

// ============================================================================
// SettingDocument Validation with Entity Check
// ============================================================================

/**
 * Validate and clean SettingDocuments array
 * - Filters out items with invalid path format
 * - Filters out items missing required fields
 * - Warns about paths referencing non-existent entities
 */
export function validateSettingDocuments(
  documents: unknown,
  state: StateData
): ValidateAndCleanResult<SettingDocument[]> {
  const warnings: ValidationWarning[] = []
  const cleanedDocs: SettingDocument[] = []
  
  // Must be an array
  if (!Array.isArray(documents)) {
    return {
      value: [],
      warnings: [{ message: 'SettingDocuments must be an array' }],
      hasChanges: true
    }
  }
  
  // Get existing entity names for reference checking
  const creatureNames = getCreatureNames(state)
  const regionNames = getRegionNames(state)
  const orgNames = getOrganizationNames(state)
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i]
    
    // Validate structure
    const result = SettingDocumentSchema.safeParse(doc)
    
    if (!result.success) {
      // Extract error messages
      const errors = result.error.issues.map(issue => issue.message).join('; ')
      warnings.push({
        index: i,
        message: `Invalid document: ${errors}`
      })
      continue // Filter out this item
    }
    
    const validDoc = result.data as SettingDocument
    
    // Entity reference checking is no longer needed since docs are now scoped to entities
    const docName = validDoc.name
    
    // Warn if neither static_priority nor condition is set
    if (validDoc.static_priority === undefined && !validDoc.condition) {
      warnings.push({
        index: i,
        field: 'static_priority/condition',
        message: `Document "${validDoc.name}" has no recall control (static_priority or condition). Consider adding one for better RAG performance.`
      })
    }
    
    cleanedDocs.push(validDoc)
  }
  
  return {
    value: cleanedDocs,
    warnings,
    hasChanges: cleanedDocs.length !== documents.length
  }
}

// ============================================================================
// CustomComponentDef Validation
// ============================================================================

/**
 * CustomComponentDef Schema - validates structure for custom component definitions
 * component_key is REQUIRED
 */
const CustomComponentDefSchema = z.object({
  component_key: z.string().min(1, 'component_key is required'),
  is_array: z.boolean(),
  type_schema: z.string().optional(),
  data_registry: z.array(z.object({
    item_id: z.string().min(1, 'item_id is required'),
    data: z.any()
  })).optional()
})

/**
 * Validate CustomComponentRegistry
 */
export function validateCustomComponentRegistry(
  value: unknown,
  _state: StateData
): ValidateAndCleanResult<unknown> {
  const warnings: ValidationWarning[] = []
  
  if (typeof value !== 'object' || value === null) {
    return {
      value: null,
      warnings: [{ message: 'CustomComponentRegistry must be an object with "custom_components" array' }],
      hasChanges: true
    }
  }
  
  const registry = value as any
  if (!Array.isArray(registry.custom_components)) {
    return {
      value: null,
      warnings: [{ message: 'CustomComponentRegistry.custom_components must be an array' }],
      hasChanges: true
    }
  }
  
  const cleanedDefs: any[] = []
  let hasChanges = false
  
  for (let i = 0; i < registry.custom_components.length; i++) {
    const def = registry.custom_components[i]
    const result = CustomComponentDefSchema.safeParse(def)
    
    if (!result.success) {
      const errors = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      warnings.push({
        index: i,
        message: `Invalid CustomComponentDef: ${errors}. ⚠️ Please use getArtifactContent("builtin_statedata_schema") to check the correct structure.`
      })
      hasChanges = true
      continue // Filter out invalid def
    }
    
    cleanedDefs.push(result.data)
  }
  
  return {
    value: { ...registry, custom_components: cleanedDefs },
    warnings,
    hasChanges
  }
}

// ============================================================================
// Generic Value Validation for setStateContent
// ============================================================================

/**
 * Validate value before setting to state
 * Returns cleaned value and any warnings
 */
export function validateValueForPath(
  path: string,
  value: unknown,
  state: StateData
): ValidateAndCleanResult<unknown> {
  // SettingDocuments are now entity-scoped via BindSetting.documents
  // Validate individual SettingDocument items within BindSetting
  if (path.includes('BindSetting.documents[') || path.includes('BindSetting.documents')) {
    if (Array.isArray(value)) {
      return validateSettingDocuments(value, state)
    }
    const result = SettingDocumentSchema.safeParse(value)
    if (!result.success) {
      const errors = result.error.issues.map(issue => issue.message).join('; ')
      return {
        value: null,
        warnings: [{ message: `Invalid SettingDocument: ${errors}` }],
        hasChanges: true
      }
    }
    return {
      value: result.data,
      warnings: [],
      hasChanges: false
    }
  }
  
  // Special handling for CustomComponentRegistry
  if (path === 'World.CustomComponentRegistry' || path === 'World/CustomComponentRegistry') {
    return validateCustomComponentRegistry(value, state)
  }
  
  // Default: no validation, pass through
  return {
    value,
    warnings: [],
    hasChanges: false
  }
}

// ============================================================================
// Format Validation Result for Tool Output
// ============================================================================

/**
 * Format validation warnings for tool output
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
// Full State Validation (for updateStateWithJavascript)
// ============================================================================

export interface FullStateValidationResult {
  valid: boolean
  errors: string[]
  warnings: ValidationWarning[]
  autoFixes: string[]
}

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

/**
 * Validate the entire state object after JS code execution.
 * Returns errors (block commit), warnings (informational), and autoFixes (mutations applied).
 * Auto-fixes mutate the state object in-place to correct common AI mistakes.
 */
export function validateFullState(state: unknown): FullStateValidationResult {
  const errors: string[] = []
  const warnings: ValidationWarning[] = []
  const autoFixes: string[] = []

  // 1. Must be an object
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['state must be an object'], warnings: [], autoFixes: [] }
  }

  const s = state as Record<string, unknown>

  // 2. World must exist and be an object
  if (!s.World || typeof s.World !== 'object') {
    errors.push('state.World is required and must be an object')
  }

  // 3. Arrays must be arrays (if present)
  const arrayFields = ['Creatures', 'Regions', 'Organizations', 'StoryHistory'] as const
  for (const field of arrayFields) {
    if (s[field] !== undefined && !Array.isArray(s[field])) {
      errors.push(`state.${field} must be an array (got ${typeof s[field]})`)
    }
  }

  // 4. Creature validation
  const creatures = Array.isArray(s.Creatures) ? s.Creatures : []
  const creatureIds = new Set<string>()

  // Valid fields for Creature (whitelist)
  const VALID_CREATURE_ATTR_FIELDS = new Set([
    'creature_id', 'name', 'organization_id', 'titles',
    'appearance', 'gender', 'race', 'emotion', 'skills', 'attrs',
    'known_infos', 'goal'
  ])

  creatures.forEach((c: unknown, i: number) => {
    if (!c || typeof c !== 'object') {
      errors.push(`Creatures[${i}] must be an object`)
      return
    }
    const creature = c as Record<string, unknown>

    // Auto-assign entity_id if missing (legacy ECS field, auto-managed)
    if (typeof creature.entity_id !== 'number') {
      creature.entity_id = i + 1
    }

    const attrs = creature.Creature as Record<string, unknown> | undefined
    if (!attrs || typeof attrs !== 'object') {
      errors.push(`Creatures[${i}].Creature is required`)
      return
    }
    if (!attrs.creature_id || typeof attrs.creature_id !== 'string') {
      errors.push(`Creatures[${i}].Creature.creature_id is required (string)`)
    } else {
      creatureIds.add(attrs.creature_id as string)
    }
    if (!attrs.name || typeof attrs.name !== 'string') {
      errors.push(`Creatures[${i}].Creature.name is required (string)`)
    }

    // 4a. Creature field whitelist validation + auto-fix description
    for (const key of Object.keys(attrs)) {
      if (!VALID_CREATURE_ATTR_FIELDS.has(key)) {
        if (key === 'description') {
          // AUTO-FIX: move description → appearance.body
          const descValue = attrs.description as string
          if (typeof descValue === 'string' && descValue.length > 0) {
            if (!attrs.appearance || typeof attrs.appearance !== 'object') {
              attrs.appearance = { body: '', clothing: '' }
            }
            const app = attrs.appearance as Record<string, unknown>
            if (app.body && typeof app.body === 'string') {
              app.body = app.body + '\n' + descValue
            } else {
              app.body = descValue
            }
            autoFixes.push(`Creatures[${i}]: auto-moved description → appearance.body`)
          }
          delete attrs.description
        } else {
          warnings.push({
            field: `Creatures[${i}].Creature.${key}`,
            message: `Unknown field "${key}" in Creature. Valid fields: ${[...VALID_CREATURE_ATTR_FIELDS].join(', ')}`
          })
        }
      }
    }

    // 4b. IsPlayer type auto-fix
    if (creature.IsPlayer !== undefined) {
      if (typeof creature.IsPlayer !== 'object' || creature.IsPlayer === null || Array.isArray(creature.IsPlayer)) {
        const oldType = Array.isArray(creature.IsPlayer) ? '[]' : String(creature.IsPlayer)
        creature.IsPlayer = {}
        autoFixes.push(`Creatures[${i}]: auto-fixed IsPlayer from ${oldType} → {}`)
      }
    }

    // 4c. Inventory structure auto-fix
    if (creature.Inventory !== undefined) {
      const inv = creature.Inventory as Record<string, unknown>
      if (inv && typeof inv === 'object' && Array.isArray(inv.items)) {
        (inv.items as unknown[]).forEach((item: unknown, j: number) => {
          if (!item || typeof item !== 'object') return
          const itemObj = item as Record<string, unknown>

          // AUTO-FIX: rename item_id → id
          if ('item_id' in itemObj && !('id' in itemObj)) {
            itemObj.id = itemObj.item_id
            delete itemObj.item_id
            autoFixes.push(`Creatures[${i}].Inventory.items[${j}]: auto-renamed item_id → id`)
          }
          // AUTO-FIX: rename quantity → count
          if ('quantity' in itemObj && !('count' in itemObj)) {
            itemObj.count = itemObj.quantity
            delete itemObj.quantity
            autoFixes.push(`Creatures[${i}].Inventory.items[${j}]: auto-renamed quantity → count`)
          }

          // Check correct fields exist (after auto-fix)
          if (!('id' in itemObj) || typeof itemObj.id !== 'string') {
            warnings.push({
              field: `Creatures[${i}].Inventory.items[${j}]`,
              message: `Missing required field "id" (string). Correct format: { id: string, count: number }`
            })
          }
          if (!('count' in itemObj) || typeof itemObj.count !== 'number') {
            warnings.push({
              field: `Creatures[${i}].Inventory.items[${j}]`,
              message: `Missing required field "count" (number). Correct format: { id: string, count: number }`
            })
          }
        })
      }
    }
  })

  // 5. World.Registry validation
  // Collect registered item IDs for referential integrity check
  const registeredItemIds = new Set<string>()
  if (s.World && typeof s.World === 'object') {
    const world = s.World as Record<string, unknown>
    const registry = world.Registry as Record<string, unknown> | undefined
    if (registry && typeof registry === 'object') {
      // Collect registered item IDs
      if (Array.isArray(registry.items)) {
        for (const itemDef of registry.items) {
          if (itemDef && typeof itemDef === 'object' && typeof (itemDef as any).id === 'string') {
            registeredItemIds.add((itemDef as any).id)
          }
        }
      }
      // 5b. ItemDef field whitelist + auto-fix
      const VALID_ITEMDEF_FIELDS = new Set(['id', 'name', 'description', 'detail', 'equippable_slot', 'equippable_attributes'])
      if (Array.isArray(registry.items)) {
        for (let idx = 0; idx < registry.items.length; idx++) {
          const itemDef = registry.items[idx] as Record<string, unknown> | null
          if (!itemDef || typeof itemDef !== 'object') continue
          const extraFields: string[] = []
          for (const key of Object.keys(itemDef)) {
            if (!VALID_ITEMDEF_FIELDS.has(key)) {
              extraFields.push(`${key}=${JSON.stringify(itemDef[key])}`)
            }
          }
          // AUTO-FIX: merge non-schema fields into description
          if (extraFields.length > 0) {
            const extraText = extraFields.join(', ')
            const desc = (itemDef.description as string) || ''
            itemDef.description = desc ? `${desc} [${extraText}]` : `[${extraText}]`
            for (const key of Object.keys(itemDef)) {
              if (!VALID_ITEMDEF_FIELDS.has(key)) delete itemDef[key]
            }
            autoFixes.push(`Registry.items[${idx}]: auto-merged non-schema fields into description: ${extraText}`)
          }
        }
      }

      // 5c. SkillDef field whitelist + auto-fix
      const VALID_SKILLDEF_FIELDS = new Set(['id', 'name', 'description', 'details'])
      if (Array.isArray(registry.skills)) {
        for (let idx = 0; idx < (registry.skills as unknown[]).length; idx++) {
          const skillDef = (registry.skills as unknown[])[idx] as Record<string, unknown> | null
          if (!skillDef || typeof skillDef !== 'object') continue
          const extraFields: string[] = []
          for (const key of Object.keys(skillDef)) {
            if (!VALID_SKILLDEF_FIELDS.has(key)) {
              extraFields.push(`${key}=${JSON.stringify(skillDef[key])}`)
            }
          }
          // AUTO-FIX: merge non-schema fields into description
          if (extraFields.length > 0) {
            const extraText = extraFields.join(', ')
            const desc = (skillDef.description as string) || ''
            skillDef.description = desc ? `${desc} [${extraText}]` : `[${extraText}]`
            for (const key of Object.keys(skillDef)) {
              if (!VALID_SKILLDEF_FIELDS.has(key)) delete skillDef[key]
            }
            autoFixes.push(`Registry.skills[${idx}]: auto-merged non-schema fields into description: ${extraText}`)
          }
        }
      }
    }
  }

  // 5a. Item ID referential integrity: check Inventory items against Registry.items
  if (registeredItemIds.size > 0) {
    creatures.forEach((c: unknown, i: number) => {
      if (!c || typeof c !== 'object') return
      const creature = c as Record<string, unknown>
      if (!creature.Inventory || typeof creature.Inventory !== 'object') return
      const inv = creature.Inventory as Record<string, unknown>
      if (!Array.isArray(inv.items)) return

      (inv.items as unknown[]).forEach((item: unknown, j: number) => {
        if (!item || typeof item !== 'object') return
        const itemObj = item as Record<string, unknown>
        const itemId = (itemObj.id || itemObj.item_id) as string | undefined
        if (typeof itemId === 'string' && !registeredItemIds.has(itemId)) {
          warnings.push({
            field: `Creatures[${i}].Inventory.items[${j}]`,
            message: `Item ID "${itemId}" is not registered in World.Registry.items. Available IDs: ${[...registeredItemIds].slice(0, 10).join(', ')}${registeredItemIds.size > 10 ? '...' : ''}`
          })
        }
      })
    })
  }

  // 5d. Region entity validation
  const regions = Array.isArray(s.Regions) ? s.Regions : []
  const VALID_REGION_FIELDS = new Set(['entity_id', 'Region'])
  regions.forEach((r: unknown, i: number) => {
    if (!r || typeof r !== 'object') return
    const region = r as Record<string, unknown>
    // Auto-assign entity_id if missing
    if (typeof region.entity_id !== 'number') {
      region.entity_id = creatures.length + i + 1
    }
    for (const key of Object.keys(region)) {
      if (!VALID_REGION_FIELDS.has(key)) {
        warnings.push({
          field: `Regions[${i}].${key}`,
          message: `Unknown field "${key}" in Region entity. Valid fields: ${[...VALID_REGION_FIELDS].join(', ')}. Use Region for region name and description.`
        })
      }
    }
  })

  // 5e. Organization entity validation
  const orgs = Array.isArray(s.Organizations) ? s.Organizations : []
  const VALID_ORG_FIELDS = new Set(['entity_id', 'Organization'])
  orgs.forEach((o: unknown, i: number) => {
    if (!o || typeof o !== 'object') return
    const org = o as Record<string, unknown>
    // Auto-assign entity_id if missing
    if (typeof org.entity_id !== 'number') {
      org.entity_id = creatures.length + regions.length + i + 1
    }
    for (const key of Object.keys(org)) {
      if (!VALID_ORG_FIELDS.has(key)) {
        warnings.push({
          field: `Organizations[${i}].${key}`,
          message: `Unknown field "${key}" in Organization entity. Valid fields: ${[...VALID_ORG_FIELDS].join(', ')}`
        })
      }
    }
  })

  // 6. SettingDocuments are now entity-scoped via BindSetting.documents
  // No top-level SettingDocuments to validate

  // 7. CustomComponentRegistry validation (reuse existing)
  if (s.World && typeof s.World === 'object') {
    const world = s.World as Record<string, unknown>
    if (world.CustomComponentRegistry !== undefined) {
      const ccResult = validateCustomComponentRegistry(world.CustomComponentRegistry, s as unknown as StateData)
      warnings.push(...ccResult.warnings)
    }
  }

  // 8. GameInitialStory validation
  if (s.GameInitialStory !== undefined) {
    if (typeof s.GameInitialStory !== 'object' || s.GameInitialStory === null) {
      errors.push('GameInitialStory must be an object')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    autoFixes
  }
}
