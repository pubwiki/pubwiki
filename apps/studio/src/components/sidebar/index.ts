/**
 * Studio Sidebar Components
 */

export { default as StudioSidebar } from './StudioSidebar.svelte';
export type { EditorMode } from './StudioSidebar.svelte';
export { default as OverviewTab } from './OverviewTab.svelte';
export { default as PropertiesTab } from './PropertiesTab.svelte';
export { default as ProjectTab } from './ProjectTab.svelte';
export { default as ProjectMenu } from './ProjectMenu.svelte';
export { default as ProjectListModal } from './ProjectListModal.svelte';
export { default as SyncStatusIndicator } from './SyncStatusIndicator.svelte';

// Re-export from properties folder
export { VFSProperties, VFSGitPanel } from './properties';
