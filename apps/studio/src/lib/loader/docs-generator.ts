/**
 * Service Documentation Generator
 * 
 * Generates TypeScript type definitions, Markdown documentation, and agent guides
 * from ServiceDefinition objects.
 */

import type { ServiceDefinition, JsonSchema } from '@pubwiki/sandbox-host';

// ============================================================================
// Types
// ============================================================================

export interface GeneratedDocs {
  /** Entry file, re-exports sandbox-client and generated types */
  indexTs: string;
  /** TypeScript type definitions (includes ServiceMap declaration merging) */
  servicesDts: string;
  /** Markdown API documentation */
  servicesMd: string;
  /** Agent integration guide */
  agentsMd: string;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate complete documentation from service definitions
 */
export function generateServiceDocs(services: ServiceDefinition[]): GeneratedDocs {
  const timestamp = new Date().toISOString();
  
  return {
    indexTs: generateIndexTs(timestamp),
    servicesDts: generateServicesDts(services, timestamp),
    servicesMd: generateServicesMd(services, timestamp),
    agentsMd: generateAgentsMd(services),
  };
}

// ============================================================================
// Index.ts Generator
// ============================================================================

function generateIndexTs(timestamp: string): string {
  return `// ============================================================================
// Auto-generated Service Client Entry Point
// Generated at: ${timestamp}
// ============================================================================

// Re-export everything from sandbox-client
export * from '@pubwiki/sandbox-client';

// Re-export generated service types (type-only export for .d.ts module)
export type * from './services.d.ts';

// Import for side-effect: extends ServiceMap via declaration merging
import './services.d.ts';
`;
}

// ============================================================================
// Services.d.ts Generator
// ============================================================================

function generateServicesDts(services: ServiceDefinition[], timestamp: string): string {
  const lines: string[] = [
    '// ============================================================================',
    '// Auto-generated Service Type Definitions',
    `// Generated at: ${timestamp}`,
    '// ============================================================================',
    '//',
    '// Access types via indexed access:',
    '//   type MyInput = Services["namespace:service"]["input"]',
    '//   type NestedField = Services["namespace:service"]["input"]["fieldName"]',
    '//',
    '// ============================================================================',
    '',
  ];

  // Generate the main Services interface with nested types
  lines.push('/**');
  lines.push(' * Service type registry - access nested types via indexed access');
  lines.push(' * @example');
  lines.push(' * type Input = Services["my:service"]["input"]');
  lines.push(' * type Config = Services["my:service"]["input"]["config"]');
  lines.push(' */');
  lines.push('export interface Services {');
  
  for (const service of services) {
    const isStreaming = isStreamingService(service);
    
    // Add service description as JSDoc
    if (service.description) {
      lines.push(`  /** ${service.description} */`);
    }
    
    lines.push(`  '${service.identifier}': {`);
    lines.push(`    input: ${jsonSchemaToNestedTS(service.inputs, 4)};`);
    lines.push(`    output: ${jsonSchemaToNestedTS(service.outputs, 4)};`);
    lines.push(`    kind: '${service.kind}';`);
    if (isStreaming) {
      lines.push(`    streaming: true;`);
    }
    lines.push(`  };`);
  }
  
  lines.push('}');
  lines.push('');

  // Extend ServiceMap for type-safe client access
  lines.push('// Extend ServiceMap for type-safe client access');
  lines.push("declare module '@pubwiki/sandbox-client' {");
  lines.push('  interface ServiceMap {');

  // Generate ServiceMap entries referencing the Services interface
  for (const service of services) {
    lines.push(`    '${service.identifier}': {`);
    lines.push(`      inputs: Services['${service.identifier}']['input'];`);
    lines.push(`      outputs: Services['${service.identifier}']['output'];`);
    if (isStreamingService(service)) {
      lines.push(`      streaming: true;`);
    }
    lines.push(`    };`);
  }

  lines.push('  }', '}', '');

  // Generate convenience type aliases
  lines.push('// ============================================================================');
  lines.push('// Convenience Type Aliases');
  lines.push('// ============================================================================');
  lines.push('');
  
  for (const service of services) {
    const safeName = pascalCase(service.name);
    lines.push(`export type ${safeName}Input = Services['${service.identifier}']['input'];`);
    lines.push(`export type ${safeName}Output = Services['${service.identifier}']['output'];`);
  }
  lines.push('');

  // Generate Service Interfaces
  lines.push('// ============================================================================');
  lines.push('// Service Interfaces');
  lines.push('// ============================================================================');
  lines.push('');

  for (const service of services) {
    const serviceName = `${pascalCase(service.name)}Service`;
    const isStreaming = isStreamingService(service);
    
    lines.push(`export interface ${serviceName} {`);
    lines.push(`  readonly identifier: '${service.identifier}';`);
    lines.push(`  readonly kind: '${service.kind}';`);
    if (isStreaming) {
      lines.push(`  readonly isStreaming: true;`);
      lines.push(`  stream(input: Services['${service.identifier}']['input'], on: (value: Services['${service.identifier}']['output']) => void): Promise<void>;`);
    } else {
      lines.push(`  call(input: Services['${service.identifier}']['input']): Promise<Services['${service.identifier}']['output']>;`);
    }
    lines.push('}');
    lines.push('');
  }

  // Generate Union Types
  lines.push('// ============================================================================');
  lines.push('// Union Types');
  lines.push('// ============================================================================');
  lines.push('');

  const serviceNames = services.map(s => `${pascalCase(s.name)}Service`);
  lines.push(`export type AllServices = ${serviceNames.join(' | ')};`);
  lines.push(`export type ServiceIdentifier = keyof Services;`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Convert JsonSchema to nested TypeScript type (inline, with proper indentation)
 */
function jsonSchemaToNestedTS(schema: JsonSchema, indent: number): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);
  
  // Handle enum
  if (schema.enum && Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).map((v: unknown) => JSON.stringify(v)).join(' | ');
  }

