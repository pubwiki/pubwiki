/// <reference lib="dom" />
import { newWebSocketRpcSession, RpcStub, RpcTarget } from 'capnweb';
import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import { isVfsFile } from '@pubwiki/vfs';
import type { FileStat, FileType, FileChangeEvent, IVirtualFileSystem } from './types';

/**
 * RPC API implementation that adapts @pubwiki/vfs to VS Code's file system interface
 */
class VfsAdapter extends RpcTarget implements IVirtualFileSystem {
  private fileChangeCallbacks: Array<RpcStub<(changes: FileChangeEvent[]) => void>> = [];
  private eventUnsubscriber: (() => void) | null = null;

  constructor(private vfs: Vfs<VfsProvider>) {
    super();
    this.setupEventListening();
  }

  /**
   * Set up VFS event listening and forward to registered callbacks
   */
  private setupEventListening(): void {
    console.log('[VFS Browser] Setting up VFS event listening...');
    this.eventUnsubscriber = this.vfs.events.onAny((event) => {
      console.log('[VFS Browser] VFS event received:', event.type, event);
      console.log('[VFS Browser] Number of registered callbacks:', this.fileChangeCallbacks.length);
      
      if (this.fileChangeCallbacks.length === 0) {
        console.log('[VFS Browser] No callbacks registered, ignoring event');
        return;
      }

      const changes: FileChangeEvent[] = [];

      switch (event.type) {
        case 'file:created':
        case 'folder:created':
          changes.push({ type: 'created', path: event.path });
          break;
        case 'file:updated':
          changes.push({ type: 'changed', path: event.path });
          break;
        case 'file:deleted':
        case 'folder:deleted':
          changes.push({ type: 'deleted', path: event.path });
          break;
        case 'file:moved':
        case 'folder:moved':
          changes.push({ type: 'deleted', path: event.fromPath });
          changes.push({ type: 'created', path: event.toPath });
          break;
      }

      if (changes.length > 0) {
        console.log('[VFS Browser] Notifying callbacks with changes:', changes);
        // Notify all registered callbacks
        for (const callback of this.fileChangeCallbacks) {
          try {
            console.log('[VFS Browser] Invoking callback...');
            callback(changes);
            console.log('[VFS Browser] Callback invoked successfully');
          } catch (e) {
            console.error('[VFS Browser] Error in file change callback:', e);
          }
        }
      } else {
        console.log('[VFS Browser] No changes to notify for event:', event.type);
      }
    });
  }

