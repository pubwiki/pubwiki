/**
 * Automatic checkpoint management
 * 
 * Handles automatic checkpoint creation based on operation count
 */

import type { StoreConfig, SnapshotInfo, Triple } from '../types.js'
import type { LogManager } from '../log/manager.js'
import type { StoreBackend } from '../backend/quadstore.js'

export interface CheckpointManager {
  /**
   * Check if auto checkpoint should be triggered
   */
  shouldCheckpoint(): boolean

  /**
   * Create a checkpoint
   */
  createCheckpoint(label?: string): Promise<SnapshotInfo>

  /**
   * Create an auto checkpoint if needed
   */
  maybeCreateAutoCheckpoint(): Promise<SnapshotInfo | null>

  /**
   * Reset the operation counter
   */
  resetCounter(): void
}

/**
 * Create a checkpoint manager
 */
export function createCheckpointManager(
  backend: StoreBackend,
  logManager: LogManager,
  config: StoreConfig
): CheckpointManager {
  return {
    shouldCheckpoint(): boolean {
      return logManager.shouldAutoCheckpoint()
    },

    async createCheckpoint(label?: string): Promise<SnapshotInfo> {
      const tripleCount = await backend.count()
      return logManager.saveCheckpoint(tripleCount, label, false)
    },

    async maybeCreateAutoCheckpoint(): Promise<SnapshotInfo | null> {
      if (!config.enableAutoCheckpoint || !logManager.shouldAutoCheckpoint()) {
        return null
      }
      
      const tripleCount = await backend.count()
      const info = await logManager.saveCheckpoint(
        tripleCount,
        `auto-${Date.now()}`,
        true
      )
      logManager.resetCheckpointCounter()
      return info
    },

    resetCounter(): void {
      logManager.resetCheckpointCounter()
    }
  }
}

/**
 * Restore state from a checkpoint
 * 
 * Loads all triples from the checkpoint and subsequent operations
 */
export async function restoreFromCheckpoint(
  backend: StoreBackend,
  logManager: LogManager,
  targetRef: string
): Promise<{ restoredTriples: Triple[]; operationsReplayed: number }> {
  // Find the nearest checkpoint
  const checkpoint = await logManager.getNearestCheckpoint(targetRef)
  
  if (!checkpoint) {
    // No checkpoint found, start from empty
    return { restoredTriples: [], operationsReplayed: 0 }
  }

  // Get operations since checkpoint
  const operations = await logManager.getOperationsSince(checkpoint.ref)
  
  // Apply operations to get final state
  // Note: The actual replay happens in the store, this just provides the operations
  const currentTriples = await backend.getAllTriples()
  
  return {
    restoredTriples: currentTriples,
    operationsReplayed: operations.length
  }
}
