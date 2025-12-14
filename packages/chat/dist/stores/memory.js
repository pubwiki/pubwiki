/**
 * Memory Message Store - In-memory implementation
 *
 * Simple implementation for testing/simple scenarios.
 * Uses Map for storage with parent-children index.
 */
/**
 * In-memory message store implementation
 */
export class MemoryMessageStore {
    constructor() {
        this.nodes = new Map();
        this.childrenIndex = new Map(); // parentId -> Set<childId>
    }
    /**
     * Save a message node
     */
    async save(node) {
        this.nodes.set(node.id, node);
        // Update children index
        const parentId = node.parentId || '__ROOT__';
        if (!this.childrenIndex.has(parentId)) {
            this.childrenIndex.set(parentId, new Set());
        }
        this.childrenIndex.get(parentId).add(node.id);
    }
    /**
     * Batch save message nodes
     */
    async saveBatch(nodes) {
        for (const node of nodes) {
            await this.save(node);
        }
    }
    /**
     * Get a message node by ID
     */
    async get(id) {
        return this.nodes.get(id) || null;
    }
    /**
     * Get all child nodes of a parent
     */
    async getChildren(parentId) {
        const childIds = this.childrenIndex.get(parentId) || new Set();
        return Array.from(childIds)
            .map(id => this.nodes.get(id))
            .filter(Boolean)
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    /**
     * Get the complete path from root to the specified leaf node
     */
    async getPath(leafId) {
        const path = [];
        let current = await this.get(leafId);
        while (current) {
            path.unshift(current);
            if (!current.parentId)
                break;
            current = await this.get(current.parentId);
        }
        return path;
    }
    /**
     * Delete a message node (and optionally all descendants)
     */
    async delete(id, deleteDescendants = true) {
        const node = this.nodes.get(id);
        if (!node)
            return;
        if (deleteDescendants) {
            const descendants = await this.getAllDescendants(id);
            for (const desc of descendants) {
                // Remove from parent's children index
                const parentId = desc.parentId || '__ROOT__';
                this.childrenIndex.get(parentId)?.delete(desc.id);
                this.nodes.delete(desc.id);
            }
        }
        // Remove from parent's children index
        const parentId = node.parentId || '__ROOT__';
        this.childrenIndex.get(parentId)?.delete(id);
        // Delete this node's children index
        this.childrenIndex.delete(id);
        // Delete the node itself
        this.nodes.delete(id);
    }
    /**
     * List all root nodes (conversation starting points)
     */
    async listRoots() {
        const rootIds = this.childrenIndex.get('__ROOT__') || new Set();
        return Array.from(rootIds)
            .map(id => this.nodes.get(id))
            .filter(Boolean)
            .sort((a, b) => b.timestamp - a.timestamp); // Newest first
    }
    /**
     * Get all descendants of a node
     */
    async getAllDescendants(id) {
        const result = [];
        const children = await this.getChildren(id);
        for (const child of children) {
            result.push(child);
            result.push(...await this.getAllDescendants(child.id));
        }
        return result;
    }
    /**
     * Clear all data
     */
    clear() {
        this.nodes.clear();
        this.childrenIndex.clear();
    }
    /**
     * Get total message count
     */
    get size() {
        return this.nodes.size;
    }
    /**
     * Export all data (for debugging/persistence)
     */
    exportData() {
        const nodes = Array.from(this.nodes.values());
        const childrenIndex = {};
        for (const [key, value] of this.childrenIndex) {
            childrenIndex[key] = Array.from(value);
        }
        return { nodes, childrenIndex };
    }
    /**
     * Import data (for restoring from persistence)
     */
    importData(data) {
        this.clear();
        for (const node of data.nodes) {
            this.nodes.set(node.id, node);
        }
        if (data.childrenIndex) {
            for (const [key, value] of Object.entries(data.childrenIndex)) {
                this.childrenIndex.set(key, new Set(value));
            }
        }
        else {
            // Rebuild children index from nodes
            for (const node of data.nodes) {
                const parentId = node.parentId || '__ROOT__';
                if (!this.childrenIndex.has(parentId)) {
                    this.childrenIndex.set(parentId, new Set());
                }
                this.childrenIndex.get(parentId).add(node.id);
            }
        }
    }
}
//# sourceMappingURL=memory.js.map