/**
 * RPC Host
 *
 * Creates capnweb RPC servers that expose services to sandbox clients.
 * Two independent channels:
 * 1. VFS RPC Host - for Service Worker (file access only)
 * 2. Main RPC Host - for sandbox main page (HMR + custom services)
 */

import { newMessagePortRpcSession, RpcTarget } from 'capnweb'
import type {
  VfsRpcHostConfig,
  MainRpcHostConfig,
  VfsRpcHost,
  MainRpcHost,
  CustomServiceFactory,
  ICustomService
} from './types'
import type { SandboxMainService, ServiceDefinition } from '@pubwiki/sandbox-service'
export type { MainRpcHost, VfsRpcHost } from './types'
import type { Vfs } from '@pubwiki/vfs'
import { VfsServiceImpl, type VfsServiceConfig } from './services/vfs-service'
import { HmrServiceImpl } from './services/hmr-service'

// =============================================================================
// Extended Config Types (with injected dependencies)
// =============================================================================

/**
 * Extended VFS RPC Host config with dependencies
 */
export interface VfsRpcHostConfigExt extends VfsRpcHostConfig {
  /** VFS instance */
  vfs: Vfs
}

/**
 * Extended Main RPC Host config with dependencies
 */
export interface MainRpcHostConfigExt extends MainRpcHostConfig {
  /** Custom services to register */
  customServices?: Map<string, CustomServiceFactory<MainRpcHostConfig>>
}

// =============================================================================
// VFS RPC Host - for Service Worker
// =============================================================================

/**
 * Create a VFS RPC host for Service Worker
 *
 * @param port - MessagePort to use for RPC
 * @param config - Host configuration
 * @returns RPC host instance
 */
