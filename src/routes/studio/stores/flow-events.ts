/**
 * Flow Events System
 * 
 * Provides a typed event system for node-specific logic to respond to
 * flow-level events (connections, deletions, etc.) without coupling
 * the page component to specific node implementations.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData } from '../utils/types';

// ============================================================================
// Event Types
// ============================================================================

export interface ConnectionEvent {
	type: 'connection';
	source: string;
	target: string;
	sourceHandle: string | null;
	targetHandle: string | null;
	/** Current nodes state (read-only snapshot for inspection) */
	nodes: Node<StudioNodeData>[];
	/** Current edges state (read-only snapshot for inspection) */
	edges: Edge[];
	/** Callback to update nodes */
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void;
	/** Callback to update edges */
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
}

export interface EdgeDeleteEvent {
	type: 'edge-delete';
	edge: Edge;
	/** Callback to update nodes */
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void;
}

export interface NodeDeleteEvent {
	type: 'node-delete';
	node: Node<StudioNodeData>;
}

export type FlowEvent = ConnectionEvent | EdgeDeleteEvent | NodeDeleteEvent;

// ============================================================================
// Event Handler Registry
// ============================================================================

export type ConnectionHandler = (event: ConnectionEvent) => boolean;
export type EdgeDeleteHandler = (event: EdgeDeleteEvent) => void;
export type NodeDeleteHandler = (event: NodeDeleteEvent) => void;

interface EventHandlers {
	connection: ConnectionHandler[];
	'edge-delete': EdgeDeleteHandler[];
	'node-delete': NodeDeleteHandler[];
}

const handlers: EventHandlers = {
	connection: [],
	'edge-delete': [],
	'node-delete': []
};

// ============================================================================
// Registration Functions
// ============================================================================

/**
 * Register a connection handler.
 * Handler returns true if it handled the connection (prevents default edge creation).
 */
export function onConnection(handler: ConnectionHandler): () => void {
	handlers.connection.push(handler);
	return () => {
		const idx = handlers.connection.indexOf(handler);
		if (idx >= 0) handlers.connection.splice(idx, 1);
	};
}

/**
 * Register an edge delete handler.
 */
export function onEdgeDelete(handler: EdgeDeleteHandler): () => void {
	handlers['edge-delete'].push(handler);
	return () => {
		const idx = handlers['edge-delete'].indexOf(handler);
		if (idx >= 0) handlers['edge-delete'].splice(idx, 1);
	};
}

/**
 * Register a node delete handler.
 */
export function onNodeDelete(handler: NodeDeleteHandler): () => void {
	handlers['node-delete'].push(handler);
	return () => {
		const idx = handlers['node-delete'].indexOf(handler);
		if (idx >= 0) handlers['node-delete'].splice(idx, 1);
	};
}

// ============================================================================
// Event Dispatching
// ============================================================================

/**
 * Dispatch a connection event.
 * Returns true if any handler handled it (prevents default).
 */
export function dispatchConnection(event: ConnectionEvent): boolean {
	for (const handler of handlers.connection) {
		if (handler(event)) return true;
	}
	return false;
}

/**
 * Dispatch edge delete events.
 */
export function dispatchEdgeDeletes(
	edges: Edge[],
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void
): void {
	for (const edge of edges) {
		const event: EdgeDeleteEvent = {
			type: 'edge-delete',
			edge,
			updateNodes
		};
		for (const handler of handlers['edge-delete']) {
			handler(event);
		}
	}
}

/**
 * Dispatch node delete events.
 */
export function dispatchNodeDeletes(nodes: Node<StudioNodeData>[]): void {
	for (const node of nodes) {
		const event: NodeDeleteEvent = {
			type: 'node-delete',
			node
		};
		for (const handler of handlers['node-delete']) {
			handler(event);
		}
	}
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all handlers (useful for testing or page unmount)
 */
export function clearAllHandlers(): void {
	handlers.connection = [];
	handlers['edge-delete'] = [];
	handlers['node-delete'] = [];
}
