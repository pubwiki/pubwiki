/**
 * Studio VFS - Unified exports
 */

export {
  getNodeVfs,
  getVfsFactory,
  ScopedVfsProvider,
  NodeVfsFactory,
  preInitializeZenFS,
  type VersionedVfs,
  type VersionedVfsProvider,
  type VfsProvider
} from './store';

export {
  VfsFileTreeService,
  countFiles,
  countFolders,
  getParentPath,
  getFileName
} from './file-tree-service';
