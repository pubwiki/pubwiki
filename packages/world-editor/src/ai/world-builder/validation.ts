/**
 * WorldBuilder Validation
 *
 * Zod-based schema validation + semantic validation for phase outputs.
 * When validation fails, errors are sent back to the AI for retry.
 *
 * Migrated from worldBuilderNextValidation.ts.
 */

import { z } from 'zod'
import type { WBNPhaseId, WBNSession, WBNDraftOutput } from './types'

// ============================================================================
// Validation Result
// ============================================================================

export interface PhaseValidationResult {
  valid: boolean
  errors: string[] // Blocking errors (must fix)
  warnings: string[] // Non-blocking warnings (informational)
}

// ============================================================================
// Zod Schemas
// ============================================================================

const SettingDocumentSchema = z.object({
  name: z.string().min(1, 'document name must not be empty'),
  content: z.string().min(1, 'document content must not be empty'),
  condition: z.string().optional(),
})

const BindSettingSchema = z
  .object({
    documents: z.array(SettingDocumentSchema),
  })
  .optional()

// ----- world_data -----

const WorldDataOutputSchema = z.object({
  creature_attr_fields: z
    .array(
      z.object({
        field_name: z.string().min(1),
        hint: z.string().min(1),
        field_display_name: z.string().optional(),
      }),
    )
    .min(1, 'creature_attr_fields must have at least 1 entry'),
  GameTime: z.object({
    year: z.number(),
    month: z.number().min(1).max(12),
    day: z.number().min(1).max(31),
    hour: z.number().min(0).max(23),
    minute: z.number().min(0).max(59),
  }),
  CustomComponentRegistry: z.object({
    custom_components: z.array(
      z.object({
        component_key: z.string().min(1),
        component_name: z.string().min(1),
        fields: z.array(
          z.object({
            field_name: z.string().min(1),
            field_type: z.string().min(1),
            field_description: z.string().min(1),
          }),
        ),
      }),
    ),
  }),
  documents: z.array(SettingDocumentSchema).min(1, 'must have at least 1 setting document'),
})

// ----- regions -----

const RegionLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
})

const RegionPathSchema = z.object({
  src_location: z.string().min(1),
  src_region: z.string().min(1),
  to_region: z.string().min(1),
  to_location: z.string().min(1),
  discovered: z.boolean(),
  description: z.string(),
})

const RegionSchema = z.object({
  region_id: z.string().min(1),
  region_name: z.string().min(1),
  description: z.string().min(1),
  locations: z.array(RegionLocationSchema).min(1, 'each region must have at least 1 location'),
  paths: z.array(RegionPathSchema),
  BindSetting: BindSettingSchema,
})

const RegionsOutputSchema = z.object({
  regions: z.array(RegionSchema).min(1, 'must have at least 1 region'),
})

// ----- organizations -----

const OrganizationSchema = z.object({
  organization_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  territories: z.array(
    z.object({
      region_id: z.string().min(1),
      location_id: z.string().min(1),
    }),
  ),
  BindSetting: BindSettingSchema,
})

const OrganizationsOutputSchema = z.object({
  organizations: z.array(OrganizationSchema).min(1, 'must have at least 1 organization'),
})

// ----- creatures -----

const CreatureDataSchema = z.object({
  creature_id: z.string().min(1),
  name: z.string().min(1),
  organization_id: z.string().optional(),
  titles: z.array(z.string()),
  appearance: z.object({
    body: z.string().min(1),
    clothing: z.string().min(1),
  }),
  gender: z.string().optional(),
  race: z.string().optional(),
  emotion: z.string().optional(),
  attrs: z.record(z.string(), z.union([z.number(), z.string()])),
  known_infos: z.array(z.string()),
  goal: z.string().optional(),
})

const InventoryItemSchema = z.object({
  id: z.string().min(1),
  count: z.number().min(1),
  name: z.string().min(1),
  description: z.string(),
  details: z.array(z.string()),
})

const RelationshipEntrySchema = z.object({
  target_creature_id: z.string().min(1),
  name: z.string().min(1),
  value: z.number(),
})

