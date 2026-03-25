/**
 * Editor utilities — defaults, validation, and helper functions for StateData.
 */

import type {
  StateData,
  WorldSnapshot,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  EntityType,
  CreatureComponent,
  RegionComponent,
  OrganizationComponent,
} from './state-data'

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Generate a short random ID for entities */
export function generateEntityId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10)
  const ts = Date.now().toString(36)
  return `${prefix}_${ts}_${random}`
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function createDefaultWorldSnapshot(entityId?: string): WorldSnapshot {
  return {
    entity_id: entityId ?? generateEntityId('world'),
    game_time: { year: 0, month: 1, day: 1, hour: 0, minute: 0 },
    registry: [],
    director_notes: { notes: [], flags: {}, stage_goal: null },
    custom_component_registry: [],
    log: [],
    bind_setting: { documents: [] },
  }
}

export function createDefaultCreatureComponent(): CreatureComponent {
  return {
    name: '',
    titles: [],
    gender: '',
    race: '',
    appearance: { body: '', clothing: '' },
    attrs: {},
    known_infos: [],
    personality: '',
    description: '',
  }
}

export function createDefaultCreatureSnapshot(creatureId?: string): CreatureSnapshot {
  return {
    creature_id: creatureId ?? generateEntityId('creature'),
    creature: createDefaultCreatureComponent(),
    is_player: false,
    location: { region_id: '', point: '' },
    inventory: [],
    status_effects: [],
    custom_components: [],
    relationships: [],
    bind_setting: { documents: [] },
    log: [],
  }
}

export function createDefaultRegionComponent(): RegionComponent {
  return {
    name: '',
    description: '',
    locations: [],
    paths: [],
  }
}

export function createDefaultRegionSnapshot(regionId?: string): RegionSnapshot {
  return {
    region_id: regionId ?? generateEntityId('region'),
    region: createDefaultRegionComponent(),
    status_effects: [],
    bind_setting: { documents: [] },
    log: [],
  }
}

export function createDefaultOrganizationComponent(): OrganizationComponent {
  return {
    name: '',
    description: '',
    territories: [],
  }
}

export function createDefaultOrganizationSnapshot(orgId?: string): OrganizationSnapshot {
  return {
    organization_id: orgId ?? generateEntityId('org'),
    organization: createDefaultOrganizationComponent(),
    status_effects: [],
    bind_setting: { documents: [] },
    log: [],
  }
}

export function createDefaultStateData(): StateData {
  return {
    World: createDefaultWorldSnapshot(),
    Creatures: [],
    Regions: [],
    Organizations: [],
    StoryHistory: [],
    _save_version: 'v2',
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string
  message: string
}

/** Validate StateData integrity, returns a list of errors (empty = valid). */
export function validateStateData(state: StateData): ValidationError[] {
  const errors: ValidationError[] = []

  // World is required
  if (!state.World) {
    errors.push({ path: 'World', message: 'World snapshot is required' })
    return errors // cannot proceed
  }

  if (!state.World.entity_id) {
    errors.push({ path: 'World.entity_id', message: 'World entity_id is required' })
  }

  // Validate creatures
  const creatureIds = new Set<string>()
  for (const [i, c] of (state.Creatures ?? []).entries()) {
    const prefix = `Creatures[${i}]`
    if (!c.creature_id) {
      errors.push({ path: `${prefix}.creature_id`, message: 'creature_id is required' })
    } else if (creatureIds.has(c.creature_id)) {
      errors.push({ path: `${prefix}.creature_id`, message: `Duplicate creature_id: ${c.creature_id}` })
    } else {
      creatureIds.add(c.creature_id)
    }
    if (!c.creature?.name) {
      errors.push({ path: `${prefix}.creature.name`, message: 'Creature name is required' })
    }
  }

  // Validate regions
  const regionIds = new Set<string>()
  for (const [i, r] of (state.Regions ?? []).entries()) {
    const prefix = `Regions[${i}]`
    if (!r.region_id) {
      errors.push({ path: `${prefix}.region_id`, message: 'region_id is required' })
    } else if (regionIds.has(r.region_id)) {
      errors.push({ path: `${prefix}.region_id`, message: `Duplicate region_id: ${r.region_id}` })
    } else {
      regionIds.add(r.region_id)
    }
    if (!r.region?.name) {
      errors.push({ path: `${prefix}.region.name`, message: 'Region name is required' })
    }
  }

  // Validate organizations
  const orgIds = new Set<string>()
  for (const [i, o] of (state.Organizations ?? []).entries()) {
    const prefix = `Organizations[${i}]`
    if (!o.organization_id) {
      errors.push({ path: `${prefix}.organization_id`, message: 'organization_id is required' })
    } else if (orgIds.has(o.organization_id)) {
      errors.push({ path: `${prefix}.organization_id`, message: `Duplicate organization_id: ${o.organization_id}` })
    } else {
      orgIds.add(o.organization_id)
    }
    if (!o.organization?.name) {
      errors.push({ path: `${prefix}.organization.name`, message: 'Organization name is required' })
    }
  }

  // Validate referential integrity: creature location references
  for (const [i, c] of (state.Creatures ?? []).entries()) {
    if (c.location?.region_id && regionIds.size > 0 && !regionIds.has(c.location.region_id)) {
      errors.push({
        path: `Creatures[${i}].location.region_id`,
        message: `References non-existent region: ${c.location.region_id}`,
      })
    }
  }

  // Validate referential integrity: creature relationship targets
  for (const [i, c] of (state.Creatures ?? []).entries()) {
    for (const [j, rel] of (c.relationships ?? []).entries()) {
      if (rel.target_id && !creatureIds.has(rel.target_id)) {
        errors.push({
          path: `Creatures[${i}].relationships[${j}].target_id`,
          message: `References non-existent creature: ${rel.target_id}`,
        })
      }
    }
  }

  // Validate referential integrity: region paths
  for (const [i, r] of (state.Regions ?? []).entries()) {
    for (const [j, path] of (r.region?.paths ?? []).entries()) {
      if (path.to_region && !regionIds.has(path.to_region)) {
        errors.push({
          path: `Regions[${i}].region.paths[${j}].to_region`,
          message: `References non-existent region: ${path.to_region}`,
        })
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

/** Get the ID of an entity snapshot */
export function getEntityId(type: EntityType, entity: WorldSnapshot | CreatureSnapshot | RegionSnapshot | OrganizationSnapshot): string {
  switch (type) {
    case 'world': return (entity as WorldSnapshot).entity_id
    case 'creature': return (entity as CreatureSnapshot).creature_id
    case 'region': return (entity as RegionSnapshot).region_id
    case 'organization': return (entity as OrganizationSnapshot).organization_id
  }
}

/** Find a creature by ID */
export function findCreature(state: StateData, id: string): CreatureSnapshot | undefined {
  return state.Creatures?.find(c => c.creature_id === id)
}

/** Find a region by ID */
export function findRegion(state: StateData, id: string): RegionSnapshot | undefined {
  return state.Regions?.find(r => r.region_id === id)
}

/** Find an organization by ID */
export function findOrganization(state: StateData, id: string): OrganizationSnapshot | undefined {
  return state.Organizations?.find(o => o.organization_id === id)
}
