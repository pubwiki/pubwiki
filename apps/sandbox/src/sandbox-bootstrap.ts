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


import { SandboxMainService, newMessagePortRpcSession, RpcStub } from '@pubwiki/sandbox-service'
import type { ConsoleLogLevel } from '@pubwiki/sandbox-service'
import { SANDBOX_CLIENT_KEY, type ISandboxClient } from '@pubwiki/sandbox-client'
import { SandboxClient } from './sandbox-client'
import type { SandboxContext } from './sandbox-types'

let sandboxContext: SandboxContext | null = null
let mainRpcClient: RpcStub<SandboxMainService> | null = null
let sandboxClient: ISandboxClient | null = null
let vfsRpcPort: MessagePort | null = null
let bootstrapClientId: string | null = null
let userIframe: HTMLIFrameElement | null = null
let pendingVfsPortRequest = false

// Parse allowed origins at module scope so Vite inlining + minification
// cannot fold the .split() away into a single-string comparison.
const _rawOrigins: string = import.meta.env.VITE_MAIN_ORIGIN || 'http://localhost:5173'
const allowedOrigins: string[] = _rawOrigins.split(',')

/**
 * Show/hide UI elements
 */
function _showLoading(): void {
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

// ============================================================================
// Build Error Overlay
// ============================================================================

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface BuildError {
  file: string
  line: number
  column: number
  message: string
  snippet?: string
}

/**
 * Show build error overlay
 */
function showBuildError(errors: BuildError[]): void {
  
  const overlay = document.getElementById('build-error-overlay')
  const summary = document.getElementById('build-error-summary')
  const content = document.getElementById('build-error-content')
  
  if (!overlay || !content || !summary) {
    console.error('[SandboxBootstrap] Error overlay elements not found!')
    return
  }
  
  summary.textContent = `${errors.length} error${errors.length > 1 ? 's' : ''} found`
  
  content.innerHTML = errors.map(e => `
    <div class="error-item">
      <div class="error-location">${escapeHtml(e.file)}:${e.line}:${e.column}</div>
      <div class="error-message">${escapeHtml(e.message)}</div>
      ${e.snippet ? `<div class="error-snippet">${escapeHtml(e.snippet)}</div>` : ''}
    </div>
  `).join('')
  
  overlay.classList.add('show')
}

/**
 * Hide build error overlay
 */
function hideBuildError(): void {
  const overlay = document.getElementById('build-error-overlay')
  if (overlay) {
    overlay.classList.remove('show')
  }
}

/**
 * Setup error overlay event listeners
 */
function setupErrorOverlayListeners(): void {
  // Close button
  const closeBtn = document.getElementById('close-error-btn')
  if (closeBtn) {
    closeBtn.addEventListener('click', hideBuildError)
  }
  
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideBuildError()
    }
  })
}

// Setup listeners on load
setupErrorOverlayListeners()

function initSandboxMainService(port: MessagePort): RpcStub<SandboxMainService> {

  // Create RPC session - returns a proxy that routes calls to remote services
  const session = newMessagePortRpcSession<SandboxMainService>(port, {})

  // Start the port
  port.start()

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
    
    const registration = await navigator.serviceWorker.register('/sandbox-sw.js', {
      updateViaCache: 'none'
    })
    
    
    await navigator.serviceWorker.ready
    
    
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
  
  return true
}

/**
 * Request VFS port from main site
 */
function requestVfsPortFromMainSite(): void {
  if (pendingVfsPortRequest) {
    return
  }
  
  pendingVfsPortRequest = true
  
  // Use '*' because the parent could be any of the allowed origins.
  // Incoming messages are validated against allowedOrigins separately.
  window.parent.postMessage(
    { type: 'REQUEST_VFS_PORT' },
    '*'
  )
}

// ============================================================================
// Console Interceptor
// ============================================================================

/**
 * Serialize console arguments to a string
 */
