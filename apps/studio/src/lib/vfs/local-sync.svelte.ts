/**
 * Local Sync Service
 * 
 * Syncs VFS with a local filesystem directory using the File System API.
 * Uses FileSystemObserver for real-time sync when available, falls back to manual sync.
 * 
 * The local directory is the authoritative data source - changes flow from local to VFS.
 * Respects .gitignore files to filter out ignored files.
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import ignore, { type Ignore } from 'ignore';

// ============================================================================
// Types
// ============================================================================

export type LocalSyncStatus = 'disconnected' | 'connecting' | 'synced' | 'syncing';

export interface LocalSyncState {
	status: LocalSyncStatus;
	error: string | null;
	lastSyncTime: Date | null;
	/** Whether FileSystemObserver is supported in this browser */
	observerSupported: boolean;
	/** Name of the connected directory */
	directoryName: string | null;
}

export interface LocalSync {
	readonly state: LocalSyncState;
	
	/** Open directory picker and start syncing */
	connect(): Promise<void>;
	
	/** Disconnect from local directory */
	disconnect(): void;
	
	/** Manually trigger a full sync (when Observer is not available) */
	manualSync(): Promise<void>;
}

// ============================================================================
// FileSystemObserver Types (not yet in TypeScript lib)
// ============================================================================

interface FileSystemObserverCallback {
	(records: FileSystemChangeRecord[], observer: FileSystemObserver): void;
}

interface FileSystemObserverObserveOptions {
	recursive?: boolean;
}

interface FileSystemObserver {
	observe(handle: FileSystemHandle, options?: FileSystemObserverObserveOptions): Promise<void>;
	disconnect(): void;
}

interface FileSystemObserverConstructor {
	new(callback: FileSystemObserverCallback): FileSystemObserver;
}

interface FileSystemChangeRecord {
	readonly changedHandle: FileSystemHandle;
	readonly relativePathComponents: readonly string[];
	readonly type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored';
	readonly relativePathMovedFrom?: readonly string[];
}

// File System Access API extensions (not fully in TypeScript lib yet)
interface FileSystemDirectoryHandleExt extends FileSystemDirectoryHandle {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface FileSystemHandlePermissionDescriptor {
	mode: 'read' | 'readwrite';
}

declare global {
	interface Window {
		FileSystemObserver?: FileSystemObserverConstructor;
		showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
	}
	
	interface FileSystemHandle {
		requestPermission(descriptor: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	}
}

// ============================================================================
// IndexedDB Persistence for Directory Handle
// ============================================================================

const DB_NAME = 'pubwiki-local-sync';
const STORE_NAME = 'handles';

async function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
	});
}

async function saveDirectoryHandle(nodeId: string, handle: FileSystemDirectoryHandle): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.put(handle, `local-sync-${nodeId}`);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
		tx.oncomplete = () => db.close();
	});
}

async function loadDirectoryHandle(nodeId: string): Promise<FileSystemDirectoryHandle | null> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(`local-sync-${nodeId}`);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result ?? null);
			tx.oncomplete = () => db.close();
		});
	} catch {
		return null;
	}
}

async function clearDirectoryHandle(nodeId: string): Promise<void> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const request = store.delete(`local-sync-${nodeId}`);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
			tx.oncomplete = () => db.close();
		});
	} catch {
		// Ignore errors when clearing
	}
}

// ============================================================================
// Implementation
// ============================================================================

class LocalSyncImpl implements LocalSync {
	private directoryHandle: FileSystemDirectoryHandle | null = null;
	private observer: FileSystemObserver | null = null;
	private vfs: Vfs<VfsProvider>;
	private nodeId: string;
	/** Gitignore filter instance */
	private gitignore: Ignore | null = null;
	
	_state = $state<LocalSyncState>({
		status: 'disconnected',
		error: null,
		lastSyncTime: null,
		observerSupported: typeof window !== 'undefined' && 'FileSystemObserver' in window,
		directoryName: null
	});

	constructor(vfs: Vfs<VfsProvider>, nodeId: string) {
		this.vfs = vfs;
		this.nodeId = nodeId;
		
		// Try to restore previous connection
		this.tryRestoreConnection();
	}

	get state(): LocalSyncState {
		return this._state;
	}

	/**
	 * Load and parse .gitignore file from the directory
	 */
	private async loadGitignore(dirHandle: FileSystemDirectoryHandle): Promise<void> {
		this.gitignore = ignore();
		
		// Always ignore .git directory
		this.gitignore.add('.git');
		
		try {
			const gitignoreHandle = await dirHandle.getFileHandle('.gitignore');
			const file = await gitignoreHandle.getFile();
			const content = await file.text();
			this.gitignore.add(content);
			console.log('[LocalSync] Loaded .gitignore rules');
		} catch {
			// No .gitignore file, that's fine
			console.log('[LocalSync] No .gitignore file found');
		}
	}

