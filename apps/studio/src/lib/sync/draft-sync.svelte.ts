/**
 * Draft Cloud Sync Service
 * 
 * Provides cloud synchronization for local projects using the artifact API.
 * Draft sync uses a fixed `draft-latest` commit tag with PRIVATE visibility.
 * 
 * Key concepts:
 * - Draft sync is separate from formal publishing
 * - Uses same artifact ID but different commit tags
 * - PRIVATE visibility is enforced
 * - Supports conflict detection and resolution
 * - Automatically commits uncommitted VFS changes before sync
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '../types/flow';
import type { StoredProject } from '../persistence/db';
import { saveProject, getProject } from '../persistence/db';
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';
import { publishArtifact, patchArtifact, type PublishMetadata, type PatchMetadata } from '../io/publish';
import { getNodeVfs, type NodeVfs } from '../vfs';
import { SvelteMap } from 'svelte/reactivity';
import { errorRouter } from '$lib/errors';
import { AppError } from '$lib/errors/types';

// ============================================================================
// Constants
// ============================================================================

/** Fixed commit tag for draft sync */
export const DRAFT_LATEST_TAG = 'draft-latest';

// ============================================================================
// Types
// ============================================================================

/** Sync operation status */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'conflict';

/** Result of a sync operation */
export interface SyncResult {
  success: boolean;
  /** New commit hash after sync */
  newCommit?: string;
  /** Error message if failed */
  error?: string;
  /** Whether a conflict was detected */
  conflict?: boolean;
  /** Cloud commit hash (for conflict resolution) */
  cloudCommit?: string;
}

/** Sync state for reactive UI */
export interface DraftSyncState {
  /** Current sync status */
  status: SyncStatus;
  /** Whether there are local node/edge changes not yet synced */
  hasUnsyncedChanges: boolean;
  /** Whether any VFS node has uncommitted file changes */
  hasVfsChanges: boolean;
  /** Last sync timestamp */
  lastSyncedAt: number | null;
  /** Last synced commit */
  lastSyncedCommit: string | null;
  /** Error message if any */
  error: string | null;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Whether the backend state has been validated */
  backendValidated: boolean;
  /** 
   * Divergence info when local and cloud histories diverge.
   * This happens when the local commit is not found in cloud history.
   */
  diverged?: {
    /** The local commit that was expected to be on cloud */
    localCommit: string;
    /** The cloud's current commit (draft-latest) */
    cloudCommit: string;
  };
}

// ============================================================================
// API Client
// ============================================================================

const apiClient = createApiClient(API_BASE_URL);

// ============================================================================
// Draft Sync Service Factory
// ============================================================================

/**
 * Create a draft sync service for a project.
 * 
 * Usage:
 * ```typescript
 * const syncService = createDraftSyncService();
 * 
 * // Initialize with project
 * syncService.init(project, currentCommit);
 * 
 * // Sync to cloud
 * const result = await syncService.sync(nodes, edges);
 * 
 * // Check state
 * const state = syncService.state;
 * ```
 */
