/**
 * Full State Export/Import for RDFStore
 * 
 * Exports/imports the complete state including:
 * - All RefNodes (version history)
 * - All Checkpoints and their data
 * - Current head ref
 * - Current quads snapshot
 * 
 * Format: JSON with version information for forward compatibility
 */

import type { Ref } from '../types.js'
import type { Quad as SyncQuad, Operation as SyncOperation } from '@pubwiki/rdfsync'
import { fromRdfQuad, toRdfQuad } from '@pubwiki/rdfsync/convert'
import type { VersionStore } from '../version/store.js'
import type { StoreBackend } from '../backend/quadstore.js'

// ============================================================================
// Export/Import Types
// ============================================================================

/**
 * Serialized ref node for export
 */
interface ExportedRefNode {
  ref: string
  parent: string | null
  operation: SyncOperation
  timestamp: number
}

/**
 * Serialized checkpoint for export
 */
interface ExportedCheckpoint {
  id: string
  ref: string
  title: string
  description?: string
  timestamp: number
  quadCount: number
}

/**
 * Serialized checkpoint data for export
 */
interface ExportedCheckpointData {
  ref: string
  quads: SyncQuad[]
}

/**
 * Serialized children index for export
 */
interface ExportedChildrenIndex {
  parentRef: string
  children: string[]
}

/**
 * Full state export format
 */
export interface FullStateExport {
  /** Format version for forward compatibility */
  version: 2
  /** Export timestamp */
  exportedAt: string
  /** Current head ref */
  head: Ref
  /** Current quads snapshot */
  currentQuads: SyncQuad[]
  /** All ref nodes (version history) */
  refNodes: ExportedRefNode[]
  /** Children index for each ref */
  childrenIndex: ExportedChildrenIndex[]
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
 * @param versionStore - The version store (for version history)
 * @param options - Export options
 * @returns JSON string of the full state
 */
export async function exportFullState(
  backend: StoreBackend,
  versionStore: VersionStore,
  options: FullStateExportOptions = {}
): Promise<string> {
  const db = versionStore.database

  // Get current head
  const headRecord = await db.meta.get('head')
  const head = headRecord?.value ?? 'ROOT'

  // Get current quads
  const currentQuads = await backend.getAllQuads()
  const serializedQuads = currentQuads.map(fromRdfQuad)

  // Get all ref nodes
  const refNodeRecords = await db.refNodes.toArray()
  const refNodes: ExportedRefNode[] = refNodeRecords.map(record => ({
    ref: record.ref,
    parent: record.parent,
    operation: record.operation,
    timestamp: record.timestamp
  }))

  // Get children index
  const childrenRecords = await db.children.toArray()
  const childrenIndex: ExportedChildrenIndex[] = childrenRecords.map(record => ({
    parentRef: record.parentRef,
    children: record.children
  }))

  // Get all checkpoints
  const checkpointRecords = await db.checkpoints.toArray()
  const checkpoints: ExportedCheckpoint[] = checkpointRecords.map(record => ({
    id: record.id,
    ref: record.ref,
    title: record.title,
    description: record.description,
    timestamp: record.timestamp,
    quadCount: record.quadCount
  }))

  // Get checkpoint data
  const checkpointDataRecords = await db.checkpointData.toArray()
  const checkpointData: ExportedCheckpointData[] = checkpointDataRecords.map(record => ({
    ref: record.ref,
    quads: record.data
  }))

  const exportData: FullStateExport = {
    version: 2,
    exportedAt: new Date().toISOString(),
    head,
    currentQuads: serializedQuads,
    refNodes,
    childrenIndex,
    checkpoints,
    checkpointData
  }

  // Diagnostic logging for export size analysis
  const currentQuadsJson = JSON.stringify(serializedQuads)
  const refNodesJson = JSON.stringify(refNodes)
  const childrenIndexJson = JSON.stringify(childrenIndex)
  const checkpointsJson = JSON.stringify(checkpoints)
  const checkpointDataJson = JSON.stringify(checkpointData)

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  console.log('[RDFStore State Export] Size breakdown:')
  console.log(`  - currentQuads: ${serializedQuads.length} quads, ${formatSize(currentQuadsJson.length)}`)
  console.log(`  - refNodes: ${refNodes.length} nodes, ${formatSize(refNodesJson.length)}`)
  console.log(`  - childrenIndex: ${childrenIndex.length} entries, ${formatSize(childrenIndexJson.length)}`)
  console.log(`  - checkpoints: ${checkpoints.length} checkpoints, ${formatSize(checkpointsJson.length)}`)
  console.log(`  - checkpointData: ${checkpointData.length} snapshots, ${formatSize(checkpointDataJson.length)}`)

  // Detailed breakdown for checkpointData (often the largest)
  if (checkpointData.length > 0) {
    console.log('[RDFStore State Export] Checkpoint data breakdown:')
    checkpointData.forEach((cpd, i) => {
      const cpdJson = JSON.stringify(cpd)
      console.log(`  - checkpoint[${i}] (ref: ${cpd.ref.substring(0, 8)}...): ${cpd.quads.length} quads, ${formatSize(cpdJson.length)}`)
    })
  }

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
 * @param versionStore - The version store (for version history)
 * @param data - JSON string of the full state export
 */
export async function importFullState(
  backend: StoreBackend,
  versionStore: VersionStore,
  data: string
): Promise<void> {
  const parsed = JSON.parse(data)
  
  // Validate version
  if (parsed.version !== 2) {
    throw new Error(`Unsupported state export version: ${parsed.version}. Expected version 2.`)
  }
  
  const exportData = parsed as FullStateExport
  const db = versionStore.database
  
  // Use a transaction for atomic import
  await db.transaction('rw', [db.refNodes, db.children, db.checkpoints, db.checkpointData, db.meta], async () => {
    // Clear all existing data
    await db.refNodes.clear()
    await db.children.clear()
    await db.checkpoints.clear()
    await db.checkpointData.clear()
    await db.meta.clear()
    
    // Import ref nodes
    if (exportData.refNodes.length > 0) {
      await db.refNodes.bulkPut(exportData.refNodes.map(node => ({
        ref: node.ref,
        parent: node.parent,
        operation: node.operation,
        timestamp: node.timestamp
      })))
    }
    
    // Import children index
    if (exportData.childrenIndex.length > 0) {
      await db.children.bulkPut(exportData.childrenIndex.map(idx => ({
        parentRef: idx.parentRef,
        children: idx.children
      })))
    }
    
    // Import checkpoints
    if (exportData.checkpoints.length > 0) {
      await db.checkpoints.bulkPut(exportData.checkpoints.map(cp => ({
        id: cp.id,
        ref: cp.ref,
        title: cp.title,
        description: cp.description,
        timestamp: cp.timestamp,
        quadCount: cp.quadCount
      })))
    }
    
    // Import checkpoint data
    if (exportData.checkpointData.length > 0) {
      await db.checkpointData.bulkPut(exportData.checkpointData.map(cpd => ({
        ref: cpd.ref,
        data: cpd.quads
      })))
    }
    
    // Set head
    await db.meta.put({ key: 'head', value: exportData.head })
  })
  
  // Clear and restore backend quads
  await backend.clear()
  if (exportData.currentQuads.length > 0) {
    const quads = exportData.currentQuads.map(toRdfQuad)
    await backend.batchInsert(quads)
  }
}
