/**
 * VFS Git Submodule Integration - High-level utilities
 * 
 * Uses native git submodule mechanism (.gitmodules + gitlink) to track
 * VFS-to-VFS mount relationships in version control.
 * 
 * The low-level git operations are encapsulated in NodeVfs class.
 * This module provides high-level utilities that work with nodeStore.
 */

import { nodeStore } from '$lib/persistence';
import type { VFSContent } from '$lib/types';
import type { NodeVfs } from './node-vfs.svelte';

// Re-export SubmoduleInfo for consumers
export type { SubmoduleInfo } from './node-vfs.svelte';

/**
 * Sync mount configurations from VFSContent to git submodules.
 * 
 * This removes submodule entries that are no longer in the mounts array.
 * Should be called before committing.
 * 
 * @param vfs - The NodeVfs to sync
 * @param nodeId - The node ID of this VFS
 */
export async function syncMountsToSubmodules(
  vfs: NodeVfs,
  nodeId: string
): Promise<void> {
  const nodeData = nodeStore.get(nodeId);
  if (!nodeData || nodeData.type !== 'VFS') {
    return;
  }

  const content = nodeData.content as VFSContent;
  const mounts = content.mounts || [];

  // Get current submodules
  const currentSubmodules = await vfs.listSubmodules();

  // Paths we want to have
  const desiredPaths = new Set(mounts.map(m => 
    m.mountPath.startsWith('/') ? m.mountPath.slice(1) : m.mountPath
  ));

  // Remove submodules that are no longer in mounts
  for (const submodule of currentSubmodules) {
    if (!desiredPaths.has(submodule.path)) {
      await vfs.removeSubmodule(submodule.path);
    }
  }
}

/**
 * Update all submodule commit references to the latest HEAD of each source VFS.
 * 
 * This should be called before committing to lock the current versions
 * of all mounted VFS nodes.
 * 
 * @param vfs - The NodeVfs to update submodules for
 * @param nodeId - The node ID of this VFS
 * @param getVfsForNode - Function to get NodeVfs instance for a given node ID
 */
export async function updateSubmoduleCommits(
  vfs: NodeVfs,
  nodeId: string,
  getVfsForNode: (nodeId: string) => Promise<NodeVfs>
): Promise<void> {
  const nodeData = nodeStore.get(nodeId);
  if (!nodeData || nodeData.type !== 'VFS') {
    return;
  }

  const content = nodeData.content as VFSContent;
  const mounts = content.mounts || [];

  for (const mount of mounts) {
    try {
      // Get the source VFS
      const sourceVfs = await getVfsForNode(mount.sourceNodeId);
      
      // Get its current HEAD commit
      const sourceHead = await sourceVfs.getHead();
      
      // Update the submodule reference
      await vfs.updateSubmoduleCommit(mount.mountPath, sourceHead.hash);
      
      console.log(`[VFS:Submodule] Locked ${mount.mountPath} to commit ${sourceHead.hash.slice(0, 7)}`);
    } catch (err) {
      console.warn(`[VFS:Submodule] Failed to update submodule ${mount.mountPath}:`, err);
    }
  }
}
