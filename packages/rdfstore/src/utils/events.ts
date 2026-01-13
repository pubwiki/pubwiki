/**
 * Simple typed event emitter for store events
 */

type Listener<T> = (data: T) => void

export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>()

  /**
   * Subscribe to an event
   * @returns Unsubscribe function
   */
  on<K extends keyof Events>(event: K, callback: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const listeners = this.listeners.get(event)!
    listeners.add(callback as Listener<unknown>)

    return () => {
      listeners.delete(callback as Listener<unknown>)
      if (listeners.size === 0) {
        this.listeners.delete(event)
      }
    }
  }

  /**
   * Emit an event to all subscribers
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data)
        } catch (error) {
          console.error(`Error in event listener for ${String(event)}:`, error)
        }
      }
    }
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   */
  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0
  }
}
