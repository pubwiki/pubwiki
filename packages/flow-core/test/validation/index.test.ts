/**
 * validateGraph Integration Tests
 * 
 * Tests the main validateGraph function which runs all validations
 * in sequence: structure → connections → save nodes → entrypoint
 */

import { describe, it, expect } from 'vitest'
import { ImmutableGraph, type ImmutableGraphNode, type ImmutableGraphEdge } from '../../src/graph'
import { validateGraph } from '../../src/validation'
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

function createLoaderNode(nodeId: string, commit?: string): ImmutableGraphNode {
  return createNode(nodeId, 'LOADER', {
    commit: commit ?? `commit-${nodeId}`,
    content: { type: 'LOADER' },
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
// Complete Valid Graph Tests
// ============================================================================

describe('validateGraph - Complete valid scenarios', () => {
  it('should accept empty graph', () => {
    const graph = ImmutableGraph.fromArrays([], [])
    const result = validateGraph(graph)
    expect(result.success).toBe(true)
  })

  it('should accept simple graph without SAVE nodes', () => {
    const nodes = [
      createNode('prompt1', 'PROMPT'),
      createNode('generated1', 'GENERATED'),
    ]
    const edges = [createEdge('prompt1', 'generated1')]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    expect(result.success).toBe(true)
  })

  it('should accept full artifact graph', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createNode('prompt1', 'PROMPT'),
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('prompt1', 'state1'),
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'sandbox1',
    }
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    expect(result.success).toBe(true)
  })

  it('should accept complex multi-branch graph', () => {
    const stateCommit1 = 'state-v1'
    const stateCommit2 = 'state-v2'
    const saveCommit1 = 'save-v1'
    const saveCommit2 = 'save-v2'
    
    const nodes = [
      // Branch 1
      createNode('prompt1', 'PROMPT'),
      createStateNode('state1', stateCommit1),
      createSaveNode('save1', 'state1', stateCommit1, saveCommit1),
      createLoaderNode('loader1'),
      
      // Branch 2
      createNode('prompt2', 'PROMPT'),
      createStateNode('state2', stateCommit2),
      createSaveNode('save2', 'state2', stateCommit2, saveCommit2),
      createLoaderNode('loader2'),
      
      // Shared sandbox
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('prompt1', 'state1'),
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
      createEdge('prompt2', 'state2'),
      createEdge('state2', 'loader2'),
      createEdge('loader2', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit: saveCommit1,
      sandboxNodeId: 'sandbox1',
    }
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Validation Order Tests
// ============================================================================

describe('validateGraph - Validation order', () => {
  it('should fail on structure before connections', () => {
    // Duplicate edge (structure issue) and self-connection (connection issue)
    const nodes = [createNode('n1', 'PROMPT')]
    const edges = [
      createEdge('n1', 'n1'),
      createEdge('n1', 'n1'), // duplicate
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('Duplicate edge')
  })

  it('should fail on structure before save nodes', () => {
    // Missing node (structure) and invalid SAVE
    const nodes = [
      createSaveNode('save1', 'missing-state', 'missing-commit'),
    ]
    const edges = [
      createEdge('n1', 'n2'), // both nodes missing
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('source node')
    expect(result.error?.message).toContain('does not exist')
  })

  it('should fail on connections before save nodes', () => {
    // Self-connection (connection issue) along with SAVE validation
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', 'wrong-commit'), // wrong commit
      createNode('prompt1', 'PROMPT'),
    ]
    const edges = [
      createEdge('prompt1', 'prompt1'), // self-connection
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('Self-connection')
  })

  it('should fail on save nodes before entrypoint', () => {
    // Invalid SAVE and invalid entrypoint
    const nodes = [
      createSaveNode('save1', 'missing-state', 'missing-commit', 'save-v1'),
      createSandboxNode('sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'save-v1',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('missing-state')
    expect(result.error?.message).toContain('not present')
  })
})

// ============================================================================
// Structural Failures in Integration
// ============================================================================

describe('validateGraph - Structural validation', () => {
  it('should reject duplicate edges', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const edges = [
      createEdge('n1', 'n2'),
      createEdge('n1', 'n2'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
  })

  it('should reject missing nodes in edges', () => {
    const nodes = [createNode('n1', 'PROMPT')]
    const edges = [createEdge('n1', 'missing')]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
  })
})

// ============================================================================
// Connection Validation in Integration
// ============================================================================

describe('validateGraph - Connection validation', () => {
  it('should reject self-connection', () => {
    const nodes = [createNode('n1', 'PROMPT')]
    const edges = [createEdge('n1', 'n1')]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('Self-connection')
  })

  it('should accept valid connections between different nodes', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const edges = [createEdge('n1', 'n2')]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// SAVE Node Failures in Integration
// ============================================================================

describe('validateGraph - SAVE node validation', () => {
  it('should reject SAVE with missing STATE', () => {
    const nodes = [createSaveNode('save1', 'nonexistent', 'commit')]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('nonexistent')
  })

  it('should reject SAVE with commit mismatch', () => {
    const nodes = [
      createStateNode('state1', 'actual-commit'),
      createSaveNode('save1', 'state1', 'wrong-commit'),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('wrong-commit')
    expect(result.error?.message).toContain('actual-commit')
  })

  it('should reject SAVE without STATE → LOADER → SANDBOX path', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createSandboxNode('sandbox1'),
      // No LOADER
    ]
    const edges = [
      createEdge('state1', 'sandbox1'), // direct to sandbox
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('state1')
    expect(result.error?.message).toContain('SANDBOX')
    expect(result.error?.message).toContain('LOADER')
  })
})

// ============================================================================
// Entrypoint Failures in Integration
// ============================================================================

describe('validateGraph - Entrypoint validation', () => {
  it('should reject invalid sandbox node', () => {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'nonexistent',
    }
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('nonexistent')
  })

  it('should reject invalid save commit', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, 'actual-save'),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit: 'wrong-save',
      sandboxNodeId: 'sandbox1',
    }
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('wrong-save')
  })

  it('should pass when entrypoint is undefined', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const result = validateGraph(graph, undefined)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Build Cache Requirement Tests
// ============================================================================

describe('validateGraph - Build cache requirement', () => {
  function createValidEntrypointGraph() {
    const stateCommit = 'state-v1'
    const saveCommit = 'save-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    return {
      graph: ImmutableGraph.fromArrays(nodes, edges),
      entrypoint: { saveCommit, sandboxNodeId: 'sandbox1' } as EntrypointConfig,
    }
  }

  it('should reject entrypoint without buildCacheKey', () => {
    const { graph, entrypoint } = createValidEntrypointGraph()
    const result = validateGraph(graph, { entrypoint })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('buildCacheKey')
  })

  it('should accept entrypoint with buildCacheKey', () => {
    const { graph, entrypoint } = createValidEntrypointGraph()
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'abc123' })

    expect(result.success).toBe(true)
  })

  it('should accept no entrypoint without buildCacheKey', () => {
    const { graph } = createValidEntrypointGraph()
    const result = validateGraph(graph)

    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('validateGraph - Edge cases', () => {
  it('should handle graph with only isolated nodes', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
      createNode('n3', 'LOADER'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateGraph(graph)
    expect(result.success).toBe(true)
  })

  it('should handle large graph validation', () => {
    const nodeCount = 500
    const nodes = Array.from({ length: nodeCount }, (_, i) =>
      createNode(`n${i}`, i % 2 === 0 ? 'PROMPT' : 'GENERATED')
    )
    const edges = Array.from({ length: nodeCount - 1 }, (_, i) =>
      createEdge(`n${i}`, `n${i + 1}`)
    )
    
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const start = performance.now()
    const result = validateGraph(graph)
    const elapsed = performance.now() - start
    
    expect(result.success).toBe(true)
    // Should complete in reasonable time (<500ms)
    expect(elapsed).toBeLessThan(500)
  })

  it('should handle graph with cycles', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
      createNode('n3', 'LOADER'),
    ]
    const edges = [
      createEdge('n1', 'n2'),
      createEdge('n2', 'n3'),
      createEdge('n3', 'n1'), // cycle
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateGraph(graph)
    
    // Cycles are structurally valid
    expect(result.success).toBe(true)
  })

  it('should validate all aspects of a complete workflow', () => {
    // Complete workflow: PROMPT → INPUT → GENERATED → STATE → LOADER → SANDBOX
    const stateCommit = 'state-abc123'
    const saveCommit = 'save-def456'
    
    const nodes = [
      createNode('prompt1', 'PROMPT'),
      createNode('input1', 'INPUT'),
      createNode('generated1', 'GENERATED'),
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit, saveCommit),
      createLoaderNode('loader1'),
      createSandboxNode('sandbox1'),
    ]
    const edges = [
      createEdge('prompt1', 'input1'),
      createEdge('input1', 'generated1'),
      createEdge('generated1', 'state1'),
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    const entrypoint: EntrypointConfig = {
      saveCommit,
      sandboxNodeId: 'sandbox1',
    }
    
    const result = validateGraph(graph, { entrypoint, buildCacheKey: 'test-build-key' })
    expect(result.success).toBe(true)
  })
})
