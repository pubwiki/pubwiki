/**
 * Serialize / deserialize TripleIndex to Uint8Array.
 *
 * Format: JSON-encoded Triple[] → TextEncoder/TextDecoder.
 * Simple and correct; can be optimized later (MessagePack, etc.).
 */

import type { TripleIndex } from '../index/triple-index'
import type { Triple } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function serialize(index: TripleIndex): Uint8Array {
  const triples = index.getAll()
  const json = JSON.stringify(triples)
  return encoder.encode(json)
}

export function deserialize(data: Uint8Array): Triple[] {
  const json = decoder.decode(data)
  return JSON.parse(json) as Triple[]
}
