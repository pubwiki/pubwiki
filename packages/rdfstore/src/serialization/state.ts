/**
 * Full State Export/Import for RDFStore
 * 
 * Exports/imports the complete state including:
 * - Current quads snapshot
 * - All Checkpoints and their data
 * 
 * Format: JSON with version information for forward compatibility
 * 
 * 重构后：移除了 RefNodes、Children 等操作历史相关的导出
 * 简化为纯 Checkpoint 快照导出
 */

import { fromRdfQuad, toRdfQuad, type SerializedQuad } from '../convert.js';
import type { CheckpointStore } from '../version/store.js'
import type { StoreBackend } from '../backend/quadstore.js'

// ============================================================================
// Export/Import Types
// ============================================================================

/**
 * Serialized checkpoint for export
 */
interface ExportedCheckpoint {
  id: string
  title: string
  description?: string
  timestamp: number
  quadCount: number
}

/**
 * Serialized checkpoint data for export
 */
interface ExportedCheckpointData {
  id: string
  quads: SerializedQuad[]
}

/**
 * Full state export format - Version 3 (simplified)
 */
export interface FullStateExport {
  /** Format version for forward compatibility */
  version: 3
  /** Export timestamp */
  exportedAt: string
  /** Current quads snapshot */
  currentQuads: SerializedQuad[]
  /** All checkpoints */
  checkpoints: ExportedCheckpoint[]
  /** Checkpoint data (full quad snapshots) */
  checkpointData: ExportedCheckpointData[]
}

/**
 * Options for full state export
 */
export interface FullStateExportOptions {
  /** Pretty print JSON output */
  pretty?: boolean
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export the complete RDFStore state to JSON string
 * 
 * @param backend - The store backend (for current quads)
 * @param checkpointStore - The checkpoint store
 * @param options - Export options
 * @returns JSON string of the full state
 */
export async function exportFullState(
  backend: StoreBackend,
  checkpointStore: CheckpointStore,
  options: FullStateExportOptions = {}
): Promise<string> {
  const db = checkpointStore.database

  // Get current quads
  const currentQuads = await backend.getAllQuads()
  const serializedQuads = currentQuads.map(fromRdfQuad)

  // Get all checkpoints
  const checkpointRecords = await db.checkpoints.toArray()
  const checkpoints: ExportedCheckpoint[] = checkpointRecords.map(record => ({
    id: record.id,
    title: record.title,
    description: record.description,
    timestamp: record.timestamp,
    quadCount: record.quadCount
  }))

  // Get checkpoint data
  const checkpointDataRecords = await db.checkpointData.toArray()
  const checkpointData: ExportedCheckpointData[] = checkpointDataRecords.map(record => ({
    id: record.id,
    quads: record.data
  }))

  const exportData: FullStateExport = {
    version: 3,
    exportedAt: new Date().toISOString(),
    currentQuads: serializedQuads,
    checkpoints,
    checkpointData
  }

  // Diagnostic logging for export size analysis
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const currentQuadsJson = JSON.stringify(serializedQuads)
  const checkpointsJson = JSON.stringify(checkpoints)
  const checkpointDataJson = JSON.stringify(checkpointData)

  console.log('[RDFStore State Export] Size breakdown:')
  console.log(`  - currentQuads: ${serializedQuads.length} quads, ${formatSize(currentQuadsJson.length)}`)
  console.log(`  - checkpoints: ${checkpoints.length} checkpoints, ${formatSize(checkpointsJson.length)}`)
  console.log(`  - checkpointData: ${checkpointData.length} snapshots, ${formatSize(checkpointDataJson.length)}`)

  const result = options.pretty 
    ? JSON.stringify(exportData, null, 2) 
    : JSON.stringify(exportData)

  console.log(`[RDFStore State Export] Total export size: ${formatSize(result.length)}`)

  return result
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Import complete RDFStore state from JSON string
 * 
 * WARNING: This will completely replace the current state!
 * 
 * @param backend - The store backend (for quads)
 * @param checkpointStore - The checkpoint store
 * @param data - JSON string of the full state export
 */
export async function importFullState(
  backend: StoreBackend,
  checkpointStore: CheckpointStore,
  data: string
): Promise<void> {
  const parsed = JSON.parse(data)
  
  // Validate version
  if (parsed.version !== 3) {
    throw new Error(`Unsupported state export version: ${parsed.version}. Expected version 3.`)
  }
  
  const exportData = parsed as FullStateExport
  const db = checkpointStore.database
  
  // Use a transaction for atomic import
  await db.transaction('rw', [db.checkpoints, db.checkpointData], async () => {
    // Clear all existing data
    await db.checkpoints.clear()
    await db.checkpointData.clear()
    
    // Import checkpoints
    if (exportData.checkpoints.length > 0) {
      await db.checkpoints.bulkPut(exportData.checkpoints.map(cp => ({
        id: cp.id,
        title: cp.title,
        description: cp.description,
        timestamp: cp.timestamp,
        quadCount: cp.quadCount
      })))
    }
    
    // Import checkpoint data
    if (exportData.checkpointData.length > 0) {
      await db.checkpointData.bulkPut(exportData.checkpointData.map(cpd => ({
        id: cpd.id,
        data: cpd.quads
      })))
    }
  })
  
  // Clear and restore backend quads
  await backend.clear()
  if (exportData.currentQuads.length > 0) {
    const quads = exportData.currentQuads.map(toRdfQuad)
    await backend.batchInsert(quads)
  }
}
