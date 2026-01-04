import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types';
import { createDb, UserService, type ServiceError } from '@pubwiki/db';
import type { RegisterRequest, RegisterResponse, LoginRequest, LoginResponse, ApiError } from '@pubwiki/api';

const auth = new Hono<{ Bindings: Env }>();

// 将服务错误转换为 HTTP 状态码
function errorToStatus(error: ServiceError): ContentfulStatusCode {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'USER_EXISTS':
      return 409;
    case 'INVALID_CREDENTIALS':
      return 401;
    case 'USER_NOT_FOUND':
      return 404;
    case 'INTERNAL_ERROR':
    default:
      return 500;
  }
}

// 注册
auth.post('/register', async (c) => {
  const db = createDb(c.env.DB);
  const userService = new UserService(db, c.env.JWT_SECRET);

  const body = await c.req.json<RegisterRequest>();
  const result = await userService.register(body);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, errorToStatus(result.error));
  }

  return c.json<RegisterResponse>({
    message: 'Registration successful',
    user: result.data.user,
    token: result.data.token,
  }, 201);
});

// 登录
auth.post('/login', async (c) => {
  const db = createDb(c.env.DB);
  const userService = new UserService(db, c.env.JWT_SECRET);

  const body = await c.req.json<LoginRequest>();
  const result = await userService.login(body);

  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, errorToStatus(result.error));
  }

  return c.json<LoginResponse>({
    message: 'Login successful',
    user: result.data.user,
    token: result.data.token,
  });
});

export { auth };
