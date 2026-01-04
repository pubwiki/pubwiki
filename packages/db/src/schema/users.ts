import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 生成 UUID 的 SQL 表达式 (SQLite 兼容)
const generateUUID = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`;

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// users - 用户表
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    username: text('username', { length: 50 }).notNull().unique(),
    displayName: text('display_name', { length: 100 }),
    email: text('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url', { length: 500 }),
    bio: text('bio'),
    website: text('website', { length: 255 }),
    location: text('location', { length: 100 }),
    isVerified: integer('is_verified', { mode: 'boolean' }).default(false).notNull(),
    isAdmin: integer('is_admin', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (table) => [
    index('idx_users_username').on(table.username),
    index('idx_users_email').on(table.email),
  ]
);

// user_oauth - OAuth 第三方登录
export const userOauth = sqliteTable(
  'user_oauth',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { length: 50 }).notNull(), // github/google/discord
    providerUserId: text('provider_user_id', { length: 255 }).notNull(),
    accessToken: text('access_token'), // 加密存储
    refreshToken: text('refresh_token'), // 加密存储
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_user_oauth_user').on(table.userId),
    index('idx_user_oauth_provider').on(table.provider, table.providerUserId),
  ]
);

// user_follows - 用户关注关系
export const userFollows = sqliteTable(
  'user_follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index('idx_user_follows_follower').on(table.followerId),
    index('idx_user_follows_following').on(table.followingId),
  ]
);

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserOauth = typeof userOauth.$inferSelect;
export type NewUserOauth = typeof userOauth.$inferInsert;
export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;
