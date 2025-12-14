/**
 * Memory Message Store - In-memory implementation
 *
 * Simple implementation for testing/simple scenarios.
 * Uses Map for storage with parent-children index.
 */
import type { MessageStoreProvider } from '../providers/types';
import type { MessageNode } from '../types/message';
/**
 * In-memory message store implementation
 */
export declare class MemoryMessageStore implements MessageStoreProvider {
    private nodes;
    private childrenIndex;
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
    /**
     * Get all descendants of a node
     */
    private getAllDescendants;
    /**
     * Clear all data
     */
    clear(): void;
    /**
     * Get total message count
     */
    get size(): number;
    /**
     * Export all data (for debugging/persistence)
     */
    exportData(): {
        nodes: MessageNode[];
        childrenIndex: Record<string, string[]>;
    };
    /**
     * Import data (for restoring from persistence)
     */
    importData(data: {
        nodes: MessageNode[];
        childrenIndex?: Record<string, string[]>;
    }): void;
}
//# sourceMappingURL=memory.d.ts.map