	/**
	 * Check if a path should be ignored based on gitignore rules
	 * @param relativePath - Path relative to the root directory (without leading slash)
	 * @param isDirectory - Whether the path is a directory
	 */
	private isIgnored(relativePath: string, isDirectory: boolean = false): boolean {
		if (!this.gitignore) return false;
		
		// Remove leading slash for ignore check
		const path = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
		if (!path) return false;
		
		// For directories, append trailing slash as per gitignore spec
		const checkPath = isDirectory ? `${path}/` : path;
		return this.gitignore.ignores(checkPath);
	}

	/**
	 * Try to restore a previously saved directory handle
	 */
	private async tryRestoreConnection(): Promise<void> {
		try {
			const handle = await loadDirectoryHandle(this.nodeId);
			if (!handle) return;
			
			// Check if we still have permission
			const permission = await handle.requestPermission({ mode: 'read' });
			if (permission !== 'granted') {
				await clearDirectoryHandle(this.nodeId);
				return;
			}
			
			// Restore connection
			this.directoryHandle = handle;
			this._state.directoryName = handle.name;
			this._state.status = 'synced';
			
			// Load gitignore rules
			await this.loadGitignore(handle);
			
			// Setup observer if supported
			if (this._state.observerSupported) {
				this.setupObserver();
			}
			
			// Do initial sync
			await this.syncFromLocal();
			
			console.log(`[LocalSync] Restored connection to "${handle.name}"`);
		} catch (err) {
			console.warn('[LocalSync] Failed to restore connection:', err);
			await clearDirectoryHandle(this.nodeId);
		}
	}

