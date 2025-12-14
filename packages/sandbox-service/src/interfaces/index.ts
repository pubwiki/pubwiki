/**
 * RPC Interface definitions for sandbox-service
 * 
 * These interfaces define the services available to sandbox applications:
 * - IVfsService: Virtual file system operations (read files, check existence)
 * - IHmrService: Hot Module Replacement notifications and updates
 * - IWikiRAGService: WikiRAG AI/knowledge base integration
 */

export * from './vfs-service'
export * from './hmr-service'
export * from './wikirag-service'

import type { IHmrService } from "./hmr-service"
import type { IWikiRAGService } from './wikirag-service'

export interface SandboxMainService {
    get hmr(): IHmrService
    get wikirag(): IWikiRAGService
}
