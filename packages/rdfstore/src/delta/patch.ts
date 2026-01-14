/**
 * Text patch utilities for Literal values
 */

import { diffChars } from 'diff'
import type { TextPatch, PatchHunk } from '../types.js'

/**
 * Create a text patch from old to new
 */
export function createTextPatch(oldText: string, newText: string): TextPatch {
  const changes = diffChars(oldText, newText)
  const hunks: PatchHunk[] = []
  let pos = 0

  for (const c of changes) {
    if (c.removed) {
      hunks.push({ start: pos, deleteCount: c.value.length, insert: '' })
      pos += c.value.length
    } else if (c.added) {
      const last = hunks.length > 0 ? hunks[hunks.length - 1] : undefined
      if (last && last.start + last.deleteCount === pos) {
        last.insert += c.value
      } else {
        hunks.push({ start: pos, deleteCount: 0, insert: c.value })
      }
    } else {
      pos += c.value.length
    }
  }

  return { originalLength: oldText.length, hunks }
}

/**
 * Apply a patch to text
 */
export function applyTextPatch(text: string, patch: TextPatch): string {
  if (text.length !== patch.originalLength) {
    throw new Error(`Length mismatch: expected ${patch.originalLength}, got ${text.length}`)
  }
  
  let result = text
  for (const h of [...patch.hunks].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, h.start) + h.insert + result.slice(h.start + h.deleteCount)
  }
  return result
}

/**
 * Invert a patch (for undo)
 */
export function invertTextPatch(originalText: string, patch: TextPatch): TextPatch {
  const newText = applyTextPatch(originalText, patch)
  return createTextPatch(newText, originalText)
}
