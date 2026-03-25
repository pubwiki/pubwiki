/**
 * VFS-backed WorkspaceFileProvider
 *
 * Implements WorkspaceFileProvider from @pubwiki/world-editor using
 * the Studio VFS (OPFS) as the storage backend.
 *
 * Files are stored under a dedicated directory in the node's VFS:
 *   /copilot-files/<filename>
 */

import type { WorkspaceFileProvider, WorkspaceFileInfo } from '@pubwiki/world-editor';
import { type Vfs, isVfsFile } from '@pubwiki/vfs';

const FILES_DIR = '/copilot-files';

const MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	md: 'text/markdown',
	json: 'application/json',
	txt: 'text/plain',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function getExt(filename: string): string {
	return filename.split('.').pop()?.toLowerCase() ?? '';
}

function getFileType(filename: string): string {
	const ext = getExt(filename);
	if (IMAGE_EXTENSIONS.has(ext)) return 'image';
	if (ext === 'md') return 'md';
	if (ext === 'json') return 'json';
	return 'txt';
}

export class VfsWorkspaceFileProvider implements WorkspaceFileProvider {
	private vfs: Vfs;
	private initialized = false;

	constructor(vfs: Vfs) {
		this.vfs = vfs;
	}

	private async ensureDir(): Promise<void> {
		if (this.initialized) return;
		try {
			const exists = await this.vfs.exists(FILES_DIR);
			if (!exists) {
				await this.vfs.createFolder(FILES_DIR);
			}
		} catch {
			// createFolder may throw if already exists in some providers
		}
		this.initialized = true;
	}

	async listFiles(): Promise<WorkspaceFileInfo[]> {
		await this.ensureDir();
		try {
			const entries = await this.vfs.listFolder(FILES_DIR);
			const files: WorkspaceFileInfo[] = [];
			for (const entry of entries) {
				if (isVfsFile(entry)) {
					files.push({
						name: entry.name,
						type: getFileType(entry.name),
						size: entry.size,
					});
				}
			}
			return files;
		} catch {
			return [];
		}
	}

	async readTextFile(filename: string): Promise<string | null> {
		await this.ensureDir();
		try {
			const file = await this.vfs.readFile(`${FILES_DIR}/${filename}`);
			if (typeof file.content === 'string') return file.content;
			if (file.content instanceof ArrayBuffer) return new TextDecoder().decode(file.content);
			return null;
		} catch {
			return null;
		}
	}

	async readImageAsDataUrl(filename: string): Promise<string | null> {
		await this.ensureDir();
		try {
			const file = await this.vfs.readFile(`${FILES_DIR}/${filename}`);
			const mime = this.getMimeType(filename);
			let bytes: Uint8Array;
			if (file.content instanceof ArrayBuffer) {
				bytes = new Uint8Array(file.content);
			} else if (typeof file.content === 'string') {
				bytes = new TextEncoder().encode(file.content);
			} else {
				return null;
			}
			const base64 = uint8ArrayToBase64(bytes);
			return `data:${mime};base64,${base64}`;
		} catch {
			return null;
		}
	}

	async writeFile(filename: string, content: Uint8Array): Promise<void> {
		await this.ensureDir();
		const path = `${FILES_DIR}/${filename}`;
		const buffer = content.buffer as ArrayBuffer;
		const exists = await this.vfs.exists(path);
		if (exists) {
			await this.vfs.updateFile(path, buffer);
		} else {
			await this.vfs.createFile(path, buffer);
		}
	}

	async deleteFile(filename: string): Promise<void> {
		await this.ensureDir();
		try {
			await this.vfs.deleteFile(`${FILES_DIR}/${filename}`);
		} catch {
			// ignore if file doesn't exist
		}
	}

	getMimeType(filename: string): string {
		return MIME_TYPES[getExt(filename)] ?? 'application/octet-stream';
	}
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
