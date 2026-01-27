/**
 * Mock GameSave Worker for unit tests
 */

import type { GameSaveRPC, SaveMetadata, CheckpointInfo, CheckpointVisibility } from 'pubwiki-gamesave';

// In-memory storage for mock data
const mockSaves = new Map<string, SaveMetadata>();
const mockCheckpoints = new Map<string, Map<string, CheckpointInfo>>();

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

  async syncOperations() {
    return { success: true, finalRef: 'mock-ref', affectedCount: 0 };
  },

  async refExists() {
    return true;
  },

  async getHistory() {
    return [];
  },

  async getQuadCount() {
    return 0;
  },

  async getVersionCount() {
    return 0;
  },

  async clearSave(saveId: string): Promise<void> {
    mockSaves.delete(saveId);
    mockCheckpoints.delete(saveId);
  },

  async exportAtRef() {
    return { data: '', ref: 'mock-ref', quadCount: 0 };
  },

  async createCheckpoint(saveId: string, ref: string, metadata?: { id?: string; name?: string; description?: string; visibility?: CheckpointVisibility }): Promise<string> {
    const checkpointId = metadata?.id ?? `checkpoint-${Date.now()}`;
    const checkpoints = mockCheckpoints.get(saveId) ?? new Map();
    checkpoints.set(checkpointId, {
      id: checkpointId,
      ref,
      timestamp: Date.now(),
      quadCount: 0,
      name: metadata?.name,
      description: metadata?.description,
      visibility: metadata?.visibility ?? 'PRIVATE',
    });
    mockCheckpoints.set(saveId, checkpoints);
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

  async updateCheckpointVisibility(saveId: string, checkpointId: string, visibility: CheckpointVisibility): Promise<boolean> {
    const checkpoints = mockCheckpoints.get(saveId);
    const checkpoint = checkpoints?.get(checkpointId);
    if (!checkpoint) return false;
    checkpoint.visibility = visibility;
    return true;
  },

  async deleteCheckpoint(saveId: string, checkpointId: string): Promise<boolean> {
    const checkpoints = mockCheckpoints.get(saveId);
    return checkpoints?.delete(checkpointId) ?? false;
  },

  async isRefPubliclyAccessible(): Promise<boolean> {
    return true;
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
  visibility: CheckpointVisibility = 'PUBLIC'
): void {
  const checkpoints = mockCheckpoints.get(saveId) ?? new Map();
  checkpoints.set(checkpointId, {
    id: checkpointId,
    ref: `ref-${checkpointId}`,
    timestamp: Date.now(),
    quadCount: 0,
    visibility,
  });
  mockCheckpoints.set(saveId, checkpoints);
}

export function clearMockData(): void {
  mockSaves.clear();
  mockCheckpoints.clear();
}
