/**
 * Utility functions for generating unique IDs and hashes
 */

/**
 * Generate a unique ID for log entries
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Generate a snapshot reference from content hash
 * Uses a simple hash function suitable for IndexedDB keys
 */
export async function generateSnapshotRef(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return `snap-${hashHex.substring(0, 16)}`
}

/**
 * Generate a snapshot reference from a log index (for checkpoints)
 */
export function generateCheckpointRef(logIndex: number): string {
  const timestamp = Date.now().toString(36)
  return `ckpt-${logIndex}-${timestamp}`
}

/**
 * Check if a snapshot ref is an initial/empty snapshot
 */
export function isEmptySnapshotRef(ref: string): boolean {
  return ref === 'empty' || ref.startsWith('empty-')
}

/**
 * Generate an empty snapshot reference
 */
export function generateEmptySnapshotRef(): string {
  return `empty-${Date.now().toString(36)}`
}
