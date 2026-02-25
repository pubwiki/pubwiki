import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, TagService, BatchContext, tags, artifactTags, artifacts, user, session, account } from '@pubwiki/db';

describe('TagService', () => {
  let db: ReturnType<typeof createDb>;
  let ctx: BatchContext;
  let tagService: TagService;

  // Helper function: create a test user
  async function createTestUser(username: string = 'testuser'): Promise<string> {
    const now = new Date();
    const [created] = await db.insert(user).values({
      username,
      email: `${username}@example.com`,
      displayName: username,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
      displayUsername: username,
      isVerified: false,
    }).returning();
    return created.id;
  }

  // Helper function: create a test artifact
  async function createTestArtifact(authorId: string, name: string): Promise<string> {
    const [artifact] = await db.insert(artifacts).values({
      authorId,
      name,
    }).returning();
    return artifact.id;
  }

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
    db = createDb(env.DB);
    ctx = new BatchContext(db);
    tagService = new TagService(ctx);
    
    // Clear database (follow foreign key order)
    await db.delete(artifactTags);
    await db.delete(tags);
    await db.delete(artifacts);
    await db.delete(session);
    await db.delete(account);
    await db.delete(user);
  });

  describe('listTags', () => {
    it('should return empty list when no tags exist', async () => {
      const result = await tagService.listTags();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(0);
        expect(result.data.pagination.total).toBe(0);
        expect(result.data.pagination.totalPages).toBe(0);
      }
    });

    it('should return all tags with default pagination', async () => {
      await createTestTag('tag-1', { usageCount: 5 });
      await createTestTag('tag-2', { usageCount: 10 });
      await createTestTag('tag-3', { usageCount: 3 });

      const result = await tagService.listTags();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(3);
        expect(result.data.pagination.total).toBe(3);
        expect(result.data.pagination.page).toBe(1);
        expect(result.data.pagination.limit).toBe(20);
      }
    });

    it('should sort by usageCount descending by default', async () => {
      await createTestTag('tag-low', { usageCount: 5 });
      await createTestTag('tag-high', { usageCount: 100 });
      await createTestTag('tag-mid', { usageCount: 50 });

      const result = await tagService.listTags();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags[0].slug).toBe('tag-high');
        expect(result.data.tags[1].slug).toBe('tag-mid');
        expect(result.data.tags[2].slug).toBe('tag-low');
      }
    });

    it('should support sorting by name ascending', async () => {
      await createTestTag('zebra');
      await createTestTag('apple');
      await createTestTag('banana');

      const result = await tagService.listTags({ sortBy: 'name', sortOrder: 'asc' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags[0].slug).toBe('apple');
        expect(result.data.tags[1].slug).toBe('banana');
        expect(result.data.tags[2].slug).toBe('zebra');
      }
    });

    it('should support sorting by name descending', async () => {
      await createTestTag('zebra');
      await createTestTag('apple');
      await createTestTag('banana');

      const result = await tagService.listTags({ sortBy: 'name', sortOrder: 'desc' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags[0].slug).toBe('zebra');
        expect(result.data.tags[1].slug).toBe('banana');
        expect(result.data.tags[2].slug).toBe('apple');
      }
    });

    it('should support pagination with page and limit', async () => {
      // Create 5 tags
      for (let i = 1; i <= 5; i++) {
        await createTestTag(`tag-${i}`, { usageCount: i * 10 });
      }

      const result = await tagService.listTags({ page: 2, limit: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(2);
        expect(result.data.pagination.page).toBe(2);
        expect(result.data.pagination.limit).toBe(2);
        expect(result.data.pagination.total).toBe(5);
        expect(result.data.pagination.totalPages).toBe(3);
        // With default sort (usageCount desc), page 2 should have tag-3 and tag-2
        expect(result.data.tags[0].slug).toBe('tag-3');
        expect(result.data.tags[1].slug).toBe('tag-2');
      }
    });

    it('should support search by slug', async () => {
      await createTestTag('javascript');
      await createTestTag('typescript');
      await createTestTag('python');

      const result = await tagService.listTags({ search: 'script' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(2);
        const slugs = result.data.tags.map(t => t.slug);
        expect(slugs).toContain('javascript');
        expect(slugs).toContain('typescript');
        expect(slugs).not.toContain('python');
      }
    });

    it('should support search by name', async () => {
      await createTestTag('js', { name: 'JavaScript' });
      await createTestTag('ts', { name: 'TypeScript' });
      await createTestTag('py', { name: 'Python' });

      const result = await tagService.listTags({ search: 'Script' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(2);
        const slugs = result.data.tags.map(t => t.slug);
        expect(slugs).toContain('js');
        expect(slugs).toContain('ts');
      }
    });

    it('should return correct tag fields', async () => {
      await createTestTag('test-tag', {
        name: 'Test Tag',
        description: 'A test tag',
        color: '#FF0000',
        usageCount: 42,
      });

      const result = await tagService.listTags();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(1);
        const tag = result.data.tags[0];
        expect(tag.slug).toBe('test-tag');
        expect(tag.name).toBe('Test Tag');
        expect(tag.description).toBe('A test tag');
        expect(tag.color).toBe('#FF0000');
        expect(tag.usageCount).toBe(42);
      }
    });

    it('should return tags with null description and color', async () => {
      await createTestTag('minimal-tag');

      const result = await tagService.listTags();

      expect(result.success).toBe(true);
      if (result.success) {
        const tag = result.data.tags[0];
        expect(tag.description).toBeNull();
        expect(tag.color).toBeNull();
      }
    });

    it('should handle pagination with no results', async () => {
      await createTestTag('only-tag');

      const result = await tagService.listTags({ page: 5, limit: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(0);
        expect(result.data.pagination.total).toBe(1);
        expect(result.data.pagination.page).toBe(5);
      }
    });

    it('should handle empty search result', async () => {
      await createTestTag('javascript');

      const result = await tagService.listTags({ search: 'nonexistent' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toHaveLength(0);
        expect(result.data.pagination.total).toBe(0);
      }
    });
  });

  describe('fetchTagsBySlug', () => {
    it('should return empty map for empty input', async () => {
      const result = await tagService.fetchTagsBySlug([]);
      expect(result.size).toBe(0);
    });

    it('should return tags by their slugs', async () => {
      await createTestTag('tag-1', { name: 'Tag One' });
      await createTestTag('tag-2', { name: 'Tag Two' });
      await createTestTag('tag-3', { name: 'Tag Three' });

      const result = await tagService.fetchTagsBySlug(['tag-1', 'tag-3']);

      expect(result.size).toBe(2);
      expect(result.get('tag-1')?.name).toBe('Tag One');
      expect(result.get('tag-3')?.name).toBe('Tag Three');
      expect(result.has('tag-2')).toBe(false);
    });

    it('should skip non-existent slugs', async () => {
      await createTestTag('existing-tag');

      const result = await tagService.fetchTagsBySlug(['existing-tag', 'non-existent']);

      expect(result.size).toBe(1);
      expect(result.has('existing-tag')).toBe(true);
      expect(result.has('non-existent')).toBe(false);
    });
  });

  describe('getArtifactTagSlugs', () => {
    it('should return empty set for artifact with no tags', async () => {
      const userId = await createTestUser();
      const artifactId = await createTestArtifact(userId, 'Test Artifact');

      const result = await tagService.getArtifactTagSlugs(artifactId);

      expect(result.size).toBe(0);
    });

    it('should return tag slugs for artifact', async () => {
      const userId = await createTestUser();
      const artifactId = await createTestArtifact(userId, 'Test Artifact');
      
      // Create tags and associations
      await createTestTag('tag-a');
      await createTestTag('tag-b');
      await db.insert(artifactTags).values([
        { artifactId, tagSlug: 'tag-a' },
        { artifactId, tagSlug: 'tag-b' },
      ]);

      const result = await tagService.getArtifactTagSlugs(artifactId);

      expect(result.size).toBe(2);
      expect(result.has('tag-a')).toBe(true);
      expect(result.has('tag-b')).toBe(true);
    });
  });
});
