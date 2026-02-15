import { describe, it, expect, beforeEach } from 'vitest';
import type { GetMeResponse, UpdateProfileResponse, ApiError } from '@pubwiki/api';
import { getTestDb, clearDatabase, sendRequest, registerAndGetSession, user, eq, type TestDb } from './helpers';

describe('User API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/me', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      sessionCookie = await registerAndGetSession('metest');
    });

    it('should return current user info with valid session', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetMeResponse>();
      expect(data.user.username).toBe('metest');
      expect(data.user.email).toBe('metest@example.com');
    });

    it('should return 401 without session cookie', async () => {
      const request = new Request('http://localhost/api/me');
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization required');
    });

    it('should return 401 with invalid session token', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization required');
    });

    it('should return 401 with malformed cookie value', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Cookie: 'invalid-cookie-format' },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/me', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      sessionCookie = await registerAndGetSession('profiletest');
    });

    it('should update user profile with valid data', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          displayName: 'Updated Name',
          bio: 'This is my bio',
          website: 'https://example.com',
          location: 'Tokyo, Japan',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UpdateProfileResponse>();
      expect(data.message).toBe('Profile updated successfully');
      expect(data.user.displayName).toBe('Updated Name');
      expect(data.user.bio).toBe('This is my bio');
      expect(data.user.website).toBe('https://example.com');
      expect(data.user.location).toBe('Tokyo, Japan');

      // 验证数据库状态
      const dbUser = await db.select().from(user).where(eq(user.username, 'profiletest'));
      expect(dbUser).toHaveLength(1);
      expect(dbUser[0].displayName).toBe('Updated Name');
      expect(dbUser[0].bio).toBe('This is my bio');
      expect(dbUser[0].website).toBe('https://example.com');
      expect(dbUser[0].location).toBe('Tokyo, Japan');
    });

    it('should update partial profile fields', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          bio: 'Only bio updated',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UpdateProfileResponse>();
      expect(data.user.bio).toBe('Only bio updated');
      // Other fields should remain unchanged
      expect(data.user.displayName).toBe('profiletest'); // Default is username
    });

    it('should update avatarUrl', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          avatarUrl: 'https://example.com/avatar.png',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<UpdateProfileResponse>();
      expect(data.user.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should return 401 without session cookie', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Should Not Work',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid session token', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'better-auth.session_token=invalid-token',
        },
        body: JSON.stringify({
          displayName: 'Should Not Work',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization required');
    });

    it('should update updatedAt timestamp', async () => {
      // Get original user
      const getRequest1 = new Request('http://localhost/api/me', {
        headers: { Cookie: sessionCookie },
      });
      const response1 = await sendRequest(getRequest1);
      const originalData = await response1.json<GetMeResponse>();
      const originalUpdatedAt = new Date(originalData.user.updatedAt).getTime();

      // Wait enough time to ensure timestamp difference (SQLite timestamp has second precision)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Update profile
      const updateRequest = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          bio: 'New bio for timestamp test',
        }),
      });
      const response2 = await sendRequest(updateRequest);
      const updatedData = await response2.json<UpdateProfileResponse>();
      const newUpdatedAt = new Date(updatedData.user.updatedAt).getTime();

      // The new timestamp should be at least 1 second later
      expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });
});
