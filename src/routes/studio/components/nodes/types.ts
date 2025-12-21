/**
 * Type definitions for node components
 */

import type { Node } from '@xyflow/svelte';
import type { StudioNodeData, BaseNodeData, NodeRef, SnapshotEdge } from '../../utils/types';

/**
 * Common props passed to all node types
 */
export interface BaseNodeProps {
	id: string;
	data: StudioNodeData;
	selected: boolean;
	isConnectable: boolean;
}

/**
 * Props for the node header component
 */
export interface NodeHeaderProps {
	nodeType: string;
	name?: string;
	headerBgClass: string;
	isPreviewing: boolean;
	isUsed: boolean;
	hasHistory: boolean;
	versionCount: number;
	previewVersionNumber: number | null;
	isEditingName: boolean;
	editingNameValue: string;
	onVersionClick?: () => void;
	onNameInputKeydown?: (e: KeyboardEvent) => void;
	onNameSave?: () => void;
}

/**
 * Preview state from context
 */
export interface PreviewState {
	content?: string;
	commit?: string;
	isUsed?: boolean;
	incomingEdges?: SnapshotEdge[];
}

/**
 * Node content renderer props
 */
export interface NodeContentProps {
	content: string;
	readonly?: boolean;
	placeholder?: string;
	className?: string;
	onchange?: (value: string) => void;
	onfocus?: () => void;
	onblur?: () => void;
}
