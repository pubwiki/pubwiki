/**
 * VFS Git Submodule Integration
 * 
 * Uses native git submodule mechanism (.gitmodules + gitlink) to track
 * VFS-to-VFS mount relationships in version control.
 * 
 * Benefits:
 * - Standard format compatible with canonical git
 * - Export-friendly (projects can be used as regular git repos)
 * - Toolchain compatible (any git tool can view/edit)
 * 
 * Note: isomorphic-git v1.36.0+ supports submodule operations.
 */

import * as git from 'isomorphic-git';
import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import { ScopedVfsProvider } from './store';
import { nodeStore } from '$lib/persistence';
import type { VFSContent } from '$lib/types';

/**
 * A VFS that supports version control operations.
 * This can be either a VersionedVfs or NodeVfs (which wraps VersionedVfs).
 */
interface VersionableVfs extends Vfs<VfsProvider> {
  getHead(): Promise<{ hash: string }>;
}

/**
 * Helper to get ScopedVfsProvider from a VFS
 * In studio, all VFS providers are ScopedVfsProvider
 */
function getScopedProvider(vfs: Vfs<VfsProvider>): ScopedVfsProvider {
  return vfs.getProvider() as unknown as ScopedVfsProvider;
}

/**
 * Parsed submodule information from .gitmodules
 */
export interface SubmoduleInfo {
  /** Mount path in the target VFS */
  path: string;
  /** Source VFS Node ID (from vfs:// URL) */
  nodeId: string;
}

/**
 * Add a VFS as a submodule to another VFS
 * 
 * Since our VFS repositories are all local in OPFS, we don't need to clone.
 * We just record the path and commit reference in .gitmodules and update the index.
 * 
 * @param targetVfs - The VFS receiving the mount (parent)
 * @param sourceVfs - The VFS being mounted (child)
 * @param mountPath - Path where the source VFS will appear in target
 */
export async function addVfsSubmodule(
  targetVfs: VersionableVfs,
  sourceVfs: VersionableVfs,
  mountPath: string
): Promise<void> {
  const provider = getScopedProvider(targetVfs);
  const fs = provider.getFs();
  const dir = provider.getDir();

  // Get source VFS's current HEAD commit
  const sourceProvider = getScopedProvider(sourceVfs);
  const sourceHead = await sourceVfs.getHead();

  // Read or create .gitmodules
  let gitmodules = '';
  try {
    const content = await fs.promises.readFile(`${dir}/.gitmodules`, 'utf8');
    gitmodules = content as string;
  } catch {
    // File doesn't exist, create new
  }

  // Normalize mount path (remove leading slash for gitmodules)
  const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

  // Get source node ID for the URL
  const sourceNodeId = sourceProvider.getNodeId();

  // Check if submodule already exists
  if (gitmodules.includes(`[submodule "${normalizedPath}"]`)) {
    console.log(`[VFS:Submodule] Submodule ${normalizedPath} already exists, skipping add`);
    return;
  }

  // Add submodule configuration
  // Use special vfs:// URL format to identify this as a local VFS node
  const submoduleConfig = `
[submodule "${normalizedPath}"]
	path = ${normalizedPath}
	url = vfs://${sourceNodeId}
`;
  gitmodules += submoduleConfig;

  await fs.promises.writeFile(`${dir}/.gitmodules`, gitmodules);

  // Create gitlink (special tree entry pointing to submodule commit)
  // This is the core mechanism of git submodule
  await git.updateIndex({
    fs,
    dir,
    filepath: normalizedPath,
    oid: sourceHead.hash,
    mode: 0o160000 // gitlink mode
  });

  console.log(`[VFS:Submodule] Added submodule ${sourceNodeId} at ${normalizedPath} (commit: ${sourceHead.hash.slice(0, 7)})`);
}

/**
 * Remove a VFS submodule
 * 
 * @param targetVfs - The VFS containing the mount
 * @param mountPath - Path of the submodule to remove
 */
