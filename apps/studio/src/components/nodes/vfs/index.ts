/**
 * VFSNode module
 * 
 * Exports the VFSNode component and related views
 */

export { default as VFSNode } from './VFSNode.svelte';
export { default as VFSFileEditor } from './VFSFileEditor.svelte';
export { 
	getVfsController, 
	releaseVfsController, 
	registerVfsNodeHandlers,
	type VfsController 
} from './controller.svelte';
