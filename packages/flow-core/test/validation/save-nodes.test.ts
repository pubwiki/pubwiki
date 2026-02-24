/**
 * SAVE Node Validation Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { ImmutableGraph, type ImmutableGraphNode, type ImmutableGraphEdge } from '../../src/graph'
import { validateSaveNodes } from '../../src/validation/save-nodes'

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
// No SAVE Nodes Tests
// ============================================================================

describe('validateSaveNodes - No SAVE nodes', () => {
  it('should accept graph with no SAVE nodes', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })

  it('should accept empty graph', () => {
    const graph = ImmutableGraph.fromArrays([], [])
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })

  it('should accept graph with STATE but no SAVE nodes', () => {
    const nodes = [
      createStateNode('state1', 'commit-state1'),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Valid SAVE Node Tests
// ============================================================================

describe('validateSaveNodes - Valid SAVE configurations', () => {
  it('should accept valid SAVE node with matching STATE', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })

  it('should accept multiple valid SAVE nodes', () => {
    const stateCommit1 = 'state-v1'
    const stateCommit2 = 'state-v2'
    const nodes = [
      createStateNode('state1', stateCommit1),
      createStateNode('state2', stateCommit2),
      createSaveNode('save1', 'state1', stateCommit1),
      createSaveNode('save2', 'state2', stateCommit2),
      createNode('loader1', 'LOADER'),
      createNode('loader2', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
      createEdge('state2', 'loader2'),
      createEdge('loader2', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })

  it('should accept multiple SAVE nodes referencing same STATE', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createSaveNode('save2', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Missing Content Fields Tests
// ============================================================================

describe('validateSaveNodes - Missing content fields', () => {
  it('should reject SAVE node missing stateNodeId', () => {
    const nodes = [
      createStateNode('state1', 'commit-state1'),
      createNode('save1', 'SAVE', {
        content: {
          type: 'SAVE',
          // stateNodeId missing
          stateNodeCommit: 'commit-state1',
        } as ImmutableGraphNode['content'],
      }),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('save1')
    expect(result.error?.message).toContain('stateNodeId')
  })

  it('should reject SAVE node missing stateNodeCommit', () => {
    const nodes = [
      createStateNode('state1', 'commit-state1'),
      createNode('save1', 'SAVE', {
        content: {
          type: 'SAVE',
          stateNodeId: 'state1',
          // stateNodeCommit missing
        } as ImmutableGraphNode['content'],
      }),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('save1')
    expect(result.error?.message).toContain('stateNodeCommit')
  })

  it('should reject SAVE node with empty content', () => {
    const nodes = [
      createStateNode('state1', 'commit-state1'),
      createNode('save1', 'SAVE', { content: {} as ImmutableGraphNode['content'] }),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
  })
})

// ============================================================================
// Missing STATE Node Tests
// ============================================================================

describe('validateSaveNodes - Missing STATE reference', () => {
  it('should reject SAVE referencing non-existent STATE node', () => {
    const nodes = [
      createSaveNode('save1', 'nonexistent-state', 'some-commit'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('save1')
    expect(result.error?.message).toContain('nonexistent-state')
    expect(result.error?.message).toContain('not present')
  })

  it('should reject SAVE referencing STATE not in graph', () => {
    const nodes = [
      createStateNode('state1', 'commit-state1'),
      createSaveNode('save1', 'state2', 'commit-state2'), // state2 doesn't exist
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('state2')
  })
})

// ============================================================================
// Commit Mismatch Tests
// ============================================================================

describe('validateSaveNodes - Commit mismatch', () => {
  it('should reject SAVE with mismatched stateNodeCommit', () => {
    const nodes = [
      createStateNode('state1', 'actual-commit-v1'),
      createSaveNode('save1', 'state1', 'wrong-commit-v2'),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('save1')
    expect(result.error?.message).toContain('wrong-commit-v2')
    expect(result.error?.message).toContain('actual-commit-v1')
  })
})

// ============================================================================
// Connectivity Tests (STATE → LOADER → SANDBOX)
// ============================================================================

describe('validateSaveNodes - Graph connectivity', () => {
  it('should reject STATE without path to SANDBOX', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
      // No edge from state1 to loader1
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('state1')
    expect(result.error?.message).toContain('SANDBOX')
    expect(result.error?.message).toContain('LOADER')
  })

  it('should reject STATE directly connected to SANDBOX (bypassing LOADER)', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'sandbox1'), // Direct connection, no LOADER
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    expect(result.error?.message).toContain('state1')
  })

  it('should reject STATE connected only to LOADER without SANDBOX', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      // No SANDBOX node
    ]
    const edges = [
      createEdge('state1', 'loader1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
  })

  it('should accept STATE → LOADER → LOADER → SANDBOX', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      createNode('loader2', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'loader2'),
      createEdge('loader2', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })

  it('should cache connectivity results for multiple SAVE nodes', () => {
    const stateCommit = 'state-v1'
    const nodes = [
      createStateNode('state1', stateCommit),
      createSaveNode('save1', 'state1', stateCommit),
      createSaveNode('save2', 'state1', stateCommit),
      createSaveNode('save3', 'state1', stateCommit),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('validateSaveNodes - Edge cases', () => {
  it('should handle multiple STATE nodes with individual connectivity', () => {
    const stateCommit1 = 'state-v1'
    const stateCommit2 = 'state-v2'
    const nodes = [
      createStateNode('state1', stateCommit1),
      createStateNode('state2', stateCommit2),
      createSaveNode('save1', 'state1', stateCommit1),
      createSaveNode('save2', 'state2', stateCommit2),
      createNode('loader1', 'LOADER'),
      createNode('loader2', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
      // state2 not connected
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('state2')
  })

  it('should validate first error found in multiple invalid SAVE nodes', () => {
    const nodes = [
      createSaveNode('save1', 'missing1', 'commit1'),
      createSaveNode('save2', 'missing2', 'commit2'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('BAD_REQUEST')
    // Should fail on first SAVE node encountered
  })

  it('should handle SAVE node with correct ID reference but wrong type', () => {
    // Node exists but is not a STATE type
    const nodes = [
      createNode('notState', 'PROMPT', { commit: 'commit-prompt' }),
      createSaveNode('save1', 'notState', 'commit-prompt'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    const result = validateSaveNodes(graph)
    
    // Should fail because notState is not in STATE nodes map
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('notState')
    expect(result.error?.message).toContain('not present')
  })
})