export function createDraftSyncService() {
  // Tracked VFS instances (for aggregating isDirty state)
  // Using SvelteMap for reactive iteration in $derived
  const trackedVfsInstances = new SvelteMap<string, NodeVfs>();
  
  // Base reactive state (without hasVfsChanges - that's derived)
  const baseState = $state<Omit<DraftSyncState, 'hasVfsChanges'>>({
    status: 'idle',
    hasUnsyncedChanges: false,
    lastSyncedAt: null,
    lastSyncedCommit: null,
    error: null,
    enabled: false,
    backendValidated: false,
    diverged: undefined
  });
  
  // Derived VFS dirty state - aggregates isDirty from all tracked VFS instances
  // SvelteMap is reactive, so iterating over it establishes dependencies
  const hasVfsChanges = $derived.by(() => {
    console.log('[DraftSync] Computing hasVfsChanges, trackedVfsInstances count:', trackedVfsInstances.size);
    for (const [nodeId, vfs] of trackedVfsInstances.entries()) {
      console.log('[DraftSync] VFS node:', nodeId, 'isDirty:', vfs.isDirty);
      if (vfs.isDirty) {
        return true;
      }
    }
    return false;
  });
  
  // Combined state with hasVfsChanges derived
  const state = $derived<DraftSyncState>({
    ...baseState,
    hasVfsChanges
  });

  let currentProject: StoredProject | null = null;
  let currentArtifactCommit: string | null = null;
  
  // ============================================================================
  // VFS Change Tracking
  // ============================================================================
  
  // Current nodes reference
  let currentNodes: Node<FlowNodeData>[] = [];
  
  /**
   * Update the tracked VFS nodes based on current nodes array.
   * Call this whenever nodes change (add/remove VFS nodes).
   * The hasVfsChanges state is computed by aggregating isDirty from all tracked VFS instances.
   */
  async function updateTrackedVfsNodes(nodes: Node<FlowNodeData>[]): Promise<void> {
    console.log('[DraftSync] updateTrackedVfsNodes called, nodes count:', nodes.length);
    currentNodes = nodes;
    
    if (!currentProject) {
      console.log('[DraftSync] updateTrackedVfsNodes skipped - project not initialized');
      return;
    }
    
    const currentVfsNodeIds = new Set(
      nodes.filter(n => n.data.type === 'VFS').map(n => n.id)
    );
    console.log('[DraftSync] VFS nodes found:', Array.from(currentVfsNodeIds));
    
    // Track new VFS nodes
    for (const nodeId of currentVfsNodeIds) {
      if (!trackedVfsInstances.has(nodeId)) {
        try {
          console.log('[DraftSync] Tracking new VFS node:', nodeId);
          const vfs = await getNodeVfs(currentProject.id, nodeId);
          trackedVfsInstances.set(nodeId, vfs);
          // Trigger initial dirty state check
          await vfs.refreshDirtyState();
          console.log('[DraftSync] VFS node tracked, isDirty:', vfs.isDirty);
        } catch {
          errorRouter.dispatch(
            new AppError('VFS_TRACK_FAILED', `Failed to track VFS node ${nodeId}`, 'storage', 'warning', false, {
              nodeId,
              operation: 'trackVfsNode'
            })
          );
        }
      }
    }
    
    // Untrack removed VFS nodes
    for (const nodeId of trackedVfsInstances.keys()) {
      if (!currentVfsNodeIds.has(nodeId)) {
        console.log('[DraftSync] Untracking VFS node:', nodeId);
        trackedVfsInstances.delete(nodeId);
      }
    }
    
    console.log('[DraftSync] updateTrackedVfsNodes done, tracked count:', trackedVfsInstances.size);
  }
  
  /**
   * Cleanup all VFS tracking.
   */
  function cleanupVfsTracking(): void {
    trackedVfsInstances.clear();
  }
  
  /**
   * Get aggregated VFS dirty state from all tracked instances.
   * Returns true if any tracked VFS has uncommitted changes.
   /**
   * Initialize the service with a project ID.
   * Will fetch the project from storage and validate against backend.
   */
  async function init(projectId: string): Promise<void> {
    const project = await getProject(projectId);
    if (!project) {
      // Create a minimal project record if it doesn't exist
      const newProject: StoredProject = {
        id: projectId,
        name: `Project ${projectId.substring(0, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDraft: true
      };
      await saveProject(newProject);
      currentProject = newProject;
    } else {
      currentProject = project;
    }
    
    currentArtifactCommit = currentProject.lastCloudCommit ?? null;
    
    baseState.enabled = currentProject.draftSyncEnabled ?? false;
    baseState.lastSyncedAt = currentProject.lastDraftSyncAt ?? null;
    baseState.lastSyncedCommit = currentProject.lastDraftSyncCommit ?? null;
    baseState.backendValidated = false;
    baseState.diverged = undefined;
    
    // Initial sync state: assume synced if lastCloudCommit matches lastDraftSyncCommit
    // The actual state will be updated when updateCommit is called with real node data
    if (currentProject.lastDraftSyncCommit && currentProject.lastCloudCommit === currentProject.lastDraftSyncCommit) {
      baseState.hasUnsyncedChanges = false;
    } else {
      baseState.hasUnsyncedChanges = checkUnsyncedChanges(currentProject, currentArtifactCommit);
    }
    
    baseState.status = 'idle';
    baseState.error = null;
    
    // If sync is enabled and we have an artifact, validate against backend
    if (baseState.enabled && currentProject.artifactId) {
      await validateBackendState();
    } else {
      baseState.backendValidated = true; // No backend state to validate
    }
  }

  /**
   * Validate local sync state against backend.
   * This is the source of truth - backend is authoritative.
   * 
   * Cases:
   * 1. Artifact doesn't exist on backend → reset sync state
   * 2. Artifact exists but local commit not found → diverged state
   * 3. Artifact exists and commits match → synced
   */
  async function validateBackendState(): Promise<void> {
    if (!currentProject?.artifactId) {
      baseState.backendValidated = true;
      return;
    }
    
    try {
      // Try to fetch the draft-latest version from backend
      const { data, error, response } = await apiClient.GET('/artifacts/{artifactId}/graph', {
        params: {
          path: { artifactId: currentProject.artifactId },
          query: { version: DRAFT_LATEST_TAG }
        }
      });
      
      if (response.status === 404 || response.status === 403) {
        // Artifact doesn't exist on backend (404) or ACL records were deleted along with artifact (403)
        console.info('[DraftSync] Artifact not found on backend (status:', response.status, '), resetting sync state');
        await resetSyncStateForMissingArtifact();
        baseState.backendValidated = true;
        return;
      }
      
      if (error || !data) {
        // Other error - don't change state, but mark as not validated
        console.warn('[DraftSync] Failed to validate backend state:', error);
        baseState.backendValidated = false;
        baseState.error = 'Failed to validate sync state with server';
        return;
      }
      
      const cloudCommit = data.version.commitHash;
      const localCommit = currentProject.lastDraftSyncCommit;
      
      if (!localCommit) {
        // Local never synced, but cloud has data - need to handle carefully
        // For now, update local state to match cloud
        console.info('[DraftSync] Local never synced but cloud has data, updating local state');
        currentProject.lastDraftSyncCommit = cloudCommit;
        currentProject.lastCloudCommit = cloudCommit;
        currentProject.lastDraftSyncAt = Date.now();
        await saveProject(currentProject);
        
        baseState.lastSyncedCommit = cloudCommit;
        baseState.hasUnsyncedChanges = true; // Local changes exist since we just loaded
        baseState.backendValidated = true;
        return;
      }
      
      if (cloudCommit === localCommit) {
        // Perfect - local and cloud are in sync
        console.info('[DraftSync] Local and cloud commits match');
        baseState.backendValidated = true;
        return;
      }
      
      // Cloud commit differs from local - this is a divergence
      // The user may have synced from another device, or backend was reset
      console.warn('[DraftSync] Local and cloud commits diverged', { localCommit, cloudCommit });
      baseState.diverged = { localCommit, cloudCommit };
      baseState.status = 'conflict';
      baseState.error = 'Local and cloud histories have diverged. Please resolve.';
      baseState.backendValidated = true;
      
    } catch {
      errorRouter.dispatch(
        new AppError('SYNC_VALIDATE_FAILED', 'Failed to connect to sync server', 'network', 'warning', true, {
          operation: 'validateBackendState'
        })
      );
      baseState.backendValidated = false;
      baseState.error = 'Failed to connect to sync server';
    }
  }

  /**
   * Reset sync state when artifact is not found on backend.
   * This happens when backend is cleared or artifact is deleted.
   */
  async function resetSyncStateForMissingArtifact(): Promise<void> {
    if (!currentProject) return;
    
    // Clear all sync-related fields but keep the artifact ID
    // (so user can re-sync to the same artifact if they want)
    currentProject.lastDraftSyncCommit = undefined;
    currentProject.lastDraftSyncAt = undefined;
    currentProject.lastCloudCommit = undefined;
    // Keep draftSyncEnabled as user preference
    
    await saveProject(currentProject);
    
    // Update state
    baseState.lastSyncedCommit = null;
    baseState.lastSyncedAt = null;
    baseState.hasUnsyncedChanges = baseState.enabled; // Has changes if sync is enabled
    baseState.diverged = undefined;
    baseState.status = 'idle';
    baseState.error = null;
  }

  /**
   * Update current artifact commit (call when local changes occur)
   */
  function updateCommit(newCommit: string) {
    currentArtifactCommit = newCommit;
    if (currentProject) {
      baseState.hasUnsyncedChanges = checkUnsyncedChanges(currentProject, newCommit);
    }
  }

  /**
   * Mark the project as having unsynced changes.
   * Call this when any node data is modified locally.
   */
  function markDirty(): void {
    if (baseState.enabled) {
      baseState.hasUnsyncedChanges = true;
    }
  }

  /**
   * Check if there are unsynced changes
   */
  function checkUnsyncedChanges(project: StoredProject, commit: string | null): boolean {
    if (!project.lastDraftSyncCommit) {
      // Never synced - consider it as having changes if sync is enabled
      return project.draftSyncEnabled ?? false;
    }
    if (!commit) {
      // No local commit to compare - consider having changes
      return true;
    }
    return commit !== project.lastDraftSyncCommit;
  }

  /**
   * Enable draft sync for the project
   */
  async function enable(): Promise<void> {
    if (!currentProject) return;
    
    currentProject.draftSyncEnabled = true;
    baseState.enabled = true;
    
    // When enabled, always consider having unsynced changes if never synced
    baseState.hasUnsyncedChanges = checkUnsyncedChanges(currentProject, currentArtifactCommit);
    
    // Start tracking VFS nodes
    await updateTrackedVfsNodes(currentNodes);
    
    await saveProject(currentProject);
  }

  /**
   * Disable draft sync for the project
   */
  async function disable(): Promise<void> {
    if (!currentProject) return;
    
    currentProject.draftSyncEnabled = false;
    baseState.enabled = false;
    baseState.hasUnsyncedChanges = false;
    
    // Stop tracking VFS nodes
    cleanupVfsTracking();
    
    await saveProject(currentProject);
  }

  /**
   * Commit all uncommitted VFS changes before sync.
   * This ensures all VFS content is properly versioned before uploading.
   * 
   * @param nodes - All nodes in the project
   * @returns Number of VFS nodes that were committed
   */
  async function commitAllVfsChanges(nodes: Node<FlowNodeData>[]): Promise<number> {
    if (!currentProject) return 0;
    
    const projectId = currentProject.id;
    const timestamp = new Date().toISOString();
    const commitMessage = `Cloud sync at ${timestamp}`;
    
    let committedCount = 0;
    
    // Find all VFS nodes
    const vfsNodes = nodes.filter(n => n.data.type === 'VFS');
    
    for (const node of vfsNodes) {
      try {
        const vfs = await getNodeVfs(projectId, node.id);
        
        // Check if there are uncommitted changes
        const status = await vfs.getStatus();
        const hasChanges = status.length > 0;
        
        if (hasChanges) {
          console.log(`[DraftSync] Committing ${status.length} changes in VFS node ${node.id}`);
          await vfs.commit(commitMessage);
          committedCount++;
        }
      } catch (err) {
        console.warn(`[DraftSync] Failed to commit VFS node ${node.id}:`, err);
        // Continue with other nodes
      }
    }
    
    if (committedCount > 0) {
      console.log(`[DraftSync] Committed changes in ${committedCount} VFS node(s)`);
    }
    
    return committedCount;
  }

  /**
   * Perform draft sync to cloud.
   * Automatically commits any uncommitted VFS changes first.
   */
  async function sync(
    nodes: Node<FlowNodeData>[],
    edges: Edge[],
    projectName: string
  ): Promise<SyncResult> {
    if (!currentProject) {
      return { success: false, error: 'Project not initialized' };
    }

    baseState.status = 'syncing';
    baseState.error = null;

    try {
      // First, commit any uncommitted VFS changes
      await commitAllVfsChanges(nodes);
      
      let result: SyncResult;

      if (currentProject.artifactId && currentProject.lastDraftSyncCommit) {
        // Incremental PATCH sync - we have a base commit to build on
        result = await performPatchSync(
          currentProject,
          nodes,
          edges
        );
      } else {
        // First sync or re-sync after reset - create/recreate artifact
        // performFirstSync will use existing artifactId if available
        result = await performFirstSync(
          currentProject,
          nodes,
          edges,
          projectName
        );
      }

      if (result.success) {
        // Sync metadata to cloud (name, description, tags, visibility, etc.)
        // This is a best-effort operation — graph is already synced.
        await syncMetadata(currentProject).catch(err => {
          console.warn('[DraftSync] Metadata sync failed (graph sync succeeded):', err);
        });

        // Update project and state
        currentProject.lastDraftSyncCommit = result.newCommit;
        currentProject.lastDraftSyncAt = Date.now();
        currentProject.draftSyncEnabled = true;
        // Also update lastCloudCommit to keep sync state consistent across page refreshes
        currentProject.lastCloudCommit = result.newCommit;
        
        await saveProject(currentProject);

        baseState.status = 'success';
        baseState.lastSyncedCommit = result.newCommit ?? null;
        baseState.lastSyncedAt = currentProject.lastDraftSyncAt;
        baseState.hasUnsyncedChanges = false;
        baseState.enabled = true;
      } else if (result.conflict) {
        baseState.status = 'conflict';
        baseState.error = result.error ?? 'Sync conflict detected';
      } else {
        baseState.status = 'error';
        baseState.error = result.error ?? 'Sync failed';
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      baseState.status = 'error';
      baseState.error = error;
      return { success: false, error };
    }
  }

  /**
   * First-time sync - create a new PRIVATE artifact with draft-latest tag.
   * Uses the project's locally-persisted metadata (name, description, tags, etc.).
   */
  async function performFirstSync(
    project: StoredProject,
    nodes: Node<FlowNodeData>[],
    edges: Edge[],
    projectName: string
  ): Promise<SyncResult> {
    // Use project ID as artifact ID to keep URL consistent
    const artifactId = project.artifactId ?? project.id;
    
    // Create slug from project name
    const effectiveName = projectName || project.name;
    const slug = effectiveName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'draft';

    // Parse tags from comma-separated string
    const tags = project.tags
      ? project.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : [];
    
    const metadata: PublishMetadata = {
      artifactId,
      name: effectiveName,
      slug: `${slug}-${artifactId.slice(0, 8)}`, // Ensure uniqueness
      description: project.description || '',
      isListed: !(project.isUnlisted ?? true), // Default to unlisted for draft sync
      isPrivate: project.isPrivate ?? true, // Default to private for draft sync
      version: project.version || '0.0.1-draft',
      tags,
      homepage: project.homepage || undefined,
      commitTags: [DRAFT_LATEST_TAG]
    };

    const result = await publishArtifact(metadata, nodes, edges);

    if (result.success && result.artifactId) {
      // Update project with artifact ID
      project.artifactId = result.artifactId;
      await saveProject(project);

      return {
        success: true,
        newCommit: result.latestCommit
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to create artifact'
    };
  }

  /**
   * Incremental PATCH sync
   */
  async function performPatchSync(
    project: StoredProject,
    nodes: Node<FlowNodeData>[],
    edges: Edge[]
  ): Promise<SyncResult> {
    if (!project.artifactId) {
      return { success: false, error: 'No artifact ID' };
    }

    // Determine base commit for PATCH
    // Use lastDraftSyncCommit if available, otherwise lastCloudCommit
    const baseCommit = project.lastDraftSyncCommit ?? project.lastCloudCommit;

    if (!baseCommit) {
      // No base commit - this shouldn't happen as sync() should route to performFirstSync
      // But handle gracefully by returning error
      return {
        success: false,
        error: 'No base commit for patch. Please try again.'
      };
    }

    const metadata: PatchMetadata = {
      artifactId: project.artifactId,
      baseCommit,
      commitTags: [DRAFT_LATEST_TAG]
    };

    const result = await patchArtifact(metadata, nodes, edges);

    if (result.success) {
      return {
        success: true,
        newCommit: result.newCommit
      };
    }

    // Check for conflict (base commit mismatch)
    if (result.error?.includes('BASE_COMMIT_MISMATCH') || 
        result.error?.includes('base commit') ||
        result.error?.includes('conflict')) {
      return {
        success: false,
        conflict: true,
        error: 'Cloud has newer changes. Please resolve conflict.'
      };
    }

    return {
      success: false,
      error: result.error ?? 'Patch failed'
    };
  }

  /**
   * Sync project metadata to the cloud artifact.
   * Reads the latest metadata from IndexedDB and sends it via
   * PUT /artifacts/{artifactId}/metadata.
   *
   * This is called after a successful graph sync so that sidebar edits
   * (name, description, tags, visibility, etc.) are reflected on the backend.
   */
  async function syncMetadata(project: StoredProject): Promise<void> {
    if (!project.artifactId) return;

    // Re-read from IndexedDB to get the latest metadata
    // (the sidebar auto-persists changes to IndexedDB independently)
    const freshProject = await getProject(project.id);
    if (!freshProject) return;

    const tags = freshProject.tags
      ? freshProject.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : undefined;

    // Build partial update body — only include fields that have values
    const body: {
      name?: string;
      description?: string;
      isPrivate?: boolean;
      isListed?: boolean;
      tags?: string[];
    } = {};
    if (freshProject.name) body.name = freshProject.name;
    if (freshProject.description !== undefined) body.description = freshProject.description;
    if (freshProject.isPrivate !== undefined) body.isPrivate = freshProject.isPrivate;
    if (freshProject.isUnlisted !== undefined) body.isListed = !freshProject.isUnlisted;
    if (tags && tags.length > 0) body.tags = tags;

    // Only call if there's something to update
    if (Object.keys(body).length === 0) return;

    const { error } = await apiClient.PUT('/artifacts/{artifactId}/metadata', {
      params: { path: { artifactId: project.artifactId } },
      body,
    });

    if (error) {
      console.warn('[DraftSync] Metadata update failed:', error);
    } else {
      console.log('[DraftSync] Metadata synced to cloud');
    }
  }

  /**
   * Force overwrite cloud with local (conflict resolution)
   */
  async function forceOverwriteCloud(
    nodes: Node<FlowNodeData>[],
    edges: Edge[],
    projectName: string
  ): Promise<SyncResult> {
    if (!currentProject) {
      return { success: false, error: 'Project not initialized' };
    }

    baseState.status = 'syncing';
    baseState.error = null;

    try {
      // Fetch current cloud commit to use as base
      const cloudCommit = await fetchCurrentCloudCommit(currentProject.artifactId!);
      
      if (!cloudCommit) {
        return { success: false, error: 'Cannot fetch cloud state' };
      }

      // Update project's base commit to cloud's current
      currentProject.lastDraftSyncCommit = cloudCommit;
      
      // Now do normal sync
      return await sync(nodes, edges, projectName);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      baseState.status = 'error';
      baseState.error = error;
      return { success: false, error };
    }
  }

  /**
   * Fetch current cloud commit for an artifact
   */
  async function fetchCurrentCloudCommit(artifactId: string): Promise<string | null> {
    try {
      const { data } = await apiClient.GET('/artifacts/{artifactId}/graph', {
        params: {
          path: { artifactId },
          query: { version: DRAFT_LATEST_TAG }
        }
      });
      return data?.version?.commitHash ?? null;
    } catch {
      // Log but don't surface to user - caller handles null case
      errorRouter.dispatch(
        new AppError('FETCH_CLOUD_COMMIT_FAILED', 'Failed to fetch cloud commit', 'network', 'info', true, {
          artifactId,
          operation: 'fetchCurrentCloudCommit'
        })
      );
      return null;
    }
  }

  /**
   * Reset sync state (e.g., after restoring from cloud)
   */
  function reset() {
    // Cleanup VFS tracking before reset
    cleanupVfsTracking();
    
    baseState.status = 'idle';
    baseState.hasUnsyncedChanges = false;
    baseState.lastSyncedAt = null;
    baseState.lastSyncedCommit = null;
    baseState.error = null;
    baseState.enabled = false;
    baseState.backendValidated = false;
    baseState.diverged = undefined;
    
    currentProject = null;
    currentArtifactCommit = null;
  }

  /**
   * Accept cloud state and discard local divergence.
   * Updates local commit references to match cloud.
   */
  async function acceptCloudState(): Promise<void> {
    if (!currentProject?.artifactId || !baseState.diverged) return;
    
    const { cloudCommit } = baseState.diverged;
    
    currentProject.lastDraftSyncCommit = cloudCommit;
    currentProject.lastCloudCommit = cloudCommit;
    currentProject.lastDraftSyncAt = Date.now();
    await saveProject(currentProject);
    
    baseState.lastSyncedCommit = cloudCommit;
    baseState.lastSyncedAt = currentProject.lastDraftSyncAt;
    baseState.hasUnsyncedChanges = true; // Local content differs from cloud
    baseState.diverged = undefined;
    baseState.status = 'idle';
    baseState.error = null;
  }

  /**
   * Force push local state to cloud, overwriting cloud history.
   * This will create a new commit based on current cloud commit.
   */
  async function forcePushLocal(
    nodes: Node<FlowNodeData>[],
    edges: Edge[],
    projectName: string
  ): Promise<SyncResult> {
    if (!currentProject?.artifactId || !baseState.diverged) {
      return { success: false, error: 'No divergence to resolve' };
    }
    
    // Use cloud commit as base to create new version
    currentProject.lastDraftSyncCommit = baseState.diverged.cloudCommit;
    currentProject.lastCloudCommit = baseState.diverged.cloudCommit;
    
    baseState.diverged = undefined;
    
    // Now perform normal sync
    return await sync(nodes, edges, projectName);
  }

  return {
    // State accessor
    get state() { return state; },
    
    // Methods
    init,
    updateCommit,
    markDirty,
    updateTrackedVfsNodes,
    cleanupVfsTracking,
    enable,
    disable,
    sync,
    forceOverwriteCloud,
    reset,
    // New methods for divergence resolution
    validateBackendState,
    acceptCloudState,
    forcePushLocal
  };
}

export type DraftSyncService = ReturnType<typeof createDraftSyncService>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get relative time string (e.g., "2 minutes ago")
 */
export function formatRelativeSyncTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
