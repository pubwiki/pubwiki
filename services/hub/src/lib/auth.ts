import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from '@pubwiki/db';
import type { Env } from '../types';
import { user, session, account, verification } from '@pubwiki/db';
import { username } from 'better-auth/plugins';

// PBKDF2 password hashing using Web Crypto API (hardware-accelerated in Workers)
// Replaces default bcrypt which exceeds Workers CPU time limits
// TODO: Switch to native node:crypto scrypt once better-auth integrates @better-auth/utils@0.4.0+
//   Tracking: https://github.com/better-auth/better-auth/issues/8456
const PBKDF2_ITERATIONS = 100_000; // OWASP recommended for SHA-256
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LENGTH * 8,
  );
  const saltHex = [...new Uint8Array(salt)].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(derivedBits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split(':');
  // Support legacy bcrypt hashes (start with $2) by rejecting them
  // so Better Auth falls back to re-hashing on next login
  if (!parts[0] || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = new Uint8Array((parts[2].match(/.{2}/g) ?? []).map(b => parseInt(b, 16)));
  const expectedHash = parts[3];
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_LENGTH * 8,
  );
  const hashHex = [...new Uint8Array(derivedBits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHash;
}

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
    // 在开发环境，信任所有 localhost 端口（HTTP + HTTPS）
    trustedOrigins: isDev 
      ? ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*', 'https://127.0.0.1:*']
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
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    user: {
      // 字段映射：Better Auth 的 name/image 映射到我们 schema 的 displayName/avatarUrl
      fields: {
        name: 'displayName',
        image: 'avatarUrl',
      },
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