  // Handle oneOf/anyOf (union types)
  if (schema.oneOf) {
    const types = schema.oneOf.map((s) => jsonSchemaToNestedTS(s, indent));
    return types.join(' | ');
  }

  if (schema.anyOf) {
    const types = schema.anyOf.map((s) => jsonSchemaToNestedTS(s, indent));
    return types.join(' | ');
  }

  // Handle object
  if (schema.type === 'object' || schema.properties) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    
    if (Object.keys(props).length === 0) {
      if (schema.additionalProperties === true) {
        return 'Record<string, unknown>';
      }
      return '{}';
    }
    
    const propLines = Object.entries(props).map(([key, propSchema]) => {
      const optional = required.has(key) ? '' : '?';
      const doc = propSchema.description ? `${innerPad}/** ${propSchema.description} */\n` : '';
      const type = jsonSchemaToNestedTS(propSchema, indent + 2);
      return `${doc}${innerPad}${key}${optional}: ${type};`;
    });
    
    return `{\n${propLines.join('\n')}\n${pad}}`;
  }

  // Handle array
  if (schema.type === 'array') {
    const itemType = schema.items ? jsonSchemaToNestedTS(schema.items, indent) : 'unknown';
    return `Array<${itemType}>`;
  }

  // Handle function type (x-function)
  if (schema['x-function']) {
    const params = schema['x-params'] || {};
    const returns = schema['x-returns'];
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}: ${jsonSchemaToNestedTS(v as JsonSchema, indent)}`)
      .join(', ');
    const returnStr = returns ? jsonSchemaToNestedTS(returns, indent) : 'void';
    return `(${paramStr}) => ${returnStr}`;
  }

  // Basic type mapping
  const typeMap: Record<string, string> = {
    'string': 'string',
    'number': 'number',
    'integer': 'number',
    'boolean': 'boolean',
    'null': 'null',
  };

  return typeMap[schema.type || 'unknown'] || 'unknown';
}

// ============================================================================
// Services.md Generator
// ============================================================================

function generateServicesMd(services: ServiceDefinition[], timestamp: string): string {
  const lines: string[] = [
    '# Service Documentation',
    '',
    `> Generated at: ${timestamp}`,
    '',
    '## Overview',
    '',
    'This document describes the services available in this Loader.',
    '',
    '## Services',
    '',
  ];

  for (const service of services) {
    lines.push(`### ${service.identifier}`);
    lines.push('');
    lines.push(`**Kind:** ${service.kind}`);
    if (isStreamingService(service)) {
      lines.push('**Streaming:** Yes');
    }
    lines.push('');
    
    if (service.description) {
      lines.push(service.description);
      lines.push('');
    }

    // Input table
    lines.push('#### Input');
    lines.push('');
    const inputProps = service.inputs.properties || {};
    const inputRequired = new Set(service.inputs.required || []);
    
    if (Object.keys(inputProps).length > 0) {
      lines.push('| Parameter | Type | Required | Description |');
      lines.push('|-----------|------|----------|-------------|');
      for (const [name, schema] of Object.entries(inputProps)) {
        const required = inputRequired.has(name) ? '✓' : '';
        const type = getSchemaTypeString(schema);
        const desc = schema.description || '—';
        lines.push(`| ${name} | ${type} | ${required} | ${desc} |`);
      }
    } else {
      lines.push('*No input*');
    }
    lines.push('');

    // Output table
    lines.push('#### Output');
    lines.push('');
    const outputProps = service.outputs.properties || {};
    
    if (Object.keys(outputProps).length > 0) {
      lines.push('| Parameter | Type | Description |');
      lines.push('|-----------|------|-------------|');
      for (const [name, schema] of Object.entries(outputProps)) {
        const type = getSchemaTypeString(schema);
        const desc = schema.description || '—';
        lines.push(`| ${name} | ${type} | ${desc} |`);
      }
    } else if (service.outputs['x-function']) {
      lines.push('*Streaming output*');
    } else {
      lines.push('*No outputs*');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Agents.md Generator
// ============================================================================

function generateAgentsMd(services: ServiceDefinition[]): string {
  const serviceList = services.map(s => {
    const streaming = isStreamingService(s) ? '✓' : '—';
    const desc = s.description || '—';
    return `| \`${s.identifier}\` | ${s.kind} | ${streaming} | ${desc} |`;
  }).join('\n');

  // Generate usePub() usage examples grouped by namespace
  const byNs = new Map<string, ServiceDefinition[]>();
  for (const s of services) {
    const [ns] = s.identifier.split(':');
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns)!.push(s);
  }

  const usePubExamples = Array.from(byNs.entries()).map(([ns, svcs]) => {
    const lines = svcs.map(s => {
      const name = s.name;
      const isStream = isStreamingService(s);
      if (isStream) {
        return `  // Streaming service\n  await pub.${ns}.${name}.stream({ /* inputs */ }, (chunk) => {\n    console.log(chunk)\n  })`;
      }
      return `  await pub.${ns}.${name}({ /* inputs */ })`;
    });
    return lines.join('\n');
  }).join('\n\n');

  return `# Agent Integration Guide

## usePub() — Type-safe Backend Service Proxy

The \`usePub()\` hook from \`@pubwiki/game-sdk\` provides a type-safe proxy for calling backend services.
Service types are auto-generated from the Lua backend's ServiceRegistry.

## Quick Start

\`\`\`tsx
import { usePub } from '@pubwiki/game-sdk'

function MyComponent() {
  const pub = usePub()

  async function handleAction() {
${usePubExamples}
  }
}
\`\`\`

## Available Services

| Service ID | Kind | Streaming | Description |
|------------|------|-----------|-------------|
${serviceList}

## API Pattern

Services are accessed as \`pub.namespace.ServiceName\`:

- **Call**: \`await pub.ns.Name({ ...inputs })\` — returns the service output
- **Stream**: \`await pub.ns.Name.stream({ ...inputs }, (chunk) => { ... })\` — yields chunks via callback

## Type Definitions

- \`services.d.ts\` — TypeScript type definitions + ServiceMap declaration merging (auto-generated)
- \`services.md\` — Detailed API documentation with input/output schemas

## Accessing Types

\`\`\`typescript
import type { Services } from '@pubwiki/game-sdk/generated/services.d.ts'

// Input/output types for a specific service
type MyInput = Services['namespace:service']['input']
type MyOutput = Services['namespace:service']['output']
\`\`\`
`;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sanitize a string to be a valid TypeScript identifier
 * - Removes/replaces invalid characters (., :, /, -, etc.)
 * - Ensures it doesn't start with a number
 * - Converts to PascalCase
 */
function sanitizeTypeName(str: string): string {
  // Replace common separators with underscores first
  let sanitized = str
    .replace(/[.:/\\]/g, '_')  // Replace . : / \ with _
    .replace(/[^a-zA-Z0-9_]/g, '_')  // Replace any other invalid chars with _
    .replace(/_+/g, '_')  // Collapse multiple underscores
    .replace(/^_|_$/g, '');  // Remove leading/trailing underscores
  
  // If starts with a number, prefix with underscore
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  
  // Convert to PascalCase
  return sanitized
    .replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())
    .replace(/_/g, '');
}

function pascalCase(str: string): string {
  return sanitizeTypeName(str);
}

function isStreamingService(service: ServiceDefinition): boolean {
  const returns = service.outputs;
  if (returns['x-function'] !== true) return false;
  
  const xReturns = returns['x-returns'] as JsonSchema | undefined;
  if (!xReturns?.oneOf) return false;
  
  return xReturns.oneOf.some((s: JsonSchema) => s.type === 'null');
}

function getSchemaTypeString(schema: JsonSchema): string {
  if (schema.enum && Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).map((v: unknown) => `\`${v}\``).join(' \\| ');
  }
  if (schema.type === 'array') {
    const itemType = schema.items ? getSchemaTypeString(schema.items) : 'unknown';
    return `${itemType}[]`;
  }
  if (schema.type === 'object') {
    return 'object';
  }
  return schema.type || 'unknown';
}