export function createVfsRpcHost(
  port: MessagePort,
  config: VfsRpcHostConfigExt
): VfsRpcHost {
  const id = `vfs-rpc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let connected = true

  // Create VFS service with injected dependencies
  const vfsServiceConfig: VfsServiceConfig = {
    basePath: config.basePath,
    projectConfig: config.projectConfig,
    hmrService: config.hmrService,
    vfs: config.vfs
  }

  const vfsService = new VfsServiceImpl(vfsServiceConfig)
  newMessagePortRpcSession(port, vfsService)

  console.log(`[VfsRpcHost:${id}] Created for basePath: ${config.basePath}`)

  return {
    id,
    get isConnected() {
      return connected
    },
    disconnect() {
      if (!connected) return
      connected = false
      port.close()
      console.log(`[VfsRpcHost:${id}] Disconnected`)
    }
  }
}

// =============================================================================
// Main RPC Host - for sandbox main page (HMR + custom services)
// =============================================================================

/**
 * Internal function to register a custom service on a MainRpcServices instance.
 * This is NOT exposed via RPC because it's a standalone function, not a class method.
 * 
 * @param services - The MainRpcServices instance to register on
 * @param id - Service identifier
 * @param service - ICustomService implementation
 */
function internalRegisterCustomService(
  services: { customServicesMap: Map<string, ICustomService> },
  id: string, 
  service: ICustomService
): void {
  services.customServicesMap.set(id, service)
  // Expose service as a getter on prototype (capnweb checks Object.hasOwn, so instance properties fail)
  Object.defineProperty(Object.getPrototypeOf(services), id, {
    get: () => services.customServicesMap.get(id),
    configurable: true,
    enumerable: true
  })
  console.log(`[MainRpcServices] Dynamically registered service: ${id}`)
}

/**
 * Create a MainRpcServices class with its own prototype for isolated service registration.
 * This is necessary because capnweb checks Object.hasOwn() to detect instance properties,
 * so we need to define getters on the prototype, not the instance.
 * Creating a new class per host ensures each host has its own prototype.
 */
function createMainRpcServicesClass(): typeof MainRpcServicesBase {
  class MainRpcServicesIsolated extends MainRpcServicesBase {}
  return MainRpcServicesIsolated
}

/**
 * Main page services container (HMR + extensible)
 * 
 * Implements SandboxMainService interface from @pubwiki/sandbox-service.
 * Custom services are exposed as dynamic getters on the prototype so they can be accessed via RPC.
 * capnweb checks Object.hasOwn() to detect instance properties - only prototype getters work.
 * For example, if a service is registered as 'counter', it can be accessed as
 * `rpcSession.counter.methodName()` from the client side.
 */
class MainRpcServicesBase extends RpcTarget implements SandboxMainService {
  private hmrService: HmrServiceImpl
  customServicesMap: Map<string, ICustomService> = new Map()

  constructor(config: MainRpcHostConfigExt) {
    super()
    this.hmrService = new HmrServiceImpl()

    // Register custom services using internal function (not exposed via RPC)
    if (config.customServices) {
      for (const [name, factory] of config.customServices) {
        const service = factory(config)
        internalRegisterCustomService(this, name, service)
        console.log(`[MainRpcServices] Registered custom service: ${name}`)
      }
    }
  }

  /**
   * Get HMR service (exposed as property for RPC)
   */
  get hmr(): HmrServiceImpl {
    return this.hmrService
  }

  /**
   * Get custom service by ID
   */
  getService(id: string): ICustomService | undefined {
    return this.customServicesMap.get(id)
  }

  /**
   * List all registered custom service definitions
   */
  async listServices(): Promise<ServiceDefinition[]> {
    const definitions: ServiceDefinition[] = []
    for (const [_id, service] of this.customServicesMap) {
      try {
        const def = await service.getDefinition()
        definitions.push(def)
      } catch (e) {
        console.error(`[MainRpcServices] Failed to get definition for service:`, e)
      }
    }
    return definitions
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.hmrService.dispose()
    // Dispose custom services if they have dispose method
    for (const service of this.customServicesMap.values()) {
      if ('dispose' in service && typeof service.dispose === 'function') {
        (service as { dispose: () => void }).dispose()
      }
    }
    this.customServicesMap.clear()
  }
}

/**
 * Create a Main RPC host for sandbox main page
 *
 * @param port - MessagePort to use for RPC
 * @param config - Host configuration
 * @returns RPC host instance
 */
export function createMainRpcHost(
  port: MessagePort,
  config: MainRpcHostConfigExt
): MainRpcHost {
  const id = `main-rpc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let connected = true

  // Create an isolated class for this host to avoid prototype pollution
  const MainRpcServicesIsolated = createMainRpcServicesClass()
  const services = new MainRpcServicesIsolated(config)

  newMessagePortRpcSession(port, services)
  port.start()

  console.log(`[MainRpcHost:${id}] Created for basePath: ${config.basePath}`)

  return {
    id,
    get isConnected() {
      return connected
    },
    getHmrService() {
      return services.hmr
    },
    getService(serviceId: string) {
      return services.getService(serviceId)
    },
    registerService(serviceId: string, service: ICustomService) {
      internalRegisterCustomService(services, serviceId, service)
    },
    disconnect() {
      if (!connected) return
      connected = false
      port.close()
      services.dispose()
      console.log(`[MainRpcHost:${id}] Disconnected`)
    }
  }
}

// =============================================================================
// Channel factories (create MessageChannel + host)
// =============================================================================

/**
 * Create a VFS RPC channel for Service Worker
 *
 * @param config - Host configuration
 * @returns Object with host and port to send to SW
 */
export function createVfsRpcChannel(config: VfsRpcHostConfigExt): {
  host: VfsRpcHost
  clientPort: MessagePort
} {
  const channel = new MessageChannel()
  const host = createVfsRpcHost(channel.port1, config)
  return { host, clientPort: channel.port2 }
}

/**
 * Create a Main RPC channel for sandbox main page
 *
 * @param config - Host configuration
 * @returns Object with host and port to send to sandbox
 */
export function createMainRpcChannel(config: MainRpcHostConfigExt): {
  host: MainRpcHost
  clientPort: MessagePort
} {
  const channel = new MessageChannel()
  const host = createMainRpcHost(channel.port1, config)
  return { host, clientPort: channel.port2 }
}
