import { describe, it, expect } from 'vitest';
import { generateToken, verifyToken, extractToken, type User } from '@pubwiki/db';

// 模拟用户数据
const mockUser: User = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  username: 'testuser',
  displayName: 'Test User',
  email: 'test@example.com',
  passwordHash: 'mock-hash',
  avatarUrl: null,
  bio: null,
  website: null,
  location: null,
  isVerified: false,
  isAdmin: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

const TEST_SECRET = 'test-jwt-secret-key-for-testing-purposes';

describe('JWT Utils', () => {
  describe('generateToken', () => {
    it('should generate a valid JWT token', async () => {
      const token = await generateToken(mockUser, TEST_SECRET);
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // JWT 格式：header.payload.signature
      expect(token.split('.')).toHaveLength(3);
    });

    it('should generate different tokens for different users', async () => {
      const user2: User = { ...mockUser, id: 'different-id', username: 'user2' };
      
      const token1 = await generateToken(mockUser, TEST_SECRET);
      const token2 = await generateToken(user2, TEST_SECRET);
      
      expect(token1).not.toBe(token2);
    });

    it('should generate different tokens with different secrets', async () => {
      const token1 = await generateToken(mockUser, TEST_SECRET);
      const token2 = await generateToken(mockUser, 'different-secret');
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token and return payload', async () => {
      const token = await generateToken(mockUser, TEST_SECRET);
      const payload = await verifyToken(token, TEST_SECRET);
      
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(mockUser.id);
      expect(payload?.username).toBe(mockUser.username);
      expect(payload?.email).toBe(mockUser.email);
      expect(payload?.isAdmin).toBe(mockUser.isAdmin);
    });

    it('should return null for invalid token', async () => {
      const payload = await verifyToken('invalid-token', TEST_SECRET);
      expect(payload).toBeNull();
    });

    it('should return null for token with wrong secret', async () => {
      const token = await generateToken(mockUser, TEST_SECRET);
      const payload = await verifyToken(token, 'wrong-secret');
      expect(payload).toBeNull();
    });

    it('should return null for empty token', async () => {
      const payload = await verifyToken('', TEST_SECRET);
      expect(payload).toBeNull();
    });

    it('should return null for malformed token', async () => {
      const payload = await verifyToken('not.a.valid.jwt.token', TEST_SECRET);
      expect(payload).toBeNull();
    });

    it('should include exp and iat in payload', async () => {
      const token = await generateToken(mockUser, TEST_SECRET);
      const payload = await verifyToken(token, TEST_SECRET);
      
      expect(payload?.exp).toBeDefined();
      expect(payload?.iat).toBeDefined();
      expect(typeof payload?.exp).toBe('number');
      expect(typeof payload?.iat).toBe('number');
    });
  });

  describe('extractToken', () => {
    it('should extract token from valid Bearer header', () => {
      const token = extractToken('Bearer my-jwt-token');
      expect(token).toBe('my-jwt-token');
    });

    it('should return null for null header', () => {
      const token = extractToken(null);
      expect(token).toBeNull();
    });

    it('should return null for empty header', () => {
      const token = extractToken('');
      expect(token).toBeNull();
    });

    it('should return null for header without Bearer prefix', () => {
      const token = extractToken('my-jwt-token');
      expect(token).toBeNull();
    });

    it('should return null for header with wrong prefix', () => {
      const token = extractToken('Basic my-jwt-token');
      expect(token).toBeNull();
    });

    it('should return null for header with multiple spaces', () => {
      const token = extractToken('Bearer  my-jwt-token');
      expect(token).toBeNull();
    });

    it('should return null for header with only Bearer', () => {
      const token = extractToken('Bearer');
      expect(token).toBeNull();
    });

    it('should handle token with special characters', () => {
      const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const token = extractToken(`Bearer ${expectedToken}`);
      expect(token).toBe(expectedToken);
    });
  });

  describe('Integration: generateToken + verifyToken', () => {
    it('should roundtrip token generation and verification', async () => {
      const token = await generateToken(mockUser, TEST_SECRET);
      const payload = await verifyToken(token, TEST_SECRET);
      
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(mockUser.id);
    });

    it('should handle admin user correctly', async () => {
      const adminUser: User = { ...mockUser, isAdmin: true };
      const token = await generateToken(adminUser, TEST_SECRET);
      const payload = await verifyToken(token, TEST_SECRET);
      
      expect(payload?.isAdmin).toBe(true);
    });
  });
});
