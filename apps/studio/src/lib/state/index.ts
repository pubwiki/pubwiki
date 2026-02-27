/**
 * Studio State - Unified exports
 */

export {
  setStudioContext,
  getStudioContext,
  type StudioContext,
  type PreviewState
} from './context';

export {
  dispatchConnection,
  dispatchEdgeDeletes,
  dispatchNodeDeletes,
  onConnection,
  onEdgeDelete,
  onNodeDelete,
  clearAllHandlers,
  type ConnectionEvent,
  type EdgeDeleteEvent,
  type NodeDeleteEvent,
  type ConnectionHandler,
  type EdgeDeleteHandler,
  type NodeDeleteHandler
} from './flow-events';

export {
  getPendingConfirmation,
  requestConfirmation,
  respondConfirmation,
  type ConfirmationType,
  type FormComponentProps,
  type PendingConfirmation
} from './pubwiki-confirm.svelte';

export {
  getVfsDropTarget,
  setVfsDropTarget,
  clearVfsDropTarget,
  type VfsDropTarget
} from './vfs-drop-target.svelte';

