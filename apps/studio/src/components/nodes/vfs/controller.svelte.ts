/**
 * VFSNode Controller
 * 
 * Manages VFS node state including:
 * - NodeVfs instance lifecycle (unified interface with file ops + version control)
 * - File tree service (shared between VFSNode and VFSProperties)
 * - Reactive file tree state
 * - VSCode link for remote editing
 * - VFS-to-VFS mount handling via drag-to-folder gesture
 * 
 * IMPORTANT: All VFS operations go through NodeVfs, which is the unified interface
 * that includes both file operations and version control. The NodeVfs automatically
 * handles mount configurations and supports nested mounts.
 */

import { getNodeVfs, invalidateNodeVfs, VfsFileTreeService, createVSCodeLink, type VSCodeLink, type NodeVfs } from '$lib/vfs';
import { nodeStore } from '$lib/persistence';
import { onEdgeDelete } from '$lib/state';
import { isVfsMountHandle, getMountIdFromHandle } from '$lib/graph';
import type { VFSNodeData, VFSContent, VfsMountConfig } from '$lib/types';
import type { FileItem } from '@pubwiki/ui/components';

// ============================================================================
// Types
// ============================================================================

export interface UploadState {
	isUploading: boolean;
	progress: { current: number; total: number } | null;
}

export interface VfsController {
	/** 
	 * The unified VFS interface - includes file operations, mount support, and version control.
	 * This is the ONLY VFS interface exposed by the controller.
	 */
	readonly vfs: NodeVfs;
	readonly fileTreeService: VfsFileTreeService;
	readonly fileTree: FileItem[];
	readonly isLoading: boolean;
	readonly error: string | null;
	/** Shared reactive upload state - access .isUploading and .progress directly */
	readonly uploadState: UploadState;
	/** VSCode link for remote editing */
	readonly vscodeLink: VSCodeLink;
	setUploading(uploading: boolean, progress?: { current: number; total: number }): void;
	/** Reload VFS with updated mount configuration */
	reloadMounts(): Promise<void>;
	dispose(): void;
}

// ============================================================================
// Controller Cache - One controller per node
// ============================================================================

const controllerCache = new Map<string, VfsControllerImpl>();

class VfsControllerImpl implements VfsController {
	/** The unified NodeVfs - includes file operations, mounts, and version control */
	private _vfs: NodeVfs;
	private _fileTreeService: VfsFileTreeService;
	private _vscodeLink: VSCodeLink;
	private _fileTree = $state<FileItem[]>([]);
	private _isLoading = $state(true);
	private _error = $state<string | null>(null);
	private _refCount = 0;
	private _disposed = false;
	private _nodeId: string;
	private _projectId: string;
	
	/** Shared reactive upload state object */
	uploadState = $state<UploadState>({ isUploading: false, progress: null });
	
	/** Event unsubscribers */
	private _eventUnsubscribers: Array<() => void> = [];

	constructor(vfs: NodeVfs, nodeId: string, projectId: string) {
		this._vfs = vfs;
		this._nodeId = nodeId;
		this._projectId = projectId;
		
		// File tree service uses NodeVfs directly (it's already a Vfs with mount support)
		this._fileTreeService = new VfsFileTreeService(this._vfs, (newTree) => {
			if (!this._disposed) {
				this._fileTree = newTree;
			}
		});
		
		// VSCode link uses the NodeVfs for editing
		this._vscodeLink = createVSCodeLink(this._vfs);
		
		// Setup event listeners
		this.setupEventListeners();
	}
	
	/**
	 * Setup event listeners for mount updates
	 */
	private setupEventListeners(): void {
		// Listen for mount:moved events to update persistent mount configuration
		this._eventUnsubscribers.push(
			this._vfs.events.on('mount:moved', (e) => {
				this.handleMountMoved(e.fromPath, e.toPath, e.mountedId);
			})
		);
	}
	