  async stat(path: string): Promise<FileStat> {
    console.log('[VFS Browser] stat called for:', path);
    try {
      const stat = await this.vfs.stat(path);
      const result = {
        type: stat.isFile ? 'file' : stat.isDirectory ? 'directory' : 'unknown' as FileType,
        size: stat.size,
        mtime: stat.updatedAt.getTime(),
        ctime: stat.createdAt.getTime(),
      };
      console.log('[VFS Browser] stat result:', result);
      return result;
    } catch (error) {
      console.error('[VFS Browser] stat error:', error);
      throw error;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    console.log('[VFS Browser] readFile called for:', path);
    return await this.vfs.getProvider().readFile(path);
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    console.log('[VFS Browser] writeFile called for:', path);
    const exists = await this.vfs.exists(path);
    if (exists) {
      await this.vfs.updateFile(path, content.buffer as ArrayBuffer);
    } else {
      await this.vfs.createFile(path, content.buffer as ArrayBuffer);
    }
  }

  async readDirectory(path: string): Promise<Array<[string, FileType]>> {
    console.log('[VFS Browser] readDirectory called for:', path);
    try {
      const items = await this.vfs.listFolder(path);
      const result = items.map(item => [
        item.name,
        isVfsFile(item) ? 'file' : 'directory'
      ] as [string, FileType]);
      console.log('[VFS Browser] readDirectory result:', result);
      return result;
    } catch (error) {
      console.error('[VFS Browser] readDirectory error:', error);
      throw error;
    }
  }

  async createDirectory(path: string): Promise<void> {
    await this.vfs.createFolder(path);
  }

  async delete(path: string, recursive: boolean): Promise<void> {
    const stat = await this.vfs.stat(path);
    if (stat.isFile) {
      await this.vfs.deleteFile(path);
    } else {
      await this.vfs.deleteFolder(path, recursive);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.vfs.moveItem(oldPath, newPath);
  }

  /**
   * Register a callback for file change notifications.
   * The callback function is passed over RPC - capnweb will create a stub
   * that calls back to the extension when invoked.
   */
  async onFileChange(callback: RpcStub<(changes: FileChangeEvent[]) => void>): Promise<void> {
    console.log('[VFS Browser] onFileChange called, registering callback');
    console.log('[VFS Browser] Callback type:', typeof callback);
    this.fileChangeCallbacks.push(callback.dup());
    console.log('[VFS Browser] Total callbacks registered:', this.fileChangeCallbacks.length);
  }

  /**
   * Clean up event listeners
   */
  [Symbol.dispose](): void {
    if (this.eventUnsubscriber) {
      this.eventUnsubscriber();
      this.eventUnsubscriber = null;
    }
    this.fileChangeCallbacks.forEach(cb => cb[Symbol.dispose]())
    this.fileChangeCallbacks = [];
  }
}

/**
 * Connection options
 */
export interface VfsConnectionOptions {
  /** WebSocket URL to connect to */
  websocketUrl: string;
  /** Optional authentication token */
  token?: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Maximum reconnection attempts (0 = no retry, -1 = infinite) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds */
  retryDelay?: number;
}

/**
 * VFS Browser Client - connects @pubwiki/vfs to VS Code extension
 */
export class VfsBrowserClient {
  private ws: WebSocket | null = null;
  private rpcSession: unknown = null;
  private connected = false;
  private options: VfsConnectionOptions | null = null;
  private retryCount = 0;
  private reconnecting = false;
  private manualDisconnect = false;
  private adapter: VfsAdapter | null = null;

  private onDisconnectCallback: (() => void) | null = null;
  private onReconnectCallback: (() => void) | null = null;

  constructor(private vfs: Vfs<VfsProvider>) {}

  /**
   * Connect to VS Code's WebSocket server
   */
  async connect(options: VfsConnectionOptions): Promise<void> {
    console.log('[VFS Browser] Connecting to:', options.websocketUrl);
    
    if (this.connected) {
      throw new Error('Already connected');
    }

    this.options = options;
    this.manualDisconnect = false;

    const { websocketUrl, timeout = 10000 } = options;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.error('[VFS Browser] Connection timeout');
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, timeout);

      this.ws = new WebSocket(websocketUrl);

      this.ws.onopen = () => {
        console.log('[VFS Browser] WebSocket connected, creating RPC session...');
        clearTimeout(timeoutId);
        this.adapter = new VfsAdapter(this.vfs);
        this.rpcSession = newWebSocketRpcSession(this.ws as unknown as WebSocket, this.adapter);
        this.connected = true;
        console.log('[VFS Browser] RPC session created, connection established');
        resolve();
      };

      this.ws.onerror = (event) => {
        console.error('[VFS Browser] WebSocket error:', event);
        clearTimeout(timeoutId);
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.connected = false;
        
        if (this.manualDisconnect) {
          this.onDisconnectCallback?.();
          this.cleanup();
          return;
        }

        this.onDisconnectCallback?.();
        this.cleanup();
        this.attemptReconnection();
      };
    });
  }



  /**
   * Disconnect from VS Code
   */
  disconnect(): void {
    console.log('[VFS Browser] Disconnecting...');
    this.manualDisconnect = true;
    this.reconnecting = false;
    this.retryCount = 0;
    
    // Remove event handlers before closing to prevent them from firing
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      
      // Close the WebSocket if it's open
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    }
    
    this.cleanup();
    console.log('[VFS Browser] Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set disconnect callback
   */
  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  /**
   * Set reconnect callback
   */
  onReconnect(callback: () => void): void {
    this.onReconnectCallback = callback;
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  private async attemptReconnection(): Promise<void> {
    if (this.reconnecting || this.manualDisconnect || !this.options) {
      return;
    }

    const { maxRetries = 5, retryDelay = 1000 } = this.options;

    if (maxRetries === 0 || (maxRetries > 0 && this.retryCount >= maxRetries)) {
      return;
    }

    this.reconnecting = true;
    this.retryCount++;

    const delay = retryDelay * Math.pow(2, this.retryCount - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect(this.options);
      this.retryCount = 0;
      this.reconnecting = false;
      this.onReconnectCallback?.();
    } catch {
      this.reconnecting = false;
      this.attemptReconnection();
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.connected = false;
    
    // Dispose the adapter to clean up event listeners
    if (this.adapter) {
      this.adapter[Symbol.dispose]();
      this.adapter = null;
    }

    if (this.rpcSession) {
      const disposeSymbol = Symbol.for('dispose');
      const session = this.rpcSession as Record<symbol, () => void>;
      if (typeof session[disposeSymbol] === 'function') {
        session[disposeSymbol]();
      }
    }

    this.rpcSession = null;
    this.ws = null;
  }

  /**
   * Parse callback URL from VS Code
   */
  static parseCallbackUrl(callbackUrl: string): VfsConnectionOptions {
    const url = new URL(callbackUrl);
    const websocketUrl = url.searchParams.get('ws');
    const token = url.searchParams.get('token');

    if (!websocketUrl) {
      throw new Error('Invalid callback URL: missing vscode_ws parameter');
    }

    return {
      websocketUrl,
      token: token || undefined
    };
  }
}
