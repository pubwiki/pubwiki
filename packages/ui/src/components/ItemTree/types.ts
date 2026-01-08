/**
 * Generic tree node interface - decoupled from any specific domain
 */
export interface TreeNode<T = unknown> {
	/** Unique identifier */
	id: string;
	/** Display name */
	label: string;
	/** Whether this is a leaf node (can be selected) */
	isLeaf: boolean;
	/** Child nodes */
	children: TreeNode<T>[];
	/** Optional data payload associated with this node */
	data?: T;
}

/**
 * Configuration for building a tree from flat data
 */
export interface TreeBuildConfig<TItem, TData = unknown> {
	/** Get the unique id from an item */
	getId: (item: TItem) => string;
	/** Get the display label from an item */
	getLabel: (item: TItem) => string;
	/** Get the parent id from an item (null/undefined for root nodes) */
	getParentId: (item: TItem) => string | null | undefined;
	/** Check if the item is a leaf node */
	isLeaf: (item: TItem) => boolean;
	/** Optional: transform item to node data payload */
	getData?: (item: TItem) => TData;
}

/**
 * Build a tree structure from a flat array of items
 */
export function buildTree<TItem, TData = unknown>(
	items: TItem[],
	config: TreeBuildConfig<TItem, TData>
): TreeNode<TData>[] {
	const { getId, getLabel, getParentId, isLeaf, getData } = config;
	
	// Create a map of id to node
	const nodeMap = new Map<string, TreeNode<TData>>();
	
	// Initialize all nodes
	for (const item of items) {
		const id = getId(item);
		nodeMap.set(id, {
			id,
			label: getLabel(item),
			isLeaf: isLeaf(item),
			children: [],
			data: getData?.(item)
		});
	}
	
	// Build tree structure
	const roots: TreeNode<TData>[] = [];
	for (const item of items) {
		const id = getId(item);
		const node = nodeMap.get(id)!;
		const parentId = getParentId(item);
		
		if (parentId) {
			const parent = nodeMap.get(parentId);
			if (parent) {
				parent.children.push(node);
			} else {
				// Orphan node, treat as root
				roots.push(node);
			}
		} else {
			roots.push(node);
		}
	}
	
	// Sort children by label
	const sortNodes = (nodes: TreeNode<TData>[]) => {
		nodes.sort((a, b) => a.label.localeCompare(b.label));
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);
	
	return roots;
}
