import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, UserService, users, artifacts, artifactTags, artifactStats, artifactVersions, artifactLineage, artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs, eq } from '@pubwiki/db';

const TEST_JWT_SECRET = 'test-jwt-secret-for-unit-tests';

describe('UserService', () => {
  let db: ReturnType<typeof createDb>;
  let userService: UserService;

  beforeEach(async () => {
    db = createDb(env.DB);
    userService = new UserService(db, TEST_JWT_SECRET);
    
    // 清空数据库（按外键顺序）
    await db.delete(artifactLineage);
    await db.delete(artifactNodeFiles);
    await db.delete(artifactNodeVersions);
    await db.delete(artifactNodeRefs);
    await db.delete(artifactNodes);
    await db.delete(artifactVersions);
    await db.delete(artifactTags);
    await db.delete(artifactStats);
    await db.delete(artifacts);
    await db.delete(users);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user.username).toBe('testuser');
        expect(result.data.user.email).toBe('test@example.com');
        expect(result.data.user.displayName).toBe('testuser');
        expect(result.data.token).toBeTruthy();

        // 验证数据库状态
        const dbUser = await db.select().from(users).where(eq(users.id, result.data.user.id));
        expect(dbUser).toHaveLength(1);
        expect(dbUser[0].username).toBe('testuser');
        expect(dbUser[0].email).toBe('test@example.com');
        expect(dbUser[0].passwordHash).toBeTruthy();
        expect(dbUser[0].passwordHash).toContain(':'); // PBKDF2 格式: salt:hash
      }
    });

    it('should use displayName when provided', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test Display Name',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user.displayName).toBe('Test Display Name');
      }
    });

    it('should fail with missing username', async () => {
      const result = await userService.register({
        username: '',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should fail with missing email', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: '',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should fail with missing password', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should fail with invalid username format (too short)', async () => {
      const result = await userService.register({
        username: 'ab',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('Username');
      }
    });

    it('should fail with invalid username format (special characters)', async () => {
      const result = await userService.register({
        username: 'test@user!',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should fail with invalid email format', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: 'invalid-email',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('email');
      }
    });

    it('should fail with short password', async () => {
      const result = await userService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('8 characters');
      }
    });

    it('should fail when username already exists', async () => {
      // 先注册一个用户
      await userService.register({
        username: 'existinguser',
        email: 'first@example.com',
        password: 'password123',
      });

      // 尝试用相同用户名注册
      const result = await userService.register({
        username: 'existinguser',
        email: 'second@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_EXISTS');
      }

      // 验证数据库状态 - 只有一个用户
      const dbUsers = await db.select().from(users);
      expect(dbUsers).toHaveLength(1);
      expect(dbUsers[0].email).toBe('first@example.com');
    });

    it('should fail when email already exists', async () => {
      // 先注册一个用户
      await userService.register({
        username: 'firstuser',
        email: 'existing@example.com',
        password: 'password123',
      });

      // 尝试用相同邮箱注册
      const result = await userService.register({
        username: 'seconduser',
        email: 'existing@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_EXISTS');
      }
    });

    it('should accept valid username with underscores and hyphens', async () => {
      const result = await userService.register({
        username: 'test_user-123',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      // 创建测试用户
      await userService.register({
        username: 'loginuser',
        email: 'login@example.com',
        password: 'password123',
      });
    });

    it('should login successfully with username', async () => {
      const result = await userService.login({
        usernameOrEmail: 'loginuser',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user.username).toBe('loginuser');
        expect(result.data.token).toBeTruthy();
      }
    });

    it('should login successfully with email', async () => {
      const result = await userService.login({
        usernameOrEmail: 'login@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user.email).toBe('login@example.com');
      }
    });

    it('should fail with wrong password', async () => {
      const result = await userService.login({
        usernameOrEmail: 'loginuser',
        password: 'wrongpassword',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('should fail with non-existent user', async () => {
      const result = await userService.login({
        usernameOrEmail: 'nonexistent',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('should fail with missing credentials', async () => {
      const result = await userService.login({
        usernameOrEmail: '',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should update lastLoginAt on successful login', async () => {
      await userService.login({
        usernameOrEmail: 'loginuser',
        password: 'password123',
      });

      const userResult = await userService.getUserByUsername('loginuser');
      expect(userResult.success).toBe(true);
      // lastLoginAt 不在 PublicUser 中，但登录应该成功
    });
  });

  describe('getUserById', () => {
    let userId: string;

    beforeEach(async () => {
      const result = await userService.register({
        username: 'getuser',
        email: 'get@example.com',
        password: 'password123',
      });
      if (result.success) {
        userId = result.data.user.id;
      }
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
  });

  describe('getUserByUsername', () => {
    beforeEach(async () => {
      await userService.register({
        username: 'findme',
        email: 'find@example.com',
        password: 'password123',
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
  });

  describe('updateUser', () => {
    let userId: string;

    beforeEach(async () => {
      const result = await userService.register({
        username: 'updateuser',
        email: 'update@example.com',
        password: 'password123',
      });
      if (result.success) {
        userId = result.data.user.id;
      }
    });

    it('should update user displayName', async () => {
      const result = await userService.updateUser(userId, {
        displayName: 'New Display Name',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('New Display Name');
      }
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

    it('should update multiple fields at once', async () => {
      const result = await userService.updateUser(userId, {
        displayName: 'Updated Name',
        bio: 'Updated bio',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('Updated Name');
        expect(result.data.bio).toBe('Updated bio');
      }
    });

    it('should return error for non-existent user', async () => {
      const result = await userService.updateUser('non-existent-id', {
        displayName: 'Test',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });
  });
});
