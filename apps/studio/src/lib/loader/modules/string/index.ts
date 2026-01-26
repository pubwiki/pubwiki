/**
 * String Module for Lua
 * 
 * Provides UTF-8 aware string methods that override Lua's byte-based defaults.
 * This module should be registered with a Lua instance to patch the global 'string' table.
 * 
 * Replaces the Rust-side utf8_string.rs implementation.
 */

/**
 * Get array of grapheme clusters (user-perceived characters)
 * This properly handles emoji, combining marks, etc.
 */
function toGraphemes(s: string): string[] {
  // Use Intl.Segmenter if available for proper grapheme support
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(s), seg => seg.segment)
  }
  // Fallback: use Array.from which handles surrogate pairs but not combining marks
  return Array.from(s)
}

/**
 * Convert a Lua 1-based index to a 0-based JS index
 * Handles negative indices (count from end)
 */
function luaIndexToJs(idx: number, len: number): number {
  if (idx < 0) {
    // Lua negative indices: -1 is last char, -2 is second to last, etc.
    return Math.max(0, len + idx + 1) - 1
  } else {
    // Lua positive indices are 1-based
    return Math.max(0, idx - 1)
  }
}

/**
 * UTF-8 aware string.len
 * Returns the number of characters (graphemes), not bytes
 */
function len(s: string): number {
  return toGraphemes(s).length
}

/**
 * UTF-8 aware string.sub
 * Extracts substring using 1-based character indices (Lua style)
 */
function sub(s: string, i?: number | null, j?: number | null): string {
  const chars = toGraphemes(s)
  const length = chars.length
  
  if (length === 0) {
    return ''
  }
  
  const start = i ?? 1
  const end = j ?? length
  
  // Convert to 1-based positive indices first
  const start1Based = start < 0 ? length + start + 1 : start
  const end1Based = end < 0 ? length + end + 1 : end
  
  // Convert to 0-based indices
  const startIdx = Math.min(Math.max(0, start1Based - 1), chars.length)
  const endIdx = Math.min(Math.max(0, end1Based), chars.length) // end is inclusive in Lua
  
  if (startIdx >= endIdx || startIdx >= chars.length) {
    return ''
  }
  
  return chars.slice(startIdx, endIdx).join('')
}

/**
 * UTF-8 aware string.reverse
 */
function reverse(s: string): string {
  return toGraphemes(s).reverse().join('')
}

/**
 * UTF-8 aware string.upper
 */
function upper(s: string): string {
  return s.toUpperCase()
}

/**
 * UTF-8 aware string.lower
 */
function lower(s: string): string {
  return s.toLowerCase()
}

/**
 * Get character at 1-based index
 * Returns nil (undefined) if index is out of bounds
 */
function char_at(s: string, i: number): string | undefined {
  const chars = toGraphemes(s)
  const length = chars.length
  
  const idx = i < 0 ? Math.max(0, length + i + 1) - 1 : Math.max(0, i - 1)
  
  if (idx >= chars.length) {
    return undefined
  }
  
  return chars[idx]
}

/**
 * Return array of all characters in string
 */
function chars(s: string): string[] {
  return toGraphemes(s)
}

/**
 * UTF-8 aware string.byte - return Unicode codepoints
 */
function byte(s: string, i?: number | null, j?: number | null): number[] {
  const charArray = toGraphemes(s)
  const length = charArray.length
  
  const start = i ?? 1
  const end = j ?? start
  
  const startIdx = start < 0 ? Math.max(0, length + start + 1) - 1 : Math.max(0, start - 1)
  const endIdx = Math.min(end < 0 ? Math.max(0, length + end + 1) : end, length)
  
  if (startIdx >= charArray.length) {
    return []
  }
  
  const result: number[] = []
  for (let idx = startIdx; idx < Math.min(endIdx, charArray.length); idx++) {
    const c = charArray[idx]
    // Get codepoint of first character in grapheme cluster
    const cp = c.codePointAt(0)
    if (cp !== undefined) {
      result.push(cp)
    }
  }
  
  return result
}

/**
 * UTF-8 aware string.char - create string from Unicode codepoints
 */
function char(...codepoints: number[]): string {
  let result = ''
  for (const code of codepoints) {
    if (typeof code === 'number' && !isNaN(code)) {
      try {
        result += String.fromCodePoint(code)
      } catch {
        // Invalid codepoint, skip
      }
    }
  }
  return result
}

/**
 * UTF-8 aware string.find with regex support
 * Returns (start, end) 1-based indices or (nil, nil) if not found
 */
