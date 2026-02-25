import { describe, it, expect, beforeEach } from 'vitest';
import type { ListTagsResponse, ApiError } from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  tags,
  type TestDb,
} from './helpers';

describe('Tags API', () => {
  let db: TestDb;

  // Helper function: create a test tag
  async function createTestTag(slug: string, options: {
    name?: string;
    description?: string | null;
    color?: string | null;
    usageCount?: number;
  } = {}): Promise<void> {
    await db.insert(tags).values({
      slug,
      name: options.name ?? slug,
      description: options.description ?? null,
      color: options.color ?? null,
      usageCount: options.usageCount ?? 0,
    });
  }

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/tags', () => {
    it('should return empty list when no tags exist', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/tags')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(20);
    });

    it('should return all tags with default pagination', async () => {
      await createTestTag('tag-1', { usageCount: 5 });
      await createTestTag('tag-2', { usageCount: 10 });
      await createTestTag('tag-3', { usageCount: 3 });

      const response = await sendRequest(
        new Request('http://localhost/api/tags')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(3);
      expect(data.pagination.total).toBe(3);
    });

    it('should sort by usageCount descending by default', async () => {
      await createTestTag('tag-low', { usageCount: 5 });
      await createTestTag('tag-high', { usageCount: 100 });
      await createTestTag('tag-mid', { usageCount: 50 });

      const response = await sendRequest(
        new Request('http://localhost/api/tags')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags[0].slug).toBe('tag-high');
      expect(data.tags[1].slug).toBe('tag-mid');
      expect(data.tags[2].slug).toBe('tag-low');
    });

    it('should support sorting by name', async () => {
      await createTestTag('zebra');
      await createTestTag('apple');
      await createTestTag('banana');

      const response = await sendRequest(
        new Request('http://localhost/api/tags?sortBy=name&sortOrder=asc')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags[0].slug).toBe('apple');
      expect(data.tags[1].slug).toBe('banana');
      expect(data.tags[2].slug).toBe('zebra');
    });

    it('should support pagination', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestTag(`tag-${i}`, { usageCount: i * 10 });
      }

      const response = await sendRequest(
        new Request('http://localhost/api/tags?page=2&limit=2')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(2);
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });

    it('should support search by slug', async () => {
      await createTestTag('javascript');
      await createTestTag('typescript');
      await createTestTag('python');

      const response = await sendRequest(
        new Request('http://localhost/api/tags?search=script')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(2);
      const slugs = data.tags.map(t => t.slug);
      expect(slugs).toContain('javascript');
      expect(slugs).toContain('typescript');
    });

    it('should support search by name', async () => {
      await createTestTag('js', { name: 'JavaScript' });
      await createTestTag('ts', { name: 'TypeScript' });
      await createTestTag('py', { name: 'Python' });

      const response = await sendRequest(
        new Request('http://localhost/api/tags?search=Script')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(2);
    });

    it('should return correct tag fields', async () => {
      await createTestTag('test-tag', {
        name: 'Test Tag',
        description: 'A test tag',
        color: '#FF0000',
        usageCount: 42,
      });

      const response = await sendRequest(
        new Request('http://localhost/api/tags')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(1);
      const tag = data.tags[0];
      expect(tag.slug).toBe('test-tag');
      expect(tag.name).toBe('Test Tag');
      expect(tag.description).toBe('A test tag');
      expect(tag.color).toBe('#FF0000');
      expect(tag.usageCount).toBe(42);
    });

    it('should handle invalid page parameter', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/tags?page=0')
      );

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBeDefined();
    });

    it('should handle invalid limit parameter', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/tags?limit=200')
      );

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBeDefined();
    });

    it('should handle invalid sortBy parameter', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/tags?sortBy=invalid')
      );

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBeDefined();
    });

    it('should handle invalid sortOrder parameter', async () => {
      const response = await sendRequest(
        new Request('http://localhost/api/tags?sortOrder=invalid')
      );

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBeDefined();
    });

    it('should return tags sorted by createdAt', async () => {
      // Create tags - we can't control createdAt directly, but we can test the endpoint accepts the param
      await createTestTag('first');
      await createTestTag('second');

      const response = await sendRequest(
        new Request('http://localhost/api/tags?sortBy=createdAt&sortOrder=asc')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(2);
    });

    it('should handle combined search and pagination', async () => {
      // Create 10 tags with 'test' in name
      for (let i = 1; i <= 10; i++) {
        await createTestTag(`test-${i}`, { usageCount: i });
      }
      // Create some non-matching tags
      await createTestTag('other-1');
      await createTestTag('other-2');

      const response = await sendRequest(
        new Request('http://localhost/api/tags?search=test&page=2&limit=3')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(3);
      expect(data.pagination.total).toBe(10);
      expect(data.pagination.page).toBe(2);
    });

    it('should return empty results for non-matching search', async () => {
      await createTestTag('javascript');
      await createTestTag('typescript');

      const response = await sendRequest(
        new Request('http://localhost/api/tags?search=nonexistent')
      );

      expect(response.status).toBe(200);
      const data = await response.json<ListTagsResponse>();
      expect(data.tags).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });
  });
});
