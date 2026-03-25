// Types
export type {
  // State data core
  StateData,
  WorldSnapshot,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  EntityType,
  EntitySnapshotMap,
  EntityIdField,

  // Components
  SettingDocument,
  BindSetting,
  LogEntry,
  StatusEffect,
  Metadata,
  GameTime,
  CreatureAttrField,
  TypeSchema,
  CustomComponentDef,
  CustomComponentInstance,
  DirectorNotes,
  Attributes,
  CreatureComponent,
  Appearance,
  Relationship,
  InventoryItem,
  LocationRef,
  CustomComponents,
  Location,
  RegionComponent,
  RegionPath,
  Territory,
  OrganizationComponent,

  // Story & supplementary
  StoryHistoryEntry,
  GameInitialStory,
  GameWikiEntry,
  AppInfo,
} from './state-data'

// Editor utilities
export {
  // ID generation
  generateEntityId,

  // Default factories
  createDefaultStateData,
  createDefaultWorldSnapshot,
  createDefaultCreatureSnapshot,
  createDefaultCreatureComponent,
  createDefaultRegionSnapshot,
  createDefaultRegionComponent,
  createDefaultOrganizationSnapshot,
  createDefaultOrganizationComponent,

  // Validation
  validateStateData,

  // Entity helpers
  getEntityId,
  findCreature,
  findRegion,
  findOrganization,
} from './editor'

export type { ValidationError } from './editor'
