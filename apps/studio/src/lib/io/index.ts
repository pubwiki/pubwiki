/**
 * Studio IO - Import/Export unified exports
 */

export {
  convertArtifactToStudioGraph,
  importArtifactToNewProject,
  addArtifactToProject,
  type ImportProgressCallback
} from './import';

export {
  publishArtifact,
  patchArtifact,
  type PublishMetadata,
  type PatchMetadata,
} from './publish';

// Local file import/export
export { exportProjectToZip } from './export-local';
export { importProjectFromZip, selectZipFile, importFromZipFile } from './import-local';

// Build output
export { runBuild } from './build-runner';

// Lightweight VFS content hash (local build cache: git walk based)
export { computeVfsContentHash } from './vfs-content-hash';
