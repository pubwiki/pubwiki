/**
 * ImmutableGraph - Immutable graph abstraction for validation
 * 
 * A read-only graph structure for validating artifact graphs.
 * Designed to be shared between frontend (pre-validation before upload)
 * and backend (validation on receive).
 * 
 * Uses API types directly since @pubwiki/flow-core depends on @pubwiki/api.
 */

import type {
  CreateArtifactNode,
  ArtifactEdgeDescriptor,
  ArtifactNodeType,
} from '@pubwiki/api';
import { validateConnection as validateConnectionFn, type ConnectionParams, type ValidationResult } from '../registry/connection';

// ============================================================================
// Type Aliases (for clarity while maintaining API type compatibility)
// ============================================================================

/**
 * Node type for ImmutableGraph - same as CreateArtifactNode from API
 */
export type ImmutableGraphNode = CreateArtifactNode;

/**
 * Edge type for ImmutableGraph - same as ArtifactEdgeDescriptor from API
 */
export type ImmutableGraphEdge = ArtifactEdgeDescriptor;

// ============================================================================
// ImmutableGraph Class
// ============================================================================

/**
 * Immutable graph abstraction for artifact graph validation.
 * 
 * Features:
 * - Read-only after construction
 * - Indexed for fast lookups
 * - Pure query methods without side effects
 * 
 * Usage:
 * ```typescript
 * const graph = ImmutableGraph.fromArrays(nodes, edges);
 * const result = validateGraph(graph, entrypoint);
 * ```
 */
export class ImmutableGraph {
  private readonly nodeMap: Map<string, ImmutableGraphNode>;
  private readonly nodesByType: Map<ArtifactNodeType, ImmutableGraphNode[]>;
  private readonly outgoingEdges: Map<string, ImmutableGraphEdge[]>;
  private readonly incomingEdges: Map<string, ImmutableGraphEdge[]>;
  private readonly edgeSet: Set<string>;
  private readonly _nodes: readonly ImmutableGraphNode[];
  private readonly _edges: readonly ImmutableGraphEdge[];

  // ============================================================================
  // Construction (private - use static factory methods)
  // ============================================================================

  private constructor(nodes: ImmutableGraphNode[], edges: ImmutableGraphEdge[]) {
    this._nodes = Object.freeze([...nodes]);
    this._edges = Object.freeze([...edges]);

    // Build node index
    this.nodeMap = new Map(nodes.map(n => [n.nodeId, n]));

    // Build type index
    this.nodesByType = new Map();
    for (const node of nodes) {
      const type = node.type;
      if (!this.nodesByType.has(type)) {
        this.nodesByType.set(type, []);
      }
      this.nodesByType.get(type)!.push(node);
    }

    // Build edge indexes
    this.outgoingEdges = new Map();
    this.incomingEdges = new Map();
    this.edgeSet = new Set();

    for (const edge of edges) {
      // Outgoing edges
      if (!this.outgoingEdges.has(edge.source)) {
        this.outgoingEdges.set(edge.source, []);
      }
      this.outgoingEdges.get(edge.source)!.push(edge);

      // Incoming edges
      if (!this.incomingEdges.has(edge.target)) {
        this.incomingEdges.set(edge.target, []);
      }
      this.incomingEdges.get(edge.target)!.push(edge);

      // Edge set for duplicate detection
      this.edgeSet.add(this.edgeKey(edge.source, edge.target));
    }
  }

