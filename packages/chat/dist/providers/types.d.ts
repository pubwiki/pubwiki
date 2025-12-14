/**
 * Provider Types - Interfaces for pluggable providers
 */
import type { MessageNode } from '../types/message';
export type { Vfs, VersionedVfs, VfsProvider, VersionedVfsProvider, VfsFile, VfsFolder, VfsItem, VfsStat, VfsCommit, VfsDiff, VfsEventBus, VfsEvent, VfsEventType, } from '@pubwiki/vfs';
export { createVfs, isVfsFile, isVfsFolder, isVersionedProvider } from '@pubwiki/vfs';
/**
 * Message Store Provider Interface
 *
 * Implementors need to provide persistence and query capabilities for messages.
 * The store uses an immutable linked list model where each message node
 * references its parent, enabling natural branching support.
 */
export interface MessageStoreProvider {
    /**
     * Save a message node
     */
    save(node: MessageNode): Promise<void>;
    /**
     * Batch save message nodes
     */
    saveBatch(nodes: MessageNode[]): Promise<void>;
    /**
     * Get a message node by ID
     */
    get(id: string): Promise<MessageNode | null>;
    /**
     * Get all child nodes of a parent
     */
    getChildren(parentId: string): Promise<MessageNode[]>;
    /**
     * Get the complete path from root to the specified leaf node
     */
    getPath(leafId: string): Promise<MessageNode[]>;
    /**
     * Delete a message node (and optionally all descendants)
     */
    delete(id: string, deleteDescendants?: boolean): Promise<void>;
    /**
     * List all root nodes (conversation starting points)
     */
    listRoots(): Promise<MessageNode[]>;
}
//# sourceMappingURL=types.d.ts.map