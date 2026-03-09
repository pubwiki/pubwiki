/**
 * OPFS Provider for Player
 *
 * Simplified OPFS-based VFS provider for read-only play mode.
 * No isomorphic-git — Player doesn't need version control.
 * Scoped to: navigator.storage.getDirectory() / <artifactId> / <nodeId> /
 */

import type { VfsProvider, VfsStat } from '@pubwiki/vfs';

function posixError(code: string, message: string): NodeJS.ErrnoException {
	const err = new Error(message) as NodeJS.ErrnoException;
	err.code = code;
	return err;
}

export class OpfsProvider implements VfsProvider {
	private rootHandle: FileSystemDirectoryHandle | null = null;
	private initialized = false;

	constructor(
		private readonly scopeId: string,
		private readonly nodeId: string,
	) {}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		const opfsRoot = await navigator.storage.getDirectory();
		const scopeDir = await opfsRoot.getDirectoryHandle(this.scopeId, { create: true });
		this.rootHandle = await scopeDir.getDirectoryHandle(this.nodeId, { create: true });
		this.initialized = true;
	}

	async dispose(): Promise<void> {
		this.rootHandle = null;
		this.initialized = false;
	}

	private getRoot(): FileSystemDirectoryHandle {
		if (!this.rootHandle) throw new Error('OpfsProvider not initialized');
		return this.rootHandle;
	}

	private splitPath(path: string): string[] {
		return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
	}

	private async resolve(
		path: string,
		options?: { createParents?: boolean },
	): Promise<[FileSystemDirectoryHandle, string]> {
		const root = this.getRoot();
		const segments = this.splitPath(path);
		if (segments.length === 0) return [root, ''];

		let current = root;
		for (let i = 0; i < segments.length - 1; i++) {
			try {
				current = await current.getDirectoryHandle(segments[i], {
					create: options?.createParents ?? false,
				});
			} catch {
				throw posixError('ENOENT', `No such file or directory: ${path}`);
			}
		}
		return [current, segments[segments.length - 1]];
	}

	private async resolveDir(
		path: string,
		options?: { create?: boolean },
	): Promise<FileSystemDirectoryHandle> {
		const root = this.getRoot();
		const segments = this.splitPath(path);
		if (segments.length === 0) return root;

		let current = root;
		for (const segment of segments) {
			try {
				current = await current.getDirectoryHandle(segment, {
					create: options?.create ?? false,
				});
			} catch {
				throw posixError('ENOENT', `No such directory: ${path}`);
			}
		}
		return current;
	}

	async readFile(path: string): Promise<Uint8Array> {
		const [dir, name] = await this.resolve(path);
		if (!name) throw posixError('EISDIR', `Is a directory: ${path}`);
		try {
			const fileHandle = await dir.getFileHandle(name);
			const file = await fileHandle.getFile();
			return new Uint8Array(await file.arrayBuffer());
		} catch {
			throw posixError('ENOENT', `No such file: ${path}`);
		}
	}

	async writeFile(path: string, content: Uint8Array): Promise<void> {
		const [dir, name] = await this.resolve(path, { createParents: true });
		if (!name) throw posixError('EISDIR', `Is a directory: ${path}`);
		const fileHandle = await dir.getFileHandle(name, { create: true });
		const writable = await fileHandle.createWritable();
		try {
			await writable.write(content as unknown as Blob);
		} finally {
			await writable.close();
		}
	}

	async unlink(path: string): Promise<void> {
		const [dir, name] = await this.resolve(path);
		if (!name) throw posixError('EISDIR', `Is a directory: ${path}`);
		await dir.removeEntry(name);
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		if (options?.recursive) {
			await this.resolveDir(path, { create: true });
		} else {
			const [parent, name] = await this.resolve(path);
			if (!name) return;
			await parent.getDirectoryHandle(name, { create: true });
		}
	}

	async readdir(path: string): Promise<string[]> {
		const dir = await this.resolveDir(path);
		const entries: string[] = [];
		for await (const key of (dir as any).keys()) {
			entries.push(key);
		}
		return entries.sort();
	}

	async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const [parent, name] = await this.resolve(path);
		if (!name) throw new Error('Cannot remove root directory');
		await parent.removeEntry(name, { recursive: options?.recursive });
	}

	async stat(path: string): Promise<VfsStat> {
		const segments = this.splitPath(path);
		const now = new Date();
		if (segments.length === 0) {
			return { isFile: false, isDirectory: true, size: 0, createdAt: now, updatedAt: now };
		}

		const [dir, name] = await this.resolve(path);
		try {
			const fileHandle = await dir.getFileHandle(name);
			const file = await fileHandle.getFile();
			return { isFile: true, isDirectory: false, size: file.size, createdAt: now, updatedAt: now };
		} catch {
			try {
				await dir.getDirectoryHandle(name);
				return { isFile: false, isDirectory: true, size: 0, createdAt: now, updatedAt: now };
			} catch {
				throw posixError('ENOENT', `No such file or directory: ${path}`);
			}
		}
	}

	async exists(path: string): Promise<boolean> {
		try {
			await this.stat(path);
			return true;
		} catch {
			return false;
		}
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