  private edgeKey(source: string, target: string): string {
    return `${source}:${target}`;
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create from raw arrays
   * 
   * @param nodes - Array of nodes
   * @param edges - Array of edges
   * @returns New ImmutableGraph instance
   */
  static fromArrays(nodes: ImmutableGraphNode[], edges: ImmutableGraphEdge[]): ImmutableGraph {
    return new ImmutableGraph(nodes, edges);
  }

  // ============================================================================
  // Accessors
  // ============================================================================

  /** All nodes in the graph (read-only) */
  get nodes(): readonly ImmutableGraphNode[] {
    return this._nodes;
  }

  /** All edges in the graph (read-only) */
  get edges(): readonly ImmutableGraphEdge[] {
    return this._edges;
  }

  /** Get node by ID, returns undefined if not found */
  getNode(nodeId: string): ImmutableGraphNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  /** Get all nodes of a specific type */
  getNodesByType(type: ArtifactNodeType): ImmutableGraphNode[] {
    return this.nodesByType.get(type) ?? [];
  }

  /** Get outgoing edges from a node */
  getOutgoingEdges(nodeId: string): ImmutableGraphEdge[] {
    return this.outgoingEdges.get(nodeId) ?? [];
  }

  /** Get incoming edges to a node */
  getIncomingEdges(nodeId: string): ImmutableGraphEdge[] {
    return this.incomingEdges.get(nodeId) ?? [];
  }

  /** Get direct successors of a node */
  getSuccessors(nodeId: string): ImmutableGraphNode[] {
    const edges = this.getOutgoingEdges(nodeId);
    const successors: ImmutableGraphNode[] = [];
    for (const edge of edges) {
      const node = this.getNode(edge.target);
      if (node) successors.push(node);
    }
    return successors;
  }

  /** Get direct predecessors of a node */
  getPredecessors(nodeId: string): ImmutableGraphNode[] {
    const edges = this.getIncomingEdges(nodeId);
    const predecessors: ImmutableGraphNode[] = [];
    for (const edge of edges) {
      const node = this.getNode(edge.source);
      if (node) predecessors.push(node);
    }
    return predecessors;
  }

  // ============================================================================
  // Graph Queries
  // ============================================================================

  /**
   * Check if an edge exists from source to target
   */
  hasEdge(source: string, target: string): boolean {
    return this.edgeSet.has(this.edgeKey(source, target));
  }

  /**
   * Check if there's a path from source to target through nodes of specified types
   * Used for STATE → LOADER → SANDBOX connectivity check
   * 
   * @param sourceNodeId - Starting node ID
   * @param targetType - Type of node to find
   * @param intermediateTypes - Types that MUST be traversed (at least one)
   * @returns true if path exists through at least one intermediate type node
   */
  hasPathThrough(
    sourceNodeId: string,
    targetType: ArtifactNodeType,
    intermediateTypes: ArtifactNodeType[],
  ): boolean {
    const visited = new Set<string>();
    // Track whether we've passed through an intermediate type
    const queue: { nodeId: string; passedIntermediate: boolean }[] = [
      { nodeId: sourceNodeId, passedIntermediate: false }
    ];
    const intermediateTypeSet = new Set(intermediateTypes);

    while (queue.length > 0) {
      const { nodeId, passedIntermediate } = queue.shift()!;
      
      // Use composite key to allow revisiting with different passedIntermediate states
      const visitKey = `${nodeId}:${passedIntermediate}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const node = this.getNode(nodeId);
      if (!node) continue;

      // Check if we've hit an intermediate type
      const isIntermediate = intermediateTypeSet.has(node.type);
      const nowPassedIntermediate = passedIntermediate || isIntermediate;

      // If we've passed through intermediate types and found target type
      if (nowPassedIntermediate && node.type === targetType) {
        return true;
      }

      // Continue search: from source, only through intermediate types
      const isSource = nodeId === sourceNodeId;
      if (isSource || isIntermediate) {
        for (const successor of this.getSuccessors(nodeId)) {
          queue.push({ 
            nodeId: successor.nodeId, 
            passedIntermediate: nowPassedIntermediate 
          });
        }
      }
    }

    return false;
  }

  /**
   * Find all nodes reachable from a given node via outgoing edges
   * 
   * @param nodeId - Starting node ID
   * @returns Set of reachable node IDs (including the starting node)
   */
  getReachableNodes(nodeId: string): Set<string> {
    const reachable = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (reachable.has(currentId)) continue;
      reachable.add(currentId);

      for (const successor of this.getSuccessors(currentId)) {
        if (!reachable.has(successor.nodeId)) {
          queue.push(successor.nodeId);
        }
      }
    }

    return reachable;
  }

  // ============================================================================
  // Connection Validation
  // ============================================================================

  /**
   * Validate a proposed connection
   * 
   * Uses the graph's existing edges and node types for validation.
   * 
   * @param connection - Connection parameters (source, target, handles)
   * @returns Validation result with valid flag and optional reason
   */
  validateConnection(connection: ConnectionParams): ValidationResult {
    // Convert edges to ConnectionParams format for validation
    const existingEdges: ConnectionParams[] = this._edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

    return validateConnectionFn(
      connection,
      (nodeId) => this.getNode(nodeId)?.type,
      existingEdges
    );
  }
}
