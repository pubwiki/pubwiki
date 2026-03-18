/**
 * Save Checkpoint Service
 * 
 * Manages save checkpoints with unified local/cloud model:
 * - Local checkpoints stored in IndexedDB via RDFStore (always available)
 * - Cloud saves uploaded to backend via POST /saves (requires published artifact)
 * - Unified list merges both sources with sync status badges
 * 
 * Save commit is globally unique and computed via computeNodeCommit(saveId, parent, contentHash, 'SAVE').
 * contentHash is computed via computeContentHash(saveContent) from the SAVE metadata object.
 */

import type { TripleStore, Triple } from '@pubwiki/rdfstore';
import type { SaveDetail, CreateArtifactNode } from '@pubwiki/api';
import { computeContentHash, computeNodeCommit, computeQuadsHash } from '@pubwiki/api';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import {
  putSyncMetadata,
  getSyncMetadata,
  updateSyncMetadata,
  findSyncMetadataByQuadsHash,
  getSyncMetadataBatch,
} from './sync-metadata-store';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

/**
 * Options for creating a save checkpoint
 */
export interface CreateSaveOptions {
  /** STATE node ID */
  stateNodeId: string;
  /** Parent save commit (optional) */
  parent?: string | null;
  /** Artifact ID */
  artifactId: string;
  /** Artifact commit hash */
  artifactCommit: string;
  /** Save node ID (client-generated UUID, auto-generated if omitted) */
  saveId?: string;
  /** Save title */
  title?: string;
  /** Save description */
  description?: string;
  /** Whether save is listed in public lists */
  isListed?: boolean;
}

/**
 * Result of creating a save
 */
export interface CreateSaveResult {
  success: boolean;
  save?: SaveDetail;
  error?: string;
}

/**
 * Sync status for a unified save entry
 */
export type SyncStatus = 'local-only' | 'synced' | 'cloud-only';

/**
 * Unified save entry that merges local checkpoint and cloud save data
 */
export interface UnifiedSave {
  /** Checkpoint ID (= saveId = nodeId) */
  id: string;
  title: string;
  description?: string;
  timestamp: number;
  tripleCount: number;
  quadsHash?: string;
  cloudCommit?: string;
  syncStatus: SyncStatus;
  isListed?: boolean;
}

/**
 * Options for uploading a local checkpoint to cloud
 */
export interface UploadSaveOptions {
  /** STATE node ID */
  stateNodeId: string;
  /** Artifact ID */
  artifactId: string;
  /** Artifact commit hash */
  artifactCommit: string;
  /** Parent save commit (optional) */
  parent?: string | null;
  /** Whether save is listed in public lists */
  isListed?: boolean;
}

/**
 * Upload a local checkpoint to the cloud.
 * Uses the checkpoint's ID as saveId to maintain ID consistency.
 * After successful upload, updates the local checkpoint's sync state.
 */
