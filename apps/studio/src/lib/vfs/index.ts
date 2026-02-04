/**
 * Studio VFS - Unified exports
 * 
 * API: Use getNodeVfs() to get the NodeVfs for a node. NodeVfs is the unified
 * interface that includes file operations, mount support, and version control.
 */

export {
  getNodeVfs,
  invalidateNodeVfs,
  clearNodeVfsCache,
  getVfsFactory,
  ScopedVfsProvider,
  NodeVfsFactory,
  preInitializeZenFS,
  type VfsProvider,
  NodeVfs
} from './store';

export {
  VfsFileTreeService,
  countFiles,
  countFolders,
  getParentPath,
  getFileName
} from './file-tree-service';

export {
  createVSCodeLink,
  type VSCodeLink,
  type VSCodeLinkStatus,
  type VSCodeLinkState
} from './vscode-link.svelte';

export { VfsMonacoAdapter } from './monaco-adapter';

export {
  validateVfsName,
  validateVfsNameFormat,
  isValidVfsName,
  isVfsNameUnique
} from './name-validation';

export {
  addVfsSubmodule,
  removeVfsSubmodule,
  updateSubmoduleCommit,
  updateSubmoduleCommits,
  listVfsSubmodules,
  syncMountsToSubmodules,
  type SubmoduleInfo
} from './submodule';

export {
  vfsVersionStore,
  type VfsVersionState
} from './version-store.svelte';
