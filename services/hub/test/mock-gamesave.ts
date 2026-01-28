/**
 * Mock GameSave Worker for unit tests
 * 
 * 纯 Checkpoint 存储模式：
 * - 不维护当前状态
 * - createCheckpoint 直接传入 quads 数组
 */

import type { Quad, CheckpointVisibility } from '@pubwiki/api';
import type { 
  GameSaveRPC, 
  SaveMetadata, 
  CheckpointInfo, 
  CreateCheckpointOptions,
  ExportCheckpointResult,
} from 'pubwiki-gamesave';

// In-memory storage for mock data
const mockSaves = new Map<string, SaveMetadata>();
const mockCheckpoints = new Map<string, Map<string, CheckpointInfo>>();
const mockCheckpointData = new Map<string, Quad[]>();

export const mockGameSaveRPC: GameSaveRPC = {
  async initializeSave(saveId: string, userId: string, stateNodeId: string): Promise<void> {
    mockSaves.set(saveId, {
      userId,
      stateNodeId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockCheckpoints.set(saveId, new Map());
  },

  async getMetadata(saveId: string): Promise<SaveMetadata | null> {
    return mockSaves.get(saveId) ?? null;
  },

  async clearSave(saveId: string): Promise<void> {
    // Delete all checkpoint data for this save
    const checkpoints = mockCheckpoints.get(saveId);
    if (checkpoints) {
      for (const checkpointId of checkpoints.keys()) {
        mockCheckpointData.delete(`${saveId}:${checkpointId}`);
      }
    }
    mockSaves.delete(saveId);
    mockCheckpoints.delete(saveId);
  },

  async createCheckpoint(
    saveId: string, 
    quads: Quad[], 
    options?: CreateCheckpointOptions
  ): Promise<string> {
    const checkpointId = options?.id ?? `checkpoint-${Date.now()}`;
    const checkpoints = mockCheckpoints.get(saveId) ?? new Map();
    
    // Store checkpoint info
    checkpoints.set(checkpointId, {
      id: checkpointId,
      timestamp: Date.now(),
      quadCount: quads.length,
      name: options?.name,
      description: options?.description,
      visibility: options?.visibility ?? 'PRIVATE',
    });
    mockCheckpoints.set(saveId, checkpoints);
    
    // Store checkpoint data
    mockCheckpointData.set(`${saveId}:${checkpointId}`, [...quads]);
    
    return checkpointId;
  },

  async listCheckpoints(saveId: string, accessLevel?: 'owner' | 'public'): Promise<CheckpointInfo[]> {
    const checkpoints = mockCheckpoints.get(saveId);
    if (!checkpoints) return [];
    const all = Array.from(checkpoints.values());
    if (accessLevel === 'public') {
      return all.filter(c => c.visibility !== 'PRIVATE');
    }
    return all;
  },

  async getCheckpoint(saveId: string, checkpointId: string): Promise<CheckpointInfo | null> {
    const checkpoints = mockCheckpoints.get(saveId);
    return checkpoints?.get(checkpointId) ?? null;
  },

  async exportCheckpoint(saveId: string, checkpointId: string): Promise<ExportCheckpointResult | null> {
    const quads = mockCheckpointData.get(`${saveId}:${checkpointId}`);
    if (!quads) return null;
    return {
      quads,
      quadCount: quads.length,
    };
  },

  async updateCheckpointVisibility(
    saveId: string, 
    checkpointId: string, 
    visibility: CheckpointVisibility
  ): Promise<boolean> {
    const checkpoints = mockCheckpoints.get(saveId);
    const checkpoint = checkpoints?.get(checkpointId);
    if (!checkpoint) return false;
    checkpoint.visibility = visibility;
    return true;
  },

  async deleteCheckpoint(saveId: string, checkpointId: string): Promise<boolean> {
    const checkpoints = mockCheckpoints.get(saveId);
    const deleted = checkpoints?.delete(checkpointId) ?? false;
    if (deleted) {
      mockCheckpointData.delete(`${saveId}:${checkpointId}`);
    }
    return deleted;
  },

  async getCheckpointCount(saveId: string): Promise<number> {
    const checkpoints = mockCheckpoints.get(saveId);
    return checkpoints?.size ?? 0;
  },
};

/**
 * Helper functions for setting up mock data in tests
 */
export function setupMockSave(saveId: string, userId: string, stateNodeId: string): void {
  mockSaves.set(saveId, {
    userId,
    stateNodeId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mockCheckpoints.set(saveId, new Map());
}

export function setupMockCheckpoint(
  saveId: string, 
  checkpointId: string,
  quads: Quad[] = [],
  visibility: CheckpointVisibility = 'PUBLIC'
): void {
  const checkpoints = mockCheckpoints.get(saveId) ?? new Map();
  checkpoints.set(checkpointId, {
    id: checkpointId,
    timestamp: Date.now(),
    quadCount: quads.length,
    visibility,
  });
  mockCheckpoints.set(saveId, checkpoints);
  mockCheckpointData.set(`${saveId}:${checkpointId}`, [...quads]);
}

export function clearMockData(): void {
  mockSaves.clear();
  mockCheckpoints.clear();
  mockCheckpointData.clear();
}
