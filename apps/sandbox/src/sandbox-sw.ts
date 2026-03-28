/**
 * Sandbox Service Worker (Refactored for Nested Iframe Architecture)
 *
 * Manages VFS connections for bootstrap clients and their nested user iframes.
 * 
 * Architecture:
 * - Each bootstrap client has its own VFS RPC session
 * - Each bootstrap can have multiple user iframe clients (one-to-many relationship)
 * - User iframes share their parent bootstrap's VFS session
 * - When user iframe navigates, a new client ID is added (old one not removed)
 * 
 * State Persistence:
 * - Uses IndexedDB to persist client mappings across SW wake/sleep cycles
 * - VFS RPC stubs are not persisted (will be null after wake)
 * - Automatically requests new VFS port when needed
 * 
 * Client Management:
 * - bootstrapClients: Map<bootstrapId, BootstrapClient>
 * - userIframeToBootstrap: Map<userIframeId, bootstrapId>
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope

import { newMessagePortRpcSession, RpcStub, type IVfsService } from '@pubwiki/sandbox-service'

// ========== Types ==========

interface BootstrapClient {
  id: string
  vfsRpcStub: RpcStub<IVfsService> | null
}

interface PersistedState {
  bootstrapClientIds: string[]
  userIframeToBootstrap: Record<string, string>
}

// ========== Client Management ==========

/** Bootstrap clients indexed by client ID */
const bootstrapClients = new Map<string, BootstrapClient>()

/** User iframe to bootstrap mapping */
const userIframeToBootstrap = new Map<string, string>()

/** Pending bootstrap requests - promises waiting for bootstrap registration */
const pendingBootstrapRequests = new Map<string, {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}>()

/** Flag to track if we just woke up and need to restore state */
let needsStateRestoration = true

// ========== IndexedDB Persistence ==========

const DB_NAME = 'sandbox-sw-state'
const DB_VERSION = 1
const STORE_NAME = 'state'
const STATE_KEY = 'client-mappings'

/**
 * Open IndexedDB connection
 */
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

/**
 * Save state to IndexedDB
 */
async function saveState(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    
    const state: PersistedState = {
      bootstrapClientIds: Array.from(bootstrapClients.keys()),
      userIframeToBootstrap: Object.fromEntries(userIframeToBootstrap)
    }
    
    store.put(state, STATE_KEY)
    
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    
    db.close()
  } catch (error) {
    console.error('[SandboxSW] Failed to save state:', error)
  }
}

/**
 * Load state from IndexedDB
 */
async function loadState(): Promise<PersistedState | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    
    const state = await new Promise<PersistedState | null>((resolve, reject) => {
      const request = store.get(STATE_KEY)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    
    db.close()
    return state
  } catch (error) {
    console.error('[SandboxSW] Failed to load state:', error)
    return null
  }
}

/**
 * Restore state from IndexedDB after wake up
 */
async function restoreStateIfNeeded(): Promise<void> {
  if (!needsStateRestoration) return
  
  const state = await loadState()
  if (!state) {
    needsStateRestoration = false
    return
  }
  
  // Restore bootstrap clients (without VFS stubs).
  // Skip entries that already exist in memory — they have valid state
  // from the current SW lifecycle that must not be overwritten.
  for (const bootstrapId of state.bootstrapClientIds) {
    if (!bootstrapClients.has(bootstrapId)) {
      bootstrapClients.set(bootstrapId, {
        id: bootstrapId,
        vfsRpcStub: null // Will be restored on-demand
      })
    }
  }
  
  // Restore user iframe mappings (preserve existing)
  for (const [userIframeId, bootstrapId] of Object.entries(state.userIframeToBootstrap)) {
    if (!userIframeToBootstrap.has(userIframeId)) {
      userIframeToBootstrap.set(userIframeId, bootstrapId)
    }
  }
  
  needsStateRestoration = false
}

/**
 * Ensure VFS stub is available for a bootstrap client
 * Requests new port if stub is null (after wake from sleep)
 */
async function ensureVfsStub(bootstrapId: string): Promise<RpcStub<IVfsService> | null> {
  let bootstrap = bootstrapClients.get(bootstrapId)
  
  if (!bootstrap) {
    // Bootstrap not yet in our map — request VFS port from it
    try {
      await requestBootstrapClient(bootstrapId)
      bootstrap = bootstrapClients.get(bootstrapId)
    } catch (error) {
      console.error('[SandboxSW] Failed to request bootstrap client:', error)
      return null
    }
    if (!bootstrap) return null
  }
  
  // If stub exists, return it
  if (bootstrap.vfsRpcStub) {
    return bootstrap.vfsRpcStub
  }
  
  // Stub is null, need to request new port
  try {
    await requestBootstrapClient(bootstrapId)
    return bootstrap.vfsRpcStub
  } catch (error) {
    console.error('[SandboxSW] Failed to restore VFS stub:', error)
    return null
  }
}

