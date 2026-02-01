/**
 * InputNode module
 * 
 * Exports the InputNode component and its controller functions
 */

export { default as InputNode } from './InputNode.svelte';
export { 
	findConnectedVfsNodes,
	generate,
	type GenerationCallbacks
} from './controller.svelte';
