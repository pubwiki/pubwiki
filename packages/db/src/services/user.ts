import { eq, or } from 'drizzle-orm';
import type { Database } from '../client';
import { users, type User, type NewUser } from '../schema/users';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateToken, type JWTPayload } from '../utils/jwt';

// 注册输入
export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

// 登录输入
export interface LoginInput {
  usernameOrEmail: string;
  password: string;
}

// 用户公开信息（不包含敏感字段）
// 与 @pubwiki/api 的 PublicUser 保持一致
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

// 认证响应
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

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

// 将 User 转换为 PublicUser（移除敏感字段）
function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    website: user.website,
    location: user.location,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserService {
  constructor(
    private db: Database,
    private jwtSecret: string
  ) {}

  // 验证注册输入
  private validateRegisterInput(input: RegisterInput): ServiceError | null {
    if (!input.username || !input.email || !input.password) {
      return { code: 'VALIDATION_ERROR', message: 'Missing required fields' };
    }

    // 用户名格式验证
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(input.username)) {
      return {
        code: 'VALIDATION_ERROR',
        message: 'Username must be 3-50 characters and contain only letters, numbers, underscores and hyphens',
      };
    }

    // 邮箱格式验证
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      return { code: 'VALIDATION_ERROR', message: 'Invalid email format' };
    }

    // 密码强度验证
    if (input.password.length < 8) {
      return { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' };
    }

    return null;
  }

  // 验证登录输入
  private validateLoginInput(input: LoginInput): ServiceError | null {
    if (!input.usernameOrEmail || !input.password) {
      return { code: 'VALIDATION_ERROR', message: 'Missing required fields' };
    }
    return null;
  }

  // 注册新用户
  async register(input: RegisterInput): Promise<ServiceResult<AuthResponse>> {
    // 输入验证
    const validationError = this.validateRegisterInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    try {
      // 检查用户名或邮箱是否已存在
      const existingUser = await this.db
        .select({ id: users.id })
        .from(users)
        .where(or(eq(users.username, input.username), eq(users.email, input.email)))
        .limit(1);

      if (existingUser.length > 0) {
        return {
          success: false,
          error: { code: 'USER_EXISTS', message: 'Username or email already exists' },
        };
      }

      // Hash 密码
      const passwordHash = await hashPassword(input.password);

      // 创建用户
      const [newUser] = await this.db
        .insert(users)
        .values({
          username: input.username,
          email: input.email,
          passwordHash,
          displayName: input.displayName || input.username,
        })
        .returning();

      // 生成 JWT token
      const token = await generateToken(newUser, this.jwtSecret);

      return {
        success: true,
        data: {
          user: toPublicUser(newUser),
          token,
        },
      };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 用户登录
  async login(input: LoginInput): Promise<ServiceResult<AuthResponse>> {
    // 输入验证
    const validationError = this.validateLoginInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    try {
      // 查找用户（通过用户名或邮箱）
      const [user] = await this.db
        .select()
        .from(users)
        .where(
          or(
            eq(users.username, input.usernameOrEmail),
            eq(users.email, input.usernameOrEmail)
          )
        )
        .limit(1);

      if (!user) {
        return {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        };
      }

      // 验证密码
      const isValidPassword = await verifyPassword(input.password, user.passwordHash);

      if (!isValidPassword) {
        return {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        };
      }

      // 更新最后登录时间
      await this.db
        .update(users)
        .set({ lastLoginAt: new Date().toISOString() })
        .where(eq(users.id, user.id));

      // 生成 JWT token
      const token = await generateToken(user, this.jwtSecret);

      return {
        success: true,
        data: {
          user: toPublicUser(user),
          token,
        },
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 通过 ID 获取用户
  async getUserById(id: string): Promise<ServiceResult<PublicUser>> {
    try {
      const [user] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      return {
        success: true,
        data: toPublicUser(user),
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
      const [user] = await this.db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      return {
        success: true,
        data: toPublicUser(user),
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
    updates: Partial<Pick<User, 'displayName' | 'avatarUrl' | 'bio' | 'website' | 'location'>>
  ): Promise<ServiceResult<PublicUser>> {
    try {
      const [updatedUser] = await this.db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, id))
        .returning();

      if (!updatedUser) {
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }

      return {
        success: true,
        data: toPublicUser(updatedUser),
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
