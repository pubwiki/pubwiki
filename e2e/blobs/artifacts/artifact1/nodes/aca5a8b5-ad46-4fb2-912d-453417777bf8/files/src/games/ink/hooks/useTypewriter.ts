import { useState, useEffect, useRef } from 'react'

const UPDATE_INTERVAL_MS = 50 // 20 updates/sec, performance-friendly

/**
 * Typewriter hook: reveals text character by character at a fixed speed.
 *
 * Once activated (enabled=true on mount or later), the animation runs to
 * completion regardless of subsequent `enabled` changes. This ensures that
 * store updates (like the 'done' event) don't cause text to flash fully.
 *
 * @param text - The full text to reveal (can grow during streaming)
 * @param enabled - true = animate from pos 0; false = show all text immediately.
 *                  Once true, the typewriter stays active until naturally complete.
 * @param charsPerSecond - Display speed (default 40 chars/sec)
 * @returns { visibleText, isComplete, skip }
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
  charsPerSecond: number = 40
) {
  // Instant mode: skip animation entirely
  const instant = charsPerSecond >= 9999

  // Track whether typewriter has EVER been activated — once true, never goes back
  const activatedRef = useRef(enabled && !instant)
  if (enabled && !instant) activatedRef.current = true
  const activated = activatedRef.current

  // Target length ref — updated on every render so the interval always sees the latest
  const targetLenRef = useRef(text.length)
  targetLenRef.current = text.length

  // Position: how many chars are visible
  // Never-activated → full length (history turns); activated → 0 (animate)
  const [pos, setPos] = useState(() => activated ? 0 : text.length)

  // When first activated (enabled goes from false → true), reset pos to 0
  const wasActivatedRef = useRef(activated)
  useEffect(() => {
    if (activated && !wasActivatedRef.current) {
      setPos(0)
    }
    wasActivatedRef.current = activated
  }, [activated])

  // Keep pos in sync for never-activated instances (text grows while still disabled)
  useEffect(() => {
    if (!activated) {
      setPos(text.length)
    }
  }, [activated, text.length])

  // Animation interval — runs as long as the typewriter has been activated
  useEffect(() => {
    if (!activated) return

    const charsPerUpdate = Math.max(1, Math.round(charsPerSecond * UPDATE_INTERVAL_MS / 1000))

    const interval = setInterval(() => {
      setPos(p => {
        if (p >= targetLenRef.current) return p // At the end of available text, wait
        return Math.min(p + charsPerUpdate, targetLenRef.current)
      })
    }, UPDATE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [activated, charsPerSecond])

  const isComplete = !activated || pos >= text.length

  return {
    visibleText: text ? (activated ? text.slice(0, pos) : text) : '',
    isComplete
  }
}
