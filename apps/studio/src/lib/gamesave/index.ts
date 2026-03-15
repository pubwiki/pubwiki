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
  prepareSaveForPublish,
  uploadSaveToCloud,
  pullSaveFromCloud,
  listUnifiedSaves,
  type CreateSaveOptions,
  type CreateSaveResult,
  type PreparedSaveData,
  type UploadSaveOptions,
  type UnifiedSave,
  type SyncStatus,
} from './checkpoint';

// Save store for reactive state management
export { saveStore } from './state-sync';

// Sync metadata store (studio-level cloud sync tracking)
export {
  putSyncMetadata,
  getSyncMetadata,
  updateSyncMetadata,
  findSyncMetadataByQuadsHash,
  deleteSyncMetadata,
  type SyncMetadata,
} from './sync-metadata-store';

// Artifact context for cloud saves
export {
  getArtifactContext,
  clearArtifactContext,
  clearAllArtifactContext,
  type ArtifactContext
} from './artifact-context';
