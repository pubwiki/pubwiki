/**
 * Shared deterministic hash utilities for pubwiki.
 *
 * These functions are the **single source of truth** for computing
 * commit hashes and identifiers. Both client and server MUST use them
 * to guarantee consistency.
 *
 * All functions use RFC 8785 JSON Canonicalization Scheme (JCS) via
 * `json-canonicalize` to produce deterministic serialization, then
 * SHA-256 to derive a hex digest.
 */
import { canonicalize } from 'json-canonicalize';
import type { components } from './generated/openapi';

/** 
 * ArtifactNodeContent type from OpenAPI schema.
 * This is the strongly-typed union of all possible node content structures.
 */
export type ArtifactNodeContent = components['schemas']['ArtifactNodeContent'];

/**
 * SaveContent type for SAVE node content hash calculation.
 * Save is independent from ArtifactNodeContent in the API layer.
 */
export interface SaveContent {
  type: 'SAVE';
  stateNodeId: string;
  stateNodeCommit: string;
  sourceArtifactCommit: string;
  title: string | null | undefined;
  description: string | null | undefined;
}

// ─── Hash Utilities ─────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of binary data (ArrayBuffer) and return as hex string.
 * Used for verifying uploaded files against client-provided hashes.
 * 
 * This is the **single source of truth** for binary content hash calculation.
 * Both frontend and backend MUST use this function to guarantee consistency.
 */
export async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Internal helper for string hashing (used by content hash functions)
async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  return computeSha256Hex(encoded.buffer as ArrayBuffer);
}

// ─── Content Hash ───────────────────────────────────────────────────

/**
 * Compute content hash for a node.
 * 
 * IMPORTANT: This is the **single source of truth** for contentHash calculation.
 * Both frontend and backend MUST use this function to guarantee consistency.
 * 
 * Uses RFC 8785 JSON Canonicalization Scheme (JCS) for deterministic serialization.
 * 
 * @param content - Node content object (ArtifactNodeContent or SaveContent)
 * @returns 64-char hex string (full SHA-256)
 */
export async function computeContentHash(content: ArtifactNodeContent | SaveContent): Promise<string> {
  const payload = canonicalize(content);
  return sha256Hex(payload);
}

// ─── Node Version Commit ────────────────────────────────────────────

/**
 * Compute a deterministic, **globally unique** commit hash for a node version.
 *
 * Algorithm: `SHA-256(canonicalize({ nodeId, parent, contentHash, type }))` → full 64-char hex.
 *
 * Including `nodeId` and `parent` in the preimage ensures global uniqueness:
 * - Different nodes always produce different commits (different `nodeId`).
 * - Same node + same content but different history produces different commits (different `parent`).
 *
 * @param nodeId      - The node identifier (UUID).
 * @param parent      - Parent commit hash, or `null` for root versions.
 * @param contentHash - Content hash referencing the typed content table.
 * @param type        - Node type (INPUT, PROMPT, GENERATED, VFS, SANDBOX, LOADER, STATE, SAVE).
 * @returns 64-char hex string (full SHA-256).
 */
export async function computeNodeCommit(
  nodeId: string,
  parent: string | null,
  contentHash: string,
  type: string,
): Promise<string> {
  const payload = canonicalize({ nodeId, parent, contentHash, type });
  return sha256Hex(payload);
}

// ─── Artifact Version Commit ────────────────────────────────────────

export interface ArtifactCommitNode {
  nodeId: string;
  commit: string;
}

export interface ArtifactCommitEdge {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

/**
 * Compute a deterministic commit hash for an artifact version (chain structure).
 *
 * Algorithm: `SHA-256(canonicalize({ artifactId, parentCommit, nodes (sorted), edges (sorted) }))` → full 64-char hex.
 *
 * Including `artifactId` and `parentCommit` ensures global uniqueness:
 * - Different artifacts with identical content → different hash.
 * - Same artifact, same content, different history → different hash.
 *
 * @param artifactId   - The artifact identifier (UUID).
 * @param parentCommit - Previous version's commit hash, or `null` for the first version.
 * @param nodes        - Array of `{ nodeId, commit }` describing node references in this version.
 * @param edges        - Array of edge descriptors.
 * @returns 64-char hex string (full SHA-256).
 */
export async function computeArtifactCommit(
  artifactId: string,
  parentCommit: string | null,
  nodes: ArtifactCommitNode[],
  edges: ArtifactCommitEdge[],
): Promise<string> {
  const sortedNodes = [...nodes]
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    .map(n => ({ nodeId: n.nodeId, commit: n.commit }));
  const sortedEdges = [...edges]
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }));

  const payload = canonicalize({ artifactId, parentCommit, nodes: sortedNodes, edges: sortedEdges });
  return sha256Hex(payload);
}

