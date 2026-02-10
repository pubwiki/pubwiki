/**
 * Gamesave Module
 * 
 * Cloud and local save management for STATE nodes.
 */

// Checkpoint operations
export {
  createSaveCheckpoint,
  restoreFromSave,
  fetchSaves,
  getSave,
  deleteSave,
  computeSaveCommit,
  type CreateSaveOptions,
  type CreateSaveResult
} from './checkpoint';

// Save store for reactive state management
export { saveStore } from './state-sync';

// Artifact context for cloud saves
export {
  getArtifactContext,
  clearArtifactContext,
  clearAllArtifactContext,
  type ArtifactContext
} from './artifact-context';
