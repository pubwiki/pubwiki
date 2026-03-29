/**
 * @pubwiki/game-ui — Game Data Provider, Hooks & UI Components
 *
 * Usage:
 *   import { GameDataProvider, Player, Creature, useGameData } from '@pubwiki/game-ui'
 */

// ── Provider ──
export { GameDataProvider, useGameData, type GameData, type GameResolvers } from './provider.tsx'

// ── Hooks ──
export {
  useCreatures,
  usePlayer,
  useNPCs,
  useRegions,
  useOrganizations,
  useWorld,
  type UseCreaturesResult,
  type UsePlayerResult,
  type UseRegionsResult,
  type UseOrganizationsResult,
  type UseWorldResult,
} from './hooks/index.ts'

// ── Components ──
export {
  Creature,
  Player,
  Region,
  Org,
  PlayerPanel,
  CreatureList,
  NPCList,
  RegionList,
  OrgList,
  WorldPanel,
} from './game/index.ts'

// ── Types ──
export type {
  CreatureEntity,
  CreatureComponent,
  RegionEntity,
  RegionComponent,
  OrganizationEntity,
  OrganizationComponent,
  WorldSnapshot,
  Appearance,
  InventoryItem,
  StatusEffect,
  LocationRef,
  CustomComponentInstance,
  SettingDocument,
  LogEntry,
  InteractionOption,
  Interaction,
  GameTime,
  CreatureAttrField,
  CustomComponentDef,
  DirectorNotes,
  EventEntry,
  RegionLocation,
  RegionPath,
  Territory,
  BaseInteraction,
} from './types.ts'

// ── Story Engine ──
export {
  useNarrative,
  type NarrativeKit,
  type StoryPhase,
  type StreamState,
  type GenerateResult,
  type UpdateResult,
  type GenerateParams,
  type UpdateStateParams,
  type SaveEntry,
  type StoryHistory,
} from './story/engine.ts'
export { StreamText, type StreamTextProps } from './story/stream-text.tsx'

// ── Primitives (future) ──
export {} from './primitives/index.ts'
