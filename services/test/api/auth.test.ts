import { describe, it, expect, beforeEach } from 'vitest';
import type { RegisterResponse, LoginResponse, ApiError } from '@pubwiki/api';
import { getTestDb, clearDatabase, sendRequest, users, eq, type TestDb } from './helpers';

describe('Auth API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const request = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<RegisterResponse>();
      expect(data.message).toBe('Registration successful');
      expect(data.user.username).toBe('testuser');
      expect(data.token).toBeTruthy();

      // 验证数据库状态
      const dbUser = await db.select().from(users).where(eq(users.username, 'testuser'));
      expect(dbUser).toHaveLength(1);
      expect(dbUser[0].email).toBe('test@example.com');
      expect(dbUser[0].passwordHash).toBeTruthy();
      expect(dbUser[0].passwordHash).not.toBe('password123'); // 确保密码已加密
    });

    it('should return 400 for invalid input', async () => {
      const request = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'ab', // too short
          email: 'test@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toBeTruthy();

      // 验证数据库状态 - 用户不应被创建
      const dbUsers = await db.select().from(users);
      expect(dbUsers).toHaveLength(0);
    });

    it('should return 409 for duplicate username', async () => {
      // First registration
      const firstRequest = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'duplicate',
          email: 'first@example.com',
          password: 'password123',
        }),
      });
      await sendRequest(firstRequest);

      // Second registration with same username
      const secondRequest = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'duplicate',
          email: 'second@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(secondRequest);

      expect(response.status).toBe(409);

      // 验证数据库状态 - 只有第一个用户被创建
      const dbUsers = await db.select().from(users);
      expect(dbUsers).toHaveLength(1);
      expect(dbUsers[0].email).toBe('first@example.com');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a test user
      const request = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'logintest',
          email: 'login@example.com',
          password: 'password123',
        }),
      });
      await sendRequest(request);
    });

    it('should login with username', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'logintest',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<LoginResponse>();
      expect(data.message).toBe('Login successful');
      expect(data.token).toBeTruthy();
    });

    it('should login with email', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'login@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return 401 for wrong password', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'logintest',
          password: 'wrongpassword',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return 401 for non-existent user', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'nonexistent',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });
  });
});
