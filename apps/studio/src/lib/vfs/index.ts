/**
 * Studio VFS - Unified exports
 */

export {
  getNodeVfs,
  getVfsFactory,
  ScopedVfsProvider,
  NodeVfsFactory,
  type VersionedVfs,
  type VersionedVfsProvider,
  type VfsProvider
} from './store';

export {
  VfsFileTreeService,
  isVfsFolder,
  countFiles,
  countFolders,
  getParentPath,
  getFileName
} from './file-tree-service';
