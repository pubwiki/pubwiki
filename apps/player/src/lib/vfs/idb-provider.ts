/**
 * IndexedDB VFS Provider for Player
 *
 * Fallback VFS provider when OPFS is unavailable.
 * Uses raw IndexedDB (no extra dependencies) with one object store
 * keyed by normalized absolute path.
 *
 * Scoped per database name: `vfs-<scopeId>-<nodeId>`
 */

import type { VfsProvider, VfsStat } from '@pubwiki/vfs';

// ============================================================================
// Helpers
// ============================================================================

function posixError(code: string, message: string): NodeJS.ErrnoException {
	const err = new Error(message) as NodeJS.ErrnoException;
	err.code = code;
	return err;
}

function normalizePath(path: string): string {
	if (!path.startsWith('/')) path = '/' + path;
	if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
	return path;
}

function parentPath(path: string): string {
	const last = path.lastIndexOf('/');
	return last <= 0 ? '/' : path.substring(0, last);
}

// ============================================================================
// Types
// ============================================================================

interface IdbEntry {
	path: string; // primary key — normalized absolute path
	content: Uint8Array | null; // null for directories
	isDirectory: boolean;
	size: number;
	updatedAt: number;
}

const STORE_NAME = 'entries';

// ============================================================================
// IdbVfsProvider
// ============================================================================

export class IdbVfsProvider implements VfsProvider {
	private db: IDBDatabase | null = null;
	private readonly dbName: string;

	constructor(scopeId: string, nodeId: string) {
		this.dbName = `vfs-${scopeId}-${nodeId}`;
	}

	// ---- Lifecycle ----

	async initialize(): Promise<void> {
		if (this.db) return;
		this.db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open(this.dbName, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'path' });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		// Ensure root directory entry exists
		await this.ensureDir('/');
	}

	async dispose(): Promise<void> {
		this.db?.close();
		this.db = null;
	}

	// ---- Internal helpers ----

	private getDb(): IDBDatabase {
		if (!this.db) throw new Error('IdbVfsProvider not initialized');
		return this.db;
	}

	private tx(mode: IDBTransactionMode): IDBObjectStore {
		return this.getDb().transaction(STORE_NAME, mode).objectStore(STORE_NAME);
	}

	private req<T>(request: IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private async getEntry(path: string): Promise<IdbEntry | undefined> {
		return this.req<IdbEntry | undefined>(this.tx('readonly').get(path));
	}

	private async putEntry(entry: IdbEntry): Promise<void> {
		await this.req(this.tx('readwrite').put(entry));
	}

	private async deleteEntry(path: string): Promise<void> {
		await this.req(this.tx('readwrite').delete(path));
	}

	private async ensureDir(path: string): Promise<void> {
		const existing = await this.getEntry(path);
		if (existing) return;
		await this.putEntry({
			path,
			content: null,
			isDirectory: true,
			size: 0,
			updatedAt: Date.now(),
		});
	}

	private async ensureParents(path: string): Promise<void> {
		const parts = path.split('/').filter(Boolean);
		let current = '';
		for (let i = 0; i < parts.length - 1; i++) {
			current += '/' + parts[i];
			await this.ensureDir(current);
		}
	}

	// ---- VfsProvider implementation ----

	async readFile(path: string): Promise<Uint8Array> {
		const p = normalizePath(path);
		const entry = await this.getEntry(p);
		if (!entry || entry.isDirectory || !entry.content) {
			throw posixError('ENOENT', `No such file: ${p}`);
		}
		return entry.content;
	}

	async writeFile(path: string, content: Uint8Array): Promise<void> {
		const p = normalizePath(path);
		await this.ensureParents(p);
		await this.putEntry({
			path: p,
			content,
			isDirectory: false,
			size: content.byteLength,
			updatedAt: Date.now(),
		});
	}

	async unlink(path: string): Promise<void> {
		const p = normalizePath(path);
		const entry = await this.getEntry(p);
		if (!entry || entry.isDirectory) {
			throw posixError('ENOENT', `No such file: ${p}`);
		}
		await this.deleteEntry(p);
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const p = normalizePath(path);
		if (options?.recursive) {
			await this.ensureParents(p);
			await this.ensureDir(p);
		} else {
			const parent = parentPath(p);
			const parentEntry = await this.getEntry(parent);
			if (!parentEntry || !parentEntry.isDirectory) {
				throw posixError('ENOENT', `No such directory: ${parent}`);
			}
			await this.ensureDir(p);
		}
	}

	async readdir(path: string): Promise<string[]> {
		const p = normalizePath(path);
		const entry = await this.getEntry(p);
		if (!entry || !entry.isDirectory) {
			throw posixError('ENOENT', `No such directory: ${p}`);
		}

		const prefix = p === '/' ? '/' : p + '/';
		// Use a cursor to find direct children
		const entries: string[] = [];
		const store = this.tx('readonly');
		await new Promise<void>((resolve, reject) => {
			const cursor = store.openCursor();
			cursor.onsuccess = () => {
				const c = cursor.result;
				if (!c) { resolve(); return; }
				const key = c.key as string;
				if (key !== p && key.startsWith(prefix)) {
					const rest = key.slice(prefix.length);
					// Direct child: no further '/' in rest
					if (!rest.includes('/')) {
						entries.push(rest);
					}
				}
				c.continue();
			};
			cursor.onerror = () => reject(cursor.error);
		});
		return entries.sort();
	}

	async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const p = normalizePath(path);
		if (p === '/') throw new Error('Cannot remove root directory');

		if (options?.recursive) {
			// Delete all entries under this path
			const prefix = p + '/';
			const store = this.tx('readwrite');
			await new Promise<void>((resolve, reject) => {
				const cursor = store.openCursor();
				cursor.onsuccess = () => {
					const c = cursor.result;
					if (!c) { resolve(); return; }
					const key = c.key as string;
					if (key === p || key.startsWith(prefix)) {
						c.delete();
					}
					c.continue();
				};
				cursor.onerror = () => reject(cursor.error);
			});
		} else {
			const children = await this.readdir(p);
			if (children.length > 0) {
				throw posixError('ENOTEMPTY', `Directory not empty: ${p}`);
			}
			await this.deleteEntry(p);
		}
	}

	async stat(path: string): Promise<VfsStat> {
		const p = normalizePath(path);
		const entry = await this.getEntry(p);
		if (!entry) {
			throw posixError('ENOENT', `No such file or directory: ${p}`);
		}
		const date = new Date(entry.updatedAt);
		return {
			isFile: !entry.isDirectory,
			isDirectory: entry.isDirectory,
			size: entry.size,
			createdAt: date,
			updatedAt: date,
		};
	}

	async exists(path: string): Promise<boolean> {
		const p = normalizePath(path);
		const entry = await this.getEntry(p);
		return entry !== undefined;
	}

	async rename(from: string, to: string): Promise<void> {
		const content = await this.readFile(from);
		await this.writeFile(to, content);
		await this.unlink(from);
	}

	async copyFile(from: string, to: string): Promise<void> {
		const content = await this.readFile(from);
		await this.writeFile(to, content);
	}
}
