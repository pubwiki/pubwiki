/**
 * Structural Validation Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { ImmutableGraph, type ImmutableGraphNode, type ImmutableGraphEdge } from '../../src/graph'
import { validateStructure } from '../../src/validation/structural'

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
// Basic Validation Tests
// ============================================================================

describe('validateStructure', () => {
  describe('valid graphs', () => {
    it('should accept empty graph', () => {
      const graph = ImmutableGraph.fromArrays([], [])
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })

    it('should accept graph with only nodes', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
      ]
      const graph = ImmutableGraph.fromArrays(nodes, [])
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })

    it('should accept graph with valid edges', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
        createNode('n3', 'LOADER'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n2', 'n3'),
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })

    it('should accept graph with complex topology', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
        createNode('n3', 'LOADER'),
        createNode('n4', 'SANDBOX'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n1', 'n3'),
        createEdge('n2', 'n4'),
        createEdge('n3', 'n4'),
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })

    it('should accept graph with cycles', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
        createNode('n3', 'LOADER'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n2', 'n3'),
        createEdge('n3', 'n1'),
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })
  })

  describe('duplicate edges', () => {
    it('should reject graph with duplicate edges', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n1', 'n2'), // duplicate
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BAD_REQUEST')
      expect(result.error?.message).toContain('Duplicate edge')
      expect(result.error?.message).toContain('n1')
      expect(result.error?.message).toContain('n2')
    })

    it('should detect multiple duplicate edges', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
        createNode('n3', 'LOADER'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n2', 'n3'),
        createEdge('n1', 'n2'), // first duplicate
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BAD_REQUEST')
    })

    it('should NOT consider reverse edge as duplicate', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
      ]
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n2', 'n1'), // reverse, not duplicate
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })
  })

  describe('missing nodes', () => {
    it('should reject edge with missing source node', () => {
      const nodes = [createNode('n2', 'GENERATED')]
      const edges = [createEdge('n1', 'n2')] // n1 does not exist
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BAD_REQUEST')
      expect(result.error?.message).toContain('source node')
      expect(result.error?.message).toContain('n1')
      expect(result.error?.message).toContain('does not exist')
    })

    it('should reject edge with missing target node', () => {
      const nodes = [createNode('n1', 'PROMPT')]
      const edges = [createEdge('n1', 'n2')] // n2 does not exist
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BAD_REQUEST')
      expect(result.error?.message).toContain('target node')
      expect(result.error?.message).toContain('n2')
      expect(result.error?.message).toContain('does not exist')
    })

    it('should reject edge where both nodes are missing', () => {
      const nodes: ImmutableGraphNode[] = []
      const edges = [createEdge('n1', 'n2')]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BAD_REQUEST')
      // Should fail on source node first
      expect(result.error?.message).toContain('source node')
    })

    it('should report first missing node in multiple invalid edges', () => {
      const nodes = [createNode('n1', 'PROMPT')]
      const edges = [
        createEdge('n1', 'n2'), // n2 missing
        createEdge('n3', 'n4'), // n3, n4 missing
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      // Duplicate check happens before missing node check
      // So first invalid thing encountered will be reported
    })
  })

  describe('validation order', () => {
    it('should check duplicate edges before missing nodes', () => {
      // If there's both a duplicate edge and missing nodes,
      // duplicate edge should be caught first
      const nodes: ImmutableGraphNode[] = []
      const edges = [
        createEdge('n1', 'n2'),
        createEdge('n1', 'n2'), // duplicate before we check nodes
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Duplicate edge')
    })
  })

  describe('edge cases', () => {
    it('should handle self-loops in structure validation', () => {
      // Self-loops are structurally valid (node exists)
      // Connection validation handles whether they're semantically valid
      const nodes = [createNode('n1', 'PROMPT')]
      const edges = [createEdge('n1', 'n1')]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      
      expect(result.success).toBe(true)
    })

    it('should handle large number of valid edges', () => {
      const nodeCount = 100
      const nodes = Array.from({ length: nodeCount }, (_, i) => 
        createNode(`n${i}`, 'PROMPT')
      )
      const edges = Array.from({ length: nodeCount - 1 }, (_, i) =>
        createEdge(`n${i}`, `n${i + 1}`)
      )
      
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })

    it('should handle edges with handles', () => {
      const nodes = [
        createNode('n1', 'PROMPT'),
        createNode('n2', 'GENERATED'),
      ]
      const edges = [
        createEdge('n1', 'n2', {
          sourceHandle: 'output-1',
          targetHandle: 'input-1',
        }),
      ]
      const graph = ImmutableGraph.fromArrays(nodes, edges)
      const result = validateStructure(graph)
      expect(result.success).toBe(true)
    })
  })
})
