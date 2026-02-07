import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, UserService, user, account, session, artifacts, artifactTags, artifactStats, artifactVersions, nodeVersions, nodeVersionRefs, artifactVersionNodes, artifactVersionEdges, eq } from '@pubwiki/db';

describe('UserService', () => {
  let db: ReturnType<typeof createDb>;
  let userService: UserService;

  // 辅助函数：直接在数据库中创建测试用户
  async function createTestUser(data: {
    id?: string;
    username: string;
    email: string;
    name?: string;
  }) {
    const now = new Date();
    const userId = data.id ?? crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      username: data.username,
      email: data.email,
      name: data.name ?? data.username,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
      displayUsername: data.username,
      bio: null,
      website: null,
      location: null,
      isVerified: false,
    });
    return userId;
  }

  beforeEach(async () => {
    db = createDb(env.DB);
    userService = new UserService(db);
    
    // 清空数据库（按外键顺序）
    await db.delete(nodeVersionRefs);
    await db.delete(artifactVersionNodes);
    await db.delete(artifactVersionEdges);
    await db.delete(artifactVersions);
    await db.delete(artifactTags);
    await db.delete(artifactStats);
    await db.delete(nodeVersions);
    await db.delete(artifacts);
    await db.delete(session);
    await db.delete(account);
    await db.delete(user);
  });

  describe('getUserById', () => {
    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser({
        username: 'getuser',
        email: 'get@example.com',
      });
    });

    it('should get user by id', async () => {
      const result = await userService.getUserById(userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(userId);
        expect(result.data.username).toBe('getuser');
      }
    });

    it('should return error for non-existent id', async () => {
      const result = await userService.getUserById('non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });

    it('should return correct public user fields', async () => {
      const result = await userService.getUserById(userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('id');
        expect(result.data).toHaveProperty('username');
        expect(result.data).toHaveProperty('email');
        expect(result.data).toHaveProperty('displayName');
        expect(result.data).toHaveProperty('avatarUrl');
        expect(result.data).toHaveProperty('bio');
        expect(result.data).toHaveProperty('website');
        expect(result.data).toHaveProperty('location');
        expect(result.data).toHaveProperty('createdAt');
        expect(result.data).toHaveProperty('updatedAt');
      }
    });
  });

  describe('getUserByUsername', () => {
    beforeEach(async () => {
      await createTestUser({
        username: 'findme',
        email: 'find@example.com',
      });
    });

    it('should get user by username', async () => {
      const result = await userService.getUserByUsername('findme');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe('findme');
        expect(result.data.email).toBe('find@example.com');
      }
    });

    it('should return error for non-existent username', async () => {
      const result = await userService.getUserByUsername('nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });

    it('should be case sensitive for username', async () => {
      const result = await userService.getUserByUsername('FINDME');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });
  });

  describe('updateUser', () => {
    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser({
        username: 'updateuser',
        email: 'update@example.com',
        name: 'Original Name',
      });
    });

    it('should update user name', async () => {
      const result = await userService.updateUser(userId, {
        name: 'New Display Name',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('New Display Name');
      }

      // 验证数据库状态
      const dbUser = await db.select().from(user).where(eq(user.id, userId));
      expect(dbUser[0].name).toBe('New Display Name');
    });

    it('should update user bio', async () => {
      const result = await userService.updateUser(userId, {
        bio: 'This is my bio',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bio).toBe('This is my bio');
      }
    });

    it('should update user website', async () => {
      const result = await userService.updateUser(userId, {
        website: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.website).toBe('https://example.com');
      }
    });

    it('should update user location', async () => {
      const result = await userService.updateUser(userId, {
        location: 'San Francisco, CA',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.location).toBe('San Francisco, CA');
      }
    });

    it('should update user image/avatar', async () => {
      const result = await userService.updateUser(userId, {
        image: 'https://example.com/avatar.png',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avatarUrl).toBe('https://example.com/avatar.png');
      }
    });

    it('should update multiple fields at once', async () => {
      const result = await userService.updateUser(userId, {
        name: 'Updated Name',
        bio: 'Updated bio',
        website: 'https://updated.com',
        location: 'New York',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('Updated Name');
        expect(result.data.bio).toBe('Updated bio');
        expect(result.data.website).toBe('https://updated.com');
        expect(result.data.location).toBe('New York');
      }
    });

    it('should update updatedAt timestamp', async () => {
      const beforeUpdate = await db.select().from(user).where(eq(user.id, userId));
      const originalUpdatedAt = beforeUpdate[0].updatedAt;

      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));

      await userService.updateUser(userId, {
        name: 'New Name',
      });

      const afterUpdate = await db.select().from(user).where(eq(user.id, userId));
      expect(afterUpdate[0].updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return error for non-existent user', async () => {
      const result = await userService.updateUser('non-existent-id', {
        name: 'Test',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });

    it('should allow setting fields to null', async () => {
      // 先设置一些值
      await userService.updateUser(userId, {
        bio: 'Some bio',
        website: 'https://example.com',
      });

      // 然后设置为 null
      const result = await userService.updateUser(userId, {
        bio: null,
        website: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bio).toBeNull();
        expect(result.data.website).toBeNull();
      }
    });
  });
});
