/**
 * Storage Backend Detection
 *
 * Detects the best available storage backend for VFS and build cache.
 * Priority: OPFS > IndexedDB > Memory
 *
 * OPFS detection performs a real write probe because some browsers
 * (e.g. iOS Safari 15-16) expose navigator.storage.getDirectory()
 * but throw on createWritable().
 */

export type StorageBackend = 'opfs' | 'indexeddb' | 'memory';

let _detected: StorageBackend | null = null;

/**
 * Detect the best available storage backend. Result is cached after first call.
 */
export async function detectStorageBackend(): Promise<StorageBackend> {
	if (_detected) return _detected;
	_detected = await probe();
	console.log(`[StorageDetect] using backend: ${_detected}`);
	return _detected;
}

async function probe(): Promise<StorageBackend> {
	if (await probeOpfs()) return 'opfs';
	if (await probeIndexedDb()) return 'indexeddb';
	return 'memory';
}

/**
 * Probe OPFS with an actual write round-trip.
 * Catches partial support (API exists but createWritable throws).
 */
async function probeOpfs(): Promise<boolean> {
	try {
		if (typeof navigator === 'undefined') return false;
		if (!navigator.storage?.getDirectory) return false;

		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('__probe__', { create: true });
		const file = await dir.getFileHandle('__probe__', { create: true });
		const writable = await file.createWritable();
		await writable.write(new Uint8Array([0x50])); // 'P'
		await writable.close();
		await root.removeEntry('__probe__', { recursive: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Probe IndexedDB: open + close + delete a throwaway database.
 */
async function probeIndexedDb(): Promise<boolean> {
	try {
		if (typeof indexedDB === 'undefined') return false;
		return await new Promise<boolean>((resolve) => {
			const name = '__vfs_probe__';
			const req = indexedDB.open(name, 1);
			req.onsuccess = () => {
				req.result.close();
				indexedDB.deleteDatabase(name);
				resolve(true);
			};
			req.onerror = () => resolve(false);
			req.onblocked = () => resolve(false);
		});
	} catch {
		return false;
	}
}
