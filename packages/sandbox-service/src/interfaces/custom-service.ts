/**
 * Custom Service Interface
 * 
 * Defines the unified interface for custom services registered by Loader nodes.
 * Services expose their schema (as JSON Schema) and a generic `call` method.
 */

/**
 * JSON Schema for service inputs/outputs
 * Standard JSON Schema format as exported by Lua Type.serialize()
 */
export interface JsonSchema {
    type?: string
    properties?: Record<string, JsonSchema>
    required?: string[]
    items?: JsonSchema
    additionalProperties?: boolean | JsonSchema
    oneOf?: JsonSchema[]
    anyOf?: JsonSchema[]
    description?: string
    /** Extension: marks function types */
    'x-function'?: boolean
    'x-params'?: Record<string, JsonSchema>
    'x-returns'?: JsonSchema
    [key: string]: unknown
}

/**
 * Service definition metadata (from Lua ServiceRegistry)
 * 
 * This matches the structure returned by ServiceRegistry.export() in Lua,
 * where inputs/outputs are serialized as JSON Schema via Type.serialize().
 */
export interface ServiceDefinition {
    /** Service name (without namespace) */
    name: string
    /** Service namespace */
    namespace: string
    /** Full identifier (namespace:name) */
    identifier: string
    /** Service kind: ACTION (has side effects) or PURE (no side effects) */
    kind: 'ACTION' | 'PURE'
    /** Optional description */
    description?: string
    /** Input schema as JSON Schema */
    inputs: JsonSchema
    /** Output schema as JSON Schema */
    outputs: JsonSchema
}

/**
 * Custom service interface for sandbox applications
 * 
 * This is the unified interface for all custom services registered by Loader nodes.
 * Services expose their schema and a generic `call` method.
 * 
 * For streaming services (x-function: true with oneOf null), use `stream()` method
 * to receive values via callback.
 * 
 * @example
 * ```typescript
 * const service = mainService.getService('myNamespace:myService')
 * if (service) {
 *     const definition = await service.getDefinition()
 *     console.log('Inputs:', definition.inputs)
 *     
 *     if (service.isStreaming) {
 *         await service.stream!({ input1: 'value' }, (value) => {
 *             console.log('Received:', value)
 *         })
 *     } else {
 *         const result = await service.call({ input1: 'value' })
 *         console.log('Output:', result)
 *     }
 * }
 * ```
 */
export interface ICustomService {
    /**
     * Call the service with given inputs
     * For streaming services, use stream() instead
     * @param inputs - Key-value map matching the service's input schema
     * @returns Output values matching the service's output schema
     * @throws Error if service call fails
     */
    call(inputs: Record<string, unknown>): Promise<Record<string, unknown>>
    
    /**
     * Call a streaming service with callback
     * 
     * For services that return an iterator (x-function: true with oneOf null),
     * this method iterates over all values and invokes the callback for each.
     * 
     * @param inputs - Input parameters for the service
     * @param on - Callback invoked for each yielded value
     * @returns Promise that resolves when streaming completes
     * @throws Error if service is not a streaming service
     */
    stream?(
        inputs: Record<string, unknown>,
        on: (value: unknown) => Promise<void> | void
    ): Promise<void>
    
    /**
     * Get the service definition including JSON Schema for inputs/outputs
     * @returns Service definition with metadata and schemas
     */
    getDefinition(): Promise<ServiceDefinition>
    
    /**
     * Check if this is a streaming service
     * Returns true if the service returns an iterator function
     */
    readonly isStreaming: boolean
}

/**
 * Check if a ServiceDefinition represents a streaming service
 * 
 * Streaming services have a return schema that:
 * 1. Has x-function: true (returns a function)
 * 2. Has empty x-params (function takes no arguments)
 * 3. Has x-returns.oneOf containing null (returns T | null)
 * 
 * @param definition - The service definition to check
 * @returns true if the service is a streaming service
 */
export function isStreamingService(definition: ServiceDefinition): boolean {
    const returns = definition.outputs
    
    // Must be a function
    if (returns['x-function'] !== true) return false
    
    // Function params must be empty
    const params = returns['x-params'] as Record<string, unknown> | undefined
    if (params && Object.keys(params).length > 0) return false
    
    // Return value must be oneOf containing null
    if (!returns['x-returns']?.oneOf) return false
    
    const hasNull = returns['x-returns'].oneOf.some(
        (schema) => schema.type === 'null'
    )
    
    return hasNull
}
