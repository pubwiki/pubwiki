/**
 * VFSNode Controller
 * 
 * Manages VFS node state including:
 * - VFS instance lifecycle
 * - File tree service (shared between VFSNode and VFSProperties)
 * - Reactive file tree state
 */

import { getNodeVfs, VfsFileTreeService, type VersionedVfs } from '../../../vfs';
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
	}

	async initialize(): Promise<void> {
		try {
			await this._fileTreeService.initialize();
			this._isLoading = false;
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

	setUploading(uploading: boolean, progress?: { current: number; total: number }): void {
		this.uploadState.isUploading = uploading;
		this.uploadState.progress = progress ?? null;
	}

	addRef(): void {
		this._refCount++;
	}

	release(): void {
		this._refCount--;
		console.log(`[VfsController] Released ${this._nodeId}, refCount: ${this._refCount}`);
		if (this._refCount <= 0) {
			console.log(`[VfsController] Disposing controller for ${this._nodeId}`);
			this.dispose();
			controllerCache.delete(this._nodeId);
		}
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		this._fileTreeService.dispose();
	}
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get or create a VFS controller for a node.
 * The controller is reference-counted and shared between VFSNode and VFSProperties.
 * Call release() when done to allow cleanup.
 */
export async function getVfsController(
	projectId: string,
	nodeId: string
): Promise<VfsControllerImpl> {
	// Check cache first
	let controller = controllerCache.get(nodeId);
	
	if (controller) {
		controller.addRef();
		console.log(`[VfsController] Reusing controller for ${nodeId}, refCount: ${controller['_refCount']}`);
		return controller;
	}

	// Create new controller
	console.log(`[VfsController] Creating new controller for ${nodeId}`);
	const vfs = await getNodeVfs(projectId, nodeId);
	controller = new VfsControllerImpl(vfs, nodeId);
	controllerCache.set(nodeId, controller);
	controller.addRef();
	
	// Initialize asynchronously
	await controller.initialize();
	
	return controller;
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