	async connect(): Promise<void> {
		// Disconnect any existing connection
		this.disconnect();

		this._state.status = 'connecting';
		this._state.error = null;

		try {
			// Open directory picker
			const handle = await window.showDirectoryPicker({
				mode: 'read'
			});
			
			this.directoryHandle = handle;
			this._state.directoryName = handle.name;
			
			// Save handle for persistence
			await saveDirectoryHandle(this.nodeId, handle);
			
			// Load gitignore rules
			await this.loadGitignore(handle);
			
			// Setup observer if supported
			if (this._state.observerSupported) {
				this.setupObserver();
			}
			
			// Do initial full sync
			await this.syncFromLocal();
			
			this._state.status = 'synced';
			this._state.lastSyncTime = new Date();
			
			console.log(`[LocalSync] Connected to "${handle.name}"`);
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				// User cancelled the picker
				this._state.status = 'disconnected';
				return;
			}
			
			const errorMessage = err instanceof Error ? err.message : 'Connection failed';
			this._state.error = errorMessage;
			this._state.status = 'disconnected';
			throw err;
		}
	}

	disconnect(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		
		this.directoryHandle = null;
		this.gitignore = null;
		
		// Clear persisted handle
		clearDirectoryHandle(this.nodeId);
		
		this._state = {
			status: 'disconnected',
			error: null,
			lastSyncTime: null,
			observerSupported: this._state.observerSupported,
			directoryName: null
		};
	}

	async manualSync(): Promise<void> {
		if (!this.directoryHandle) {
			throw new Error('Not connected to a local directory');
		}
		
		// Check permission
		const permission = await this.directoryHandle.requestPermission({ mode: 'read' });
		if (permission !== 'granted') {
			this._state.error = 'Permission denied';
			this.disconnect();
			return;
		}
		
		this._state.status = 'syncing';
		this._state.error = null;
		
		try {
			await this.syncFromLocal();
			this._state.status = 'synced';
			this._state.lastSyncTime = new Date();
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Sync failed';
			this._state.error = errorMessage;
			this._state.status = 'synced'; // Keep connected state
			throw err;
		}
	}

	/**
	 * Setup FileSystemObserver for real-time sync
	 */
	private setupObserver(): void {
		if (!this.directoryHandle || !window.FileSystemObserver) return;
		
		this.observer = new window.FileSystemObserver(async (records) => {
			console.log('[LocalSync] File changes detected:', records.length);
			
			for (const record of records) {
				try {
					await this.handleFileChange(record);
				} catch (err) {
					console.error('[LocalSync] Error handling file change:', err);
				}
			}
			
			this._state.lastSyncTime = new Date();
		});
		
		// Use recursive: true to observe all subdirectories
		this.observer.observe(this.directoryHandle, { recursive: true }).catch((err) => {
			console.error('[LocalSync] Failed to observe directory:', err);
		});
	}

	/**
	 * Handle a single file change event
	 */
	private async handleFileChange(record: FileSystemChangeRecord): Promise<void> {
		const relativePath = '/' + record.relativePathComponents.join('/');
		
		// Skip ignored files based on gitignore rules
		const isDir = record.changedHandle?.kind === 'directory';
		if (this.isIgnored(relativePath, isDir)) {
			return;
		}
		
		switch (record.type) {
			case 'appeared': {
				// File or folder created
				if (record.changedHandle.kind === 'file') {
					const fileHandle = record.changedHandle as FileSystemFileHandle;
					const file = await fileHandle.getFile();
					const content = await file.arrayBuffer();
					
					try {
						await this.vfs.createFile(relativePath, content);
					} catch {
						// File might exist, try to update
						await this.vfs.updateFile(relativePath, content);
					}
				} else {
					try {
						await this.vfs.createFolder(relativePath);
					} catch {
						// Folder might already exist
					}
				}
				break;
			}
			
			case 'disappeared': {
				// File or folder deleted
				try {
					const stat = await this.vfs.stat(relativePath);
					if (stat.isFile) {
						await this.vfs.deleteFile(relativePath);
					} else {
						await this.vfs.deleteFolder(relativePath, true);
					}
				} catch {
					// Already deleted
				}
				break;
			}
			
			case 'modified': {
				// File modified
				if (record.changedHandle.kind === 'file') {
					const fileHandle = record.changedHandle as FileSystemFileHandle;
					const file = await fileHandle.getFile();
					const content = await file.arrayBuffer();
					await this.vfs.updateFile(relativePath, content);
				}
				break;
			}
			
			case 'moved': {
				// File or folder moved
				if (record.relativePathMovedFrom) {
					const fromPath = '/' + record.relativePathMovedFrom.join('/');
					await this.vfs.moveItem(fromPath, relativePath);
				}
				break;
			}
		}
	}

	/**
	 * Full sync from local directory to VFS
	 */
	private async syncFromLocal(): Promise<void> {
		if (!this.directoryHandle) return;
		
		console.log('[LocalSync] Starting full sync...');
		const startTime = performance.now();
		
		// Track existing paths in VFS for deletion detection
		const existingPaths = new Set<string>();
		await this.collectExistingPaths('/', existingPaths);
		
		// Track paths we find in local directory
		const localPaths = new Set<string>();
		
		// Sync all files from local to VFS
		await this.syncDirectory(this.directoryHandle, '/', localPaths);
		
		// Delete files that exist in VFS but not in local
		for (const path of existingPaths) {
			if (!localPaths.has(path)) {
				try {
					const stat = await this.vfs.stat(path);
					if (stat.isFile) {
						await this.vfs.deleteFile(path);
					} else {
						await this.vfs.deleteFolder(path, true);
					}
					console.log(`[LocalSync] Deleted: ${path}`);
				} catch {
					// Already deleted
				}
			}
		}
		
		console.log(`[LocalSync] Full sync completed in ${(performance.now() - startTime).toFixed(2)}ms`);
	}

	/**
	 * Recursively collect existing paths in VFS
	 */
	private async collectExistingPaths(path: string, paths: Set<string>): Promise<void> {
		try {
			const entries = await this.vfs.listFolder(path);
			for (const entry of entries) {
				paths.add(entry.path);
				if ('children' in entry || entry.path.endsWith('/')) {
					// It's a folder
					await this.collectExistingPaths(entry.path, paths);
				}
			}
		} catch {
			// Folder doesn't exist
		}
	}

	/**
	 * Recursively sync a directory from local to VFS
	 */
	private async syncDirectory(
		dirHandle: FileSystemDirectoryHandle,
		basePath: string,
		localPaths: Set<string>
	): Promise<void> {
		const dirHandleExt = dirHandle as FileSystemDirectoryHandleExt;
		for await (const [name, handle] of dirHandleExt.entries()) {
			const fullPath = basePath === '/' ? `/${name}` : `${basePath}/${name}`;
			
			// Skip ignored files/folders based on gitignore rules
			if (this.isIgnored(fullPath, handle.kind === 'directory')) {
				continue;
			}
			
			localPaths.add(fullPath);
			
			if (handle.kind === 'file') {
				// Sync file
				const fileHandle = handle as FileSystemFileHandle;
				const file = await fileHandle.getFile();
				const content = await file.arrayBuffer();
				
				try {
					// Check if file exists and has same content
					const existing = await this.vfs.readFile(fullPath);
					if (existing.content && typeof existing.content !== 'string') {
						const existingArray = new Uint8Array(existing.content);
						const newArray = new Uint8Array(content);
						
						// Skip if content is the same
						if (existingArray.length === newArray.length) {
							let same = true;
							for (let i = 0; i < existingArray.length; i++) {
								if (existingArray[i] !== newArray[i]) {
									same = false;
									break;
								}
							}
							if (same) continue;
						}
					}
					
					await this.vfs.updateFile(fullPath, content);
				} catch {
					// File doesn't exist, create it
					// Ensure parent directory exists
					const parentPath = fullPath.slice(0, fullPath.lastIndexOf('/'));
					if (parentPath && parentPath !== '/') {
						try {
							await this.vfs.createFolder(parentPath);
						} catch {
							// Parent might already exist
						}
					}
					await this.vfs.createFile(fullPath, content);
				}
			} else {
				// Sync folder
				try {
					await this.vfs.createFolder(fullPath);
				} catch {
					// Folder might already exist
				}
				
				// Recurse into subfolder
				await this.syncDirectory(handle as FileSystemDirectoryHandle, fullPath, localPaths);
			}
		}
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a LocalSync manager for a VFS instance.
 * The sync allows keeping VFS in sync with a local filesystem directory.
 */
export function createLocalSync(vfs: Vfs<VfsProvider>, nodeId: string): LocalSync {
	return new LocalSyncImpl(vfs, nodeId);
}
