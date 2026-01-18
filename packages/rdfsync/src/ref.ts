/**
 * Deterministic Ref Generation
 * 
 * ref = SHA256(parentRef + '|' + canonical(operation))[0:16]
 */

import { canonicalizeOperation } from './canonical.js'
import type { Operation, OperationWithRef, RefMismatchInfo } from './types.js'

export const ROOT_REF = 'root'

/**
 * 生成确定性 ref
 */
export async function generateRef(parentRef: string, operation: Operation): Promise<string> {
  const canonical = canonicalizeOperation(operation)
  const input = `${parentRef}|${canonical}`
  
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  const hashHex = Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  
  return hashHex.slice(0, 16)
}

/**
 * 批量生成 ref 链
 */
export async function generateRefChain(
  baseRef: string,
  operations: Operation[]
): Promise<OperationWithRef[]> {
  const result: OperationWithRef[] = []
  let currentRef = baseRef
  
  for (const operation of operations) {
    const ref = await generateRef(currentRef, operation)
    result.push({ operation, ref })
    currentRef = ref
  }
  
  return result
}

/**
 * 验证 ref 链
 */
export async function verifyRefChain(
  baseRef: string,
  operations: OperationWithRef[]
): Promise<RefMismatchInfo | null> {
  let currentRef = baseRef
  
  for (let i = 0; i < operations.length; i++) {
    const { operation, ref } = operations[i]
    const expected = await generateRef(currentRef, operation)
    
    if (ref !== expected) {
      return { index: i, expected, received: ref }
    }
    
    currentRef = ref
  }
  
  return null
}