const StatusEffectSchema = z.object({
  instance_id: z.string().min(1),
  display_name: z.string().optional(),
  remark: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
})

const CustomComponentEntrySchema = z.object({
  component_key: z.string().min(1),
  data: z.unknown(),
})

const CreatureEntitySchema = z.object({
  Creature: CreatureDataSchema,
  IsPlayer: z.object({}).optional(),
  LocationRef: z
    .object({
      region_id: z.string().min(1),
      location_id: z.string().min(1),
    })
    .optional(),
  Inventory: z
    .object({
      items: z.array(InventoryItemSchema),
    })
    .optional(),
  Relationship: z
    .object({
      relationships: z.array(RelationshipEntrySchema),
    })
    .optional(),
  StatusEffects: z
    .object({
      status_effects: z.array(StatusEffectSchema),
    })
    .optional(),
  CustomComponents: z
    .object({
      custom_components: z.array(CustomComponentEntrySchema),
    })
    .optional(),
  BindSetting: BindSettingSchema,
})

const CreaturesOutputSchema = z.object({
  creatures: z.array(CreatureEntitySchema).min(1, 'must have at least 1 creature'),
})

// ----- initial_story -----

const InitialStoryOutputSchema = z.object({
  background: z.string().min(1),
  start_story: z.string().min(1),
})

// ============================================================================
// Schema Validation
// ============================================================================

const PHASE_SCHEMAS: Partial<Record<WBNPhaseId, z.ZodType>> = {
  world_data: WorldDataOutputSchema,
  regions: RegionsOutputSchema,
  organizations: OrganizationsOutputSchema,
  creatures: CreaturesOutputSchema,
  initial_story: InitialStoryOutputSchema,
}

function validateSchema(phaseId: WBNPhaseId, output: unknown): string[] {
  const schema = PHASE_SCHEMAS[phaseId]
  if (!schema) return []

  const result = schema.safeParse(output)
  if (result.success) return []

  const errors: string[] = []
  for (const issue of result.error.issues) {
    const path = issue.path.join('.')
    const msg = issue.message
    errors.push(path ? `${path}: ${msg}` : msg)
  }
  if (errors.length === 0) {
    errors.push('Schema validation failed (unknown error)')
  }
  return errors
}

// ============================================================================
// Semantic Validation
// ============================================================================

function validateWorldDataSemantics(
  output: Record<string, unknown>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const docs = (output.documents as Array<{ name: string; content: string }>) || []
  for (const doc of docs) {
    if (doc.content && doc.content.length < 200) {
      warnings.push(
        `Document "${doc.name}" has only ${doc.content.length} characters, recommend at least 500`,
      )
    }
  }

  return { errors, warnings }
}

