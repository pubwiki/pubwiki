import { describe, it, expect, beforeEach } from 'vitest';
import type { RegisterResponse, GetMeResponse, UpdateProfileResponse, ApiError } from '@pubwiki/api';
import { getTestDb, clearDatabase, sendRequest, registerAndLogin, users, eq, type TestDb } from './helpers';

describe('User API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/me', () => {
    let authToken: string;

    beforeEach(async () => {
      authToken = await registerAndLogin('metest');
    });

    it('should return current user info with valid token', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetMeResponse>();
      expect(data.user.username).toBe('metest');
      expect(data.user.email).toBe('metest@example.com');
    });

    it('should return 401 without token', async () => {
      const request = new Request('http://localhost/api/me');
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization token required');
    });

    it('should return 401 with invalid token', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid or expired token');
    });

    it('should return 401 with malformed authorization header', async () => {
      const request = new Request('http://localhost/api/me', {
        headers: { Authorization: 'Basic some-credentials' },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/me', () => {
    let authToken: string;

    beforeEach(async () => {
      authToken = await registerAndLogin('profiletest');
    });

    it('should update user profile with valid data', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
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
      const dbUser = await db.select().from(users).where(eq(users.username, 'profiletest'));
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
          Authorization: `Bearer ${authToken}`,
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
          Authorization: `Bearer ${authToken}`,
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

    it('should return 401 without token', async () => {
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

    it('should return 401 with invalid token', async () => {
      const request = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token',
        },
        body: JSON.stringify({
          displayName: 'Should Not Work',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid or expired token');
    });

    it('should update updatedAt timestamp', async () => {
      // Get original user
      const getRequest1 = new Request('http://localhost/api/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const response1 = await sendRequest(getRequest1);
      const originalData = await response1.json<GetMeResponse>();
      const originalUpdatedAt = originalData.user.updatedAt;

      // Wait a small amount to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update profile
      const updateRequest = new Request('http://localhost/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          bio: 'New bio for timestamp test',
        }),
      });
      const response2 = await sendRequest(updateRequest);
      const updatedData = await response2.json<UpdateProfileResponse>();

      expect(updatedData.user.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});
