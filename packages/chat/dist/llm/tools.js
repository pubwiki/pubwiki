/**
 * Tool Registry - Tool management system
 *
 * Based on OpenAI SDK tool management with Zod schema support
 */
import { z } from 'zod';
/**
 * Tool Registry
 */
export class ToolRegistry {
    constructor() {
        this.handlers = new Map();
        this.definitions = new Map();
    }
    /**
     * Register a tool with Zod schema
     */
    register(name, description, schema, handler) {
        // Convert Zod schema to JSON Schema
        const jsonSchema = z.toJSONSchema(schema);
        // Remove $schema and additionalProperties (not needed by OpenAI)
        const parameters = { ...jsonSchema };
        delete parameters.$schema;
        delete parameters.additionalProperties;
        this.definitions.set(name, {
            type: 'function',
            function: {
                name,
                description,
                parameters
            }
        });
        this.handlers.set(name, handler);
    }
    /**
     * Register a tool with raw JSON Schema
     */
    registerWithJsonSchema(name, description, parameters, handler) {
        this.definitions.set(name, {
            type: 'function',
            function: {
                name,
                description,
                parameters
            }
        });
        this.handlers.set(name, handler);
    }
    /**
     * Batch register tools
     */
    registerBatch(tools) {
        for (const tool of tools) {
            this.register(tool.name, tool.description, tool.schema, tool.handler);
        }
    }
    /**
     * Get all tool definitions (for API calls)
     */
    getDefinitions() {
        return Array.from(this.definitions.values());
    }
    /**
     * Get specific tool definition
     */
    getDefinition(name) {
        return this.definitions.get(name);
    }
    /**
     * Execute a tool
     */
    async execute(name, args) {
        const handler = this.handlers.get(name);
        if (!handler) {
            throw new Error(`Tool "${name}" not found`);
        }
        return await handler(args);
    }
    /**
     * Check if tool exists
     */
    has(name) {
        return this.handlers.has(name);
    }
    /**
     * Get all tool names
     */
    getToolNames() {
        return Array.from(this.handlers.keys());
    }
    /**
     * Clear all tools
     */
    clear() {
        this.handlers.clear();
        this.definitions.clear();
    }
    /**
     * Get tool count
     */
    get size() {
        return this.handlers.size;
    }
}
//# sourceMappingURL=tools.js.map