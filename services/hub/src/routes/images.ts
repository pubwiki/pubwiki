import { Hono } from 'hono';
import type { Env } from '../types';
import { computeSha256Hex } from '@pubwiki/api';
import type { UploadImageResponse, ApiError } from '@pubwiki/api';
import { authMiddleware } from '../middleware/auth';
import { badRequest, notFound } from '../lib/service-error';

// Allowed image MIME types and their file extensions
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Magic bytes signatures for image file types
const MAGIC_SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // WebP: starts with RIFF....WEBP
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

// Size limits per purpose (in bytes)
const SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,     // 2MB
  thumbnail: 5 * 1024 * 1024,  // 5MB
  article: 10 * 1024 * 1024,   // 10MB
  general: 10 * 1024 * 1024,   // 10MB
};

const VALID_PURPOSES = new Set(['avatar', 'thumbnail', 'article', 'general']);

/**
 * Detect MIME type from file magic bytes
 */
function detectMimeType(buffer: ArrayBuffer): string | null {
  const header = new Uint8Array(buffer, 0, 12);
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    const matches = sig.bytes.every((b, i) => header[offset + i] === b);
    if (matches) {
      // Extra check for WebP: bytes 8-11 must be "WEBP"
      if (sig.mime === 'image/webp') {
        if (header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
          return 'image/webp';
        }
        continue; // RIFF but not WEBP
      }
      return sig.mime;
    }
  }
  return null;
}

const imagesRoute = new Hono<{ Bindings: Env }>();

// POST /images - upload an image
imagesRoute.post('/', authMiddleware, async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  const purpose = (body['purpose'] as string) || 'general';

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'Missing file field');
  }

  if (!VALID_PURPOSES.has(purpose)) {
    return badRequest(c, `Invalid purpose: ${purpose}. Must be one of: ${[...VALID_PURPOSES].join(', ')}`);
  }

  // Check file size
  const maxSize = SIZE_LIMITS[purpose] ?? SIZE_LIMITS.general;
  if (file.size > maxSize) {
    return c.json<ApiError>(
      { error: `File too large. Maximum size for ${purpose}: ${maxSize / 1024 / 1024}MB` },
      413,
    );
  }

  if (file.size === 0) {
    return badRequest(c, 'File is empty');
  }

  // Read file into buffer
  const buffer = await file.arrayBuffer();

  // Detect actual MIME type from magic bytes
  const detectedMime = detectMimeType(buffer);
  if (!detectedMime || !(detectedMime in MIME_TO_EXT)) {
    return badRequest(c, 'Unsupported image format. Allowed: JPEG, PNG, WebP, GIF');
  }

  const ext = MIME_TO_EXT[detectedMime];

  // Compute content hash for deduplication and cache-friendly naming
  const hash = await computeSha256Hex(buffer);
  const r2Key = `images/${purpose}/${hash}.${ext}`;
  const imageKey = `${purpose}/${hash}.${ext}`;

  // Upload to R2 (PUT is idempotent — same content = same key, no conflict)
  await c.env.R2_BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: detectedMime },
  });

  return c.json<UploadImageResponse>({
    url: `/api/images/${imageKey}`,
    key: imageKey,
  });
});

// GET /images/:purpose/:filename - serve an image from R2
imagesRoute.get('/:purpose/:filename', async (c) => {
  const purpose = c.req.param('purpose');
  const filename = c.req.param('filename');

  // Validate params to prevent path traversal
  if (purpose.includes('..') || purpose.includes('/') || filename.includes('..') || filename.includes('/')) {
    return badRequest(c, 'Invalid image key');
  }

  const key = `${purpose}/${filename}`;
  const r2Key = `images/${key}`;
  const object = await c.env.R2_BUCKET.get(r2Key);

  if (!object) {
    return notFound(c, 'Image not found');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': object.etag,
    },
  });
});

export { imagesRoute };