	/**
	 * Handle mount:moved event - update persistent mount configuration
	 */
	private handleMountMoved(fromPath: string, toPath: string, mountedId?: string): void {
		if (!mountedId) {
			console.warn('[VFS:Controller] mount:moved event without mountedId, cannot update config');
			return;
		}
		
		// Get current node data
		const nodeData = nodeStore.get(this._nodeId);
		if (!nodeData || nodeData.type !== 'VFS') {
			return;
		}
		
		const content = nodeData.content as VFSContent;
		
		// Find the mount with matching sourceNodeId
		const mount = content.mounts.find(m => m.sourceNodeId === mountedId);
		if (!mount) {
			console.warn(`[VFS:Controller] No mount found for sourceNodeId: ${mountedId}`);
			return;
		}
		
		// Update the mount path in nodeStore
		nodeStore.update(this._nodeId, (data) => {
			const vfsData = data as VFSNodeData;
			return {
				...vfsData,
				content: vfsData.content.updateMountPath(mount.id, toPath)
			};
		});
		
		console.log(`[VFS:Controller] Updated mount path: ${fromPath} -> ${toPath} (sourceNodeId: ${mountedId})`);
	}

	async initialize(): Promise<void> {
		console.log(`[VFS:Controller] ${this._nodeId} initializing...`);
		const startTime = performance.now();
		try {
			await this._fileTreeService.initialize();
			this._isLoading = false;
			console.log(`[VFS:Controller] ${this._nodeId} initialized in ${(performance.now() - startTime).toFixed(2)}ms`);
		} catch (err) {
			console.error('[VfsController] Failed to initialize:', err);
			this._error = err instanceof Error ? err.message : 'Failed to initialize';
			this._isLoading = false;
		}
	}
	
	/**
	 * Reload VFS with updated mount configuration.
	 * Call this when mount configuration changes.
	 */
	async reloadMounts(): Promise<void> {
		console.log(`[VFS:Controller] ${this._nodeId} reloading mounts...`);
		
		// Clean up old event listeners (they're attached to old VFS)
		for (const unsub of this._eventUnsubscribers) {
			unsub();
		}
		this._eventUnsubscribers = [];
		
		// Invalidate the cached NodeVfs to force recreation with new mounts
		invalidateNodeVfs(this._projectId, this._nodeId);
		
		// Get the updated NodeVfs
		const newVfs = await getNodeVfs(this._projectId, this._nodeId);
		this._vfs = newVfs;
		
		// Re-setup event listeners for new VFS
		this.setupEventListeners();
		
		// Recreate file tree service with new VFS
		this._fileTreeService.dispose();
		this._fileTreeService = new VfsFileTreeService(this._vfs, (newTree) => {
			if (!this._disposed) {
				this._fileTree = newTree;
			}
		});
		
		// Reload file tree
		await this._fileTreeService.initialize();
		
		console.log(`[VFS:Controller] ${this._nodeId} mounts reloaded`);
	}

	/** Get the unified NodeVfs */
	get vfs(): NodeVfs {
		return this._vfs;
	}

	get fileTreeService(): VfsFileTreeService {
		return this._fileTreeService;
	}

	get fileTree(): FileItem[] {
		return this._fileTree;
	}

	get isLoading(): boolean {
		return this._isLoading;
	}

	get error(): string | null {
		return this._error;
	}

	get vscodeLink(): VSCodeLink {
		return this._vscodeLink;
	}

	setUploading(uploading: boolean, progress?: { current: number; total: number }): void {
		this.uploadState.isUploading = uploading;
		this.uploadState.progress = progress ?? null;
	}

	addRef(): void {
		this._refCount++;
	}