// ========== Helper Functions ==========

/**
 * Request VFS port from bootstrap client
 * Returns a promise that resolves when bootstrap is registered
 */
async function requestBootstrapClient(bootstrapId: string): Promise<void> {
  // Check if already registered with valid stub
  const existing = bootstrapClients.get(bootstrapId)
  if (existing?.vfsRpcStub) {
    return
  }
  
  // Check if request is already pending
  const pendingRequest = pendingBootstrapRequests.get(bootstrapId)
  if (pendingRequest) {
    return pendingRequest.promise
  }
  
  // Create a promise for this request
  let resolve: () => void
  let reject: (error: Error) => void
  
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  
  // Set up timeout
  const timeoutId = setTimeout(() => {
    pendingBootstrapRequests.delete(bootstrapId)
    reject(new Error(`Timeout waiting for bootstrap: ${bootstrapId}`))
  }, 5000)
  
  // Store promise and callbacks for SETUP_VFS_RPC_PORT handler to call
  pendingBootstrapRequests.set(bootstrapId, { 
    promise, 
    resolve: resolve!, 
    reject: reject!, 
    timeoutId 
  })
  
  // Get the bootstrap client and send request
  try {
    const client = await self.clients.get(bootstrapId)
    if (!client) {
      pendingBootstrapRequests.delete(bootstrapId)
      clearTimeout(timeoutId)
      throw new Error(`Bootstrap client not found: ${bootstrapId}`)
    }
    
    // Send REQUEST_VFS_PORT message to bootstrap
    client.postMessage({ type: 'REQUEST_VFS_PORT' })
  } catch (error) {
    pendingBootstrapRequests.delete(bootstrapId)
    clearTimeout(timeoutId)
    throw error
  }
  
  return promise
}

// ========== Service Worker Lifecycle ==========

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ========== Message Handling ==========

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { type } = event.data
  const source = event.source as Client
  
  if (type === 'SETUP_VFS_RPC_PORT') {
    // Bootstrap client registers its VFS port
    const bootstrapId = source?.id
    
    if (!bootstrapId) {
      console.error('[SandboxSW] SETUP_VFS_RPC_PORT: no client ID')
      return
    }
    
    if (!event.ports || event.ports.length === 0) {
      console.error('[SandboxSW] SETUP_VFS_RPC_PORT: no port provided')
      return
    }
    
    const vfsPort = event.ports[0]
    // Create RPC stub (client side - empty object as second param)
    const vfsStub = newMessagePortRpcSession<IVfsService>(vfsPort, {})
    
    // Update or create bootstrap client
    const existing = bootstrapClients.get(bootstrapId)
    if (existing) {
      existing.vfsRpcStub = vfsStub
    } else {
      bootstrapClients.set(bootstrapId, {
        id: bootstrapId,
        vfsRpcStub: vfsStub
      })
    }
    
    saveState()
    
    // Resolve any pending requests waiting for this bootstrap
    const pendingRequest = pendingBootstrapRequests.get(bootstrapId)
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeoutId)
      pendingRequest.resolve()
      pendingBootstrapRequests.delete(bootstrapId)
    }
    
    return
  }
  
  if (type === 'REGISTER_USER_IFRAME') {
    // User iframe registers itself, linking to its parent bootstrap
    const userIframeId = source?.id
    const bootstrapId = event.data.bootstrapClientId
    
    if (!userIframeId) {
      console.error('[SandboxSW] REGISTER_USER_IFRAME: no client ID')
      return
    }
    
    if (!bootstrapId) {
      console.error('[SandboxSW] REGISTER_USER_IFRAME: no bootstrap ID provided')
      return
    }
    
    // Handle async registration
    event.waitUntil(
      (async () => {
        // Restore state if needed (after wake)
        await restoreStateIfNeeded()
        
        // Check if bootstrap exists (may be restored from DB)
        let bootstrap = bootstrapClients.get(bootstrapId)
        
        // If bootstrap doesn't exist, request it
        if (!bootstrap) {
          try {
            await requestBootstrapClient(bootstrapId)
            bootstrap = bootstrapClients.get(bootstrapId)
          } catch (error) {
            console.error('[SandboxSW] Failed to get bootstrap client:', error)
            return
          }
        }
        
        if (!bootstrap) {
          console.error('[SandboxSW] REGISTER_USER_IFRAME: bootstrap still not found after request:', bootstrapId)
          return
        }
        
        // Add user iframe to bootstrap mapping (one-to-many)
        userIframeToBootstrap.set(userIframeId, bootstrapId)
        await saveState()
        
        // Notify bootstrap that registration is complete
        const bootstrapClient = await self.clients.get(bootstrapId)
        if (bootstrapClient) {
          bootstrapClient.postMessage({
            type: 'USER_IFRAME_REGISTERED',
            userIframeId: userIframeId
          })
        }
      })()
    )
    
    return
  }
  
  if (type === 'CLIENT_DISCONNECTED') {
    // Clean up client
    const clientId = event.data.clientId
    
    if (!clientId) {
      console.error('[SandboxSW] CLIENT_DISCONNECTED: no client ID')
      return
    }
    
    event.waitUntil(
      (async () => {
        cleanupClient(clientId)
        await saveState()
      })()
    )
    return
  }
  
  if (type === 'GET_CLIENT_ID') {
    // Bootstrap requests its own client ID
    const clientId = source?.id
    
    if (clientId && source) {
      source.postMessage({
        type: 'CLIENT_ID_RESPONSE',
        clientId: clientId
      })
    }
    return
  }
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  
  if (type === 'PING') {
    const clientId = source?.id
    const hasSession = clientId ? (
      bootstrapClients.has(clientId) || userIframeToBootstrap.has(clientId)
    ) : false
    
    source?.postMessage({ type: 'PONG', ready: hasSession })
    return
  }
})