function serializeArgs(args: unknown[]): string {
  return args.map(arg => {
    if (arg === null) return 'null'
    if (arg === undefined) return 'undefined'
    if (typeof arg === 'string') return arg
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`
    try {
      return JSON.stringify(arg, null, 2)
    } catch {
      return String(arg)
    }
  }).join(' ')
}

/**
 * Report a console log entry to the host
 */
function reportLog(level: ConsoleLogLevel, args: unknown[], stack?: string): void {
  if (!mainRpcClient) return
  
  const entry = {
    level,
    timestamp: Date.now(),
    message: serializeArgs(args),
    stack
  }
  
  // Fire and forget - don't await
  mainRpcClient.hmr.reportLog(entry).catch(err => {
    // Silently ignore errors to avoid infinite loops
    console.warn('[SandboxBootstrap] Failed to report log:', err)
  })
}

/**
 * Inject console interceptor into user iframe
 * This patches console methods to capture logs from user code
 */
function injectConsoleInterceptor(): void {
  if (!userIframe?.contentWindow) {
    console.warn('[SandboxBootstrap] Cannot inject console interceptor: no contentWindow')
    return
  }
  
  const iframeWindow = userIframe.contentWindow as Window & typeof globalThis
  const iframeConsole = iframeWindow.console
  
  // Store original methods
  const originalLog = iframeConsole.log.bind(iframeConsole)
  const originalInfo = iframeConsole.info.bind(iframeConsole)
  const originalWarn = iframeConsole.warn.bind(iframeConsole)
  const originalError = iframeConsole.error.bind(iframeConsole)
  const originalDebug = iframeConsole.debug.bind(iframeConsole)
  
  // Patch console methods
  iframeConsole.log = (...args: unknown[]) => {
    originalLog(...args)
    reportLog('log', args)
  }
  
  iframeConsole.info = (...args: unknown[]) => {
    originalInfo(...args)
    reportLog('info', args)
  }
  
  iframeConsole.warn = (...args: unknown[]) => {
    originalWarn(...args)
    reportLog('warn', args)
  }
  
  iframeConsole.error = (...args: unknown[]) => {
    originalError(...args)
    // Capture stack trace for errors
    const stack = new Error().stack
    reportLog('error', args, stack)
  }
  
  iframeConsole.debug = (...args: unknown[]) => {
    originalDebug(...args)
    reportLog('debug', args)
  }
  
  // Also capture unhandled errors
  iframeWindow.addEventListener('error', (event) => {
    reportLog('error', [event.message], event.error?.stack)
  })
  
  // Capture unhandled promise rejections
  iframeWindow.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    reportLog('error', [`Unhandled Promise Rejection: ${message}`], stack)
  })
  
}

/**
 * Load user iframe
 */
async function loadUserIframe(entryFile: string, initialPath?: string): Promise<void> {
  userIframe = document.getElementById('user-iframe') as HTMLIFrameElement
  
  if (!userIframe) {
    showError('User iframe element not found')
    return
  }
  
  
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
            resolve()
          }, { once: true })
          // Timeout protection — in some browsers (Chrome <131) srcdoc iframes
          // never get a SW controller, so don't block forever
          setTimeout(resolve, 1000)
        })
      }
    }
    
    // Check if we can actually send the registration message
    const controller = iframeWindow.navigator.serviceWorker?.controller
    if (!controller) {
      // No SW controller on this iframe (e.g. about:srcdoc in older Chrome).
      // Skip registration — the SW will establish the mapping when the iframe
      // navigates to a real URL via the _bid query parameter.
      return false
    }
    
    // Wait for SW to complete registration
    const registrationPromise = new Promise<void>(resolve => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'USER_IFRAME_REGISTERED') {
          navigator.serviceWorker.removeEventListener('message', handler)
          resolve()
        }
      }
      navigator.serviceWorker.addEventListener('message', handler)
    })
    
    // Register user iframe with SW
    controller.postMessage({
      type: 'REGISTER_USER_IFRAME',
      bootstrapClientId: bootstrapClientId
    })
    
    // Wait for confirmation
    await registrationPromise
    
    return true
  }
  
  userIframe.onerror = () => {
    showError('Failed to load user content')
  }
  
  
  // Try to pre-register the user iframe with SW before navigation.
  // This may fail on about:srcdoc in older Chrome versions that don't
  // assign a SW controller to srcdoc iframes.
  const preRegistered = await registerUserIframe()
  
  // Include bootstrap ID in URL for iOS Safari workaround
  // iOS Safari doesn't provide clientId on nested iframe navigation,
  // so we pass it via URL parameter for SW to establish the mapping
  const targetPath = initialPath || `/${entryFile}`
  iframeWindow.location.replace(`${targetPath}${targetPath.includes('?') ? '&' : '?'}_bid=${bootstrapClientId}`)
  
  // Wait for content to load
  await new Promise<void>(resolve => {
    const handler = () => {
      userIframe!.removeEventListener('load', handler)
      resolve()
    }
    userIframe!.addEventListener('load', handler)
  })
  
  // If pre-registration failed (srcdoc had no SW controller), register now
  // that the iframe has navigated to a real URL
  if (!preRegistered) {
    await registerUserIframe()
  }
  
  hideLoading()
  
  
  // Inject console interceptor into user iframe
  injectConsoleInterceptor()
  
  // Setup URL tracking to notify host of navigation changes
  setupUrlTracking()
  
  // Re-setup URL tracking on user iframe reload (contentWindow changes)
  userIframe.addEventListener('load', () => {
    injectConsoleInterceptor()
    setupUrlTracking()
  })
  
  // Context will be provided on-demand when user iframe calls initSandboxClient()
}

/**
 * Setup URL tracking on user iframe
 * Hooks into the user iframe's navigation events to notify the host of URL changes.
 * Uses Navigation API (Chrome 102+) when available, falls back to history monkey-patch.
 */
function setupUrlTracking(): void {
  if (!userIframe?.contentWindow || !mainRpcClient) return

  const win = userIframe.contentWindow as Window & typeof globalThis

  const notify = () => {
    if (!userIframe?.contentWindow) return
    try {
      const w = userIframe.contentWindow
      const path = w.location.pathname + w.location.search + w.location.hash
      mainRpcClient?.hmr.notifyUrlChange(path).catch(() => {
        // Silently ignore RPC errors
      })
    } catch {
      // Silently ignore cross-origin errors during navigation
    }
  }

  // Prefer Navigation API (Chrome 102+) — one event covers all navigation types
  if ('navigation' in win) {
    ;(win as unknown as { navigation: EventTarget }).navigation.addEventListener('navigatesuccess', notify)
    return
  }

  // Fallback: monkey-patch history methods on the user iframe's window
  const childHistory = win.history
  const origPush = childHistory.pushState.bind(childHistory)
  const origReplace = childHistory.replaceState.bind(childHistory)

  childHistory.pushState = (...args: Parameters<typeof childHistory.pushState>) => {
    origPush(...args)
    notify()
  }
  childHistory.replaceState = (...args: Parameters<typeof childHistory.replaceState>) => {
    origReplace(...args)
    notify()
  }

  win.addEventListener('popstate', notify)
  win.addEventListener('hashchange', notify)
}

/**
 * Reload user iframe
 */
async function reloadUserIframe(): Promise<void> {
  if (!userIframe || !sandboxContext) return
  
  
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
 * Expose sandbox client on window for user iframe to access directly
 * Since bootstrap and user iframe are same-origin, user iframe can access
 * window.parent.__sandboxClient__ directly without postMessage
 */
function exposeSandboxClient(): void {
  if (!mainRpcClient || !sandboxContext) {
    console.error('[SandboxBootstrap] Cannot expose client: not initialized')
    return
  }
  
  // Create the client instance that wraps the RPC stub
  sandboxClient = new SandboxClient(
    mainRpcClient,
    sandboxContext.basePath,
    sandboxContext.entryFile
  )
  
  // Expose the client instance (not the raw RPC stub)
  ;(window as unknown as Record<string, unknown>)[SANDBOX_CLIENT_KEY] = sandboxClient
  
}

/**
 * Initialize sandbox
 */
async function initializeSandbox(context: SandboxContext): Promise<void> {
  
  if (!mainRpcClient) {
    showError('Main RPC client not initialized')
    return
  }
  
  try {
    // Subscribe to HMR updates
    await mainRpcClient.hmr.subscribe((update) => {
      
      if (update.type === 'error') {
        // Build error: show overlay
        
        if (update.errors && update.errors.length > 0) {
          showBuildError(update.errors)
        } else if (update.error) {
          // Fallback to simple error message
          showBuildError([{
            file: update.path,
            line: 0,
            column: 0,
            message: update.error
          }])
        } else {
          console.warn('[SandboxBootstrap] Error event received but no error details!')
        }
      } else {
        // Normal update: hide error overlay and reload
        hideBuildError()
        
        if (update.path === '__manual_reload__') {
          // No special handling needed for manual reload
        } else {
          // No special handling needed for path-based update
        }
        reloadUserIframe()
      }
    })
    
    // Expose client for user iframe to access
    exposeSandboxClient()
    
    // Register Service Worker
    await registerServiceWorker()
    
    // Wait for SW to control the page
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
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
    }
    
    // Load user iframe (now async)
    await loadUserIframe(context.entryFile, context.initialPath)
    
    
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
  
  if (message?.type === 'REQUEST_VFS_PORT') {
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
  
  // Ignore messages from user iframe (context is accessed directly via parent window)
  if (userIframe && event.source === userIframe.contentWindow) {
    return
  }
  
  // Ignore messages from self
  if (event.origin === window.location.origin && event.source === window) {
    return
  }
  
  // Verify origin for messages from main site
  if (!allowedOrigins.includes(event.origin)) {
    console.warn('[SandboxBootstrap] Invalid origin:', event.origin)
    return
  }
  
  const message = event.data
  
  
  // Handle sandbox initialization
  if (message?.type === 'sandbox-init') {
    
    
    const urlParams = new URLSearchParams(window.location.search)
    const entryFromUrl = urlParams.get('entry')
    
    sandboxContext = {
      workspaceId: message.workspaceId,
      basePath: message.basePath,
      entryFile: message.entryFile || entryFromUrl || 'index.html',
      initialPath: message.initialPath
    }
    
    const mainPort = event.ports?.[0]
    const vfsPort = event.ports?.[1]
    
    if (!mainPort || !vfsPort) {
      console.error('[SandboxBootstrap] Missing RPC ports')
      showError('Failed to receive RPC ports from main site')
      return
    }
    
    mainRpcClient = initSandboxMainService(mainPort)
    
    vfsRpcPort = vfsPort
    
    window.parent.postMessage({ type: 'RPC_READY' }, event.origin)
    
    initializeSandbox(sandboxContext)
    
    return
  }
  
  // Handle VFS port response
  if (message?.type === 'VFS_PORT_RESPONSE') {
    
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