	release(): void {
		this._refCount--;
		if (this._refCount <= 0) {
			this.dispose();
			controllerCache.delete(this._nodeId);
		}
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		
		// Clean up event listeners
		for (const unsub of this._eventUnsubscribers) {
			unsub();
		}
		this._eventUnsubscribers = [];
		
		this._vscodeLink.disconnect();
		this._fileTreeService.dispose();
	}
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Cache for pending controller creation promises to prevent race conditions.
 * When multiple callers request the same controller simultaneously, they all
 * wait for the same promise instead of creating duplicate controllers.
 */
const pendingControllers = new Map<string, Promise<VfsControllerImpl>>();

/**
 * Get or create a VFS controller for a node.
 * The controller is reference-counted and shared between VFSNode and VFSProperties.
 * Call release() when done to allow cleanup.
 */
export async function getVfsController(
	projectId: string,
	nodeId: string
): Promise<VfsControllerImpl> {
	console.log(`[VFS:Controller] getVfsController called for ${nodeId}`);
	const totalStart = performance.now();
	
	// Check cache first
	let controller = controllerCache.get(nodeId);
	
	if (controller) {
		console.log(`[VFS:Controller] ${nodeId} found in cache`);
		controller.addRef();
		return controller;
	}

	// Check if there's already a pending creation
	let pending = pendingControllers.get(nodeId);
	if (pending) {
		console.log(`[VFS:Controller] ${nodeId} creation already pending, waiting...`);
		const ctrl = await pending;
		ctrl.addRef();
		console.log(`[VFS:Controller] ${nodeId} pending resolved in ${(performance.now() - totalStart).toFixed(2)}ms`);
		return ctrl;
	}

	console.log(`[VFS:Controller] ${nodeId} creating new controller...`);
	
	// Create new controller with promise caching to prevent race conditions
	const createPromise = (async () => {
		const vfsStart = performance.now();
		// Get the complete NodeVfs with all mounts
		const vfs = await getNodeVfs(projectId, nodeId);
		console.log(`[VFS:Controller] ${nodeId} getNodeVfs took ${(performance.now() - vfsStart).toFixed(2)}ms`);
		
		const newController = new VfsControllerImpl(vfs, nodeId, projectId);
		controllerCache.set(nodeId, newController);
		newController.addRef();
		
		// Initialize
		const initStart = performance.now();
		await newController.initialize();
		console.log(`[VFS:Controller] ${nodeId} controller.initialize took ${(performance.now() - initStart).toFixed(2)}ms`);
		
		return newController;
	})();
	
	pendingControllers.set(nodeId, createPromise);
	
	try {
		controller = await createPromise;
		console.log(`[VFS:Controller] ${nodeId} TOTAL getVfsController: ${(performance.now() - totalStart).toFixed(2)}ms`);
		return controller;
	} finally {
		// Clean up pending promise
		pendingControllers.delete(nodeId);
	}
}

/**
 * Release a controller reference. Call this when component unmounts.
 */
export function releaseVfsController(nodeId: string): void {
	const controller = controllerCache.get(nodeId);
	if (controller) {
		controller.release();
	}
}

// ============================================================================
// VFS Mount Event Handlers
// ============================================================================

/**
 * Check if a mount path conflicts with existing paths in the target VFS.
 * This is an async check that validates against the actual file system.
 */
async function checkMountPathConflict(
	targetNodeId: string,
	mountPath: string,
	targetContent: VFSContent
): Promise<string | null> {
	// Check if it conflicts with another mount path
	const existingMountConflict = targetContent.mounts.find(m => m.mountPath === mountPath);
	if (existingMountConflict) {
		return `Mount path "${mountPath}" is already used by another mounted VFS`;
	}
	
	// Check if the path exists in the target VFS (file or folder)
	const controller = controllerCache.get(targetNodeId);
	if (controller) {
		try {
			const exists = await controller.vfs.exists(mountPath);
			if (exists) {
				return `Path "${mountPath}" already exists in the VFS`;
			}
		} catch {
			// Path doesn't exist, no conflict
		}
	}
	
	return null;
}

// ============================================================================
// VFS Mount Event Handlers (Deprecated - edge-based mounting removed)
// ============================================================================

// Note: VFS-to-VFS mounting is now done via drag-to-folder gesture.
// The createMountToFolder() function handles mount creation.
// Edge-based mount handling (handleVfsMountConnection, handleVfsMountEdgeDelete) has been removed.

// ============================================================================
// Event Handler Registration
// ============================================================================

/**
 * Handle VFS mount edge deletion.
 * When an edge connecting to a VFS mount handle is deleted, remove the mount configuration.
 */
function handleVfsMountEdgeDelete(event: { edge: { target: string; targetHandle?: string | null } }): void {
	const { edge } = event;
	
	// Only handle VFS mount handle edges
	if (!isVfsMountHandle(edge.targetHandle)) {
		return;
	}
	
	const mountId = getMountIdFromHandle(edge.targetHandle!);
	const targetNodeId = edge.target;
	
	// Get target node data
	const targetData = nodeStore.get(targetNodeId);
	if (!targetData || targetData.type !== 'VFS') {
		return;
	}
	
	const content = targetData.content as VFSContent;
	
	// Check if mount exists
	const mount = content.mounts.find(m => m.id === mountId);
	if (!mount) {
		console.warn(`[VFS:EdgeDelete] Mount ${mountId} not found in node ${targetNodeId}`);
		return;
	}
	
	// Remove mount from persistent config
	nodeStore.update(targetNodeId, (data) => {
		const vfsData = data as VFSNodeData;
		return {
			...vfsData,
			content: vfsData.content.removeMount(mountId)
		};
	});
	
	// Trigger VFS controller reload if it exists
	const controller = controllerCache.get(targetNodeId);
	if (controller) {
		// Reload mounts to unmount the removed VFS
		controller.reloadMounts().catch(err => {
			console.error(`[VFS:EdgeDelete] Failed to reload mounts for ${targetNodeId}:`, err);
		});
	}
	
	console.log(`[VFS:EdgeDelete] Removed mount ${mountId} (path: ${mount.mountPath}) from node ${targetNodeId}`);
}

/**
 * Register VFS node event handlers
 * Should be called once during app initialization
 * 
 * Handles:
 * - Edge delete: When a VFS mount edge is deleted, remove the mount configuration
 */
export function registerVfsNodeHandlers(): () => void {
	// Register edge delete handler for VFS mount edges
	const unsubscribeEdgeDelete = onEdgeDelete(handleVfsMountEdgeDelete);
	
	return () => {
		unsubscribeEdgeDelete();
	};
}

// ============================================================================
// Drag-to-Folder Mount API
// ============================================================================

/**
 * Create a VFS mount by dragging to a folder.
 * Called when user drags from a VFS node's output handle and drops on a folder in another VFS.
 * 
 * @param sourceNodeId - The VFS node being mounted (source of the drag)
 * @param targetNodeId - The VFS node receiving the mount (contains the drop target folder)
 * @param targetFolderPath - The folder path where the mount should be created
 * @returns Promise that resolves with mount config when created, or null if failed
 */
export async function createMountToFolder(
	sourceNodeId: string,
	targetNodeId: string,
	targetFolderPath: string
): Promise<VfsMountConfig | null> {
	// Prevent self-mount
	if (sourceNodeId === targetNodeId) {
		console.warn('[VFS:Mount] Cannot mount a VFS to itself');
		return null;
	}

	// Get source node data (the VFS being mounted)
	const sourceData = nodeStore.get(sourceNodeId);
	if (!sourceData || sourceData.type !== 'VFS') {
		console.warn('[VFS:Mount] Source node is not a VFS node');
		return null;
	}

	// Get target node data (the VFS receiving the mount)
	const targetData = nodeStore.get(targetNodeId);
	if (!targetData || targetData.type !== 'VFS') {
		console.warn('[VFS:Mount] Target node is not a VFS node');
		return null;
	}

	const targetContent = targetData.content as VFSContent;

	// Check if this VFS is already mounted to the target - return existing mount
	const existingMount = targetContent.mounts.find(m => m.sourceNodeId === sourceNodeId);
	if (existingMount) {
		console.log(`[VFS:Mount] ${sourceNodeId} is already mounted to ${targetNodeId}`);
		return existingMount;
	}

	// Use source VFS node name as the mount folder name
	const mountName = sourceData.name || 'mounted';
	
	// Calculate the mount path - if dropping on root, use /{name}, otherwise {folderPath}/{name}
	const basePath = targetFolderPath === '/' ? '' : targetFolderPath;
	let mountPath = `${basePath}/${mountName}`;

	// Check for mount path conflicts
	const conflict = await checkMountPathConflict(targetNodeId, mountPath, targetContent);
	if (conflict) {
		// Generate unique path by appending a number
		let counter = 1;
		let uniquePath = `${mountPath}_${counter}`;
		while (await checkMountPathConflict(targetNodeId, uniquePath, targetContent)) {
			counter++;
			uniquePath = `${mountPath}_${counter}`;
		}
		mountPath = uniquePath;
		console.warn(`[VFS:Mount] Original path had conflict, using "${mountPath}": ${conflict}`);
	}

	// Create mount configuration
	const mount: VfsMountConfig = {
		id: crypto.randomUUID(),
		sourceNodeId,
		mountPath,
		sourceCommit: undefined
	};

	// Update target VFS content with new mount
	nodeStore.update(targetNodeId, (data) => {
		const vfsData = data as VFSNodeData;
		return {
			...vfsData,
			content: vfsData.content.addMount(mount)
		};
	});

	console.log(`[VFS:Mount] Mounted ${sourceNodeId} (${mountName}) to ${targetNodeId} at ${mountPath}`);

	// Refresh the target controller's mounts
	const targetController = controllerCache.get(targetNodeId);
	if (targetController) {
		await targetController.reloadMounts();
	}

	return mount;
}
