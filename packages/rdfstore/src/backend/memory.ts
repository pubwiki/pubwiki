/**
 * In-memory StorageBackend. Used for testing and as the default backend.
 */

import type { CheckpointInfo } from '../types'
import type { StorageBackend } from '../store/interfaces'

export class MemoryBackend implements StorageBackend {
  private snapshots = new Map<string, Uint8Array>()
  private metadata = new Map<string, CheckpointInfo>()

  async saveSnapshot(checkpointId: string, data: Uint8Array): Promise<void> {
    this.snapshots.set(checkpointId, data)
  }

  async loadSnapshot(checkpointId: string): Promise<Uint8Array | null> {
    return this.snapshots.get(checkpointId) ?? null
  }

  async deleteSnapshot(checkpointId: string): Promise<void> {
    this.snapshots.delete(checkpointId)
  }

  async listSnapshots(): Promise<string[]> {
    return Array.from(this.snapshots.keys())
  }

  async saveMetadata(checkpointId: string, meta: CheckpointInfo): Promise<void> {
    this.metadata.set(checkpointId, meta)
  }

  async loadMetadata(checkpointId: string): Promise<CheckpointInfo | null> {
    return this.metadata.get(checkpointId) ?? null
  }

  async listMetadata(): Promise<CheckpointInfo[]> {
    return Array.from(this.metadata.values())
  }

  async deleteMetadata(checkpointId: string): Promise<void> {
    this.metadata.delete(checkpointId)
  }
}
