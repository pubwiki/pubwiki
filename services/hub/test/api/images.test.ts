import { describe, it, expect, beforeEach } from 'vitest';
import type { UploadImageResponse, ApiError } from '@pubwiki/api';
import {
  sendRequest,
  getTestDb,
  getTestR2Bucket,
  clearDatabase,
  registerAndGetSession,
  type TestDb,
} from './helpers';

// Minimal valid image files (smallest possible valid headers)
// 1x1 JPEG
const JPEG_BYTES = new Uint8Array([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
]);

// Minimal PNG (8-byte signature + IHDR + IEND)
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
  0x44, 0xAE, 0x42, 0x60, 0x82,
]);

// Minimal GIF89a
const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, // 1x1, no GCT
  0x3B, // trailer
]);

// Minimal WebP (RIFF + WEBP header + minimal VP8 chunk)
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // file size - 8
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20, // VP8 chunk
  0x18, 0x00, 0x00, 0x00, // chunk size
  0x30, 0x01, 0x00, 0x9D, 0x01, 0x2A, 0x01, 0x00,
  0x01, 0x00, 0x01, 0x40, 0x25, 0xA4, 0x00, 0x03,
  0x70, 0x00, 0xFE, 0xFB, 0x94, 0x00, 0x00, 0x00,
]);

function createFormData(file: Blob, purpose?: string, fileName: string = 'test.jpg'): FormData {
  const form = new FormData();
  form.append('file', new File([file], fileName));
  if (purpose) {
    form.append('purpose', purpose);
  }
  return form;
}

describe('Images API', () => {
  let db: TestDb;
  let sessionCookie: string;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
    sessionCookie = await registerAndGetSession('imguser');
  });

  describe('POST /api/images', () => {
    it('should upload a JPEG image', async () => {
      const form = createFormData(new Blob([JPEG_BYTES]), 'general', 'photo.jpg');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UploadImageResponse>();
      expect(data.url).toMatch(/^\/api\/images\/general\/[a-f0-9]+\.jpg$/);
      expect(data.key).toMatch(/^general\/[a-f0-9]+\.jpg$/);

      // Verify R2 storage
      const r2 = getTestR2Bucket();
      const obj = await r2.get(`images/${data.key}`);
      expect(obj).not.toBeNull();
      expect(obj!.httpMetadata?.contentType).toBe('image/jpeg');
      const stored = new Uint8Array(await obj!.arrayBuffer());
      expect(stored).toEqual(JPEG_BYTES);
    });

    it('should upload a PNG image', async () => {
      const form = createFormData(new Blob([PNG_BYTES]), 'thumbnail', 'icon.png');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UploadImageResponse>();
      expect(data.key).toMatch(/^thumbnail\/[a-f0-9]+\.png$/);
    });

    it('should upload a GIF image', async () => {
      const form = createFormData(new Blob([GIF_BYTES]), 'article', 'anim.gif');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UploadImageResponse>();
      expect(data.key).toMatch(/^article\/[a-f0-9]+\.gif$/);
    });

    it('should upload a WebP image', async () => {
      const form = createFormData(new Blob([WEBP_BYTES]), 'avatar', 'pic.webp');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UploadImageResponse>();
      expect(data.key).toMatch(/^avatar\/[a-f0-9]+\.webp$/);
    });

    it('should default purpose to "general" when not specified', async () => {
      const form = createFormData(new Blob([JPEG_BYTES]), undefined, 'photo.jpg');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UploadImageResponse>();
      expect(data.key).toMatch(/^general\//);
    });

    it('should deduplicate identical uploads (same content → same key)', async () => {
      const form1 = createFormData(new Blob([JPEG_BYTES]), 'general', 'a.jpg');
      const form2 = createFormData(new Blob([JPEG_BYTES]), 'general', 'b.jpg');

      const res1 = await sendRequest(new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form1,
      }));
      const res2 = await sendRequest(new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form2,
      }));

      const data1 = await res1.json<UploadImageResponse>();
      const data2 = await res2.json<UploadImageResponse>();
      expect(data1.key).toBe(data2.key);
      expect(data1.url).toBe(data2.url);
    });

    it('should return 401 without authentication', async () => {
      const form = createFormData(new Blob([JPEG_BYTES]), 'general');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should reject invalid purpose', async () => {
      const form = createFormData(new Blob([JPEG_BYTES]), 'invalid_purpose');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid purpose');
    });

    it('should reject missing file field', async () => {
      const form = new FormData();
      form.append('purpose', 'general');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Missing file');
    });

    it('should reject empty file', async () => {
      const form = createFormData(new Blob([]), 'general');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('empty');
    });

    it('should reject non-image file (text content)', async () => {
      const textContent = new TextEncoder().encode('Hello, this is not an image!');
      const form = createFormData(new Blob([textContent]), 'general', 'fake.jpg');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Unsupported image format');
    });

    it('should reject file exceeding avatar size limit (2MB)', async () => {
      // Create a fake "JPEG" that exceeds 2MB
      const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
      // Write valid JPEG magic bytes so it passes the magic check if it gets there
      oversized[0] = 0xFF; oversized[1] = 0xD8; oversized[2] = 0xFF;
      const form = createFormData(new Blob([oversized]), 'avatar', 'big.jpg');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(413);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('File too large');
      expect(data.error).toContain('2MB');
    });

    it('should reject RIFF file that is not WebP', async () => {
      // Valid RIFF header but not WEBP (e.g., AVI)
      const riffNonWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // size
        0x41, 0x56, 0x49, 0x20, // "AVI " instead of "WEBP"
        0x00, 0x00, 0x00, 0x00,
      ]);
      const form = createFormData(new Blob([riffNonWebp]), 'general', 'fake.webp');
      const request = new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Unsupported image format');
    });
  });

  describe('GET /api/images/*', () => {
    it('should serve an uploaded image', async () => {
      // Upload first
      const form = createFormData(new Blob([PNG_BYTES]), 'thumbnail', 'icon.png');
      const uploadRes = await sendRequest(new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      }));
      const { url } = await uploadRes.json<UploadImageResponse>();

      // Fetch the image (no auth required)
      const getRes = await sendRequest(new Request(`http://localhost${url}`));

      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/png');
      expect(getRes.headers.get('Cache-Control')).toContain('immutable');
      expect(getRes.headers.get('Cache-Control')).toContain('max-age=31536000');
      expect(getRes.headers.get('ETag')).toBeTruthy();

      const body = new Uint8Array(await getRes.arrayBuffer());
      expect(body).toEqual(PNG_BYTES);
    });

    it('should return 404 for non-existent image', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/images/general/nonexistent.jpg')
      );

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('not found');
    });

    it('should reject path traversal attempts', async () => {
      // Test with ".." in the purpose segment
      const response = await sendRequest(
        new Request('http://localhost/api/images/..secret/file.jpg')
      );

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid image key');
    });

    it('should not require authentication to fetch images', async () => {
      // Upload with auth
      const form = createFormData(new Blob([JPEG_BYTES]), 'general', 'pub.jpg');
      const uploadRes = await sendRequest(new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: form,
      }));
      const { url } = await uploadRes.json<UploadImageResponse>();

      // Fetch without auth
      const getRes = await sendRequest(new Request(`http://localhost${url}`));
      expect(getRes.status).toBe(200);
      // Consume body to properly close R2 stream
      await getRes.arrayBuffer();
    });
  });
});
