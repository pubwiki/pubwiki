/**
 * In-Memory VFS Provider for Player
 *
 * Last-resort fallback when neither OPFS nor IndexedDB is available.
 * All data lives in memory — lost on page refresh.
 */

import type { VfsProvider, VfsStat } from '@pubwiki/vfs';

function normalizePath(path: string): string {
	if (!path.startsWith('/')) path = '/' + path;
	if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
	return path;
}

function parentPath(path: string): string {
	const last = path.lastIndexOf('/');
	return last <= 0 ? '/' : path.substring(0, last);
}

export class MemoryVfsProvider implements VfsProvider {
	private files = new Map<string, Uint8Array>();
	private directories = new Set<string>(['/']);

	async readFile(path: string): Promise<Uint8Array> {
		const p = normalizePath(path);
		const content = this.files.get(p);
		if (!content) throw new Error(`ENOENT: no such file: ${p}`);
		return content;
	}

	async writeFile(path: string, content: Uint8Array): Promise<void> {
		const p = normalizePath(path);
		// Ensure parent directories
		const parts = p.split('/').filter(Boolean);
		let current = '';
		for (let i = 0; i < parts.length - 1; i++) {
			current += '/' + parts[i];
			this.directories.add(current);
		}
		this.files.set(p, content);
	}

	async unlink(path: string): Promise<void> {
		const p = normalizePath(path);
		if (!this.files.has(p)) throw new Error(`ENOENT: no such file: ${p}`);
		this.files.delete(p);
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const p = normalizePath(path);
		if (options?.recursive) {
			const parts = p.split('/').filter(Boolean);
			let current = '';
			for (const part of parts) {
				current += '/' + part;
				this.directories.add(current);
			}
		} else {
			const parent = parentPath(p);
			if (parent !== '/' && !this.directories.has(parent)) {
				throw new Error(`ENOENT: no such directory: ${parent}`);
			}
			this.directories.add(p);
		}
	}

	async readdir(path: string): Promise<string[]> {
		const p = normalizePath(path);
		const prefix = p === '/' ? '/' : p + '/';
		const entries = new Set<string>();

		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(prefix)) {
				const rest = filePath.slice(prefix.length);
				const first = rest.split('/')[0];
				if (first) entries.add(first);
			}
		}
		for (const dirPath of this.directories) {
			if (dirPath.startsWith(prefix) && dirPath !== p) {
				const rest = dirPath.slice(prefix.length);
				const first = rest.split('/')[0];
				if (first) entries.add(first);
			}
		}
		return [...entries].sort();
	}

	async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const p = normalizePath(path);
		if (options?.recursive) {
			const prefix = p + '/';
			for (const f of this.files.keys()) {
				if (f.startsWith(prefix)) this.files.delete(f);
			}
			for (const d of this.directories) {
				if (d === p || d.startsWith(prefix)) this.directories.delete(d);
			}
		} else {
			const children = await this.readdir(p);
			if (children.length > 0) throw new Error(`ENOTEMPTY: directory not empty: ${p}`);
			this.directories.delete(p);
		}
	}

	async stat(path: string): Promise<VfsStat> {
		const p = normalizePath(path);
		const now = new Date();
		if (this.files.has(p)) {
			return { isFile: true, isDirectory: false, size: this.files.get(p)!.byteLength, createdAt: now, updatedAt: now };
		}
		if (this.directories.has(p)) {
			return { isFile: false, isDirectory: true, size: 0, createdAt: now, updatedAt: now };
		}
		throw new Error(`ENOENT: no such file or directory: ${p}`);
	}

	async exists(path: string): Promise<boolean> {
		const p = normalizePath(path);
		return this.files.has(p) || this.directories.has(p);
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
