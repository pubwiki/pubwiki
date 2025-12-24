/**
 * RPC Interface definitions for sandbox-service
 * 
 * These interfaces define the services available to sandbox applications:
 * - IVfsService: Virtual file system operations (read files, check existence)
 * - IHmrService: Hot Module Replacement notifications and updates
 * - SandboxMainService: Main service container for sandbox communication
 */

export * from './vfs-service'
export * from './hmr-service'

import type { IHmrService } from "./hmr-service"
import type { RpcTarget } from "capnweb"

/**
 * Main service interface for sandbox-to-main communication
 * 
 * This is the primary interface exposed by the main site to sandbox applications.
 * It provides access to:
 * - HMR service for hot module replacement
 * - Custom services registered by Loader nodes
 */
export interface SandboxMainService {
    /**
     * Access to the HMR (Hot Module Replacement) service
     */
    get hmr(): IHmrService

    /**
     * Get a custom service by ID
     * Custom services are registered by Loader nodes and exposed dynamically.
     * 
     * @param id - Service identifier
     * @returns The service instance, or undefined if not registered
     */
    getService(id: string): RpcTarget | undefined

    /**
     * List all registered custom service IDs
     * 
     * @returns Array of service IDs
     */
    listServices(): string[]
}
