import { eq } from 'drizzle-orm';
import type { BatchContext } from '../batch-context';
import { user, type User } from '../schema/auth';
import type { PublicUser } from '@pubwiki/api';

// 服务错误类型
export type ServiceError = 
  | { code: 'VALIDATION_ERROR'; message: string }
  | { code: 'USER_EXISTS'; message: string }
  | { code: 'INVALID_CREDENTIALS'; message: string }
  | { code: 'USER_NOT_FOUND'; message: string }
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'CONFLICT'; message: string }
  | { code: 'FORBIDDEN'; message: string }
  | { code: 'BAD_REQUEST'; message: string }
  | { code: 'INTERNAL_ERROR'; message: string };

export type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: ServiceError };

// 重新导出类型
export type { PublicUser };

// 将 User 转换为 PublicUser（移除敏感字段）
function toPublicUser(userData: User): PublicUser {
  return {
    id: userData.id,
    username: userData.username,
    email: userData.email,
    displayName: userData.displayName,
    avatarUrl: userData.avatarUrl,
    bio: userData.bio,
    website: userData.website,
    location: userData.location,
    createdAt: userData.createdAt.toISOString(),
    updatedAt: userData.updatedAt.toISOString(),
  };
}

export class UserService {
  constructor(private ctx: BatchContext) {}

  // 通过 ID 获取用户
  async getUserById(id: string): Promise<ServiceResult<PublicUser>> {
    try {
      const [userData] = await this.ctx.select()
        .from(user)
        .where(eq(user.id, id))
        .limit(1);

      if (!userData) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      return {
        success: true,
        data: toPublicUser(userData),
      };
    } catch (error) {
      console.error('Get user error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 通过用户名获取用户
  async getUserByUsername(username: string): Promise<ServiceResult<PublicUser>> {
    try {
      const [userData] = await this.ctx.select()
        .from(user)
        .where(eq(user.username, username))
        .limit(1);

      if (!userData) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      return {
        success: true,
        data: toPublicUser(userData),
      };
    } catch (error) {
      console.error('Get user error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 更新用户信息
  async updateUser(
    id: string,
    updates: Partial<{ displayName: string; avatarUrl: string | null; bio: string | null; website: string | null; location: string | null }>
  ): Promise<ServiceResult<PublicUser>> {
    try {
      // Check if user exists first
      const [existingUser] = await this.ctx.select()
        .from(user)
        .where(eq(user.id, id))
        .limit(1);

      if (!existingUser) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      // Collect update operation (executed on commit)
      this.ctx.modify()
        .update(user)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(user.id, id));

      // Return the expected result (after commit, data will be updated)
      return {
        success: true,
        data: toPublicUser({
          ...existingUser,
          ...updates,
          updatedAt: new Date(),
        }),
      };
    } catch (error) {
      console.error('Update user error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }
}
