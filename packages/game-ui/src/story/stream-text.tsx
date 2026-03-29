/**
 * StreamText — Typewriter-effect renderer for streaming AI content.
 *
 * Reads a text field from partial JSON content (as delivered by
 * CreativeWriting's result_update events) and reveals characters
 * progressively to create a "writing in real-time" experience.
 *
 * Usage:
 *   const { stream, phase } = useStoryEngine()
 *   <StreamText content={stream.partialContent} field="novel_content" />
 *
 * For nested fields, use dot notation: field="part1.text"
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'

export interface StreamTextProps {
  /** The partial content object from stream.partialContent or lastResult.content */
  content: unknown | null
  /** Dot-path to the text field within content (e.g. "novel_content" or "part1.text") */
  field: string
  /** Characters revealed per tick. Default: 1 */
  charsPerTick?: number
  /** Milliseconds between ticks. Default: 30 */
  speed?: number
  /** If true, skip typewriter and show all text immediately. Default: false */
  instant?: boolean
  /** Wrapper element tag. Default: "div" */
  as?: keyof React.JSX.IntrinsicElements
  /** CSS class */
  className?: string
}

/** Resolve a dot-path like "a.b.c" on an object. */
function getByPath(obj: unknown, path: string): unknown {
  let current = obj
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function StreamText({
  content,
  field,
  charsPerTick = 1,
  speed = 30,
  instant = false,
  as: Tag = 'div',
  className,
}: StreamTextProps) {
  // Extract full text from content
  const fullText = useMemo(() => {
    if (content == null) return ''
    const value = getByPath(content, field)
    return typeof value === 'string' ? value : ''
  }, [content, field])

  // Track how many characters are revealed
  const [revealedCount, setRevealedCount] = useState(0)
  const prevTextRef = useRef('')

  // When fullText grows (streaming), only animate the new portion
  useEffect(() => {
    const prev = prevTextRef.current
    if (fullText.startsWith(prev)) {
      // Text extended — keep revealed count, new chars will animate in
      // No action needed, the interval below handles it
    } else {
      // Text replaced entirely (e.g. new generation) — reset
      setRevealedCount(0)
    }
    prevTextRef.current = fullText
  }, [fullText])

  // Typewriter tick
  useEffect(() => {
    if (instant || revealedCount >= fullText.length) return

    const timer = setInterval(() => {
      setRevealedCount(prev => {
        const next = Math.min(prev + charsPerTick, fullText.length)
        if (next >= fullText.length) clearInterval(timer)
        return next
      })
    }, speed)

    return () => clearInterval(timer)
  }, [fullText, revealedCount, charsPerTick, speed, instant])

  // When instant mode, show everything
  const displayText = instant ? fullText : fullText.slice(0, revealedCount)
  const isTyping = !instant && revealedCount < fullText.length

  if (!displayText) return null

  return (
    <Tag
      data-slot="stream-text"
      data-typing={isTyping || undefined}
      className={className}
    >
      {displayText}
      {isTyping && <span data-slot="stream-cursor" />}
    </Tag>
  )
}
