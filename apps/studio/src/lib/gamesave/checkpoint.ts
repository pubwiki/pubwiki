/**
 * Save Checkpoint Service
 * 
 * Manages save checkpoints using the new save API:
 * - POST /saves - Create save with quads.bin data
 * - GET /saves - List saves by stateNodeId + stateNodeCommit
 * - GET /saves/{commit} - Get save details
 * - GET /saves/{commit}/data - Download save data
 * - DELETE /saves/{commit} - Delete save
 * 
 * Save commit is globally unique and computed via computeNodeCommit(saveId, parent, contentHash, 'SAVE').
 * contentHash is computed via computeContentHash(saveContent) from the SAVE metadata object.
 */

import type { RDFStore } from '@pubwiki/rdfstore';
import { fromRdfQuad, toRdfQuad } from '@pubwiki/rdfstore';
import type { SaveDetail } from '@pubwiki/api';
import { computeContentHash, computeNodeCommit } from '@pubwiki/api';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';

// Create a singleton API client
const apiClient = createApiClient(API_BASE_URL);

/**
 * Options for creating a save checkpoint
 */
export interface CreateSaveOptions {
  /** STATE node ID */
  stateNodeId: string;
  /** STATE node commit hash */
  stateNodeCommit: string;
  /** Parent save commit (optional) */
  parent?: string | null;
  /** Artifact ID */
  artifactId: string;
  /** Artifact commit hash */
  artifactCommit: string;
  /** Save node ID (client-generated UUID, auto-generated if omitted) */
  saveId?: string;
  /** Save title */
  title?: string;
  /** Save description */
  description?: string;
  /** Whether save is listed in public lists */
  isListed?: boolean;
}

/**
 * Result of creating a save
 */
export interface CreateSaveResult {
  success: boolean;
  save?: SaveDetail;
  error?: string;
}

/**
 * Create a save checkpoint by uploading RDF quads to the backend.
 * 
 * @param store - The local RDF store
 * @param options - Save options
 * @returns Create result
 */
export async function createSaveCheckpoint(
  store: RDFStore,
  options: CreateSaveOptions
): Promise<CreateSaveResult> {
  try {
    const saveId = options.saveId ?? crypto.randomUUID();

    // 1. Export current state as RDF quads
    const rdfQuads = await store.getAllQuads();
    
    // 2. Serialize quads to binary format
    const quadsJson = JSON.stringify(rdfQuads.map(fromRdfQuad));
    const quadsData = new TextEncoder().encode(quadsJson);

    // 3. Compute quadsHash (SHA-256 of the binary data)
    const quadsHashBuffer = await crypto.subtle.digest('SHA-256', quadsData);
    const quadsHash = Array.from(new Uint8Array(quadsHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    // 4. Build the SAVE content object (must match server-side SaveNodeContent exactly)
    const saveContent = {
      type: 'SAVE' as const,
      stateNodeId: options.stateNodeId,
      stateNodeCommit: options.stateNodeCommit,
      artifactId: options.artifactId,
      artifactCommit: options.artifactCommit,
      quadsHash,
      title: options.title ?? null,
      description: options.description ?? null,
    };

    // 5. Compute contentHash and commit using the same algorithms as the backend
    const contentHash = await computeContentHash(saveContent);
    const commit = await computeNodeCommit(saveId, options.parent ?? null, contentHash, 'SAVE');

    // 6. Create FormData for multipart upload
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({
      saveId,
      stateNodeId: options.stateNodeId,
      stateNodeCommit: options.stateNodeCommit,
      commit,
      parent: options.parent ?? null,
      artifactId: options.artifactId,
      artifactCommit: options.artifactCommit,
      contentHash,
      quadsHash,
      title: options.title,
      description: options.description,
      isListed: options.isListed ?? false
    }));
    formData.append('data', new Blob([quadsData], { type: 'application/octet-stream' }));

    // 7. POST to /saves
    const response = await fetch(`${API_BASE_URL}/saves`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `创建存档失败: ${response.status}`
      };
    }

    const save: SaveDetail = await response.json();
    return { success: true, save };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '创建存档失败'
    };
  }
}

/**
 * Restore save data from the backend into local RDF store.
 * 
 * @param store - The local RDF store
 * @param commit - The save commit hash
 * @returns Whether restore was successful
 */
export async function restoreFromSave(
  store: RDFStore,
  commit: string
): Promise<boolean> {
  try {
    // Download save data
    const response = await fetch(`${API_BASE_URL}/saves/${commit}/data`, {
      credentials: 'include'
    });

    if (!response.ok) {
      return false;
    }

    // Parse quads from response
    const quadsJson = await response.text();
    const apiQuads = JSON.parse(quadsJson);
    const rdfQuads = apiQuads.map(toRdfQuad);

    // Replace local store contents
    await store.clear();
    await store.batchInsert(rdfQuads);

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch saves for a STATE node version.
 * 
 * @param stateNodeId - The STATE node ID
 * @param stateNodeCommit - The STATE node commit hash
 * @returns List of saves
 */
export async function fetchSaves(
  stateNodeId: string,
  stateNodeCommit: string
): Promise<SaveDetail[]> {
  try {
    const { data, error } = await apiClient.GET('/saves', {
      params: {
        query: { stateNodeId, stateNodeCommit }
      }
    });

    if (error || !data) {
      return [];
    }

    return data.saves ?? [];
  } catch {
    return [];
  }
}

/**
 * Get save details by commit.
 * 
 * @param commit - The save commit hash
 * @returns Save details or null if not found
 */
export async function getSave(commit: string): Promise<SaveDetail | null> {
  try {
    const { data, error } = await apiClient.GET('/saves/{commit}', {
      params: { path: { commit } }
    });

    if (error || !data) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Delete a save by commit.
 * 
 * @param commit - The save commit hash
 */
export async function deleteSave(commit: string): Promise<void> {
  const { error } = await apiClient.DELETE('/saves/{commit}', {
    params: { path: { commit } }
  });

  if (error) {
    throw new Error(error.error || '删除存档失败');
  }
}

/**
 * @deprecated computeSaveCommit is no longer needed. createSaveCheckpoint now
 * computes contentHash and commit internally using computeContentHash/computeNodeCommit.
 */