function validateRegionsSemantics(
  output: Record<string, unknown>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const regions = (output.regions as Array<Record<string, unknown>>) || []

  // Build all region locations map
  const allRegionLocations = new Map<string, Set<string>>()
  for (const region of regions) {
    const locations = (region.locations as Array<{ id: string }>) || []
    allRegionLocations.set(
      region.region_id as string,
      new Set(locations.map((l) => l.id)),
    )
  }

  for (const region of regions) {
    const regionId = region.region_id as string
    const locationIds = allRegionLocations.get(regionId)!
    const paths = (region.paths as Array<Record<string, unknown>>) || []

    for (const path of paths) {
      // Validate src_location within its region
      if (path.src_region === regionId && !locationIds.has(path.src_location as string)) {
        errors.push(
          `Region "${regionId}": path src_location "${path.src_location}" does not exist in this region's locations`,
        )
      }
      // Validate to_location within same region
      if (path.to_region === regionId && !locationIds.has(path.to_location as string)) {
        errors.push(
          `Region "${regionId}": path to_location "${path.to_location}" does not exist in this region's locations`,
        )
      }
      // Cross-region path validation
      if (path.to_region !== regionId) {
        const targetLocations = allRegionLocations.get(path.to_region as string)
        if (!targetLocations) {
          errors.push(
            `Region "${regionId}": path references non-existent target region "${path.to_region}"`,
          )
        } else if (!targetLocations.has(path.to_location as string)) {
          errors.push(
            `Region "${regionId}": path to_location "${path.to_location}" does not exist in target region "${path.to_region}"`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

function validateOrganizationsSemantics(
  output: Record<string, unknown>,
  session: WBNSession,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // Collect valid region/location IDs from completed regions phase
  const regionsOutput = session.phases.regions?.output as Record<string, unknown> | undefined
  const validRegionIds = new Set<string>()
  const validLocationsByRegion = new Map<string, Set<string>>()
  if (regionsOutput?.regions) {
    for (const r of regionsOutput.regions as Array<Record<string, unknown>>) {
      validRegionIds.add(r.region_id as string)
      const locs = new Set<string>()
      for (const l of (r.locations as Array<{ id: string }>) || []) locs.add(l.id)
      validLocationsByRegion.set(r.region_id as string, locs)
    }
  }

  const orgs =
    (output.organizations as Array<Record<string, unknown>>) || []
  for (const org of orgs) {
    for (const territory of (org.territories as Array<{
      region_id: string
      location_id: string
    }>) || []) {
      if (!validRegionIds.has(territory.region_id)) {
        warnings.push(
          `Organization "${org.organization_id}": territory references non-existent region "${territory.region_id}"`,
        )
      } else {
        const locs = validLocationsByRegion.get(territory.region_id)
        if (locs && !locs.has(territory.location_id)) {
          warnings.push(
            `Organization "${org.organization_id}": territory references non-existent location "${territory.location_id}" in region "${territory.region_id}"`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

function validateCreaturesSemantics(
  output: Record<string, unknown>,
  session: WBNSession,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const creatures = (output.creatures as Array<Record<string, unknown>>) || []
  const generatedIds = creatures
    .map((c) => (c.Creature as Record<string, unknown>)?.creature_id as string)
    .filter(Boolean)

  // Check batch completeness
  if (session.creatureBatching) {
    const batch = session.creatureBatching.batchPlan[session.creatureBatching.currentBatch]
    if (batch) {
      const missingIds = batch.creatureIds.filter((id) => !generatedIds.includes(id))
      if (missingIds.length > 0) {
        errors.push(
          `Missing characters in this batch: [${missingIds.join(', ')}]. The creatures array must include all specified characters.`,
        )
      }
    }
  }

  // Collect valid region/location IDs
  const regionsOutput = session.phases.regions?.output as Record<string, unknown> | undefined
  const validLocationsByRegion = new Map<string, Set<string>>()
  if (regionsOutput?.regions) {
    for (const r of regionsOutput.regions as Array<Record<string, unknown>>) {
      const locs = new Set<string>()
      for (const l of (r.locations as Array<{ id: string }>) || []) locs.add(l.id)
      validLocationsByRegion.set(r.region_id as string, locs)
    }
  }

  // Collect valid organization IDs
  const orgsOutput = session.phases.organizations?.output as Record<string, unknown> | undefined
  const validOrgIds = new Set<string>()
  if (orgsOutput?.organizations) {
    for (const o of orgsOutput.organizations as Array<Record<string, unknown>>) {
      validOrgIds.add(o.organization_id as string)
    }
  }

  // Collect registered custom component keys
  const worldDataOutput = session.phases.world_data?.output as Record<string, unknown> | undefined
  const registeredComponentKeys = new Set<string>()
  if (
    worldDataOutput?.CustomComponentRegistry &&
    (worldDataOutput.CustomComponentRegistry as Record<string, unknown>).custom_components
  ) {
    for (const comp of (
      worldDataOutput.CustomComponentRegistry as Record<string, unknown>
    ).custom_components as Array<{ component_key: string }>) {
      registeredComponentKeys.add(comp.component_key)
    }
  }

  // Collect valid attr field names
  const validAttrFields = new Set<string>()
  if (worldDataOutput?.creature_attr_fields) {
    for (const field of worldDataOutput.creature_attr_fields as Array<{ field_name: string }>) {
      validAttrFields.add(field.field_name)
    }
  }

  // Collect all known creature IDs
  const allKnownCreatureIds = new Set<string>(generatedIds)
  const draft = session.phases.synopsis?.output as WBNDraftOutput | undefined
  if (draft?.creatures) {
    for (const c of draft.creatures) allKnownCreatureIds.add(c.creature_id)
  }

  for (const creature of creatures) {
    const attrs = creature.Creature as Record<string, unknown> | undefined
    const cId = (attrs?.creature_id as string) || '(unknown)'

    // Validate LocationRef
    if (creature.LocationRef) {
      const loc = creature.LocationRef as { region_id: string; location_id: string }
      const locs = validLocationsByRegion.get(loc.region_id)
      if (!locs) {
        errors.push(`Character "${cId}": LocationRef references non-existent region "${loc.region_id}"`)
      } else if (!locs.has(loc.location_id)) {
        errors.push(
          `Character "${cId}": LocationRef references non-existent location "${loc.location_id}" in region "${loc.region_id}"`,
        )
      }
    }

    // Validate organization_id
    if (attrs?.organization_id && !session.skipOrganizations) {
      if (validOrgIds.size > 0 && !validOrgIds.has(attrs.organization_id as string)) {
        warnings.push(
          `Character "${cId}": organization_id "${attrs.organization_id}" is not in the generated organizations list`,
        )
      }
    }

    // Validate CustomComponents keys
    if (creature.CustomComponents) {
      const cc = creature.CustomComponents as { custom_components: Array<{ component_key: string }> }
      for (const comp of cc.custom_components || []) {
        if (registeredComponentKeys.size > 0 && !registeredComponentKeys.has(comp.component_key)) {
          errors.push(
            `Character "${cId}": uses unregistered CustomComponent key "${comp.component_key}"`,
          )
        }
      }
    }

    // Validate attrs keys
    if (attrs?.attrs && validAttrFields.size > 0) {
      for (const key of Object.keys(attrs.attrs as Record<string, unknown>)) {
        if (!validAttrFields.has(key)) {
          warnings.push(
            `Character "${cId}": attribute "${key}" is not in defined creature_attr_fields`,
          )
        }
      }
    }

    // Validate Relationship target IDs
    if (creature.Relationship) {
      const rel = creature.Relationship as {
        relationships: Array<{ target_creature_id: string }>
      }
      for (const r of rel.relationships || []) {
        if (!allKnownCreatureIds.has(r.target_creature_id)) {
          warnings.push(
            `Character "${cId}": relationship target "${r.target_creature_id}" is not in known character list`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

function validateSemantics(
  phaseId: WBNPhaseId,
  output: unknown,
  session: WBNSession,
): { errors: string[]; warnings: string[] } {
  const o = output as Record<string, unknown>
  switch (phaseId) {
    case 'world_data':
      return validateWorldDataSemantics(o)
    case 'regions':
      return validateRegionsSemantics(o)
    case 'organizations':
      return validateOrganizationsSemantics(o, session)
    case 'creatures':
      return validateCreaturesSemantics(o, session)
    default:
      return { errors: [], warnings: [] }
  }
}

// ============================================================================
// Public API
// ============================================================================

export function validatePhaseOutput(
  phaseId: WBNPhaseId,
  output: unknown,
  session: WBNSession,
): PhaseValidationResult {
  const schemaErrors = validateSchema(phaseId, output)

  let semanticErrors: string[] = []
  let semanticWarnings: string[] = []
  if (schemaErrors.length === 0) {
    const semantics = validateSemantics(phaseId, output, session)
    semanticErrors = semantics.errors
    semanticWarnings = semantics.warnings
  }

  const allErrors = [...schemaErrors, ...semanticErrors]
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: semanticWarnings,
  }
}

export function formatValidationErrorsForAI(result: PhaseValidationResult): string {
  const lines: string[] = [
    'Data validation failed. Please fix the following issues and regenerate the complete output:',
    '',
  ]

  if (result.errors.length > 0) {
    lines.push('## Errors (must fix)')
    for (const err of result.errors) {
      lines.push(`- ${err}`)
    }
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('## Warnings (recommended to fix)')
    for (const warn of result.warnings) {
      lines.push(`- ${warn}`)
    }
    lines.push('')
  }

  lines.push(
    '> Please regenerate the **complete** output (not an incremental patch).',
  )
  return lines.join('\n')
}
