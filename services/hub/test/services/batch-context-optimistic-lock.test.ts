/**
 * Unit tests for BatchContext optimistic lock functionality.
 * 
 * Tests verify that:
 * 1. OptimisticLockError is thrown when expectAffected doesn't match actual changes
 * 2. ON CONFLICT DO NOTHING + expectAffected=1 detects duplicate inserts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTestDb,
  clearDatabase,
  tags,
  type TestDb,
} from '../api/helpers';
import { BatchContext, OptimisticLockError } from '@pubwiki/db';

describe('BatchContext optimistic lock', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('expectAffected validation', () => {
    it('should succeed when expectAffected matches actual changes', async () => {
      const ctx = new BatchContext(db);
      
      // Insert with expectAffected=1, should succeed
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag should not exist' })
        .insert(tags).values({ slug: 'test-tag', name: 'Test Tag' }).onConflictDoNothing();

      // Should not throw
      await expect(ctx.commit()).resolves.toBeUndefined();
    });

    it('should throw OptimisticLockError when expectAffected does not match (conflict case)', async () => {
      // First, insert a tag
      await db.insert(tags).values({ slug: 'existing-tag', name: 'Existing Tag' });

      const ctx = new BatchContext(db);
      
      // Try to insert same tag with expectAffected=1
      // This should conflict and return changes=0
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag already exists' })
        .insert(tags).values({ slug: 'existing-tag', name: 'Duplicate Tag' }).onConflictDoNothing();

      // Should throw OptimisticLockError
      await expect(ctx.commit()).rejects.toThrow(OptimisticLockError);
    });

    it('should include lockMsg in OptimisticLockError', async () => {
      await db.insert(tags).values({ slug: 'my-tag', name: 'My Tag' });

      const ctx = new BatchContext(db);
      const errorMessage = 'Custom error: Tag my-tag already exists';
      
      ctx.modify({ expectAffected: 1, lockMsg: errorMessage })
        .insert(tags).values({ slug: 'my-tag', name: 'Another Tag' }).onConflictDoNothing();

      try {
        await ctx.commit();
        expect.fail('Should have thrown OptimisticLockError');
      } catch (error) {
        expect(error).toBeInstanceOf(OptimisticLockError);
        expect((error as OptimisticLockError).msg).toBe(errorMessage);
      }
    });

    it('should handle multiple operations with one optimistic lock', async () => {
      const ctx = new BatchContext(db);
      
      // First operation: no optimistic lock
      ctx.modify().insert(tags).values({ slug: 'tag-1', name: 'Tag 1' });
      
      // Second operation: with optimistic lock
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag 2 should not exist' })
        .insert(tags).values({ slug: 'tag-2', name: 'Tag 2' }).onConflictDoNothing();

      // Should succeed since both operations work
      await expect(ctx.commit()).resolves.toBeUndefined();

      // Verify both tags exist
      const result = await db.select().from(tags);
      expect(result.length).toBe(2);
    });

    it('should fail entire batch if any optimistic lock fails', async () => {
      // Pre-insert tag-2 to cause conflict
      await db.insert(tags).values({ slug: 'tag-2', name: 'Existing Tag 2' });

      const ctx = new BatchContext(db);
      
      // First operation succeeds
      ctx.modify().insert(tags).values({ slug: 'tag-1', name: 'Tag 1' });
      
      // Second operation fails due to conflict
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag 2 already exists' })
        .insert(tags).values({ slug: 'tag-2', name: 'New Tag 2' }).onConflictDoNothing();

      // Should throw
      await expect(ctx.commit()).rejects.toThrow(OptimisticLockError);

      // Note: In D1 batch, partial commits may have happened
      // This test verifies the error detection, not transaction rollback
    });
  });

  describe('idempotent insert pattern', () => {
    it('should detect duplicate insert attempts', async () => {
      // First create: should succeed
      const ctx1 = new BatchContext(db);
      ctx1.modify({ expectAffected: 1, lockMsg: 'Tag unique-tag already exists' })
        .insert(tags).values({ slug: 'unique-tag', name: 'Unique Tag' }).onConflictDoNothing();
      await ctx1.commit();

      // Second create with same slug: should fail
      const ctx2 = new BatchContext(db);
      ctx2.modify({ expectAffected: 1, lockMsg: 'Tag unique-tag already exists' })
        .insert(tags).values({ slug: 'unique-tag', name: 'Duplicate Tag' }).onConflictDoNothing();
      
      await expect(ctx2.commit()).rejects.toThrow(OptimisticLockError);
    });

    it('should allow multiple successful creates with different keys', async () => {
      const ctx = new BatchContext(db);
      
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag A already exists' })
        .insert(tags).values({ slug: 'tag-a', name: 'Tag A' }).onConflictDoNothing();
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag B already exists' })
        .insert(tags).values({ slug: 'tag-b', name: 'Tag B' }).onConflictDoNothing();
      ctx.modify({ expectAffected: 1, lockMsg: 'Tag C already exists' })
        .insert(tags).values({ slug: 'tag-c', name: 'Tag C' }).onConflictDoNothing();

      await expect(ctx.commit()).resolves.toBeUndefined();

      const result = await db.select().from(tags);
      expect(result.length).toBe(3);
    });
  });
});
