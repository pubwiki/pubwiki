import type {
  CreateArtifactNode,
  ArtifactEdgeDescriptor,
  CreateArtifactMetadata,
} from '@pubwiki/api';
import type { NodeType } from '../schema/enums';
import type { ServiceResult } from '../services/user';
import type { BatchContext } from '../batch-context';
import { eq } from 'drizzle-orm';
import { artifactVersionNodes, artifactVersionEdges } from '../schema/artifact-version-graph';
import { NodeVersionService } from '../services/node-version';

// ============================================================================
// Types
// ============================================================================

export type NodeGraphNode = CreateArtifactNode;
export type NodeGraphEdge = ArtifactEdgeDescriptor;

/**
 * Patch input for building a NodeGraph from a base commit with modifications.
 * 
 * Note: removeEdges only needs { source, target } because the DB schema
 * uses (commitHash, sourceNodeId, targetNodeId) as primary key.
 * Two nodes can have at most one edge between them.
 */
export interface NodeGraphPatch {
  addNodes?: NodeGraphNode[];
  removeNodeIds?: string[];
  addEdges?: NodeGraphEdge[];
  removeEdges?: NodeGraphEdge[];
}

// ============================================================================
// NodeGraph Class
// ============================================================================

/**
 * NodeGraph is an immutable abstraction for artifact graph structure.
 * It provides:
 * - Single source of truth for all graph queries and validations
 * - Pure validation methods without side effects
 * - Reusable logic for both createArtifact and patchArtifact
 */
export class NodeGraph {
  private readonly nodeMap: Map<string, NodeGraphNode>;
  private readonly nodesByType: Map<NodeType, NodeGraphNode[]>;
  private readonly outgoingEdges: Map<string, NodeGraphEdge[]>;
  private readonly incomingEdges: Map<string, NodeGraphEdge[]>;
  private readonly edgeSet: Set<string>;
  private readonly _nodes: readonly NodeGraphNode[];
  private readonly _edges: readonly NodeGraphEdge[];

  // ============================================================================
  // Construction (private - use static factory methods)
  // ============================================================================

