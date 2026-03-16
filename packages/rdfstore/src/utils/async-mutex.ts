/**
 * Simple async mutex for serializing async operations.
 *
 * Ensures that only one async critical section runs at a time.
 * Additional callers queue up and execute in order.
 */
export class AsyncMutex {
  private queue: Array<() => void> = []
  private locked = false

  /** Run `fn` exclusively — waits for any prior holder to release. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}