export async function removeVfsSubmodule(
  targetVfs: VersionableVfs,
  mountPath: string
): Promise<void> {
  const provider = getScopedProvider(targetVfs);
  const fs = provider.getFs();
  const dir = provider.getDir();

  // Normalize mount path
  const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

  // Read and update .gitmodules
  try {
    const content = await fs.promises.readFile(`${dir}/.gitmodules`, 'utf8');
    const gitmodules = content as string;

    // Remove the submodule section
    const lines = gitmodules.split('\n');
    const newLines: string[] = [];
    let inRemoveSection = false;

    for (const line of lines) {
      if (line.match(new RegExp(`^\\[submodule "${normalizedPath}"\\]`))) {
        inRemoveSection = true;
        continue;
      }
      if (inRemoveSection && line.match(/^\[/)) {
        inRemoveSection = false;
      }
      if (!inRemoveSection) {
        newLines.push(line);
      }
    }

    const newContent = newLines.join('\n').trim();
    if (newContent) {
      await fs.promises.writeFile(`${dir}/.gitmodules`, newContent + '\n');
    } else {
      // Remove empty .gitmodules file
      await fs.promises.unlink(`${dir}/.gitmodules`);
    }
  } catch {
    // .gitmodules doesn't exist, nothing to remove
  }

  // Remove from git index
  try {
    await git.remove({
      fs,
      dir,
      filepath: normalizedPath
    });
  } catch {
    // Entry might not exist in index
  }

  console.log(`[VFS:Submodule] Removed submodule at ${normalizedPath}`);
}

/**
 * Update submodule commit reference
 * Called when the source VFS changes and we want to update the lock
 * 
 * @param targetVfs - The VFS containing the mount
 * @param mountPath - Path of the submodule
 * @param newCommit - New commit hash to reference
 */
export async function updateSubmoduleCommit(
  targetVfs: VersionableVfs,
  mountPath: string,
  newCommit: string
): Promise<void> {
  const provider = getScopedProvider(targetVfs);
  const fs = provider.getFs();
  const dir = provider.getDir();

  // Normalize mount path
  const normalizedPath = mountPath.startsWith('/') ? mountPath.slice(1) : mountPath;

  // Update gitlink to new commit
  await git.updateIndex({
    fs,
    dir,
    filepath: normalizedPath,
    oid: newCommit,
    mode: 0o160000 // gitlink mode
  });

  console.log(`[VFS:Submodule] Updated ${normalizedPath} to commit ${newCommit.slice(0, 7)}`);
}

/**
 * Read .gitmodules to get all submodule information
 * 
 * @param vfs - The VFS to read submodules from
 * @returns Array of submodule info
 */
export async function listVfsSubmodules(
  vfs: VersionableVfs
): Promise<SubmoduleInfo[]> {
  const provider = getScopedProvider(vfs);
  const fs = provider.getFs();
  const dir = provider.getDir();

  try {
    const content = await fs.promises.readFile(`${dir}/.gitmodules`, 'utf8');
    return parseGitmodules(content as string);
  } catch {
    return [];
  }
}

/**
 * Parse .gitmodules INI format
 */
function parseGitmodules(content: string): SubmoduleInfo[] {
  const result: SubmoduleInfo[] = [];
  const lines = content.split('\n');

  let currentPath = '';
  for (const line of lines) {
    const pathMatch = line.match(/^\s*path\s*=\s*(.+)$/);
    const urlMatch = line.match(/^\s*url\s*=\s*vfs:\/\/(.+)$/);

    if (pathMatch) currentPath = pathMatch[1].trim();
    if (urlMatch && currentPath) {
      result.push({ path: currentPath, nodeId: urlMatch[1].trim() });
      currentPath = '';
    }
  }

  return result;
}

/**
 * Sync mount configurations from VFSContent to git submodules
 * 
 * This should be called before committing to ensure .gitmodules
 * is in sync with the VFSContent.mounts array.
 * 
 * @param vfs - The VFS to sync
 * @param nodeId - The node ID of this VFS
 */
export async function syncMountsToSubmodules(
  vfs: VersionableVfs,
  nodeId: string
): Promise<void> {
  const nodeData = nodeStore.get(nodeId);
  if (!nodeData || nodeData.type !== 'VFS') {
    return;
  }

  const content = nodeData.content as VFSContent;
  const mounts = content.mounts || [];

  // Get current submodules
  const currentSubmodules = await listVfsSubmodules(vfs);
  const currentPaths = new Set(currentSubmodules.map(s => s.path));

  // Paths we want to have
  const desiredPaths = new Set(mounts.map(m => 
    m.mountPath.startsWith('/') ? m.mountPath.slice(1) : m.mountPath
  ));

  // Remove submodules that are no longer in mounts
  for (const submodule of currentSubmodules) {
    if (!desiredPaths.has(submodule.path)) {
      await removeVfsSubmodule(vfs, submodule.path);
    }
  }

  // Note: Adding new submodules is handled by the mount connection handler
  // This function is mainly for cleanup during commit
}

/**
 * Update all submodule commit references to the latest HEAD of each source VFS
 * 
 * This should be called before committing to lock the current versions
 * of all mounted VFS nodes.
 * 
 * @param vfs - The VFS to update submodules for
 * @param nodeId - The node ID of this VFS
 * @param getVfsForNode - Function to get VFS instance for a given node ID
 */
export async function updateSubmoduleCommits(
  vfs: VersionableVfs,
  nodeId: string,
  getVfsForNode: (nodeId: string) => Promise<VersionableVfs>
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
      await updateSubmoduleCommit(vfs, mount.mountPath, sourceHead.hash);
      
      console.log(`[VFS:Submodule] Locked ${mount.mountPath} to commit ${sourceHead.hash.slice(0, 7)}`);
    } catch (err) {
      console.warn(`[VFS:Submodule] Failed to update submodule ${mount.mountPath}:`, err);
    }
  }
}