/**
 * Clean up a client (bootstrap or user iframe)
 */
function cleanupClient(clientId: string): void {
  // If it's a bootstrap, clean up everything
  if (bootstrapClients.has(clientId)) {
    const _bootstrap = bootstrapClients.get(clientId)!
    
    // Clean up all associated user iframes
    for (const [userIframeId, bootstrapId] of userIframeToBootstrap.entries()) {
      if (bootstrapId === clientId) {
        userIframeToBootstrap.delete(userIframeId)
      }
    }
    
    bootstrapClients.delete(clientId)
    return
  }
  
  // If it's a user iframe, only remove from mapping
  if (userIframeToBootstrap.has(clientId)) {
    userIframeToBootstrap.delete(clientId)
    return
  }
}

// ========== Fetch Handling ==========

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)
  
  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) {
    return
  }
  
  const clientId = event.clientId
  
  // Handle _bid parameter for browsers that don't pre-register srcdoc iframes.
  // This covers both iOS Safari (no clientId) and older Chrome (clientId present
  // but no mapping because srcdoc iframe couldn't send REGISTER_USER_IFRAME).
  if (event.request.mode === 'navigate') {
    const bid = url.searchParams.get('_bid')
    if (bid) {
      // Map both the old (srcdoc) and new (navigated) client IDs to this bootstrap
      if (event.resultingClientId) {
        userIframeToBootstrap.set(event.resultingClientId, bid)
      }
      if (clientId) {
        userIframeToBootstrap.set(clientId, bid)
      }
      saveState()
      event.respondWith(handleNavigationRequest(event, bid))
      return
    }
  }
  
  // Skip Service Worker itself and bootstrap scripts
  if (
    url.pathname === '/sandbox-sw.js' ||
    url.pathname === '/src/sandbox-bootstrap.ts' ||
    url.pathname === '/src/sandbox-types.ts' ||
    url.pathname === '/src/rpc-client.ts' ||
    url.pathname.startsWith('/__')
  ) {
    return
  }
  
  if (!clientId) {
    return
  }

  // Handle file requests with state restoration
  event.respondWith(handleFetchRequest(event))
})

/**
 * Handle navigation request when we know the bootstrap ID (iOS Safari workaround)
 */
async function handleNavigationRequest(event: FetchEvent, bootstrapId: string): Promise<Response> {
  const url = new URL(event.request.url)
  
  await restoreStateIfNeeded()
  
  const pathname = url.pathname
  const vfsStub = await ensureVfsStub(bootstrapId)
  if (vfsStub) {
    return handleFileRequest(vfsStub, pathname)
  }
  
  console.error('[SandboxSW] Could not get VFS stub for bootstrap:', bootstrapId)
  return new Response('Service Worker: VFS not available', { status: 503 })
}

