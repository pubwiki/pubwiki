/**
 * VFSNode module
 * 
 * Exports the VFSNode component and related views
 */

export { default as VFSNode } from './VFSNode.svelte';
export { default as VFSFileEditor } from './VFSFileEditor.svelte';
export { getVfsController, releaseVfsController, type VfsController } from './controller.svelte';