export async function uploadSaveToCloud(
  store: TripleStore,
  checkpointId: string,
  options: UploadSaveOptions
): Promise<{ commit: string }> {
  // 1. Get checkpoint metadata and raw data
  const checkpoint = store.getCheckpoint(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const entries = store.exportCheckpoints([checkpointId], { mode: 'full' });
  if (entries.length === 0) throw new Error(`Checkpoint data not found: ${checkpointId}`);
  const entry = entries[0];
  if (entry.type !== 'keyframe') throw new Error(`Unexpected checkpoint entry type: ${entry.type}`);
  const triples = entry.triples;

  // 2. Serialize to binary format
  const triplesJson = JSON.stringify(triples);
  const triplesData = new TextEncoder().encode(triplesJson);

  // 3. Compute quadsHash (reuse from sync metadata if available)
  const existingMeta = await getSyncMetadata(checkpointId);
  const quadsHash = existingMeta?.quadsHash
    ?? await computeQuadsHash(triples);

  // 4. Build the SAVE content object
  const saveContent = {
    type: 'SAVE' as const,
    stateNodeId: options.stateNodeId,
    artifactId: options.artifactId,
    artifactCommit: options.artifactCommit,
    quadsHash,
    saveEncoding: 'keyframe' as const,
    parentCommit: options.parent ?? null,
    title: checkpoint.title ?? null,
    description: checkpoint.description ?? null,
  };

  // 5. Compute contentHash and commit
  const contentHash = await computeContentHash(saveContent);
  const commit = await computeNodeCommit(checkpointId, options.parent ?? null, contentHash, 'SAVE');

  // 6. POST to /saves
  const blobData = new Blob([triplesData], { type: 'application/octet-stream' });
  const saveMetadata = {
    saveId: checkpointId,
    stateNodeId: options.stateNodeId,
    commit,
    parent: options.parent ?? null,
    artifactId: options.artifactId,
    artifactCommit: options.artifactCommit,
    contentHash,
    quadsHash,
    saveEncoding: 'keyframe' as const,
    parentCommit: options.parent ?? null,
    title: checkpoint.title,
    description: checkpoint.description,
    isListed: options.isListed ?? false
  };
  const { error: postError } = await apiClient.POST('/saves', {
    body: {
      metadata: saveMetadata,
      // @ts-expect-error binary data handled by bodySerializer as Blob
      data: blobData
    },
    bodySerializer: (body) => {
      const fd = new FormData();
      fd.append('metadata', JSON.stringify(body.metadata));
      fd.append('data', blobData);
      return fd;
    },
  });

  if (postError) {
    throw new Error(postError.error || '上传存档失败');
  }

  // 7. Update sync metadata at studio layer
  await putSyncMetadata({
    checkpointId,
    quadsHash,
    cloudCommit: commit,
    cloudSyncedAt: Date.now(),
  });

  return { commit };
}

/**
 * Pull a cloud-only save to local storage.
 * If a local checkpoint with matching quadsHash already exists, just update its sync state.
 */
export async function pullSaveFromCloud(
  store: TripleStore,
  save: SaveDetail
): Promise<void> {
  // 1. Check if we already have a local checkpoint with matching quadsHash
  const existingMeta = await findSyncMetadataByQuadsHash(save.quadsHash);
  if (existingMeta) {
    await updateSyncMetadata(existingMeta.checkpointId, {
      cloudCommit: save.commit,
      cloudSyncedAt: Date.now(),
    });
    return;
  }

  // 2. Download quad data from cloud
  const { data: quadsText, error: fetchError } = await apiClient.GET('/saves/{commit}/data', {
    params: { path: { commit: save.commit } },
    parseAs: 'text',
  });

  if (fetchError || !quadsText) {
    throw new Error('下载存档数据失败');
  }

  const quads = JSON.parse(quadsText as string);

  // 3. Create a local checkpoint with the cloud data
  store.clear();
  store.batchInsert(quads);
  const cp = store.checkpoint({
    id: save.saveId,
    title: save.title ?? `Save ${save.commit.slice(0, 8)}`,
    description: save.description ?? undefined,
  });

  // 4. Save sync metadata at studio layer
  await putSyncMetadata({
    checkpointId: cp.id,
    quadsHash: save.quadsHash,
    cloudCommit: save.commit,
    cloudSyncedAt: Date.now(),
  });
}

/**
 * List unified saves by merging local checkpoints and cloud saves.
 * Matches by cloudCommit first, then by quadsHash as fallback.
 */
export async function listUnifiedSaves(
  store: TripleStore,
  stateNodeId: string,
): Promise<UnifiedSave[]> {
  // Parallel fetch
  const [localCheckpoints, cloudSaves] = await Promise.all([
    Promise.resolve(store.listCheckpoints()),
    fetchSaves(stateNodeId).catch(() => [] as SaveDetail[]),
  ]);

  // Batch-fetch sync metadata for all local checkpoints
  const syncMap = await getSyncMetadataBatch(localCheckpoints.map(cp => cp.id));

  // Build indexes for cloud saves
  const cloudByCommit = new Map(cloudSaves.map(s => [s.commit, s]));
  const cloudByHash = new Map(cloudSaves.map(s => [s.quadsHash, s]));

  const result: UnifiedSave[] = [];
  const matchedCloudCommits = new Set<string>();

  // 1. Process local checkpoints, try to match against cloud
  for (const cp of localCheckpoints) {
    const meta = syncMap.get(cp.id);
    let cloudMatch: SaveDetail | undefined;

    if (meta?.cloudCommit) {
      cloudMatch = cloudByCommit.get(meta.cloudCommit);
    }
    if (!cloudMatch && meta?.quadsHash) {
      cloudMatch = cloudByHash.get(meta.quadsHash);
    }

    if (cloudMatch) {
      matchedCloudCommits.add(cloudMatch.commit);
      result.push({
        id: cp.id,
        title: cp.title,
        description: cp.description,
        timestamp: cp.timestamp,
        tripleCount: cp.tripleCount,
        quadsHash: meta?.quadsHash,
        cloudCommit: cloudMatch.commit,
        syncStatus: 'synced',
        isListed: cloudMatch.isListed,
      });
    } else {
      result.push({
        id: cp.id,
        title: cp.title,
        description: cp.description,
        timestamp: cp.timestamp,
        tripleCount: cp.tripleCount,
        quadsHash: meta?.quadsHash,
        syncStatus: 'local-only',
      });
    }
  }

  // 2. Cloud-only saves (not matched by any local checkpoint)
  for (const save of cloudSaves) {
    if (!matchedCloudCommits.has(save.commit)) {
      result.push({
        id: save.saveId,
        title: save.title ?? `Save ${save.commit.slice(0, 8)}`,
        description: save.description ?? undefined,
        timestamp: new Date(save.createdAt).getTime(),
        tripleCount: 0,
        quadsHash: save.quadsHash,
        cloudCommit: save.commit,
        syncStatus: 'cloud-only',
        isListed: save.isListed,
      });
    }
  }

  return result.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Create a save checkpoint by first creating a local checkpoint, then uploading to cloud.
 * 
 * @param store - The local RDF store
 * @param options - Save options
 * @returns Create result
 */
export async function createSaveCheckpoint(
  store: TripleStore,
  options: CreateSaveOptions
): Promise<CreateSaveResult> {
  try {
    const saveId = options.saveId ?? crypto.randomUUID();

    // 1. Create local checkpoint first
    const cp = store.checkpoint({
      id: saveId,
      title: options.title ?? 'Untitled Save',
      description: options.description ?? undefined,
    });

    // 2. Upload to cloud
    const { commit } = await uploadSaveToCloud(store, cp.id, {
      stateNodeId: options.stateNodeId,
      parent: options.parent,
      artifactId: options.artifactId,
      artifactCommit: options.artifactCommit,
      isListed: options.isListed,
    });

    // 3. Fetch the created save detail from the backend
    const save = await getSave(commit);

    return { success: true, save: save ?? undefined };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '创建存档失败'
    };
  }
}

/**
 * Restore save data from the backend into local RDF store.
 * 
 * @param store - The local RDF store
 * @param commit - The save commit hash
 * @returns Whether restore was successful
 */
export async function restoreFromSave(
  store: TripleStore,
  commit: string
): Promise<boolean> {
  try {
    // Download save data
    const { data: quadsText, error: fetchError } = await apiClient.GET('/saves/{commit}/data', {
      params: { path: { commit } },
      parseAs: 'text',
    });

    if (fetchError || !quadsText) {
      return false;
    }

    // Parse triples from response
    const triples: Triple[] = JSON.parse(quadsText as string);

    // Replace local store contents
    store.clear();
    store.batchInsert(triples);

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch saves for a STATE node.
 * 
 * @param stateNodeId - The STATE node ID
 * @returns List of saves
 */
export async function fetchSaves(
  stateNodeId: string,
): Promise<SaveDetail[]> {
  try {
    const { data, error } = await apiClient.GET('/saves', {
      params: {
        query: { stateNodeId }
      }
    });

    if (error || !data) {
      return [];
    }

    return data.saves ?? [];
  } catch {
    return [];
  }
}

/**
 * Get save details by commit.
 * 
 * @param commit - The save commit hash
 * @returns Save details or null if not found
 */
export async function getSave(commit: string): Promise<SaveDetail | null> {
  try {
    const { data, error } = await apiClient.GET('/saves/{commit}', {
      params: { path: { commit } }
    });

    if (error || !data) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Delete a save by commit.
 * 
 * @param commit - The save commit hash
 */
export async function deleteSave(commit: string): Promise<void> {
  const { error } = await apiClient.DELETE('/saves/{commit}', {
    params: { path: { commit } }
  });

  if (error) {
    throw new Error(error.error || '删除存档失败');
  }
}

/**
 * @deprecated computeSaveCommit is no longer needed. createSaveCheckpoint now
 * computes contentHash and commit internally using computeContentHash/computeNodeCommit.
 */

/**
 * Data prepared for including a SAVE node in an artifact publish/patch request.
 * The SAVE node is included as a first-class artifact node instead of being
 * uploaded separately via the runtime saves API.
 */
export interface PreparedSaveData {
  /** Computed save commit hash (used as entrypoint.saveCommit) */
  saveCommit: string;
  /** The SAVE node to include in the artifact graph's nodes array */
  saveNode: CreateArtifactNode;
  /** Serialized quads binary data (quads.bin) */
  quadsData: Uint8Array;
  /** SHA-256 hex hash of quadsData (used as form data key: save[{quadsHash}]) */
  quadsHash: string;
}

/**
 * Prepare a local save checkpoint for inclusion in an artifact publish/patch request.
 *
 * Unlike createSaveCheckpoint() which uploads to the runtime saves API (POST /saves),
 * this function only prepares the data locally. The caller is responsible for including
 * the SAVE node in the artifact's nodes array and the binary data in the form data.
 *
 * Uses canonical JSON for deterministic quadsHash computation.
 */
export async function prepareSaveForPublish(
  store: TripleStore,
  options: CreateSaveOptions,
): Promise<PreparedSaveData> {
  const saveId = options.saveId ?? crypto.randomUUID();

  // 1. Export current state as triples
  const triples = store.getAll();

  // 2. Serialize triples to JSON for deterministic hashing
  const triplesJson = JSON.stringify(triples);
  const quadsData = new TextEncoder().encode(triplesJson);

  // 3. Compute quadsHash via shared utility
  const quadsHash = await computeQuadsHash(triples);

  // 4. Build the SAVE content object
  const saveContent = {
    type: 'SAVE' as const,
    stateNodeId: options.stateNodeId,
    artifactId: options.artifactId,
    artifactCommit: options.artifactCommit,
    quadsHash,
    saveEncoding: 'keyframe' as const,
    parentCommit: null,
    title: options.title ?? null,
    description: options.description ?? null,
  };

  // 5. Compute contentHash and commit
  const contentHash = await computeContentHash(saveContent);
  const commit = await computeNodeCommit(saveId, null, contentHash, 'SAVE');

  // 6. Build the CreateArtifactNode
  const saveNode: CreateArtifactNode = {
    nodeId: saveId,
    commit,
    parent: null,
    type: 'SAVE' as CreateArtifactNode['type'],
    name: options.title || undefined,
    content: saveContent as CreateArtifactNode['content'],
    contentHash,
  };

  return { saveCommit: commit, saveNode, quadsData, quadsHash };
}
