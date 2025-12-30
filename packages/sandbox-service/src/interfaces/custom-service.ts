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
 * @example
 * ```typescript
 * const service = mainService.getService('myNamespace:myService')
 * if (service) {
 *     const definition = await service.getDefinition()
 *     console.log('Inputs:', definition.inputs)
 *     
 *     const result = await service.call({ input1: 'value' })
 *     console.log('Output:', result)
 * }
 * ```
 */
export interface ICustomService {
    /**
     * Call the service with given inputs
     * @param inputs - Key-value map matching the service's input schema
     * @returns Output values matching the service's output schema
     * @throws Error if service call fails
     */
    call(inputs: Record<string, unknown>): Promise<Record<string, unknown>>
    
    /**
     * Get the service definition including JSON Schema for inputs/outputs
     * @returns Service definition with metadata and schemas
     */
    getDefinition(): Promise<ServiceDefinition>
}
