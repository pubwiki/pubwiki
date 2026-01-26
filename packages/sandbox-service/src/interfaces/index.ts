/**
 * RPC Interface definitions for sandbox-service
 * 
 * These interfaces define the services available to sandbox applications:
 * - IVfsService: Virtual file system operations (read files, check existence)
 * - IHmrService: Hot Module Replacement notifications and updates
 * - ICustomService: Custom services from Loader nodes
 * - SandboxMainService: Main service container for sandbox communication
 */

export * from './vfs-service'
export * from './hmr-service'
export * from './custom-service'

import type { IHmrService } from "./hmr-service"
import type { ICustomService, ServiceDefinition } from "./custom-service"

/**
 * User information for play mode
 */
export interface UserInfo {
    /** Whether the user is logged in */
    isLoggedIn: boolean
    
    /** User ID (null if not logged in) */
    userId: string | null
    
    /** Username or display name (null if not logged in) */
    username: string | null
    
    /** Save ID that the user loaded from (if loading from someone else's save) */
    sourceSaveId: string | null
    
    /** Checkpoint ID that the user loaded from */
    sourceCheckpointId: string | null
    
    /** User's own save ID (created when loading from cloud) */
    userSaveId: string | null
    
    /** User's own starting checkpoint ID */
    userCheckpointId: string | null
}

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
     * @param id - Service identifier (format: namespace:name)
     * @returns The typed service interface, or undefined if not registered
     */
    getService(id: string): ICustomService | undefined

    /**
     * List all registered custom service definitions
     * 
     * @returns Array of service definitions including JSON Schema for inputs/outputs
     */
    listServices(): Promise<ServiceDefinition[]>
}
