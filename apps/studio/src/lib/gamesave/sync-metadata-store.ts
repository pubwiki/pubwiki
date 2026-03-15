/**
 * SyncMetadataStore — Studio-level persistent storage for checkpoint cloud sync state.
 *
 * This store is intentionally separate from @pubwiki/rdfstore which is a
 * standalone quad store with no cloud awareness. Cloud sync metadata
 * (quadsHash, cloudCommit, cloudSyncedAt) lives here at the application layer.
 */
import Dexie, { type Table } from 'dexie';

export interface SyncMetadata {
  /** Checkpoint ID (primary key, matches checkpoint.id) */
  checkpointId: string;
  /** SHA-256 of canonicalized serialized quads — content-addressable key */
  quadsHash: string;
  /** Cloud commit hash, set after successful upload */
  cloudCommit?: string;
  /** Timestamp when last synced to cloud */
  cloudSyncedAt?: number;
}

class SyncMetadataDatabase extends Dexie {
  syncMetadata!: Table<SyncMetadata>;

  constructor() {
    super('pubwiki-sync-metadata');
    this.version(1).stores({
      syncMetadata: 'checkpointId, quadsHash, cloudCommit',
    });
  }
}

const db = new SyncMetadataDatabase();

/**
 * Save or update sync metadata for a checkpoint.
 */
export async function putSyncMetadata(meta: SyncMetadata): Promise<void> {
  await db.syncMetadata.put(meta);
}

/**
 * Get sync metadata for a checkpoint.
 */
export async function getSyncMetadata(checkpointId: string): Promise<SyncMetadata | null> {
  return (await db.syncMetadata.get(checkpointId)) ?? null;
}

/**
 * Update partial sync fields on existing metadata.
 */
export async function updateSyncMetadata(
  checkpointId: string,
  updates: Partial<Pick<SyncMetadata, 'cloudCommit' | 'cloudSyncedAt' | 'quadsHash'>>,
): Promise<void> {
  await db.syncMetadata.update(checkpointId, updates);
}

/**
 * Find a sync metadata record by quadsHash (content-addressable lookup).
 */
export async function findSyncMetadataByQuadsHash(quadsHash: string): Promise<SyncMetadata | null> {
  return (await db.syncMetadata.where('quadsHash').equals(quadsHash).first()) ?? null;
}

/**
 * Delete sync metadata for a checkpoint.
 */
export async function deleteSyncMetadata(checkpointId: string): Promise<void> {
  await db.syncMetadata.delete(checkpointId);
}

/**
 * List all sync metadata records for a set of checkpoint IDs.
 */
export async function getSyncMetadataBatch(checkpointIds: string[]): Promise<Map<string, SyncMetadata>> {
  const records = await db.syncMetadata.where('checkpointId').anyOf(checkpointIds).toArray();
  return new Map(records.map(r => [r.checkpointId, r]));
}