  private constructor(nodes: NodeGraphNode[], edges: NodeGraphEdge[]) {
    this._nodes = Object.freeze([...nodes]);
    this._edges = Object.freeze([...edges]);
    
    // Build node index
    this.nodeMap = new Map(nodes.map(n => [n.nodeId, n]));
    
    // Build type index
    this.nodesByType = new Map();
    for (const node of nodes) {
      const type = node.type as NodeType;
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
   * Create from raw arrays (for createArtifact)
   */
  static fromArrays(nodes: NodeGraphNode[], edges: NodeGraphEdge[]): NodeGraph {
    return new NodeGraph(nodes, edges);
  }

  /**
   * Create from DB snapshot + patches (for patchArtifact)
   * This encapsulates the merge logic previously in patchArtifact
   */
  static async fromPatch(
    ctx: BatchContext,
    baseCommitHash: string,
    patch: NodeGraphPatch,
  ): Promise<ServiceResult<NodeGraph>> {
    // Fetch base nodes from DB
    const baseNodes = await ctx
      .select()
      .from(artifactVersionNodes)
      .where(eq(artifactVersionNodes.commitHash, baseCommitHash));

    // Fetch base edges from DB
    const baseEdges = await ctx
      .select()
      .from(artifactVersionEdges)
      .where(eq(artifactVersionEdges.commitHash, baseCommitHash));

    // Build sets for patches
    const removeNodeIds = new Set(patch.removeNodeIds ?? []);
    const addNodesMap = new Map<string, NodeGraphNode>();
    for (const node of patch.addNodes ?? []) {
      addNodesMap.set(node.nodeId, node);
    }

    // Build merged nodes
    const mergedNodes: NodeGraphNode[] = [];
    const nodeVersionService = new NodeVersionService(ctx);

    for (const bn of baseNodes) {
      if (removeNodeIds.has(bn.nodeId)) continue;

      if (addNodesMap.has(bn.nodeId)) {
        // Updated node: use patch data
        mergedNodes.push(addNodesMap.get(bn.nodeId)!);
        addNodesMap.delete(bn.nodeId);
      } else {
        // Unchanged node: fetch full data from node versions
        const versionDetail = await nodeVersionService.getVersion(bn.nodeCommit);
        if (!versionDetail.success) {
          return {
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: `Failed to get node version: ${bn.nodeId}@${bn.nodeCommit}`,
            },
          };
        }
        const v = versionDetail.data;
        mergedNodes.push({
          nodeId: bn.nodeId,
          commit: bn.nodeCommit,
          type: v.type as NodeType,
          name: v.name ?? undefined,
          contentHash: v.contentHash,
          content: v.content!,
          position: bn.positionX != null && bn.positionY != null
            ? { x: bn.positionX, y: bn.positionY }
            : undefined,
        });
      }
    }

    // Add new nodes (not in base)
    for (const [, node] of addNodesMap) {
      mergedNodes.push(node);
    }

    // Build merged edges
    const removeEdgeKeys = new Set(
      (patch.removeEdges ?? []).map(e => `${e.source}:${e.target}`)
    );

    const mergedEdges: NodeGraphEdge[] = [];
    for (const be of baseEdges) {
      const key = `${be.sourceNodeId}:${be.targetNodeId}`;
      if (removeEdgeKeys.has(key)) continue;
      mergedEdges.push({
        source: be.sourceNodeId,
        target: be.targetNodeId,
        sourceHandle: be.sourceHandle ?? undefined,
        targetHandle: be.targetHandle ?? undefined,
      });
    }
    for (const edge of patch.addEdges ?? []) {
      mergedEdges.push(edge);
    }

    return {
      success: true,
      data: new NodeGraph(mergedNodes, mergedEdges),
    };
  }

  /**
   * Create from an existing commit hash (for metadata-only validation)
   */
  static async fromCommitHash(
    ctx: BatchContext,
    commitHash: string,
  ): Promise<ServiceResult<NodeGraph>> {
    return NodeGraph.fromPatch(ctx, commitHash, {});
  }

  // ============================================================================
  // Accessors
  // ============================================================================

  /** All nodes in the graph */
  get nodes(): readonly NodeGraphNode[] {
    return this._nodes;
  }

  /** All edges in the graph */
  get edges(): readonly NodeGraphEdge[] {
    return this._edges;
  }

  /** Get node by ID, returns undefined if not found */
  getNode(nodeId: string): NodeGraphNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  /** Get all nodes of a specific type */
  getNodesByType(type: NodeType): NodeGraphNode[] {
    return this.nodesByType.get(type) ?? [];
  }

  /** Get outgoing edges from a node */
  getOutgoingEdges(nodeId: string): NodeGraphEdge[] {
    return this.outgoingEdges.get(nodeId) ?? [];
  }

  /** Get incoming edges to a node */
  getIncomingEdges(nodeId: string): NodeGraphEdge[] {
    return this.incomingEdges.get(nodeId) ?? [];
  }

  /** Get direct successors of a node */
  getSuccessors(nodeId: string): NodeGraphNode[] {
    const edges = this.getOutgoingEdges(nodeId);
    const successors: NodeGraphNode[] = [];
    for (const edge of edges) {
      const node = this.getNode(edge.target);
      if (node) successors.push(node);
    }
    return successors;
  }

  /** Get direct predecessors of a node */
  getPredecessors(nodeId: string): NodeGraphNode[] {
    const edges = this.getIncomingEdges(nodeId);
    const predecessors: NodeGraphNode[] = [];
    for (const edge of edges) {
      const node = this.getNode(edge.source);
      if (node) predecessors.push(node);
    }
    return predecessors;
  }

  // ============================================================================
  // Structural Validation
  // ============================================================================

  /**
   * Validate basic graph structure:
   * - All edge endpoints reference existing nodes
   * - No duplicate edges
   */
  validateStructure(): ServiceResult<void> {
    // Check for duplicate edges (already detected during construction)
    const seenEdges = new Set<string>();
    for (const edge of this._edges) {
      const key = this.edgeKey(edge.source, edge.target);
      if (seenEdges.has(key)) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Duplicate edge detected: ${edge.source} -> ${edge.target}`,
          },
        };
      }
      seenEdges.add(key);
    }

    // Check edge endpoints exist
    for (const edge of this._edges) {
      if (!this.nodeMap.has(edge.source)) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Edge source node ${edge.source} does not exist in the graph`,
          },
        };
      }
      if (!this.nodeMap.has(edge.target)) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Edge target node ${edge.target} does not exist in the graph`,
          },
        };
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Validate SAVE nodes:
   * - Each SAVE references a STATE node present in graph
   * - stateNodeCommit matches STATE node's commit
   * - STATE → LOADER → SANDBOX connectivity
   */
  validateSaveNodes(): ServiceResult<void> {
    const saveNodes = this.getNodesByType('SAVE');

    if (saveNodes.length === 0) {
      return { success: true, data: undefined };
    }

    // Build state node map: stateNodeId -> commit
    const stateNodeMap = new Map<string, string>();
    for (const node of this.getNodesByType('STATE')) {
      stateNodeMap.set(node.nodeId, node.commit);
    }

    // Cache for graph connectivity validation results
    const connectivityCache = new Map<string, boolean>();

    for (const saveNode of saveNodes) {
      // SAVE node content must have stateNodeId and stateNodeCommit
      const saveContent = saveNode.content as {
        type: 'SAVE';
        stateNodeId: string;
        stateNodeCommit: string;
      };

      if (!saveContent?.stateNodeId) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `SAVE node ${saveNode.nodeId} missing stateNodeId in content`,
          },
        };
      }

      if (!saveContent?.stateNodeCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `SAVE node ${saveNode.nodeId} missing stateNodeCommit in content`,
          },
        };
      }

      const stateNodeId = saveContent.stateNodeId;
      const expectedStateNodeCommit = stateNodeMap.get(stateNodeId);

      // STATE node must be present in the same artifact version's nodes
      if (!expectedStateNodeCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `SAVE node ${saveNode.nodeId} references state node ${stateNodeId} which is not present in this artifact version`,
          },
        };
      }

      // Validate stateNodeCommit matches
      if (saveContent.stateNodeCommit !== expectedStateNodeCommit) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `SAVE node ${saveNode.nodeId} has stateNodeCommit ${saveContent.stateNodeCommit} but STATE node ${stateNodeId} has commit ${expectedStateNodeCommit}`,
          },
        };
      }

      // Validate graph connectivity: STATE → LOADER → SANDBOX (with caching)
      let hasValidPath = connectivityCache.get(stateNodeId);
      if (hasValidPath === undefined) {
        hasValidPath = this.hasPathThrough(stateNodeId, 'SANDBOX', ['LOADER']);
        connectivityCache.set(stateNodeId, hasValidPath);
      }
      if (!hasValidPath) {
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Save validation failed: state node ${stateNodeId} is not connected to a SANDBOX node through a LOADER node`,
          },
        };
      }
    }

    return { success: true, data: undefined };
  }

  /**
   * Validate entrypoint configuration:
   * - sandboxNodeId exists and is SANDBOX type
   * - saveCommit exists as a SAVE node
   * - Referenced STATE is in the graph
   */
  validateEntrypoint(
    entrypoint: CreateArtifactMetadata['entrypoint'],
  ): ServiceResult<void> {
    if (!entrypoint) {
      return { success: true, data: undefined };
    }

    const { saveCommit, sandboxNodeId } = entrypoint;

    // Verify sandboxNodeId exists and is SANDBOX type
    const sandboxNode = this.getNode(sandboxNodeId);
    if (!sandboxNode) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not in the graph`,
        },
      };
    }
    if (sandboxNode.type !== 'SANDBOX') {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not a SANDBOX node (got ${sandboxNode.type})`,
        },
      };
    }

    // Verify saveCommit is in the SAVE nodes
    const saveNode = this.getNodesByType('SAVE').find(n => n.commit === saveCommit);
    if (!saveNode) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Entrypoint saveCommit ${saveCommit} is not found in the SAVE nodes`,
        },
      };
    }

    // Verify the save references a STATE node in this artifact
    const saveContent = saveNode.content as { type: 'SAVE'; stateNodeId: string };
    const stateNodeIds = new Set(this.getNodesByType('STATE').map(n => n.nodeId));
    if (!stateNodeIds.has(saveContent.stateNodeId)) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Entrypoint save references state node ${saveContent.stateNodeId} which is not in the graph`,
        },
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Run all validations
   */
  validate(
    entrypoint?: CreateArtifactMetadata['entrypoint'],
  ): ServiceResult<void> {
    // Validate basic structure first
    const structureResult = this.validateStructure();
    if (!structureResult.success) return structureResult;

    // Validate SAVE nodes
    const saveResult = this.validateSaveNodes();
    if (!saveResult.success) return saveResult;

    // Validate entrypoint
    const entrypointResult = this.validateEntrypoint(entrypoint);
    if (!entrypointResult.success) return entrypointResult;

    return { success: true, data: undefined };
  }

  // ============================================================================
  // Graph Queries (for connectivity validation)
  // ============================================================================

  /**
   * Check if there's a path from source to target through nodes of specified types
   * Used for STATE → LOADER → SANDBOX connectivity check
   */
  hasPathThrough(
    sourceNodeId: string,
    targetType: NodeType,
    intermediateTypes: NodeType[],
  ): boolean {
    const visited = new Set<string>();
    const queue: { nodeId: string; depth: number }[] = [{ nodeId: sourceNodeId, depth: 0 }];
    const intermediateTypeSet = new Set(intermediateTypes);

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.getNode(nodeId);
      if (!node) continue;

      // If we've passed through intermediate types and found target type
      if (depth > 0 && node.type === targetType) {
        return true;
      }

      // Continue search through intermediate type nodes
      if (depth === 0 || intermediateTypeSet.has(node.type as NodeType)) {
        for (const successor of this.getSuccessors(nodeId)) {
          if (!visited.has(successor.nodeId)) {
            queue.push({ nodeId: successor.nodeId, depth: depth + 1 });
          }
        }
      }
    }

    return false;
  }

  /**
   * Find all nodes reachable from a given node via outgoing edges
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
}
