/**
 * SillyTavern Lorebook Parser
 *
 * Parses SillyTavern character card JSON files, extracting
 * character_book entries and card metadata.
 */

import type { LorebookData, LorebookEntry } from '../world-builder/types'

/**
 * Attempt to parse a SillyTavern character card JSON into LorebookData.
 * Returns null if the JSON is not a valid SillyTavern lorebook format.
 */
export function parseSillyTavernLorebook(
  json: unknown,
  filename: string,
): LorebookData | null {
  if (!json || typeof json !== 'object') return null

  const root = json as Record<string, unknown>
  const data = root.data as Record<string, unknown> | undefined

  // Must have data.character_book.entries
  const characterBook = data?.character_book as Record<string, unknown> | undefined
  const rawEntries = characterBook?.entries
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null

  const entries: LorebookEntry[] = []
  let totalChars = 0

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const content = typeof e.content === 'string' ? e.content : ''
    entries.push({
      id: typeof e.id === 'number' ? e.id : entries.length,
      keys: Array.isArray(e.keys)
        ? e.keys.filter((k): k is string => typeof k === 'string')
        : [],
      comment: typeof e.comment === 'string' ? e.comment : '',
      content,
      enabled: e.enabled !== false,
    })
    totalChars += content.length
  }

  const str = (key: string) => {
    const v = data?.[key]
    return typeof v === 'string' ? v : ''
  }

  return {
    filename,
    name: str('name') || (root.name as string) || filename,
    description: str('description'),
    personality: str('personality'),
    scenario: str('scenario'),
    first_mes: str('first_mes'),
    mes_example: str('mes_example'),
    creator_notes: str('creator_notes'),
    entries,
    totalChars,
    uploadedAt: Date.now(),
  }
}
