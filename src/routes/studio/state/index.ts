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
