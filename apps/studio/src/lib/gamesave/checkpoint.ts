/**
 * Checkpoint Sync Service
 * 
 * Functions for syncing local checkpoints to cloud:
 * - Determine baseRef (common ancestor with cloud)
 * - Sync operations to cloud
 * - Create cloud checkpoint
 */

import { toSyncOperation, ROOT_REF, type RDFStore } from '@pubwiki/rdfstore';
import type { SyncOperationsResponse, CheckpointInfo } from '@pubwiki/api';
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
  /** The ref to upload */
  ref: string;
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
 * Result of building sync operations
 */
export interface SyncOperationsInfo {
  baseRef: string;
  operations: Array<{ operation: ReturnType<typeof toSyncOperation>; ref: string }>;
}

/**
 * Build sync operations from cloud ancestor to target ref.
 * 
 * Walks from targetRef towards root, collecting operations until we find
 * a cloud checkpoint (or reach ROOT_REF). This combines findBaseRef and
 * getOperationsBetween into a single traversal.
 * 
 * @param store - The local RDF store
 * @param cloudCheckpoints - List of cloud checkpoints
 * @param targetRef - The target ref we want to sync to
 * @returns baseRef and operations to sync
 */
export async function buildSyncOperations(
  store: RDFStore,
  cloudCheckpoints: CheckpointInfo[],
  targetRef: string
): Promise<SyncOperationsInfo> {
  // Build a set of cloud checkpoint refs for quick lookup
  const cloudRefSet = new Set(cloudCheckpoints.map(cp => cp.ref));

  // If targetRef is already synced, no operations needed
  if (cloudRefSet.has(targetRef)) {
    return { baseRef: targetRef, operations: [] };
  }

  const versionDAG = store.getVersionDAG();
  const operations: SyncOperationsInfo['operations'] = [];
  let current = targetRef;

  while (current !== ROOT_REF) {
    const node = await versionDAG.getNode(current);
    if (!node) break;

    // Collect this operation
    operations.push({
      operation: toSyncOperation(node.operation),
      ref: node.ref
    });

    // Check if parent is a cloud checkpoint (or ROOT_REF)
    const parent = node.parent!;
    if (parent === ROOT_REF || cloudRefSet.has(parent)) {
      // Found baseRef, return operations in chronological order (oldest first)
      return { baseRef: parent, operations: operations.reverse() };
    }

    current = parent;
  }

  // Reached root without finding cloud checkpoint
  return { baseRef: ROOT_REF, operations: operations.reverse() };
}

/**
 * Sync operations from baseRef to targetRef to cloud.
 * 
 * @param saveId - The cloud save ID
 * @param syncInfo - The sync operations info from buildSyncOperations
 * @returns Sync result
 */
export async function syncOperationsToCloud(
  saveId: string,
  syncInfo: SyncOperationsInfo
): Promise<SyncOperationsResponse> {
  const { baseRef, operations } = syncInfo;

  // If no operations, return success immediately
  if (operations.length === 0) {
    return { success: true, finalRef: baseRef, affectedCount: 0 };
  }

  const { data, error } = await apiClient.POST('/saves/{saveId}/sync', {
    params: { path: { saveId } },
    body: { baseRef, operations }
  });

  if (error) {
    return { success: false, message: error.error || 'Sync failed' };
  }

  return data as SyncOperationsResponse;
}

/**
 * Create a checkpoint on cloud.
 * 
 * @param saveId - The cloud save ID
 * @param options - Checkpoint options
 * @returns The created checkpoint ID
 */
export async function createCloudCheckpoint(
  saveId: string,
  options: UploadCheckpointOptions
): Promise<string> {
  const { data, error } = await apiClient.POST('/saves/{saveId}/checkpoints', {
    params: { path: { saveId } },
    body: {
      id: options.id,
      ref: options.ref,
      name: options.name,
      description: options.description,
      visibility: options.visibility ?? 'PRIVATE'
    }
  });

  if (error) {
    throw new Error(error.error || '创建云端存档失败');
  }

  return data!.id;
}

/**
 * Upload a local checkpoint to cloud.
 * This is the main function that orchestrates:
 * 1. Building sync operations (finds baseRef and collects operations in one traversal)
 * 2. Syncing operations to cloud
 * 3. Creating checkpoint
 * 
 * @param store - The local RDF store
 * @param saveId - The cloud save ID
 * @param cloudCheckpoints - Current cloud checkpoints (for finding baseRef)
 * @param options - Checkpoint options
 * @returns Upload result
 */
export async function uploadCheckpointToCloud(
  store: RDFStore,
  saveId: string,
  cloudCheckpoints: CheckpointInfo[],
  options: UploadCheckpointOptions
): Promise<UploadCheckpointResult> {
  // 1. Build sync operations (finds baseRef and collects operations in one traversal)
  const syncInfo = await buildSyncOperations(store, cloudCheckpoints, options.ref);

  // 2. Sync operations to cloud
  const syncResult = await syncOperationsToCloud(saveId, syncInfo);
  
  if (!syncResult.success) {
    return {
      success: false,
      error: syncResult.message || '同步操作失败'
    };
  }

  // 3. Create checkpoint on cloud
  const checkpointId = await createCloudCheckpoint(saveId, options);

  return {
    success: true,
    checkpointId
  };
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
