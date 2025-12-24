/**
 * Sandbox Bootstrap Script (Refactored for Nested Iframe Architecture)
 * 
 * This script runs in the bootstrap iframe and manages:
 * - RPC connections (Main RPC for HMR + VFS RPC for Service Worker)
 * - Service Worker registration and VFS port setup
 * - User iframe lifecycle (load and reload)
 * - Communication with user iframe for client ID exchange
 * 
 * User code runs in a nested iframe, completely isolated from bootstrap.
 */

console.log('[SandboxBootstrap] Module loaded')

import { SandboxMainService } from '@pubwiki/sandbox-service'
import type { SandboxContext } from './sandbox-types'
import { newMessagePortRpcSession, RpcStub } from 'capnweb'

let sandboxContext: SandboxContext | null = null
let mainRpcClient: RpcStub<SandboxMainService> | null = null
let vfsRpcPort: MessagePort | null = null
let bootstrapClientId: string | null = null
let userIframe: HTMLIFrameElement | null = null
let pendingVfsPortRequest = false

/**
 * Show/hide UI elements
 */
function showLoading(): void {
  const loading = document.getElementById('loading')
  const error = document.getElementById('error')
  const iframe = document.getElementById('user-iframe')
  
  if (loading) loading.style.display = 'block'
  if (error) error.style.display = 'none'
  if (iframe) iframe.style.display = 'none'
}

function hideLoading(): void {
  const loading = document.getElementById('loading')
  const iframe = document.getElementById('user-iframe')
  
  if (loading) loading.style.display = 'none'
  if (iframe) iframe.style.display = 'block'
}

function showError(message: string): void {
  const loading = document.getElementById('loading')
  const error = document.getElementById('error')
  const iframe = document.getElementById('user-iframe')
  
  if (loading) loading.style.display = 'none'
  if (error) {
    error.style.display = 'block'
    error.textContent = `Error: ${message}`
  }
  if (iframe) iframe.style.display = 'none'
}

function initSandboxMainService(port: MessagePort): RpcStub<SandboxMainService> {
  console.log('[MainRpcClient] Initializing with port...')

  // Create RPC session - returns a proxy that routes calls to remote services
  const session = newMessagePortRpcSession<SandboxMainService>(port, {})

  // Start the port
  port.start()

  console.log('[MainRpcClient] Initialized successfully')
  return session
}

/**
 * Register Service Worker
 */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SandboxBootstrap] Service Worker not supported')
    return null
  }
  
  try {
    console.log('[SandboxBootstrap] Registering Service Worker...')
    
    const registration = await navigator.serviceWorker.register('/sandbox-sw.js', {
      updateViaCache: 'none'
    })
    
    console.log('[SandboxBootstrap] Service Worker registered')
    
    await navigator.serviceWorker.ready
    
    console.log('[SandboxBootstrap] Service Worker ready')
    
    return registration
  } catch (error) {
    console.error('[SandboxBootstrap] Service Worker registration failed:', error)
    return null
  }
}

/**
 * Send VFS port to Service Worker
 */
function sendVfsPortToServiceWorker(): boolean {
  if (!vfsRpcPort) {
    console.error('[SandboxBootstrap] VFS RPC port not available')
    return false
  }
  
  if (!navigator.serviceWorker.controller) {
    console.warn('[SandboxBootstrap] No active Service Worker controller')
    return false
  }
  
  navigator.serviceWorker.controller.postMessage(
    { type: 'SETUP_VFS_RPC_PORT' },
    [vfsRpcPort]
  )
  
  vfsRpcPort = null
  pendingVfsPortRequest = false
  
  console.log('[SandboxBootstrap] VFS RPC port sent to Service Worker')
  return true
}

/**
 * Request VFS port from main site
 */
function requestVfsPortFromMainSite(): void {
  if (pendingVfsPortRequest) {
    console.log('[SandboxBootstrap] VFS port request already pending')
    return
  }
  
  const mainOrigin = import.meta.env.VITE_MAIN_ORIGIN || 'http://localhost:4000'
  
  console.log('[SandboxBootstrap] Requesting new VFS port from main site')
  pendingVfsPortRequest = true
  
  window.parent.postMessage(
    { type: 'REQUEST_VFS_PORT' },
    mainOrigin
  )
}

/**
 * Load user iframe
 */
