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
 * Must match SaveNodeContent from OpenAPI schema exactly.
 */
export interface SaveContent {
  type: 'SAVE';
  stateNodeId: string;
  artifactId: string;
  artifactCommit: string;
  quadsHash: string;
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
  // Strip null values before canonicalization — DB nullable columns produce
  // null for absent optional fields, but the original content omitted them.
  // Including null would change the canonical JSON and produce a different hash.
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value != null) stripped[key] = value;
  }
  const payload = canonicalize(stripped);
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

// ─── Build Cache Key ────────────────────────────────────────────────

/**
 * Compute a build cache key from VFS filesHash and build configuration.
 *
 * Uses RFC 8785 JCS (via `canonicalize`) for deterministic serialization,
 * consistent with all other hash functions in this module.
 *
 * The key is deterministic: same source + same config = same key.
 * This enables content-addressable deduplication across artifacts sharing VFS.
 *
 * @param params.filesHash    - SHA-256 hex of the VFS archive.
 * @param params.entryFiles   - Entry file paths (will be sorted internally).
 * @param params.buildTarget  - esbuild target (default: 'es2020').
 * @param params.jsx          - JSX transform mode (default: 'automatic').
 * @param params.jsxImportSource - JSX import source (default: 'react').
 * @param params.minify       - Whether to minify output (default: false).
 * @returns 64-char hex string (full SHA-256).
 *
 * **Stability contract**: The default values below are baked into the cache
 * key, so they MUST stay in sync with `BundlerService.build()` defaults.
 * If either side changes a default without the other, the same source code
 * will produce a different cacheKey and miss the existing cache.
 *
 * **Default divergence risk**: `computeBuildCacheKey` defaults
 * (target: 'es2020', jsx: 'automatic', jsxImportSource: 'react', minify: false)
 * are duplicated literals — not imported from a shared config.
 * If `BundlerService` changes its build defaults, this function must be
 * updated in lockstep or cache hits will silently break.
 */
export async function computeBuildCacheKey(params: {
  filesHash: string;
  entryFiles: string[];
  buildTarget?: string;
  jsx?: string;
  jsxImportSource?: string;
  minify?: boolean;
}): Promise<string> {
  const normalized = {
    filesHash: params.filesHash,
    entryFiles: [...params.entryFiles].sort(),
    target: params.buildTarget ?? 'es2020',
    jsx: params.jsx ?? 'automatic',
    jsxImportSource: params.jsxImportSource ?? 'react',
    minify: params.minify ?? false,
  };
  const payload = canonicalize(normalized);
  return sha256Hex(payload);
}

/**
 * Compute config key — SHA-256 of build config WITHOUT filesHash.
 *
 * Used by BuildCacheStorage.resolve() to match builds with the same
 * config but different file contents. Two builds with the same configKey
 * are guaranteed to use the same entry files, target, jsx settings, etc.
 */
export async function computeConfigKey(params: {
  entryFiles: string[];
  buildTarget?: string;
  jsx?: string;
  jsxImportSource?: string;
  minify?: boolean;
}): Promise<string> {
  const normalized = {
    entryFiles: [...params.entryFiles].sort(),
    target: params.buildTarget ?? 'es2020',
    jsx: params.jsx ?? 'automatic',
    jsxImportSource: params.jsxImportSource ?? 'react',
    minify: params.minify ?? false,
  };
  const payload = canonicalize(normalized);
  return sha256Hex(payload);
}
