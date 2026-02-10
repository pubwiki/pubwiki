/**
 * Artifact Context for Cloud Saves
 * 
 * Provides artifact information needed for creating cloud saves.
 * Cloud saves require sourceArtifactId and sourceArtifactCommit.
 * These are only available for published artifacts.
 */

import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { getProject } from '$lib/persistence';

const apiClient = createApiClient(API_BASE_URL);

/**
 * Artifact context information needed for cloud saves
 */
export interface ArtifactContext {
  /** Whether the project is published (has an artifact) */
  isPublished: boolean;
  /** Artifact ID (only if published) */
  artifactId?: string;
  /** Latest artifact commit hash (only if published) */
  artifactCommit?: string;
}

/**
 * Cache for artifact context to avoid repeated API calls
 */
const contextCache = new Map<string, { context: ArtifactContext; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

/**
 * Get artifact context for a project.
 * Returns whether the project is published and the artifact commit if available.
 * 
 * @param projectId - The project ID
 * @returns Artifact context
 */
export async function getArtifactContext(projectId: string): Promise<ArtifactContext> {
  // Check cache
  const cached = contextCache.get(projectId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.context;
  }

  // Get project to check if published
  const project = await getProject(projectId);
  
  if (!project?.artifactId) {
    const context: ArtifactContext = { isPublished: false };
    contextCache.set(projectId, { context, timestamp: Date.now() });
    return context;
  }

  // Project is published, get the latest artifact commit
  try {
    const { data, error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
      params: {
        path: { artifactId: project.artifactId },
        query: { version: 'latest' }
      }
    });

    if (error || !data) {
      // Failed to fetch, treat as not published for safety
      const context: ArtifactContext = { isPublished: false };
      contextCache.set(projectId, { context, timestamp: Date.now() });
      return context;
    }

    const context: ArtifactContext = {
      isPublished: true,
      artifactId: project.artifactId,
      artifactCommit: data.version.commitHash
    };
    contextCache.set(projectId, { context, timestamp: Date.now() });
    return context;
  } catch {
    const context: ArtifactContext = { isPublished: false };
    contextCache.set(projectId, { context, timestamp: Date.now() });
    return context;
  }
}

/**
 * Clear artifact context cache for a project.
 * Call this after publishing to refresh the context.
 * 
 * @param projectId - The project ID
 */
export function clearArtifactContext(projectId: string): void {
  contextCache.delete(projectId);
}

/**
 * Clear all artifact context cache.
 */
export function clearAllArtifactContext(): void {
  contextCache.clear();
}
