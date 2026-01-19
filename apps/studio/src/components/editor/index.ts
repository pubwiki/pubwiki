/**
 * Editor module exports
 * 
 * Rich text editor components with reftag support using Lexical
 */

export { RefTagNode, $createRefTagNode, $isRefTagNode, type SerializedRefTagNode } from './RefTagNode';
export { default as RefTagPlugin } from './RefTagPlugin.svelte';
export { default as RefTagEditor } from './RefTagEditor.svelte';
export type { ContentBlock, TextBlock, RefTagBlock } from './content-block';
export { blocksToText, getRefTagNamesFromBlocks, textToBlocks } from './content-block';
