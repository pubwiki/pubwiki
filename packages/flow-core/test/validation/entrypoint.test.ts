/**
 * Entrypoint Validation Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { ImmutableGraph, type ImmutableGraphNode, type ImmutableGraphEdge } from '../../src/graph'
import { validateEntrypoint } from '../../src/validation/entrypoint'
import type { EntrypointConfig } from '../../src/validation/types'

// ============================================================================
// Test Utilities
// ============================================================================

function createNode(
  nodeId: string,
  type: ImmutableGraphNode['type'],
  options?: Partial<ImmutableGraphNode>
): ImmutableGraphNode {
  return {
    nodeId,
    commit: options?.commit ?? `commit-${nodeId}`,
    type,
    contentHash: options?.contentHash ?? `hash-${nodeId}`,
    content: (options?.content ?? {}) as ImmutableGraphNode['content'],
    ...options,
  }
}

function createStateNode(nodeId: string, commit: string): ImmutableGraphNode {
  return createNode(nodeId, 'STATE', {
    commit,
    content: { type: 'STATE' } as ImmutableGraphNode['content'],
  })
}

function createSaveNode(
  nodeId: string,
  stateNodeId: string,
  stateNodeCommit: string,
  commit?: string
): ImmutableGraphNode {
  return createNode(nodeId, 'SAVE', {
    commit: commit ?? `commit-${nodeId}`,
    content: {
      type: 'SAVE',
      stateNodeId,
      stateNodeCommit,
    } as ImmutableGraphNode['content'],
  })
}

function createSandboxNode(nodeId: string, commit?: string): ImmutableGraphNode {
  return createNode(nodeId, 'SANDBOX', {
    commit: commit ?? `commit-${nodeId}`,
    content: { type: 'SANDBOX' } as ImmutableGraphNode['content'],
  })
}

function createEdge(
  source: string,
  target: string,
  options?: Partial<ImmutableGraphEdge>
): ImmutableGraphEdge {
  return {
    source,
    target,
    ...options,
  }
}

// ============================================================================
// No Entrypoint Tests
// ============================================================================

describe('validateEntrypoint - No entrypoint', () => {
  it('should accept when no entrypoint provided', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateEntrypoint(graph, undefined)
    expect(result.success).toBe(true)
  })

  it('should accept empty graph with no entrypoint', () => {
    const graph = ImmutableGraph.fromArrays([], [])
    const result = validateEntrypoint(graph, undefined)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Valid Entrypoint Tests
// ============================================================================

describe('validateEntrypoint - Valid configurations', () => {
  it('should accept valid entrypoint configuration', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createNode('loader1', 'LOADER'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    expect(result.success).toBe(true)
  })

  it('should accept entrypoint with multiple SAVE nodes', () => {
    const stateCommit = 'state-v1'
    const saveCommit1 = 'save-v1'
    const saveCommit2 = 'save-v2'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit1),
      createSaveNode('save2', 'state1', stateCommit, saveCommit2),
      createNode('loader1', 'LOADER'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    // Using second save
    const entrypoint: EntrypointConfig = {
      saveCommit: saveCommit2,
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Invalid Sandbox Node Tests
// ============================================================================

describe('validateEntrypoint - Sandbox validation', () => {
  it('should reject non-existent sandbox node', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'nonexistent-sandbox',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('nonexistent-sandbox')
    expect(result.error?.message).toContain('not in the graph')
  })

  it('should reject sandbox node that is not SANDBOX type', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createNode('notSandbox', 'LOADER'), // Wrong type
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'notSandbox',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('notSandbox')
    expect(result.error?.message).toContain('not a SANDBOX')
    expect(result.error?.message).toContain('LOADER')
  })

  it('should reject when sandbox node is PROMPT type', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createNode('prompt1', 'PROMPT'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'prompt1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('PROMPT')
  })
})

// ============================================================================
// Invalid Save Commit Tests
// ============================================================================

describe('validateEntrypoint - Save commit validation', () => {
  it('should reject non-existent save commit', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, 'actual-save-commit'),
      createSandboxNode('sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'nonexistent-commit',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('nonexistent-commit')
    expect(result.error?.message).toContain('not found')
    expect(result.error?.message).toContain('SAVE')
  })

  it('should reject when no SAVE nodes exist in graph', () => {
    const nodes = [
      createStateNode('state1', 'state-v1'),
      createSandboxNode('sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'any-commit',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('any-commit')
    expect(result.error?.message).toContain('not found')
  })

  it('should match exact save commit, not partial', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, 'save-commit-full'),
      createSandboxNode('sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'save-commit', // partial match
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Save Reference Validation Tests
// ============================================================================

describe('validateEntrypoint - Save STATE reference validation', () => {
  it('should reject when SAVE references STATE not in graph', () => {
    const nodes = [
      createSaveNode('save1', 'missing-state', 'some-commit', 'save-v1'),
      createSandboxNode('sandbox1'),
      // Note: No STATE node present
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'save-v1',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('missing-state')
    expect(result.error?.message).toContain('not in the graph')
  })

  it('should accept when SAVE references valid STATE in graph', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, 'save-v1'),
      createSandboxNode('sandbox1'),
      createNode('loader1', 'LOADER'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'save-v1',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('validateEntrypoint - Edge cases', () => {
  it('should handle multiple SANDBOX nodes', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createSandboxNode('sandbox1'),
      createSandboxNode('sandbox2'),
      createNode('loader1', 'LOADER'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    // Entrypoint uses sandbox2
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'sandbox2',
    }
    const result = validateEntrypoint(graph, entrypoint)
    expect(result.success).toBe(true)
  })

  it('should validate sandbox first before save commit', () => {
    // If both sandbox and save commit are invalid,
    // sandbox should be checked first
    const nodes = [
      createStateNode('state1', 'state-v1'),
      createSaveNode('save1', 'state1', 'state-v1', 'actual-save'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'wrong-save',
      sandboxNodeId: 'nonexistent-sandbox',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('sandbox')
  })

  it('should handle empty strings in entrypoint config', () => {
    const nodes = [createSandboxNode('sandbox1')]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: '',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateEntrypoint(graph, entrypoint)
    
    expect(result.success).toBe(false)
    // Empty save commit won't match any SAVE node
    expect(result.error?.message).toContain('SAVE')
  })
})