function find(s: string, pattern: string, init?: number | null): [number | null, number | null] {
  const charArray = toGraphemes(s)
  const startPos = Math.max(1, init ?? 1) - 1
  
  const searchStr = charArray.slice(startPos).join('')
  
  try {
    const re = new RegExp(pattern)
    const match = re.exec(searchStr)
    
    if (match) {
      // Calculate character positions (1-based)
      const prefix = searchStr.slice(0, match.index)
      const prefixChars = toGraphemes(prefix).length
      const matchedChars = toGraphemes(match[0]).length
      
      const charStart = startPos + prefixChars
      const charEnd = charStart + matchedChars
      
      return [charStart + 1, charEnd]
    }
    
    return [null, null]
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${e}`)
  }
}

/**
 * string.match - return captured groups from regex
 */
function match(s: string, pattern: string, init?: number | null): string[] | null {
  const startPos = Math.max(1, init ?? 1) - 1
  const charArray = toGraphemes(s)
  const searchStr = charArray.slice(startPos).join('')
  
  try {
    const re = new RegExp(pattern)
    const caps = re.exec(searchStr)
    
    if (caps) {
      // Return captured groups (excluding full match at index 0)
      const results: string[] = []
      for (let i = 1; i < caps.length; i++) {
        if (caps[i] !== undefined) {
          results.push(caps[i])
        }
      }
      
      // If no captures, return the full match
      if (results.length === 0 && caps[0]) {
        results.push(caps[0])
      }
      
      return results.length > 0 ? results : null
    }
    
    return null
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${e}`)
  }
}

/**
 * string.gmatch - return iterator for all matches
 */
function gmatch(s: string, pattern: string): () => string | null {
  try {
    // Add global flag to get all matches
    const re = new RegExp(pattern, 'g')
    const matches: string[] = []
    let m: RegExpExecArray | null
    
    while ((m = re.exec(s)) !== null) {
      matches.push(m[0])
    }
    
    let index = 0
    return function(): string | null {
      if (index < matches.length) {
        return matches[index++]
      }
      return null
    }
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${e}`)
  }
}

/**
 * string.gsub - global substitution with regex
 * Returns (result, count)
 */
function gsub(
  s: string, 
  pattern: string, 
  replacement: string | ((match: string) => string),
  n?: number | null
): [string, number] {
  try {
    const re = new RegExp(pattern, 'g')
    const maxReplacements = n ?? Infinity
    let count = 0
    
    if (typeof replacement === 'string') {
      // String replacement
      const result = s.replace(re, (match) => {
        if (count >= maxReplacements) {
          return match
        }
        count++
        return replacement
      })
      return [result, count]
    } else if (typeof replacement === 'function') {
      // Function replacement
      const result = s.replace(re, (match) => {
        if (count >= maxReplacements) {
          return match
        }
        count++
        return replacement(match)
      })
      return [result, count]
    }
    
    throw new Error('gsub replacement must be string or function')
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('gsub')) {
      throw e
    }
    throw new Error(`Invalid regex pattern: ${e}`)
  }
}

/**
 * string.rep - repeat string n times with optional separator
 */
function rep(s: string, n: number, sep?: string): string {
  if (n <= 0) {
    return ''
  }
  if (sep) {
    return Array(n).fill(s).join(sep)
  }
  return s.repeat(n)
}

/**
 * string.format - basic format string support
 * Supports: %s (string), %d (integer), %f (float), %% (literal %)
 */
function format(fmt: string, ...args: unknown[]): string {
  let argIndex = 0
  return fmt.replace(/%([%sdfq])/g, (match, specifier) => {
    if (specifier === '%') {
      return '%'
    }
    if (argIndex >= args.length) {
      return match
    }
    const arg = args[argIndex++]
    switch (specifier) {
      case 's':
        return String(arg)
      case 'd':
        return Math.floor(Number(arg)).toString()
      case 'f':
        return Number(arg).toString()
      case 'q':
        // Quoted string
        return JSON.stringify(String(arg))
      default:
        return match
    }
  })
}

/**
 * Create the string module object
 * This patches the Lua 'string' global table with UTF-8 aware methods
 */
export function createStringModule() {
  return {
    len,
    sub,
    reverse,
    upper,
    lower,
    char_at,
    chars,
    byte,
    char,
    find,
    match,
    gmatch,
    gsub,
    rep,
    format
  }
}

// Export individual functions for testing
export {
  len,
  sub,
  reverse,
  upper,
  lower,
  char_at,
  chars,
  byte,
  char,
  find,
  match,
  gmatch,
  gsub,
  rep,
  format,
  toGraphemes,
  luaIndexToJs
}