async function loadUserIframe(entryFile: string): Promise<void> {
  userIframe = document.getElementById('user-iframe') as HTMLIFrameElement
  
  if (!userIframe) {
    showError('User iframe element not found')
    return
  }
  
  console.log('[SandboxBootstrap] Loading user iframe with entry:', entryFile)
  
  // Use srcdoc to create the iframe document first
  // This ensures the iframe is created and can be controlled by SW before any fetch
  userIframe.srcdoc = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Loading...</title></head>
<body style="margin:0;background:#000;"></body>
</html>`
  
  // Wait for srcdoc to load
  await new Promise<void>(resolve => {
    const handler = () => {
      userIframe!.removeEventListener('load', handler)
      resolve()
    }
    userIframe!.addEventListener('load', handler)
  })
  
  console.log('[SandboxBootstrap] User iframe document created, waiting for SW control...')
  
  // Now wait for SW to control the iframe
  const iframeWindow = userIframe.contentWindow
  if (!iframeWindow) {
    showError('Failed to access iframe window')
    return
  }
  
  // Setup a load handler to register user iframe with SW after each load
  const registerUserIframe = async () => {
    const iframeWindow = userIframe?.contentWindow
    if (!iframeWindow || !bootstrapClientId) return
    
    // Wait for SW to control the iframe (important for reload scenarios)
    if (iframeWindow.navigator.serviceWorker) {
      if (!iframeWindow.navigator.serviceWorker.controller) {
        // Not controlled yet, wait for controllerchange
        await new Promise<void>(resolve => {
          iframeWindow.navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[SandboxBootstrap] User iframe controlled by SW after reload')
            resolve()
          }, { once: true })
          // Timeout protection
          setTimeout(resolve, 1000)
        })
      }
    }
    
    // Wait for SW to complete registration
    const registrationPromise = new Promise<void>(resolve => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'USER_IFRAME_REGISTERED') {
          navigator.serviceWorker.removeEventListener('message', handler)
          console.log('[SandboxBootstrap] SW confirmed user iframe registration')
          resolve()
        }
      }
      navigator.serviceWorker.addEventListener('message', handler)
    })
    
    // Register user iframe with SW using iframe's serviceWorker
    if (iframeWindow.navigator.serviceWorker?.controller) {
      iframeWindow.navigator.serviceWorker.controller.postMessage({
        type: 'REGISTER_USER_IFRAME',
        bootstrapClientId: bootstrapClientId
      })
      console.log('[SandboxBootstrap] Sent REGISTER_USER_IFRAME to SW, bootstrap:', bootstrapClientId)
    }
    
    // Wait for confirmation
    await registrationPromise
    
    hideLoading()
  }
  
  userIframe.onerror = () => {
    showError('Failed to load user content')
  }
  
  console.log('[SandboxBootstrap] Manually registering before loading content...')
  
  // Manually call register before loading entryFile to ensure SW is ready
  await registerUserIframe()
  
  console.log('[SandboxBootstrap] Loading actual content...')
  
  // Now load the actual content
  iframeWindow.location.replace(`/${entryFile}`)
  
  // Wait for content to load
  await new Promise<void>(resolve => {
    const handler = () => {
      userIframe!.removeEventListener('load', handler)
      resolve()
    }
    userIframe!.addEventListener('load', handler)
  })
  
  console.log('[SandboxBootstrap] User iframe content loaded')
  // Context will be provided on-demand when user iframe calls initSandboxClient()
}

/**
 * Reload user iframe
 */
async function reloadUserIframe(): Promise<void> {
  if (!userIframe || !sandboxContext) return
  
  console.log('[SandboxBootstrap] Reloading user iframe')
  
  const iframeWindow = userIframe.contentWindow
  if (iframeWindow) {
    // Use location.reload() to force a full reload
    try {
      iframeWindow.location.reload()
    } catch (error) {
      console.error('[SandboxBootstrap] Reload failed, trying fallback:', error)
      // Fallback: navigate to the same URL with a cache-busting parameter
      const currentUrl = new URL(iframeWindow.location.href)
      currentUrl.searchParams.set('_reload', Date.now().toString())
      iframeWindow.location.href = currentUrl.href
    }
  }
}

/**
 * Expose sandbox context on window for user iframe to access directly
 * Since bootstrap and user iframe are same-origin, user iframe can access
 * window.parent.__sandboxContextForClient__ directly without postMessage
 */
function exposeSandboxContext(): void {
  if (!mainRpcClient || !sandboxContext) {
    console.error('[SandboxBootstrap] Cannot expose context: not initialized')
    return
  }
  
  ;(window as unknown as Record<string, unknown>).__sandboxContextForClient__ = {
    rpcStub: mainRpcClient,
    basePath: sandboxContext.basePath,
    entryFile: sandboxContext.entryFile
  }
  
  console.log('[SandboxBootstrap] Exposed sandbox context on window')
}

/**
 * Initialize sandbox
 */
async function initializeSandbox(context: SandboxContext): Promise<void> {
  console.log('[SandboxBootstrap] Initializing sandbox')
  
  if (!mainRpcClient) {
    showError('Main RPC client not initialized')
    return
  }
  
  try {
    // Subscribe to HMR updates
    console.log('[SandboxBootstrap] Subscribing to HMR updates...')
    await mainRpcClient.hmr.subscribe((update) => {
      console.log('[SandboxBootstrap] HMR update received:', update)
      
      if (update.path === '__manual_reload__') {
        console.log('[SandboxBootstrap] Manual reload triggered')
        reloadUserIframe()
      } else {
        console.log('[SandboxBootstrap] File changed, reloading user iframe')
        reloadUserIframe()
      }
    })
    console.log('[SandboxBootstrap] HMR subscription established')
    
    // Expose context for user iframe to access
    exposeSandboxContext()
    
    // Register Service Worker
    await registerServiceWorker()
    
    // Wait for SW to control the page
    if (!navigator.serviceWorker.controller) {
      console.log('[SandboxBootstrap] Waiting for SW to take control...')
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[SandboxBootstrap] SW now controls the page')
          resolve()
        }, { once: true })
      })
    }
    
    // Get bootstrap client ID
    // We'll get this from the Service Worker via a message
    // Send a request to SW to get our client ID
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_CLIENT_ID' })
      
      // Wait for response
      const clientIdPromise = new Promise<string>((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'CLIENT_ID_RESPONSE') {
            navigator.serviceWorker.removeEventListener('message', handler)
            resolve(event.data.clientId)
          }
        }
        navigator.serviceWorker.addEventListener('message', handler)
      })
      
      bootstrapClientId = await clientIdPromise
      console.log('[SandboxBootstrap] Bootstrap client ID:', bootstrapClientId)
    }
    
    // Load user iframe (now async)
    await loadUserIframe(context.entryFile)
    
    console.log('[SandboxBootstrap] Initialization complete')
    
  } catch (error) {
    console.error('[SandboxBootstrap] Initialization error:', error)
    showError(`Initialization error: ${error}`)
  }
}

/**
 * Listen for Service Worker messages
 */
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
  const message = event.data
  
  console.log('[SandboxBootstrap] Received message from SW:', message?.type)
  
  if (message?.type === 'REQUEST_VFS_PORT') {
    console.log('[SandboxBootstrap] SW requesting VFS port reconnection')
    
    if (vfsRpcPort) {
      sendVfsPortToServiceWorker()
    } else {
      requestVfsPortFromMainSite()
    }
  }
})

/**
 * Listen for messages from parent (main site)
 */
window.addEventListener('message', (event: MessageEvent) => {
  const mainOrigin = import.meta.env.VITE_MAIN_ORIGIN || 'http://localhost:5173'
  
  // Ignore messages from user iframe (context is accessed directly via parent window)
  if (userIframe && event.source === userIframe.contentWindow) {
    return
  }
  
  // Ignore messages from self
  if (event.origin === window.location.origin && event.source === window) {
    return
  }
  
  // Verify origin for messages from main site
  if (event.origin !== mainOrigin) {
    console.warn('[SandboxBootstrap] Invalid origin:', event.origin)
    return
  }
  
  const message = event.data
  
  console.log('[SandboxBootstrap] Received message from main site:', message?.type)
  
  // Handle sandbox initialization
  if (message?.type === 'sandbox-init') {
    console.log('[SandboxBootstrap] Received sandbox-init (dual channel)')
    
    const urlParams = new URLSearchParams(window.location.search)
    const entryFromUrl = urlParams.get('entry')
    
    sandboxContext = {
      workspaceId: message.workspaceId,
      basePath: message.basePath,
      entryFile: message.entryFile || entryFromUrl || 'index.html'
    }
    
    const mainPort = event.ports?.[0]
    const vfsPort = event.ports?.[1]
    
    if (!mainPort || !vfsPort) {
      console.error('[SandboxBootstrap] Missing RPC ports')
      showError('Failed to receive RPC ports from main site')
      return
    }
    
    console.log('[SandboxBootstrap] Initializing Main RPC client')
    mainRpcClient = initSandboxMainService(mainPort)
    
    vfsRpcPort = vfsPort
    
    window.parent.postMessage({ type: 'RPC_READY' }, mainOrigin)
    
    initializeSandbox(sandboxContext)
    
    return
  }
  
  // Handle VFS port response
  if (message?.type === 'VFS_PORT_RESPONSE') {
    console.log('[SandboxBootstrap] Received new VFS port from main site')
    
    const vfsPort = event.ports?.[0]
    
    if (!vfsPort) {
      console.error('[SandboxBootstrap] VFS_PORT_RESPONSE missing port')
      pendingVfsPortRequest = false
      return
    }
    
    vfsRpcPort = vfsPort
    sendVfsPortToServiceWorker()
    return
  }
})

// Send ready message to parent
if (window.parent !== window) {
  console.log('[SandboxBootstrap] Sending SANDBOX_READY message to parent')
  window.parent.postMessage({ type: 'SANDBOX_READY' }, '*')
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (bootstrapClientId && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CLIENT_DISCONNECTED',
      clientId: bootstrapClientId
    })
  }
})

console.log('[SandboxBootstrap] Bootstrap script initialized')
