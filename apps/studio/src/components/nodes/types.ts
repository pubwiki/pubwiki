/**
 * Type definitions for node components
 */

import type { StudioNodeData } from '$lib/types';
import type { SnapshotEdge } from '$lib/version';

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
