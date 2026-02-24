/**
 * NodeGraph Factory
 * 
 * DB-specific factory methods for creating ImmutableGraph instances.
 * The graph structure and validation logic is now in @pubwiki/flow-core.
 * 
 * This module provides:
 * - DB-integrated factory methods (fromPatch, fromCommitHash)
 * - Re-exports of ImmutableGraph and validation functions
 */

import type {
  CreateArtifactNode,
  ArtifactEdgeDescriptor,
} from '@pubwiki/api';
import type { NodeType } from '../schema/enums';
import type { ServiceResult } from '../services/user';
import type { BatchContext } from '../batch-context';
import { eq } from 'drizzle-orm';
import { artifactVersionNodes, artifactVersionEdges } from '../schema/artifact-version-graph';
import { NodeVersionService } from '../services/node-version';
import {
  ImmutableGraph,
  validateGraph,
  validateStructure,
  validateSaveNodes,
  validateEntrypoint,
  type ImmutableGraphNode,
  type ImmutableGraphEdge,
  type GraphValidationResult,
  type EntrypointConfig,
} from '@pubwiki/flow-core';

// ============================================================================
// Re-exports from @pubwiki/flow-core
// ============================================================================

export {
  ImmutableGraph,
  validateGraph,
  validateStructure,
  validateSaveNodes,
  validateEntrypoint,
};
export type {
  ImmutableGraphNode,
  ImmutableGraphEdge,
  GraphValidationResult,
  EntrypointConfig,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Patch input for building an ImmutableGraph from a base commit with modifications.
 * 
 * Note: removeEdges only needs { source, target } because the DB schema
 * uses (commitHash, sourceNodeId, targetNodeId) as primary key.
 * Two nodes can have at most one edge between them.
 */
export interface NodeGraphPatch {
  addNodes?: CreateArtifactNode[];
  removeNodeIds?: string[];
  addEdges?: ArtifactEdgeDescriptor[];
  removeEdges?: ArtifactEdgeDescriptor[];
}

// ============================================================================
// NodeGraphFactory - DB-specific factory methods
// ============================================================================

/**
 * Factory for creating ImmutableGraph instances from database data.
 * 
 * Use this factory when you need to:
 * - Create a graph from existing artifact version data (fromCommitHash)
 * - Apply patches to an existing artifact version (fromPatch)
 * 
 * For direct construction from arrays, use ImmutableGraph.fromArrays() directly.
 */
export class NodeGraphFactory {
  /**
   * Create from raw arrays (convenience method - delegates to ImmutableGraph)
   */
  static fromArrays(
    nodes: CreateArtifactNode[],
    edges: ArtifactEdgeDescriptor[]
  ): ImmutableGraph {
    return ImmutableGraph.fromArrays(nodes, edges);
  }

  /**
   * Create from DB snapshot + patches (for patchArtifact)
   * This encapsulates the merge logic for artifact version patching.
   */
  static async fromPatch(
    ctx: BatchContext,
    baseCommitHash: string,
    patch: NodeGraphPatch,
  ): Promise<ServiceResult<ImmutableGraph>> {
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
    const addNodesMap = new Map<string, CreateArtifactNode>();
    for (const node of patch.addNodes ?? []) {
      addNodesMap.set(node.nodeId, node);
    }

    // Build merged nodes
    const mergedNodes: CreateArtifactNode[] = [];
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

    const mergedEdges: ArtifactEdgeDescriptor[] = [];
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
      data: ImmutableGraph.fromArrays(mergedNodes, mergedEdges),
    };
  }

  /**
   * Create from an existing commit hash (for metadata-only validation)
   */
  static async fromCommitHash(
    ctx: BatchContext,
    commitHash: string,
  ): Promise<ServiceResult<ImmutableGraph>> {
    return NodeGraphFactory.fromPatch(ctx, commitHash, {});
  }
}
