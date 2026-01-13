/**
 * Functional operations on snapshots
 */

import type { Triple, SnapshotRef, Operation } from '../types.js'
import type { StoreBackend } from '../backend/quadstore.js'
import type { SnapshotView } from './snapshot.js'
import { createSnapshotView } from './snapshot.js'
import { generateEmptySnapshotRef, generateSnapshotRef } from '../utils/hash.js'

/**
 * Load a snapshot view from a reference
 * 
 * Note: In this implementation, the ref is mainly for tracking purposes.
 * The actual data is read from the current backend state.
 */
export async function loadSnapshot(
  backend: StoreBackend,
  ref: SnapshotRef
): Promise<SnapshotView> {
  return createSnapshotView(backend, ref)
}

/**
 * Apply a single operation to the backend
 * Returns a new snapshot reference
 */
export async function applyOperation(
  backend: StoreBackend,
  _snapshotRef: SnapshotRef,
  operation: Operation
): Promise<SnapshotRef> {
  switch (operation.type) {
    case 'insert':
      await backend.insert(operation.triple)
      break

    case 'delete':
      await backend.delete(operation.triple)
      break

    case 'batch-insert':
      await backend.batchInsert(operation.triples)
      break

    case 'batch-delete':
      for (const triple of operation.triples) {
        await backend.delete(triple)
      }
      break
  }

  // Generate new snapshot ref based on content hash
  const allTriples = await backend.getAllTriples()
  const content = JSON.stringify(allTriples)
  return generateSnapshotRef(content)
}

/**
 * Apply multiple operations in sequence
 */
export async function applyOperations(
  backend: StoreBackend,
  snapshotRef: SnapshotRef,
  operations: Operation[]
): Promise<SnapshotRef> {
  let currentRef = snapshotRef

  for (const op of operations) {
    currentRef = await applyOperation(backend, currentRef, op)
  }

  return currentRef
}

/**
 * Create an empty snapshot
 */
export async function createEmptySnapshot(backend: StoreBackend): Promise<SnapshotRef> {
  await backend.clear()
  return generateEmptySnapshotRef()
}

/**
 * Create a snapshot from a set of triples
 */
export async function createSnapshot(
  backend: StoreBackend,
  triples: Triple[]
): Promise<SnapshotRef> {
  await backend.clear()
  
  if (triples.length > 0) {
    await backend.batchInsert(triples)
  }

  const content = JSON.stringify(triples)
  return generateSnapshotRef(content)
}

/**
 * Compute delta between two sets of triples
 * 
 * This is a wrapper around the delta module for convenience
 */
export async function computeDelta(
  _backend: StoreBackend,
  _fromRef: SnapshotRef,
  _toRef: SnapshotRef
): Promise<Operation[]> {
  // Note: In a full implementation, we would store snapshots
  // and retrieve them by ref. For now, this computes the delta
  // based on the current state.
  
  // This function would need access to stored snapshot data
  // For the functional API, users should use the delta module directly
  // with their own triple arrays
  
  throw new Error(
    'computeDelta between refs requires snapshot storage. ' +
    'Use computeDelta from delta module with triple arrays instead.'
  )
}

/**
 * Compute delta between two triple arrays
 * Re-exported for convenience
 */
export { computeDelta as computeTripleDelta } from '../delta/diff.js'