async function handleFetchRequest(event: FetchEvent) {
  const url = new URL(event.request.url)
  const clientId = event.clientId

  // Restore state if needed
  await restoreStateIfNeeded()

  // Handle navigation - update client ID mapping
  if (event.request.mode === 'navigate' && event.resultingClientId && event.resultingClientId !== clientId) {
    const newClientId = event.resultingClientId
    if (userIframeToBootstrap.has(clientId)) {
      const bootstrapId = userIframeToBootstrap.get(clientId)!
      userIframeToBootstrap.set(newClientId, bootstrapId)
      saveState()
    }
  }
  
  // 1. Check if it's a bootstrap client
  if (bootstrapClients.has(clientId)) {
    const vfsStub = await ensureVfsStub(clientId)
    if (vfsStub) {
      return handleFileRequest(vfsStub, url.pathname)
    }
  }
  
  // 2. Check if it's a user iframe client
  if (userIframeToBootstrap.has(clientId)) {
    const bootstrapId = userIframeToBootstrap.get(clientId)!
    const vfsStub = await ensureVfsStub(bootstrapId)
    if (vfsStub) {
      return handleFileRequest(vfsStub, url.pathname)
    }
  }
  
  // 3. Unknown client
  console.warn('[SandboxSW] Unknown client:', clientId, 'for:', url.pathname, 'bootstrapClients:', [...bootstrapClients.keys()], 'userIframeMap:', [...userIframeToBootstrap.entries()])
  return new Response('Service Worker not ready', { status: 503 })
}


/**
 * Handle file request by reading from VFS
 */
async function handleFileRequest(vfsStub: RpcStub<IVfsService>, pathname: string): Promise<Response> {
  try {
    // Check if file exists
    const existsResult = await vfsStub.fileExists(pathname)
    if (!existsResult.exists) {
      // Try index.html for directory requests
      if (!pathname.includes('.') || existsResult.isDirectory) {
        const indexPath = pathname.endsWith('/')
          ? `${pathname}index.html`
          : `${pathname}/index.html`
        const indexExistsResult = await vfsStub.fileExists(indexPath)
        if (indexExistsResult.exists) {
          return await readAndRespond(vfsStub, indexPath)
        }
      }
      return new Response('Not Found', { status: 404 })
    }
    
    // If it's a directory, try index.html
    if (existsResult.isDirectory) {
      const indexPath = pathname.endsWith('/')
        ? `${pathname}index.html`
        : `${pathname}/index.html`
      return await readAndRespond(vfsStub, indexPath)
    }
    
    return await readAndRespond(vfsStub, pathname)
  } catch (error) {
    console.error('[SandboxSW] VFS error:', error)
    throw error
  }
}

/**
 * Console interceptor script injected into HTML pages served to the user iframe.
 * Patches console methods to forward logs to the parent (bootstrap) frame via postMessage.
 * This runs BEFORE any user module/deferred scripts because it's an inline classic script.
 */
const CONSOLE_INTERCEPTOR_SCRIPT = `<script>(function(){var O={};['log','info','warn','error','debug'].forEach(function(l){O[l]=console[l];console[l]=function(){O[l].apply(console,arguments);try{var a=[];for(var i=0;i<arguments.length;i++){try{a.push(typeof arguments[i]==='object'?JSON.stringify(arguments[i]):String(arguments[i]))}catch(e){a.push('[unserializable]')}}var s=l==='error'?new Error().stack:void 0;window.parent.postMessage({type:'__CONSOLE_LOG__',level:l,message:a.join(' '),timestamp:Date.now(),stack:s},'*')}catch(e){}}});window.addEventListener('error',function(e){window.parent.postMessage({type:'__CONSOLE_LOG__',level:'error',message:e.message||String(e),timestamp:Date.now(),stack:e.error&&e.error.stack},'*')});window.addEventListener('unhandledrejection',function(e){var r=e.reason;window.parent.postMessage({type:'__CONSOLE_LOG__',level:'error',message:'Unhandled Promise Rejection: '+(r instanceof Error?r.message:String(r)),timestamp:Date.now(),stack:r instanceof Error?r.stack:void 0},'*')})})()<\/script>`

/**
 * Inject console interceptor script into HTML content.
 * Inserts immediately after <head> so it runs before any user scripts.
 */
function injectConsoleScript(html: string): string {
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length
    return html.slice(0, insertPos) + CONSOLE_INTERCEPTOR_SCRIPT + html.slice(insertPos)
  }
  // No <head> tag — inject at the start
  return CONSOLE_INTERCEPTOR_SCRIPT + html
}

/**
 * Read file from VFS and create Response
 */
async function readAndRespond(vfsStub: RpcStub<IVfsService>, pathname: string): Promise<Response> {
  const fileInfo = await vfsStub.readFile(pathname)
  const mimeType = fileInfo.mimeType
  
  // For HTML files, inject console interceptor script before user scripts
  if (mimeType === 'text/html') {
    let html: string
    if (typeof fileInfo.content === 'string') {
      html = fileInfo.content
    } else if (fileInfo.content instanceof Uint8Array || fileInfo.content instanceof ArrayBuffer) {
      html = new TextDecoder().decode(fileInfo.content)
    } else {
      html = String(fileInfo.content)
    }
    const injected = injectConsoleScript(html)
    return new Response(injected, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
      }
    })
  }
  
  // FileContent can be string or Uint8Array - Response accepts both
  return new Response(fileInfo.content as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': fileInfo.size.toString()
    }
  })
}

export {}
