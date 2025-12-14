/**
 * VFS Toolkit - File operation tools for function calling
 *
 * Provides a toolkit that can be registered with PubChat
 * to enable file operation capabilities when a Vfs instance is available.
 */
import type { ToolRegistry } from '../llm/tools';
import type { Vfs } from '@pubwiki/vfs';
/**
 * Register VFS tools to a tool registry
 *
 * @param registry Tool registry to register tools to
 * @param vfs Vfs instance from @pubwiki/vfs
 */
export declare function registerVFSTools(registry: ToolRegistry, vfs: Vfs): void;
/**
 * Get VFS tool definitions without registering handlers
 *
 * Useful for previewing what tools would be registered
 */
export declare function getVFSToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}>;
//# sourceMappingURL=vfs-toolkit.d.ts.map