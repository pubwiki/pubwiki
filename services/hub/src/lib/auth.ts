import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from '@pubwiki/db';
import type { Env } from '../types';
import { user, session, account, verification } from '@pubwiki/db';
import { username } from 'better-auth/plugins';

export const createAuth = (env: Env) => {
  const db = createDb(env.DB);
  
  // 判断是否是开发/测试环境
  // 注意：在 E2E 测试中端口是动态的，所以需要检查 localhost
  const isDev = !env.BETTER_AUTH_URL || 
    env.BETTER_AUTH_URL.includes('localhost') || 
    env.BETTER_AUTH_URL.includes('127.0.0.1');
  
  return betterAuth({
    database: drizzleAdapter(db, { 
      provider: 'sqlite',  // D1 使用 sqlite 方言
      schema: {
        user,
        session,
        account,
        verification,
      },
    }),
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // 在开发环境，信任所有 localhost 端口
    trustedOrigins: isDev 
      ? ['http://localhost:*', 'http://127.0.0.1:*']
      : (env.BETTER_AUTH_TRUSTED_ORIGINS
          ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(',')
          : []),
    advanced: {
      // 在开发/测试环境禁用 Origin 检查，因为端口是动态的
      disableCSRFCheck: isDev,
      disableOriginCheck: isDev,
    },
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        username: {
          type: 'string',
          required: true,
          input: true,
        },
        bio: {
          type: 'string',
          required: false,
          input: true,
        },
        website: {
          type: 'string',
          required: false,
          input: true,
        },
        location: {
          type: 'string',
          required: false,
          input: true,
        },
        isAdmin: {
          type: 'boolean',
          defaultValue: false,
          input: false, // 不允许用户设置
        },
        isVerified: {
          type: 'boolean',
          defaultValue: false,
          input: false, // 不允许用户设置
        },
      },
    },
    plugins: [
      username(), // 启用 username 登录支持
    ],
    // 可选：启用 OAuth
    // socialProviders: {
    //   github: {
    //     clientId: env.GITHUB_CLIENT_ID,
    //     clientSecret: env.GITHUB_CLIENT_SECRET,
    //   },
    // },
  });
};

export type Auth = ReturnType<typeof createAuth>;
