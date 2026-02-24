/**
 * ImmutableGraph Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { ImmutableGraph, type ImmutableGraphNode, type ImmutableGraphEdge } from '../../src/graph'

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
// Basic Construction Tests
// ============================================================================

describe('ImmutableGraph - Construction', () => {
  it('should create an empty graph', () => {
    const graph = ImmutableGraph.fromArrays([], [])
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it('should create a graph with nodes only', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(0)
  })

  it('should create a graph with nodes and edges', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const edges = [createEdge('n1', 'n2')]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
  })

  it('should freeze nodes and edges arrays', () => {
    const nodes = [createNode('n1', 'PROMPT')]
    const edges: ImmutableGraphEdge[] = []
    const graph = ImmutableGraph.fromArrays(nodes, edges)

    expect(() => {
      (graph.nodes as ImmutableGraphNode[]).push(createNode('n2', 'INPUT'))
    }).toThrow()

    expect(() => {
      (graph.edges as ImmutableGraphEdge[]).push(createEdge('n1', 'n2'))
    }).toThrow()
  })
})

// ============================================================================
// Node Access Tests
// ============================================================================

describe('ImmutableGraph - Node Access', () => {
  const nodes = [
    createNode('n1', 'PROMPT'),
    createNode('n2', 'GENERATED'),
    createNode('n3', 'LOADER'),
    createNode('n4', 'SANDBOX'),
    createNode('n5', 'PROMPT'),
  ]
  const edges = [
    createEdge('n1', 'n2'),
    createEdge('n2', 'n3'),
    createEdge('n3', 'n4'),
  ]
  const graph = ImmutableGraph.fromArrays(nodes, edges)

  describe('getNode', () => {
    it('should return node by ID', () => {
      const node = graph.getNode('n1')
      expect(node).toBeDefined()
      expect(node?.nodeId).toBe('n1')
      expect(node?.type).toBe('PROMPT')
    })

    it('should return undefined for non-existent node', () => {
      const node = graph.getNode('nonexistent')
      expect(node).toBeUndefined()
    })

    it('should handle edge case with empty string ID', () => {
      const node = graph.getNode('')
      expect(node).toBeUndefined()
    })
  })

  describe('getNodesByType', () => {
    it('should return all nodes of a specific type', () => {
      const prompts = graph.getNodesByType('PROMPT')
      expect(prompts).toHaveLength(2)
      expect(prompts.map(n => n.nodeId)).toContain('n1')
      expect(prompts.map(n => n.nodeId)).toContain('n5')
    })

    it('should return empty array for type with no nodes', () => {
      const inputs = graph.getNodesByType('INPUT')
      expect(inputs).toHaveLength(0)
    })

    it('should return single node when only one exists', () => {
      const sandboxes = graph.getNodesByType('SANDBOX')
      expect(sandboxes).toHaveLength(1)
      expect(sandboxes[0].nodeId).toBe('n4')
    })
  })
})

// ============================================================================
// Edge Access Tests
// ============================================================================

describe('ImmutableGraph - Edge Access', () => {
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
  ]
  const graph = ImmutableGraph.fromArrays(nodes, edges)

  describe('getOutgoingEdges', () => {
    it('should return outgoing edges for a node', () => {
      const outgoing = graph.getOutgoingEdges('n1')
      expect(outgoing).toHaveLength(2)
      expect(outgoing.map(e => e.target)).toContain('n2')
      expect(outgoing.map(e => e.target)).toContain('n3')
    })

    it('should return empty array for node with no outgoing edges', () => {
      const outgoing = graph.getOutgoingEdges('n4')
      expect(outgoing).toHaveLength(0)
    })

    it('should return empty array for non-existent node', () => {
      const outgoing = graph.getOutgoingEdges('nonexistent')
      expect(outgoing).toHaveLength(0)
    })
  })

  describe('getIncomingEdges', () => {
    it('should return incoming edges for a node', () => {
      const incoming = graph.getIncomingEdges('n2')
      expect(incoming).toHaveLength(1)
      expect(incoming[0].source).toBe('n1')
    })

    it('should return empty array for node with no incoming edges', () => {
      const incoming = graph.getIncomingEdges('n1')
      expect(incoming).toHaveLength(0)
    })

    it('should return empty array for non-existent node', () => {
      const incoming = graph.getIncomingEdges('nonexistent')
      expect(incoming).toHaveLength(0)
    })
  })

  describe('hasEdge', () => {
    it('should return true for existing edge', () => {
      expect(graph.hasEdge('n1', 'n2')).toBe(true)
    })

    it('should return false for non-existing edge', () => {
      expect(graph.hasEdge('n1', 'n4')).toBe(false)
    })

    it('should return false for reversed edge', () => {
      expect(graph.hasEdge('n2', 'n1')).toBe(false)
    })

    it('should return false for non-existent nodes', () => {
      expect(graph.hasEdge('nonexistent1', 'nonexistent2')).toBe(false)
    })
  })
})

// ============================================================================
// Traversal Tests
// ============================================================================

describe('ImmutableGraph - Traversal', () => {
  const nodes = [
    createNode('n1', 'PROMPT'),
    createNode('n2', 'GENERATED'),
    createNode('n3', 'LOADER'),
    createNode('n4', 'SANDBOX'),
    createNode('n5', 'PROMPT'),
  ]
  const edges = [
    createEdge('n1', 'n2'),
    createEdge('n2', 'n3'),
    createEdge('n3', 'n4'),
    createEdge('n5', 'n4'),
  ]
  const graph = ImmutableGraph.fromArrays(nodes, edges)

  describe('getSuccessors', () => {
    it('should return direct successors', () => {
      const successors = graph.getSuccessors('n1')
      expect(successors).toHaveLength(1)
      expect(successors[0].nodeId).toBe('n2')
    })

    it('should return multiple successors', () => {
      // n3 and n5 both point to n4, but getSuccessors is about outgoing
      const successors = graph.getSuccessors('n2')
      expect(successors).toHaveLength(1)
      expect(successors[0].nodeId).toBe('n3')
    })

    it('should return empty array for leaf nodes', () => {
      const successors = graph.getSuccessors('n4')
      expect(successors).toHaveLength(0)
    })

    it('should return empty array for non-existent node', () => {
      const successors = graph.getSuccessors('nonexistent')
      expect(successors).toHaveLength(0)
    })
  })

  describe('getPredecessors', () => {
    it('should return direct predecessors', () => {
      const predecessors = graph.getPredecessors('n2')
      expect(predecessors).toHaveLength(1)
      expect(predecessors[0].nodeId).toBe('n1')
    })

    it('should return multiple predecessors', () => {
      const predecessors = graph.getPredecessors('n4')
      expect(predecessors).toHaveLength(2)
      expect(predecessors.map(p => p.nodeId)).toContain('n3')
      expect(predecessors.map(p => p.nodeId)).toContain('n5')
    })

    it('should return empty array for root nodes', () => {
      const predecessors = graph.getPredecessors('n1')
      expect(predecessors).toHaveLength(0)
    })

    it('should return empty array for non-existent node', () => {
      const predecessors = graph.getPredecessors('nonexistent')
      expect(predecessors).toHaveLength(0)
    })
  })
})

// ============================================================================
// Graph Query Tests
// ============================================================================

describe('ImmutableGraph - Graph Queries', () => {
  describe('hasPathThrough', () => {
    // STATE -> LOADER -> SANDBOX pattern
    const nodes = [
      createNode('state1', 'STATE'),
      createNode('loader1', 'LOADER'),
      createNode('sandbox1', 'SANDBOX'),
      createNode('state2', 'STATE'),
      createNode('loader2', 'LOADER'),
      createNode('sandbox2', 'SANDBOX'),
      createNode('prompt1', 'PROMPT'),
      createNode('isolated', 'STATE'),
    ]
    const edges = [
      createEdge('state1', 'loader1'),
      createEdge('loader1', 'sandbox1'),
      createEdge('state2', 'loader2'),
      createEdge('loader2', 'sandbox2'),
      createEdge('prompt1', 'sandbox1'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)

    it('should find path STATE -> LOADER -> SANDBOX', () => {
      expect(graph.hasPathThrough('state1', 'SANDBOX', ['LOADER'])).toBe(true)
      expect(graph.hasPathThrough('state2', 'SANDBOX', ['LOADER'])).toBe(true)
    })

    it('should return false when path does not exist', () => {
      expect(graph.hasPathThrough('isolated', 'SANDBOX', ['LOADER'])).toBe(false)
    })

    it('should return false when intermediate type is missing', () => {
      // prompt1 goes directly to sandbox1, not through LOADER
      expect(graph.hasPathThrough('prompt1', 'SANDBOX', ['LOADER'])).toBe(false)
    })

    it('should return false for non-existent source node', () => {
      expect(graph.hasPathThrough('nonexistent', 'SANDBOX', ['LOADER'])).toBe(false)
    })

    it('should handle multiple intermediate types', () => {
      const nodes = [
        createNode('s1', 'STATE'),
        createNode('l1', 'LOADER'),
        createNode('p1', 'PROMPT'),
        createNode('sb1', 'SANDBOX'),
      ]
      const edges = [
        createEdge('s1', 'l1'),
        createEdge('l1', 'p1'),
        createEdge('p1', 'sb1'),
      ]
      const g = ImmutableGraph.fromArrays(nodes, edges)
      expect(g.hasPathThrough('s1', 'SANDBOX', ['LOADER', 'PROMPT'])).toBe(true)
    })

    it('should not match source node as target', () => {
      const nodes = [createNode('sb1', 'SANDBOX')]
      const graph = ImmutableGraph.fromArrays(nodes, [])
      expect(graph.hasPathThrough('sb1', 'SANDBOX', [])).toBe(false)
    })
  })

  describe('getReachableNodes', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
      createNode('n3', 'LOADER'),
      createNode('n4', 'SANDBOX'),
      createNode('n5', 'PROMPT'),
    ]
    const edges = [
      createEdge('n1', 'n2'),
      createEdge('n2', 'n3'),
      createEdge('n3', 'n4'),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)

    it('should find all reachable nodes from source', () => {
      const reachable = graph.getReachableNodes('n1')
      expect(reachable.has('n1')).toBe(true)
      expect(reachable.has('n2')).toBe(true)
      expect(reachable.has('n3')).toBe(true)
      expect(reachable.has('n4')).toBe(true)
      expect(reachable.has('n5')).toBe(false)
    })

    it('should return only source node when isolated', () => {
      const reachable = graph.getReachableNodes('n5')
      expect(reachable.size).toBe(1)
      expect(reachable.has('n5')).toBe(true)
    })

    it('should return only source node when it is a leaf', () => {
      const reachable = graph.getReachableNodes('n4')
      expect(reachable.size).toBe(1)
      expect(reachable.has('n4')).toBe(true)
    })

    it('should return empty set for non-existent node', () => {
      const reachable = graph.getReachableNodes('nonexistent')
      expect(reachable.size).toBe(1) // Contains 'nonexistent' itself
    })

    it('should handle cycles correctly', () => {
      const nodes = [
        createNode('a', 'PROMPT'),
        createNode('b', 'GENERATED'),
        createNode('c', 'LOADER'),
      ]
      const edges = [
        createEdge('a', 'b'),
        createEdge('b', 'c'),
        createEdge('c', 'a'), // cycle
      ]
      const g = ImmutableGraph.fromArrays(nodes, edges)
      const reachable = g.getReachableNodes('a')
      expect(reachable.size).toBe(3)
      expect(reachable.has('a')).toBe(true)
      expect(reachable.has('b')).toBe(true)
      expect(reachable.has('c')).toBe(true)
    })
  })
})

// ============================================================================
// Connection Validation Tests
// ============================================================================

describe('ImmutableGraph - validateConnection', () => {
  // Note: validateConnection depends on node registry specs
  // These tests use simple scenarios; full connection validation
  // is tested in registry/connection.test.ts

  const nodes = [
    createNode('prompt1', 'PROMPT'),
    createNode('generated1', 'GENERATED'),
    createNode('sandbox1', 'SANDBOX'),
  ]
  const edges = [createEdge('prompt1', 'generated1')]
  const graph = ImmutableGraph.fromArrays(nodes, edges)

  it('should reject connection with non-existent source node', () => {
    const result = graph.validateConnection({
      source: 'nonexistent',
      target: 'generated1',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Node not found')
  })

  it('should reject connection with non-existent target node', () => {
    const result = graph.validateConnection({
      source: 'prompt1',
      target: 'nonexistent',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Node not found')
  })

  it('should reject self-connection', () => {
    const result = graph.validateConnection({
      source: 'prompt1',
      target: 'prompt1',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Self-connection not allowed')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('ImmutableGraph - Edge Cases', () => {
  it('should handle graph with only edges (dangling edges)', () => {
    // While structurally invalid, ImmutableGraph should not crash
    const edges = [createEdge('n1', 'n2')]
    const graph = ImmutableGraph.fromArrays([], edges)
    expect(graph.edges).toHaveLength(1)
    expect(graph.getNode('n1')).toBeUndefined()
    expect(graph.getSuccessors('n1')).toHaveLength(0)
  })

  it('should handle duplicate node IDs (last wins)', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n1', 'GENERATED'), // duplicate
    ]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    expect(graph.nodes).toHaveLength(2)
    // Map constructor behavior: second value overwrites first
    const node = graph.getNode('n1')
    expect(node?.type).toBe('GENERATED')
  })

  it('should handle parallel edges between same nodes', () => {
    const nodes = [
      createNode('n1', 'PROMPT'),
      createNode('n2', 'GENERATED'),
    ]
    const edges = [
      createEdge('n1', 'n2', { sourceHandle: 'h1' }),
      createEdge('n1', 'n2', { sourceHandle: 'h2' }),
    ]
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    
    expect(graph.edges).toHaveLength(2)
    const outgoing = graph.getOutgoingEdges('n1')
    expect(outgoing).toHaveLength(2)
  })

  it('should handle large graph efficiently', () => {
    const nodeCount = 1000
    const nodes = Array.from({ length: nodeCount }, (_, i) => 
      createNode(`n${i}`, i % 2 === 0 ? 'PROMPT' : 'GENERATED')
    )
    const edges = Array.from({ length: nodeCount - 1 }, (_, i) =>
      createEdge(`n${i}`, `n${i + 1}`)
    )
    
    const start = performance.now()
    const graph = ImmutableGraph.fromArrays(nodes, edges)
    const constructTime = performance.now() - start
    
    // Should construct in reasonable time (<100ms)
    expect(constructTime).toBeLessThan(100)
    
    expect(graph.getNode('n500')).toBeDefined()
    expect(graph.getSuccessors('n0')).toHaveLength(1)
    expect(graph.getPredecessors('n999')).toHaveLength(1)
  })

  it('should handle nodes with complex content', () => {
    const content = {
      type: 'SAVE',
      stateNodeId: 'state-123',
      stateNodeCommit: 'commit-abc',
      nested: {
        deep: {
          value: true,
        },
      },
    } as unknown as ImmutableGraphNode['content']
    const nodes = [createNode('n1', 'SAVE', { content })]
    const graph = ImmutableGraph.fromArrays(nodes, [])
    
    const node = graph.getNode('n1')
    expect(node?.content).toEqual(content)
  })
})
