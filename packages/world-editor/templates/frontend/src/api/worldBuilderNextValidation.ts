/**
 * WorldBuilderNext Validation
 *
 * Zod-based schema validation + semantic validation for phase report outputs.
 * When validation fails, errors are sent back to the AI for retry.
 */

import { z } from 'zod'
import type { WBNPhaseId, WBNSession, WBNDraftOutput } from './worldBuilderNextTypes'

// ============================================================================
// Validation Result
// ============================================================================

export interface PhaseValidationResult {
    valid: boolean
    errors: string[]      // Blocking errors (must fix)
    warnings: string[]    // Non-blocking warnings (informational)
}

// ============================================================================
// Zod Schemas (mirrors JSON Schema in worldBuilderNextPrompts.ts)
// ============================================================================

const SettingDocumentSchema = z.object({
    name: z.string().min(1, 'document name must not be empty'),
    content: z.string().min(1, 'document content must not be empty'),
    condition: z.string().optional(),
})

const BindSettingSchema = z.object({
    documents: z.array(SettingDocumentSchema),
}).optional()

// ----- world_data -----

const WorldDataOutputSchema = z.object({
    creature_attr_fields: z.array(z.object({
        field_name: z.string().min(1),
        hint: z.string().min(1),
        field_display_name: z.string().optional(),
    })).min(1, 'creature_attr_fields must have at least 1 entry'),
    GameTime: z.object({
        year: z.number(),
        month: z.number().min(1).max(12),
        day: z.number().min(1).max(31),
        hour: z.number().min(0).max(23),
        minute: z.number().min(0).max(59),
    }),
    CustomComponentRegistry: z.object({
        custom_components: z.array(z.object({
            component_key: z.string().min(1),
            component_name: z.string().min(1),
            fields: z.array(z.object({
                field_name: z.string().min(1),
                field_type: z.string().min(1),
                field_description: z.string().min(1),
            })),
        })),
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
    territories: z.array(z.object({
        region_id: z.string().min(1),
        location_id: z.string().min(1),
    })),
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
    LocationRef: z.object({
        region_id: z.string().min(1),
        location_id: z.string().min(1),
    }).optional(),
    Inventory: z.object({
        items: z.array(InventoryItemSchema),
    }).optional(),
    Relationship: z.object({
        relationships: z.array(RelationshipEntrySchema),
    }).optional(),
    StatusEffects: z.object({
        status_effects: z.array(StatusEffectSchema),
    }).optional(),
    CustomComponents: z.object({
        custom_components: z.array(CustomComponentEntrySchema),
    }).optional(),
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

    // Collect error messages with paths
    const errors: string[] = []
    if (result.error && 'issues' in result.error) {
        for (const issue of (result.error as any).issues || []) {
            const path = (issue.path || []).join('.')
            const msg = issue.message || 'invalid'
            errors.push(path ? `${path}: ${msg}` : msg)
        }
    }
    if (errors.length === 0) {
        errors.push('Schema validation failed (unknown error)')
    }
    return errors
}

// ============================================================================
// Semantic Validation
// ============================================================================

function validateWorldDataSemantics(output: any, _session: WBNSession): { errors: string[], warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Warn on short documents
    const docs = output.documents || []
    for (const doc of docs) {
        if (doc.content && doc.content.length < 200) {
            warnings.push(`文档 "${doc.name}" 内容仅 ${doc.content.length} 字，建议至少 500 字以上`)
        }
    }

    return { errors, warnings }
}

function validateRegionsSemantics(output: any, _session: WBNSession): { errors: string[], warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    const regions = output.regions || []
    for (const region of regions) {
        const locationIds = new Set((region.locations || []).map((l: any) => l.id))

        for (const path of region.paths || []) {
            // Validate src_location within its region
            if (path.src_region === region.region_id && !locationIds.has(path.src_location)) {
                errors.push(`地域 "${region.region_id}" 的路径 src_location "${path.src_location}" 不存在于该地域的地点列表中`)
            }
            // Validate to_location when same region
            if (path.to_region === region.region_id && !locationIds.has(path.to_location)) {
                errors.push(`地域 "${region.region_id}" 的路径 to_location "${path.to_location}" 不存在于该地域的地点列表中`)
            }
        }
    }

    // Cross-region path validation: to_location must exist in to_region
    const allRegionLocations = new Map<string, Set<string>>()
    for (const region of regions) {
        allRegionLocations.set(region.region_id, new Set((region.locations || []).map((l: any) => l.id)))
    }
    for (const region of regions) {
        for (const path of region.paths || []) {
            if (path.to_region !== region.region_id) {
                const targetLocations = allRegionLocations.get(path.to_region)
                if (!targetLocations) {
                    errors.push(`地域 "${region.region_id}" 的路径引用了不存在的目标地域 "${path.to_region}"`)
                } else if (!targetLocations.has(path.to_location)) {
                    errors.push(`地域 "${region.region_id}" 的路径 to_location "${path.to_location}" 不存在于目标地域 "${path.to_region}" 中`)
                }
            }
        }
    }

    return { errors, warnings }
}

function validateOrganizationsSemantics(output: any, session: WBNSession): { errors: string[], warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Collect valid region/location IDs from completed regions phase
    const regionsOutput = session.phases.regions?.output as any
    const validRegionIds = new Set<string>()
    const validLocationsByRegion = new Map<string, Set<string>>()
    if (regionsOutput?.regions) {
        for (const r of regionsOutput.regions) {
            validRegionIds.add(r.region_id)
            const locs = new Set<string>()
            for (const l of r.locations || []) locs.add(l.id)
            validLocationsByRegion.set(r.region_id, locs)
        }
    }

    const orgs = output.organizations || []
    for (const org of orgs) {
        for (const territory of org.territories || []) {
            if (!validRegionIds.has(territory.region_id)) {
                warnings.push(`组织 "${org.organization_id}" 的领地引用了不存在的地域 "${territory.region_id}"`)
            } else {
                const locs = validLocationsByRegion.get(territory.region_id)
                if (locs && !locs.has(territory.location_id)) {
                    warnings.push(`组织 "${org.organization_id}" 的领地引用了不存在的地点 "${territory.location_id}"（地域 "${territory.region_id}"）`)
                }
            }
        }
    }

    return { errors, warnings }
}

function validateCreaturesSemantics(output: any, session: WBNSession): { errors: string[], warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    const creatures = output.creatures || []
    const generatedIds = creatures
        .map((c: any) => c.Creature?.creature_id)
        .filter(Boolean) as string[]

    // 1. Check batch completeness
    if (session.creatureBatching) {
        const batch = session.creatureBatching.batchPlan[session.creatureBatching.currentBatch]
        if (batch) {
            const missingIds = batch.creatureIds.filter(id => !generatedIds.includes(id))
            if (missingIds.length > 0) {
                errors.push(`本批次缺少以下角色: [${missingIds.join(', ')}]。creatures 数组必须包含所有指定角色。`)
            }
        }
    }

    // Collect valid region/location IDs
    const regionsOutput = session.phases.regions?.output as any
    const validLocationsByRegion = new Map<string, Set<string>>()
    if (regionsOutput?.regions) {
        for (const r of regionsOutput.regions) {
            const locs = new Set<string>()
            for (const l of r.locations || []) locs.add(l.id)
            validLocationsByRegion.set(r.region_id, locs)
        }
    }

    // Collect valid organization IDs
    const orgsOutput = session.phases.organizations?.output as any
    const validOrgIds = new Set<string>()
    if (orgsOutput?.organizations) {
        for (const o of orgsOutput.organizations) validOrgIds.add(o.organization_id)
    }

    // Collect registered custom component keys
    const worldDataOutput = session.phases.world_data?.output as any
    const registeredComponentKeys = new Set<string>()
    if (worldDataOutput?.CustomComponentRegistry?.custom_components) {
        for (const comp of worldDataOutput.CustomComponentRegistry.custom_components) {
            registeredComponentKeys.add(comp.component_key)
        }
    }

    // Collect valid attr field names
    const validAttrFields = new Set<string>()
    if (worldDataOutput?.creature_attr_fields) {
        for (const field of worldDataOutput.creature_attr_fields) {
            validAttrFields.add(field.field_name)
        }
    }

    // Collect all known creature IDs (prior batches + current batch)
    const allKnownCreatureIds = new Set<string>(generatedIds)
    const draft = session.phases.synopsis?.output as WBNDraftOutput | undefined
    if (draft?.creatures) {
        for (const c of draft.creatures) allKnownCreatureIds.add(c.creature_id)
    }
    // Prior batch creatures
    const priorCreaturesOutput = session.phases.creatures?.output as any
    if (priorCreaturesOutput?.creatures) {
        for (const c of priorCreaturesOutput.creatures) {
            const id = c.Creature?.creature_id
            if (id) allKnownCreatureIds.add(id)
        }
    }

    for (const creature of creatures) {
        const attrs = creature.Creature
        const cId = attrs?.creature_id || '(unknown)'

        // 2. Validate LocationRef
        if (creature.LocationRef) {
            const { region_id, location_id } = creature.LocationRef
            const locs = validLocationsByRegion.get(region_id)
            if (!locs) {
                errors.push(`角色 "${cId}" 的 LocationRef 引用了不存在的地域 "${region_id}"`)
            } else if (!locs.has(location_id)) {
                errors.push(`角色 "${cId}" 的 LocationRef 引用了不存在的地点 "${location_id}"（地域 "${region_id}"）`)
            }
        }

        // 3. Validate organization_id
        if (attrs?.organization_id && !session.skipOrganizations) {
            if (validOrgIds.size > 0 && !validOrgIds.has(attrs.organization_id)) {
                warnings.push(`角色 "${cId}" 的 organization_id "${attrs.organization_id}" 不在已生成的组织列表中`)
            }
        }

        // 4. Validate CustomComponents keys
        if (creature.CustomComponents?.custom_components) {
            for (const comp of creature.CustomComponents.custom_components) {
                if (registeredComponentKeys.size > 0 && !registeredComponentKeys.has(comp.component_key)) {
                    errors.push(`角色 "${cId}" 使用了未注册的 CustomComponent key "${comp.component_key}"`)
                }
            }
        }

        // 5. Validate attrs keys
        if (attrs?.attrs && validAttrFields.size > 0) {
            for (const key of Object.keys(attrs.attrs)) {
                if (!validAttrFields.has(key)) {
                    warnings.push(`角色 "${cId}" 的属性 "${key}" 不在已定义的 creature_attr_fields 中`)
                }
            }
        }

        // 6. Validate Relationship target IDs
        if (creature.Relationship?.relationships) {
            for (const rel of creature.Relationship.relationships) {
                if (!allKnownCreatureIds.has(rel.target_creature_id)) {
                    warnings.push(`角色 "${cId}" 的关系目标 "${rel.target_creature_id}" 不在已知角色列表中`)
                }
            }
        }
    }

    return { errors, warnings }
}

function validateSemantics(
    phaseId: WBNPhaseId,
    output: unknown,
    session: WBNSession
): { errors: string[], warnings: string[] } {
    switch (phaseId) {
        case 'world_data':
            return validateWorldDataSemantics(output, session)
        case 'regions':
            return validateRegionsSemantics(output, session)
        case 'organizations':
            return validateOrganizationsSemantics(output, session)
        case 'creatures':
            return validateCreaturesSemantics(output, session)
        default:
            return { errors: [], warnings: [] }
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a phase report output against schema + semantic rules.
 * Returns errors (blocking) and warnings (informational).
 */
export function validatePhaseOutput(
    phaseId: WBNPhaseId,
    output: unknown,
    session: WBNSession
): PhaseValidationResult {
    // Schema validation
    const schemaErrors = validateSchema(phaseId, output)

    // Semantic validation (only if schema passes — semantic rules assume valid structure)
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

/**
 * Format validation errors into a tool response message for the AI.
 */
export function formatValidationErrorsForAI(result: PhaseValidationResult): string {
    const lines: string[] = [
        '数据验证失败，请修正以下问题后重新调用 report 工具提交完整数据：',
        '',
    ]

    if (result.errors.length > 0) {
        lines.push('## 必须修正的错误')
        for (const err of result.errors) {
            lines.push(`- ${err}`)
        }
        lines.push('')
    }

    if (result.warnings.length > 0) {
        lines.push('## 建议修正的警告')
        for (const warn of result.warnings) {
            lines.push(`- ${warn}`)
        }
        lines.push('')
    }

    lines.push('> 请重新调用 report 工具提交修正后的**完整**数据（不是增量补丁）。')
    return lines.join('\n')
}
