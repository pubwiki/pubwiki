/**
 * Checkpoint Sync Service (Simplified)
 * 
 * Pure snapshot-based cloud sync:
 * - Export current state to cloud
 * - Create cloud checkpoint with quads directly
 * - Restore from cloud checkpoint
 * 
 * Removed blockchain-style operation sync:
 * - No more buildSyncOperations
 * - No more syncOperationsToCloud
 * - No more versionDAG dependencies
 */

import type { RDFStore } from '@pubwiki/rdfstore';
import { fromRdfQuad, toRdfQuad } from '@pubwiki/rdfstore';
import type { CheckpointInfo, Quad } from '@pubwiki/api';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

/**
 * Options for uploading a checkpoint
 */
export interface UploadCheckpointOptions {
  /** Checkpoint ID (use local checkpoint id for consistency) */
  id: string;
  /** Checkpoint title */
  name: string;
  /** Optional description */
  description?: string;
  /** Visibility setting */
  visibility?: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
}

/**
 * Result of uploading a checkpoint
 */
export interface UploadCheckpointResult {
  success: boolean;
  checkpointId?: string;
  error?: string;
}

/**
 * Upload current local state as a checkpoint to cloud.
 * This exports the current quads and uploads them directly as a new checkpoint.
 * 
 * @param store - The local RDF store
 * @param saveId - The cloud save ID
 * @param options - Checkpoint options
 * @returns Upload result
 */
export async function uploadCheckpointToCloud(
  store: RDFStore,
  saveId: string,
  options: UploadCheckpointOptions
): Promise<UploadCheckpointResult> {
  try {
    // 1. Export current state as RDF quads
    const rdfQuads = await store.getAllQuads();
    
    // 2. Convert to API Quad format (N3 strings)
    const quads: Quad[] = rdfQuads.map(fromRdfQuad);

    // 3. Create checkpoint directly with quads
    const { data, error } = await apiClient.POST('/saves/{saveId}/checkpoints', {
      params: { path: { saveId } },
      body: {
        quads,
        id: options.id,
        name: options.name,
        description: options.description,
        visibility: options.visibility ?? 'PRIVATE'
      }
    });

    if (error) {
      return {
        success: false,
        error: error.error || '创建云端存档失败'
      };
    }

    return {
      success: true,
      checkpointId: data!.id
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '上传失败'
    };
  }
}

/**
 * Download checkpoint from cloud and import into local store.
 * 
 * @param store - The local RDF store
 * @param saveId - The cloud save ID
 * @param checkpointId - The checkpoint ID to restore
 * @returns Whether restore was successful
 */
export async function restoreFromCloudCheckpoint(
  store: RDFStore,
  saveId: string,
  checkpointId: string
): Promise<boolean> {
  try {
    // 1. Export checkpoint data from cloud
    const { data, error } = await apiClient.GET('/saves/{saveId}/checkpoints/{checkpointId}/export', {
      params: { path: { saveId, checkpointId } }
    });

    if (error || !data) {
      return false;
    }

    // 2. Convert API Quads to RDF.js Quads and replace local store
    const rdfQuads = data.quads.map(toRdfQuad);
    await store.clear();
    await store.batchInsert(rdfQuads);

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch cloud checkpoints for a save.
 * 
 * @param saveId - The cloud save ID
 * @returns List of checkpoints, or empty array on error
 */
export async function fetchCloudCheckpoints(saveId: string): Promise<CheckpointInfo[]> {
  try {
    const { data, error } = await apiClient.GET('/saves/{saveId}/checkpoints', {
      params: { path: { saveId } }
    });

    if (error || !data) {
      return [];
    }

    return data.checkpoints || [];
  } catch {
    return [];
  }
}

/**
 * Get save ID by state node ID.
 * 
 * @param stateNodeId - The state node ID
 * @returns The save ID or null if not found
 */
export async function getSaveIdByStateNode(stateNodeId: string): Promise<string | null> {
  try {
    const { data, error } = await apiClient.GET('/saves/by-state/{stateNodeId}', {
      params: { path: { stateNodeId } }
    });

    if (error || !data) {
      return null;
    }

    return data.id;
  } catch {
    return null;
  }
}

/**
 * Check if a cloud save exists.
 * 
 * @param saveId - The cloud save ID
 * @returns true if save exists and is accessible
 */
export async function cloudSaveExists(saveId: string): Promise<boolean> {
  try {
    const { error } = await apiClient.GET('/saves/{saveId}/checkpoints', {
      params: { path: { saveId } }
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Create a new cloud save.
 * 
 * @param name - Save name
 * @param stateNodeId - Associated state node ID
 * @returns The created save ID
 */
export async function createCloudSave(name: string, stateNodeId: string): Promise<string> {
  const { data, error } = await apiClient.POST('/saves', {
    body: { name, stateNodeId }
  });

  if (error) {
    throw new Error(error.error || '创建云存档失败');
  }

  return data!.id;
}

/**
 * Delete a cloud checkpoint.
 * 
 * @param saveId - The cloud save ID
 * @param checkpointId - The checkpoint ID to delete
 */
export async function deleteCloudCheckpoint(saveId: string, checkpointId: string): Promise<void> {
  const { error } = await apiClient.DELETE('/saves/{saveId}/checkpoints/{checkpointId}', {
    params: { path: { saveId, checkpointId } }
  });

  if (error) {
    throw new Error(error.error || '删除失败');
  }
}
