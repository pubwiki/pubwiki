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

  return `# Agent Integration Guide

## 类型安全的服务调用

本 VFS 包含自动生成的 TypeScript 类型定义，支持与 \`@pubwiki/sandbox-client\` 无缝集成。

## 快速开始

### 1. 复制类型文件

将整个 VFS 内容复制到你的项目中（如 \`src/generated/\` 目录）。

### 2. 在 tsconfig.json 中包含类型

\`\`\`json
{
  "include": ["src/**/*", "src/generated/**/*"]
}
\`\`\`

### 3. 享受类型安全

\`\`\`typescript
// 直接从生成的 index.ts 导入
import { initSandboxClient } from './generated/index';

const client = await initSandboxClient();

// 🎯 自动补全 service ID
const service = await client.getService('...');

// 🎯 类型检查输入和输出
const result = await service.call({ ... });
\`\`\`

## 可用服务

| Service ID | Kind | Streaming | Description |
|------------|------|-----------|-------------|
${serviceList}

## 类型定义文件

- \`index.ts\` - 入口文件，re-export sandbox-client + 生成的类型
- \`services.d.ts\` - TypeScript 类型定义 + ServiceMap 声明合并
- \`services.md\` - 详细 API 文档

## 高级用法

### 获取所有服务标识符

\`\`\`typescript
import type { ServiceMap } from '@pubwiki/sandbox-client';

type ServiceId = keyof ServiceMap;
\`\`\`

### 获取特定服务的输入/输出类型

\`\`\`typescript
import type { Services } from './services.d.ts';

// 获取特定服务的输入类型
type MyServiceInput = Services['my:service']['input'];
// 获取嵌套字段类型
type ConfigField = Services['my:service']['input']['config'];
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
