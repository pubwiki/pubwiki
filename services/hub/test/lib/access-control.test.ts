import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import type { Env } from '../../src/types';
import type { ResourceRef } from '@pubwiki/db/services';
import {
  checkResourceAccess,
  checkResourceWriteAccess,
  checkResourceManageAccess,
  requireResourceOwner,
} from '../../src/lib/access-control';

// Mock Context factory for new ACL-based API
function createMockContext(
  permissions: {
    canRead?: (ref: ResourceRef) => Promise<boolean>;
    canWrite?: (ref: ResourceRef) => Promise<boolean>;
    canManage?: (ref: ResourceRef) => Promise<boolean>;
  },
  userId: string | null = null
): Context<{ Bindings: Env }> {
  const resourceAccess = {
    canRead: permissions.canRead ?? vi.fn().mockResolvedValue(false),
    canWrite: permissions.canWrite ?? vi.fn().mockResolvedValue(false),
    canManage: permissions.canManage ?? vi.fn().mockResolvedValue(false),
    userId,
    tokenValue: null,
    aclService: {},
  };

  const jsonResponses: Array<{ body: unknown; status: number }> = [];

  const mockContext = {
    get: vi.fn((key: string) => {
      if (key === 'resourceAccess') return resourceAccess;
      return undefined;
    }),
    json: vi.fn((body: unknown, status: number = 200) => {
      jsonResponses.push({ body, status });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
    // Helper to get last json response
    _getLastJsonCall: () => jsonResponses[jsonResponses.length - 1],
  } as unknown as Context<{ Bindings: Env }> & {
    _getLastJsonCall: () => { body: unknown; status: number } | undefined;
  };

  return mockContext;
}

describe('access-control', () => {
  describe('checkResourceAccess', () => {
    it('should return null when read access is allowed', async () => {
      const mockCanRead = vi.fn().mockResolvedValue(true);
      const c = createMockContext({ canRead: mockCanRead });
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceAccess(c, ref);

      expect(result).toBeNull();
      expect(mockCanRead).toHaveBeenCalledWith(ref);
    });

    it('should return 403 when read access is denied', async () => {
      const mockCanRead = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canRead: mockCanRead }) as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceAccess(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(403);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Access denied' });
    });
  });

  describe('checkResourceWriteAccess', () => {
    it('should return null when write access is allowed', async () => {
      const mockCanWrite = vi.fn().mockResolvedValue(true);
      const c = createMockContext({ canWrite: mockCanWrite });
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceWriteAccess(c, ref);

      expect(result).toBeNull();
      expect(mockCanWrite).toHaveBeenCalledWith(ref);
    });

    it('should return 403 when write access is denied', async () => {
      const mockCanWrite = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canWrite: mockCanWrite }) as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceWriteAccess(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(403);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Access denied' });
    });
  });

  describe('checkResourceManageAccess', () => {
    it('should return null when manage access is allowed', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(true);
      const c = createMockContext({ canManage: mockCanManage }, 'user-123');
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceManageAccess(c, ref);

      expect(result).toBeNull();
      expect(mockCanManage).toHaveBeenCalledWith(ref);
    });

    it('should return 401 when not authenticated', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canManage: mockCanManage }, null) as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceManageAccess(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(401);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Authentication required' });
      // Should not call canManage when not authenticated
      expect(mockCanManage).not.toHaveBeenCalled();
    });

    it('should return 403 when manage access is denied', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canManage: mockCanManage }, 'user-123') as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await checkResourceManageAccess(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(403);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Access denied' });
    });
  });

  describe('requireResourceOwner', () => {
    it('should return null when user has manage permission', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(true);
      const c = createMockContext({ canManage: mockCanManage }, 'user-123');
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await requireResourceOwner(c, ref);

      expect(result).toBeNull();
    });

    it('should return 401 when not authenticated', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canManage: mockCanManage }, null) as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await requireResourceOwner(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(401);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Authentication required' });
    });

    it('should return 403 when manage permission is denied', async () => {
      const mockCanManage = vi.fn().mockResolvedValue(false);
      const c = createMockContext({ canManage: mockCanManage }, 'user-123') as Context<{ Bindings: Env }> & {
        _getLastJsonCall: () => { body: unknown; status: number } | undefined;
      };
      const ref: ResourceRef = { type: 'artifact', id: 'test-id' };

      const result = await requireResourceOwner(c, ref);

      expect(result).toBeInstanceOf(Response);
      expect(c._getLastJsonCall()?.status).toBe(403);
      expect(c._getLastJsonCall()?.body).toEqual({ error: 'Access denied' });
    });
  });
});
