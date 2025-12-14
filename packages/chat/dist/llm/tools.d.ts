/**
 * Tool Registry - Tool management system
 *
 * Based on OpenAI SDK tool management with Zod schema support
 */
import { z } from 'zod';
import type { ToolDefinition } from '../types';
/**
 * Tool handler function
 */
export type ToolHandler = (args: unknown) => Promise<unknown>;
/**
 * Tool Registry
 */
export declare class ToolRegistry {
    private handlers;
    private definitions;
    /**
     * Register a tool with Zod schema
     */
    register(name: string, description: string, schema: z.ZodTypeAny, handler: ToolHandler): void;
    /**
     * Register a tool with raw JSON Schema
     */
    registerWithJsonSchema(name: string, description: string, parameters: Record<string, unknown>, handler: ToolHandler): void;
    /**
     * Batch register tools
     */
    registerBatch(tools: Array<{
        name: string;
        description: string;
        schema: z.ZodTypeAny;
        handler: ToolHandler;
    }>): void;
    /**
     * Get all tool definitions (for API calls)
     */
    getDefinitions(): ToolDefinition[];
    /**
     * Get specific tool definition
     */
    getDefinition(name: string): ToolDefinition | undefined;
    /**
     * Execute a tool
     */
    execute(name: string, args: unknown): Promise<unknown>;
    /**
     * Check if tool exists
     */
    has(name: string): boolean;
    /**
     * Get all tool names
     */
    getToolNames(): string[];
    /**
     * Clear all tools
     */
    clear(): void;
    /**
     * Get tool count
     */
    get size(): number;
}
//# sourceMappingURL=tools.d.ts.map