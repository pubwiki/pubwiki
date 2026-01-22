/**
 * VFSNode Controller
 * 
 * Manages VFS node state including:
 * - VFS instance lifecycle
 * - File tree service (shared between VFSNode and VFSProperties)
 * - Reactive file tree state
 * - VSCode link for remote editing
 */

import { getNodeVfs, VfsFileTreeService, createVSCodeLink, type VersionedVfs, type VSCodeLink } from '$lib/vfs';
import type { FileItem } from '@pubwiki/ui/components';

// ============================================================================
// Types
// ============================================================================

export interface UploadState {
	isUploading: boolean;
	progress: { current: number; total: number } | null;
}

export interface VfsController {
	readonly vfs: VersionedVfs;
	readonly fileTreeService: VfsFileTreeService;
	readonly fileTree: FileItem[];
	readonly isLoading: boolean;
	readonly error: string | null;
	/** Shared reactive upload state - access .isUploading and .progress directly */
	readonly uploadState: UploadState;
	/** VSCode link for remote editing */
	readonly vscodeLink: VSCodeLink;
	setUploading(uploading: boolean, progress?: { current: number; total: number }): void;
	dispose(): void;
}

// ============================================================================
// Controller Cache - One controller per node
// ============================================================================

const controllerCache = new Map<string, VfsControllerImpl>();

class VfsControllerImpl implements VfsController {
	private _vfs: VersionedVfs;
	private _fileTreeService: VfsFileTreeService;
	private _vscodeLink: VSCodeLink;
	private _fileTree = $state<FileItem[]>([]);
	private _isLoading = $state(true);
	private _error = $state<string | null>(null);
	private _refCount = 0;
	private _disposed = false;
	private _nodeId: string;
	
	/** Shared reactive upload state object */
	uploadState = $state<UploadState>({ isUploading: false, progress: null });

	constructor(vfs: VersionedVfs, nodeId: string) {
		this._vfs = vfs;
		this._nodeId = nodeId;
		this._fileTreeService = new VfsFileTreeService(vfs, (newTree) => {
			if (!this._disposed) {
				this._fileTree = newTree;
			}
		});
		this._vscodeLink = createVSCodeLink(vfs);
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

	get vfs(): VersionedVfs {
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
		const vfs = await getNodeVfs(projectId, nodeId);
		console.log(`[VFS:Controller] ${nodeId} getNodeVfs took ${(performance.now() - vfsStart).toFixed(2)}ms`);
		
		const newController = new VfsControllerImpl(vfs, nodeId);
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
