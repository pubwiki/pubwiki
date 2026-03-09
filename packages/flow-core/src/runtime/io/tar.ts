/**
 * TAR + GZIP Utilities
 *
 * Pure tar archive creation/extraction and gzip compression/decompression.
 * Shared by publish.ts (VFS archives) and build-output-serializer.ts (build archives).
 *
 * TAR archives use deterministic headers (mtime = 0) so that identical file
 * content always produces the same archive bytes — necessary for content-
 * addressable hashing.
 */

/** A file entry within a tar archive */
export interface TarEntry {
	path: string;
	content: Uint8Array;
}

// ============================================================================
// TAR Creation
// ============================================================================

/**
 * Create a ustar tar header (512 bytes) for a single file.
 *
 * Uses epoch-0 mtime and fixed UID/GID/mode for deterministic output.
 */
function createTarHeader(filename: string, size: number): Uint8Array {
	const header = new Uint8Array(512);
	const enc = new TextEncoder();

	// File name (0–99), truncated to 100 chars
	header.set(enc.encode(filename.slice(0, 100)), 0);
	// File mode 0644 (100–107)
	header.set(enc.encode('0000644\0'), 100);
	// UID (108–115)
	header.set(enc.encode('0000000\0'), 108);
	// GID (116–123)
	header.set(enc.encode('0000000\0'), 116);
	// Size in octal (124–135)
	header.set(enc.encode(size.toString(8).padStart(11, '0') + ' '), 124);
	// Mtime in octal (136–147) — epoch 0 for determinism
	header.set(enc.encode('00000000000 '), 136);
	// Checksum placeholder (148–155) — spaces for initial calculation
	header.set(enc.encode('        '), 148);
	// Type flag '0' = regular file (156)
	header[156] = 0x30;
	// Magic 'ustar\0' (257–262)
	header.set(enc.encode('ustar\0'), 257);
	// Version '00' (263–264)
	header.set(enc.encode('00'), 263);

	// Compute checksum (sum of all bytes, treating checksum field as spaces)
	let checksum = 0;
	for (let i = 0; i < 512; i++) checksum += header[i];
	header.set(enc.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);

	return header;
}

/**
 * Create a tar archive from an array of file entries.
 *
 * Output is deterministic: same inputs → same bytes.
 */
export function createTar(files: TarEntry[]): Uint8Array {
	const chunks: Uint8Array[] = [];

	for (const file of files) {
		chunks.push(createTarHeader(file.path, file.content.byteLength));
		chunks.push(file.content);

		// Pad to 512-byte boundary
		const padding = 512 - (file.content.byteLength % 512);
		if (padding < 512) {
			chunks.push(new Uint8Array(padding));
		}
	}

	// Two empty 512-byte blocks mark end of archive
	chunks.push(new Uint8Array(1024));

	return concatUint8Arrays(chunks);
}

// ============================================================================
// TAR Extraction
// ============================================================================

/**
 * Extract file entries from an uncompressed tar archive.
 *
 * Validates the header checksum for each entry to detect corruption.
 */
export function extractTar(tarData: Uint8Array): TarEntry[] {
	const files: TarEntry[] = [];
	const dec = new TextDecoder();
	let offset = 0;

	while (offset + 512 <= tarData.length) {
		const header = tarData.slice(offset, offset + 512);

		// End-of-archive: all-zero block
		let allZero = true;
		for (let i = 0; i < 512; i++) {
			if (header[i] !== 0) { allZero = false; break; }
		}
		if (allZero) break;

		// Validate header checksum (bytes 148–155).
		// The stored checksum is computed treating bytes 148–155 as spaces (0x20).
		const storedChecksumStr = dec.decode(header.slice(148, 156)).replace(/[\0 ]/g, '');
		const storedChecksum = parseInt(storedChecksumStr, 8);
		if (!Number.isFinite(storedChecksum)) {
			throw new Error(`Invalid tar header checksum at offset ${offset}`);
		}
		let computedChecksum = 0;
		for (let i = 0; i < 512; i++) {
			// Treat the checksum field (148–155) as all spaces for the calculation
			computedChecksum += (i >= 148 && i < 156) ? 0x20 : header[i];
		}
		if (computedChecksum !== storedChecksum) {
			throw new Error(
				`Tar header checksum mismatch at offset ${offset}: expected ${storedChecksum}, got ${computedChecksum}`
			);
		}

		// Filename (0–99), null-terminated
		let nameEnd = 0;
		while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
		const name = dec.decode(header.slice(0, nameEnd));

		// Size (124–135), octal
		const sizeStr = dec.decode(header.slice(124, 136)).replace(/[\0 ]/g, '');
		const size = parseInt(sizeStr, 8) || 0;

		offset += 512;

		if (size > 0 && name) {
			files.push({ path: name, content: new Uint8Array(tarData.slice(offset, offset + size)) });
		}

		// Advance past content, padded to 512
		offset += Math.ceil(size / 512) * 512;
	}

	return files;
}

// ============================================================================
// GZIP
// ============================================================================

/** Gzip-compress data via the Compression Streams API. */
export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream('gzip');
	const writer = cs.writable.getWriter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	writer.write(new Uint8Array(data) as any);
	writer.close();
	return drainReadable(cs.readable);
}

/** Gzip-decompress data via the Decompression Streams API. */
export async function gzipDecompress(data: ArrayBuffer): Promise<Uint8Array> {
	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	writer.write(new Uint8Array(data) as any);
	writer.close();
	return drainReadable(ds.readable);
}

/** Decompress + extract in one step. */
export async function extractTarGz(data: ArrayBuffer): Promise<TarEntry[]> {
	const decompressed = await gzipDecompress(data);
	return extractTar(decompressed);
}

// ============================================================================
// Helpers
// ============================================================================

/** Read all chunks from a ReadableStream into a single Uint8Array. */
async function drainReadable(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = readable.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	return concatUint8Arrays(chunks);
}

/** Concatenate an array of Uint8Arrays into a single Uint8Array. */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const a of arrays) {
		result.set(a, offset);
		offset += a.byteLength;
	}
	return result;
}
