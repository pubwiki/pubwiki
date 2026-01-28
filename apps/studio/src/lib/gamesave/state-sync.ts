/**
 * State Node Cloud Sync Service
 * 
 * Synchronizes STATE node cloud save information on page load.
 * - Checks if saves exist on the backend
 * - Fetches latest checkpoints list
 * - Updates local StateContent with cloud data
 */

import { nodeStore } from '$lib/persistence';
import { StateContent, type StateNodeData, type CheckpointInfo } from '$lib/types';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { cloudSaveExists, createCloudSave } from './checkpoint';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

/**
 * Cloud save info fetched from backend
 */
export interface CloudSaveInfo {
  exists: boolean;
  checkpoints: CheckpointInfo[];
}

/**
 * Result of syncing all STATE nodes
 */
export interface StateSyncResult {
  /** Number of STATE nodes found */
  totalNodes: number;
  /** Number of nodes with valid cloud saves */
  validSaves: number;
  /** Number of nodes with invalid/missing saves */
  invalidSaves: number;
  /** Details per node */
  details: Map<string, { saveId: string | null; exists: boolean; checkpointsCount: number }>;
}

/**
 * Fetch cloud save info for a given saveId
 */
async function fetchCloudSaveInfo(saveId: string): Promise<CloudSaveInfo> {
  try {
    // First check if save exists by fetching checkpoints
    // If the save doesn't exist, this will return 404
    const { data, error } = await apiClient.GET('/saves/{saveId}/checkpoints', {
      params: { path: { saveId } }
    });

    if (error || !data) {
      return { exists: false, checkpoints: [] };
    }

    // Transform API response to local CheckpointInfo format
    const checkpoints: CheckpointInfo[] = (data.checkpoints || []).map(cp => ({
      id: cp.id,
      name: cp.name || 'Unnamed',
      description: cp.description ?? undefined,
      createdAt: cp.timestamp,
      visibility: cp.visibility
    }));

    return { exists: true, checkpoints };
  } catch (error) {
    console.warn(`[StateSync] Failed to fetch cloud save info for ${saveId}:`, error);
    return { exists: false, checkpoints: [] };
  }
}

/**
 * Sync all STATE nodes' cloud save information
 * 
 * This should be called after nodeStore.init() completes.
 * It fetches the latest checkpoint information from the cloud
 * and updates the local StateContent.
 * 
 * @returns Sync result summary
 */
export async function syncStateNodesFromCloud(): Promise<StateSyncResult> {
  const result: StateSyncResult = {
    totalNodes: 0,
    validSaves: 0,
    invalidSaves: 0,
    details: new Map()
  };

  // Find all STATE nodes
  const allNodeIds = nodeStore.getAllIds();
  const stateNodes: Array<{ id: string; data: StateNodeData }> = [];
  
  for (const nodeId of allNodeIds) {
    const nodeData = nodeStore.get(nodeId);
    if (nodeData?.type === 'STATE') {
      stateNodes.push({ id: nodeId, data: nodeData as StateNodeData });
    }
  }

  result.totalNodes = stateNodes.length;

  if (stateNodes.length === 0) {
    console.log('[StateSync] No STATE nodes found');
    return result;
  }

  console.log(`[StateSync] Syncing ${stateNodes.length} STATE node(s)...`);

  // Fetch cloud info for each STATE node in parallel
  const syncPromises = stateNodes.map(async ({ id, data }) => {
    const content = data.content as StateContent;
    const saveId = content.saveId;

    if (!saveId) {
      // No cloud save configured
      result.details.set(id, { saveId: null, exists: false, checkpointsCount: 0 });
      return;
    }

    const cloudInfo = await fetchCloudSaveInfo(saveId);
    
    result.details.set(id, {
      saveId,
      exists: cloudInfo.exists,
      checkpointsCount: cloudInfo.checkpoints.length
    });

    if (cloudInfo.exists) {
      result.validSaves++;
      
      // Update StateContent with cloud checkpoints
      const updatedContent = content.withCheckpoints(cloudInfo.checkpoints);
      nodeStore.update(id, (prev) => ({
        ...prev,
        content: updatedContent
      }) as StateNodeData);
      
      console.log(`[StateSync] Node ${id}: Save ${saveId} valid, ${cloudInfo.checkpoints.length} checkpoints`);
    } else {
      result.invalidSaves++;
      
      // Save doesn't exist - clear both saveId and checkpoints
      // This ensures the next upload will create a new save
      const clearedContent = content.withSaveId(null).withCheckpoints([]);
      nodeStore.update(id, (prev) => ({
        ...prev,
        content: clearedContent
      }) as StateNodeData);
      
      console.warn(`[StateSync] Node ${id}: Save ${saveId} not found or not accessible, cleared saveId`);
    }
  });

  await Promise.all(syncPromises);

  console.log(`[StateSync] Sync complete: ${result.validSaves} valid, ${result.invalidSaves} invalid`);
  return result;
}

/**
 * Result of ensuring a cloud save exists
 */
export interface EnsureCloudSaveResult {
  /** The save ID (existing or newly created) */
  saveId: string;
  /** Whether a new save was created */
  created: boolean;
}

/**
 * Ensure a cloud save exists for a STATE node.
 * If saveId exists and is valid, returns it.
 * If saveId doesn't exist or is invalid, creates a new one.
 * Updates the node's StateContent with the valid saveId.
 * 
 * @param stateNodeId - The STATE node ID
 * @returns The valid save ID and whether it was created
 * @throws Error if node is not found or not a STATE node
 */
export async function ensureCloudSave(stateNodeId: string): Promise<EnsureCloudSaveResult> {
  const nodeData = nodeStore.get(stateNodeId);
  if (!nodeData || nodeData.type !== 'STATE') {
    throw new Error(`Node ${stateNodeId} is not a STATE node`);
  }

  const stateData = nodeData as StateNodeData;
  const content = stateData.content as StateContent;
  let saveId = content.saveId;
  let created = false;

  // Verify save exists if we have a saveId
  if (saveId) {
    const exists = await cloudSaveExists(saveId);
    if (!exists) {
      console.log(`[ensureCloudSave] Save ${saveId} not found, will create new save`);
      saveId = null;
      
      // Clear the invalid saveId from state
      nodeStore.update(stateNodeId, (prev) => {
        const data = prev as StateNodeData;
        return {
          ...data,
          content: data.content.withSaveId(null)
        } as StateNodeData;
      });
    }
  }

  // Create cloud save if not exists
  if (!saveId) {
    saveId = await createCloudSave(
      stateData.name || `State ${stateNodeId.slice(0, 8)}`,
      stateNodeId
    );
    created = true;
    
    // Update node with saveId
    nodeStore.update(stateNodeId, (prev) => {
      const data = prev as StateNodeData;
      return {
        ...data,
        content: data.content.withSaveId(saveId)
      } as StateNodeData;
    });
    
    console.log(`[ensureCloudSave] Created new save ${saveId} for node ${stateNodeId}`);
  }

  return { saveId, created };
}
