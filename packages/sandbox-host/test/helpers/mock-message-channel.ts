/**
 * Mock MessagePort and MessageChannel for Testing
 *
 * Simulates MessagePort behavior for testing RPC communication.
 */

type MessageHandler = (event: MessageEvent) => void

/**
 * Mock MessagePort implementation
 */
export class MockMessagePort implements MessagePort {
  private _otherPort: MockMessagePort | null = null
  private _handlers: Set<MessageHandler> = new Set()
  private _started = false
  private _closed = false

  onmessage: ((this: MessagePort, ev: MessageEvent) => void) | null = null
  onmessageerror: ((this: MessagePort, ev: MessageEvent) => void) | null = null

  /**
   * Connect this port to another port
   */
  _connect(otherPort: MockMessagePort): void {
    this._otherPort = otherPort
  }

  start(): void {
    this._started = true
  }

  close(): void {
    this._closed = true
    this._otherPort = null
    this._handlers.clear()
  }

  postMessage(message: unknown, transfer?: Transferable[]): void
  postMessage(message: unknown, options?: StructuredSerializeOptions): void
  postMessage(message: unknown, _transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
    if (this._closed || !this._otherPort) {
      return
    }

    // Simulate async message delivery
    queueMicrotask(() => {
      if (this._otherPort && !this._otherPort._closed) {
        const event = new MessageEvent('message', { data: message })
        
        if (this._otherPort.onmessage) {
          this._otherPort.onmessage.call(this._otherPort, event)
        }
        
        for (const handler of this._otherPort._handlers) {
          handler(event)
        }
      }
    })
  }

  addEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => void,
    _options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (type === 'message') {
      const handler = typeof listener === 'function' 
        ? listener as MessageHandler
        : (listener as EventListenerObject).handleEvent.bind(listener) as MessageHandler
      this._handlers.add(handler)
    }
  }

  removeEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => void,
    _options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {
    if (type === 'message') {
      const handler = typeof listener === 'function'
        ? listener as MessageHandler
        : (listener as EventListenerObject).handleEvent.bind(listener) as MessageHandler
      this._handlers.delete(handler)
    }
  }

  dispatchEvent(_event: Event): boolean {
    return true
  }
}

/**
 * Mock MessageChannel implementation
 */
export class MockMessageChannel implements MessageChannel {
  readonly port1: MockMessagePort
  readonly port2: MockMessagePort

  constructor() {
    this.port1 = new MockMessagePort()
    this.port2 = new MockMessagePort()
    
    // Connect the two ports
    this.port1._connect(this.port2)
    this.port2._connect(this.port1)
  }
}
