# @pubwiki/sandbox-client

Client SDK for sandbox applications to access custom services from the main site.

## Overview

This package provides a type-safe client SDK for sandbox iframe applications to:
- Access custom services registered by Loader nodes
- Discover available services dynamically via `listServices()`
- Call services using the unified `ICustomService` interface

## Installation

```bash
pnpm add @pubwiki/sandbox-client
```

## Usage

### Basic Usage

```typescript
import { initSandboxClient } from '@pubwiki/sandbox-client'

// Initialize the client (waits for port injection from bootstrap)
const client = await initSandboxClient()

// List all available services
const services = await client.listServices()
console.log('Available services:', services)
// [
//   {
//     name: 'calculator',
//     namespace: 'math',
//     identifier: 'math:calculator',
//     kind: 'PURE',
//     description: 'A simple calculator service',
//     inputs: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
//     outputs: { type: 'object', properties: { result: { type: 'number' } } }
//   }
// ]
```

### Getting and Calling a Service

```typescript
// Get a service by ID
const calculator = await client.getService('calculator')

// Call the service with inputs
const result = await calculator.call({ a: 5, b: 3, operation: 'add' })
console.log(result) // { result: 8 }

// Get service definition (JSON Schema)
const definition = await calculator.getDefinition()
console.log(definition.inputs)  // JSON Schema for inputs
console.log(definition.outputs) // JSON Schema for outputs
```

### Checking Service Availability

```typescript
// Check if a service exists before using it
if (await client.hasService('calculator')) {
  const calc = await client.getService('calculator')
  const result = await calc.call({ a: 10, b: 5, operation: 'multiply' })
  console.log(result) // { result: 50 }
}
```

### Working with Service Definitions

Each service provides a `ServiceDefinition` with JSON Schema for type information:

```typescript
interface ServiceDefinition {
  name: string        // Service name (e.g., 'calculator')
  namespace: string   // Service namespace (e.g., 'math')
  identifier: string  // Full identifier (e.g., 'math:calculator')
  kind: 'ACTION' | 'PURE'  // Whether the service has side effects
  description?: string     // Optional service description
  inputs: JsonSchema       // JSON Schema for input validation
  outputs: JsonSchema      // JSON Schema for output structure
}
```

Example of using service definitions:

```typescript
const services = await client.listServices()

for (const service of services) {
  console.log(`Service: ${service.identifier}`)
  console.log(`  Kind: ${service.kind}`)
  console.log(`  Description: ${service.description ?? 'N/A'}`)
  
  // Inspect input schema
  if (service.inputs.properties) {
    console.log('  Inputs:')
    for (const [name, schema] of Object.entries(service.inputs.properties)) {
      console.log(`    - ${name}: ${schema.type}`)
    }
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Sandbox (User Iframe)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                @pubwiki/sandbox-client                │   │
│  │                                                       │   │
│  │  initSandboxClient() → ISandboxClient                 │   │
│  │    - getService(id): ICustomService                   │   │
│  │    - listServices(): ServiceDefinition[]              │   │
│  │    - hasService(id): boolean                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│                              │ capnweb RPC                  │
│                              ▼                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              sandbox-bootstrap.ts                     │   │
│  │     (receives port from main site)                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │ MessagePort
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                      Main Site                               │
│              (MainRpcHost with custom services)              │
└──────────────────────────────────────────────────────────────┘
```

## API Reference

### `initSandboxClient(options?)`

Initialize the sandbox client. This waits for the RPC port to be injected by the sandbox bootstrap.

```typescript
const client = await initSandboxClient({
  timeout: 5000 // Optional: timeout in ms (default: 5000)
})
```

### `ISandboxClient`

The main client interface for accessing services.

#### Properties

- `basePath: string` - The base path for this sandbox
- `entryFile: string` - The entry file for this sandbox

#### Methods

##### `getService(serviceId: string): Promise<ICustomService>`

Get a custom service by ID.

```typescript
const service = await client.getService('my-service')
```

##### `listServices(): Promise<ServiceDefinition[]>`

List all available custom service definitions with their JSON Schema.

```typescript
const services = await client.listServices()
```

##### `hasService(serviceId: string): Promise<boolean>`

Check if a service is available.

```typescript
if (await client.hasService('my-service')) {
  // Service is available
}
```

### `ICustomService`

The unified interface for all custom services.

#### Methods

##### `call(inputs: Record<string, unknown>): Promise<Record<string, unknown>>`

Call the service with the given inputs and receive outputs.

```typescript
const result = await service.call({ input1: 'value1', input2: 42 })
```

##### `getDefinition(): Promise<ServiceDefinition>`

Get the service definition including JSON Schema for inputs/outputs.

```typescript
const definition = await service.getDefinition()
console.log(definition.kind) // 'PURE' or 'ACTION'
```

### `ServiceDefinition`

Describes a service's metadata and type information.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Service name |
| `namespace` | `string` | Service namespace |
| `identifier` | `string` | Full identifier (`namespace:name`) |
| `kind` | `'ACTION' \| 'PURE'` | Whether service has side effects |
| `description` | `string?` | Optional description |
| `inputs` | `JsonSchema` | JSON Schema for input validation |
| `outputs` | `JsonSchema` | JSON Schema for output structure |

### `JsonSchema`

Standard JSON Schema with extensions for function types:

```typescript
interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  description?: string
  // ... other standard JSON Schema fields
  
  // Extensions for function types
  'x-function'?: boolean
  'x-params'?: JsonSchema[]
  'x-returns'?: JsonSchema
}
```

## License

MIT
