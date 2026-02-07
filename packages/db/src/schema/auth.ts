import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 当前时间戳 (ISO 格式字符串) - 用于非 Better-Auth 表
const currentTimestamp = sql`(datetime('now'))`;

// user - Better-Auth 核心用户表 + 自定义扩展
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(), // displayName
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
    image: text('image'), // avatarUrl
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    // username 插件字段
    username: text('username', { length: 50 }).notNull().unique(),
    displayUsername: text('display_username', { length: 50 }),
    // 自定义扩展字段
    bio: text('bio'),
    website: text('website', { length: 255 }),
    location: text('location', { length: 100 }),
    isVerified: integer('is_verified', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => [
    index('idx_user_username').on(table.username),
    index('idx_user_email').on(table.email),
  ]
);

// session - Better-Auth session 表
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('idx_session_user').on(table.userId),
    index('idx_session_token').on(table.token),
  ]
);

// account - Better-Auth OAuth/social 账户表
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'), // 用于 email+password 认证
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('idx_account_user').on(table.userId),
    index('idx_account_provider').on(table.providerId, table.accountId),
  ]
);

// verification - Better-Auth 验证令牌表
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  },
  (table) => [
    index('idx_verification_identifier').on(table.identifier),
  ]
);

// user_follows - 用户关注关系（从旧 schema 保留）
export const userFollows = sqliteTable(
  'user_follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index('idx_user_follows_follower').on(table.followerId),
    index('idx_user_follows_following').on(table.followingId),
  ]
);

// Type exports
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;
