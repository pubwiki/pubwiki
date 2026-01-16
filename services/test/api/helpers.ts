import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import app from '../../src/index';
import { createDb, user, session, account, verification, artifacts, tags, artifactTags, artifactStats, artifactVersions, artifactLineage, projects, projectMaintainers, projectArtifacts, projectRoles, projectPages, projectPosts, artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs, discussions, discussionReplies, articles, eq } from '@pubwiki/db';

export type TestDb = ReturnType<typeof createDb>;

/**
 * 获取测试环境 R2 bucket
 */
export function getTestR2Bucket(): R2Bucket {
  return env.R2_BUCKET;
}

/**
 * 创建数据库实例
 */
export function getTestDb(): TestDb {
  return createDb(env.DB);
}

/**
 * 清空数据库（按外键顺序）
 */
export async function clearDatabase(db: TestDb): Promise<void> {
  await db.delete(discussionReplies);
  await db.delete(discussions);
  await db.delete(articles);
  await db.delete(artifactLineage);
  await db.delete(artifactNodeFiles);
  await db.delete(artifactNodeVersions);
  await db.delete(artifactNodeRefs);
  await db.delete(artifactNodes);
  await db.delete(artifactVersions);
  await db.delete(artifactTags);
  await db.delete(artifactStats);
  await db.delete(projectPosts);
  await db.delete(projectArtifacts);
  await db.delete(projectMaintainers);
  await db.delete(projectRoles);
  await db.delete(projectPages);
  // 更新 projects 表清除 homepageId 引用后再删除（因为有循环引用）
  await db.update(projects).set({ homepageId: null });
  await db.delete(projects);
  await db.delete(artifacts);
  await db.delete(tags);
  // Better-Auth 相关表 (按外键顺序)
  await db.delete(session);
  await db.delete(account);
  await db.delete(verification);
  await db.delete(user);
}

/**
 * 发送请求到API
 */
export async function sendRequest(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/**
 * 注册用户并返回 session cookie 和 userId
 */
export async function registerUser(username: string): Promise<{
  sessionCookie: string;
  userId: string;
}> {
  const request = new Request('http://localhost/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.com`,
      password: 'password123',
    }),
  });
  const response = await sendRequest(request);
  if (!response.ok) {
    throw new Error(`Failed to register user: ${response.status}`);
  }
  const setCookie = response.headers.get('Set-Cookie') || '';
  const cookieValue = setCookie.split(';')[0];
  
  // 从响应中获取用户信息
  const data = await response.json<{ user: { id: string } }>();
  
  return {
    sessionCookie: cookieValue,
    userId: data.user.id,
  };
}

/**
 * 通过 Better-Auth API 注册用户并返回 session cookie
 * 返回格式: "better-auth.session_token=xxx" (可直接用于 Cookie header)
 */
export async function registerAndGetSession(username: string): Promise<string> {
  const { sessionCookie } = await registerUser(username);
  return sessionCookie;
}

/**
 * 创建测试用户和 session（直接操作数据库，更快）
 * 返回 session cookie 字符串
 */
export async function createTestUserWithSession(db: TestDb, username: string = 'testuser'): Promise<{
  userId: string;
  sessionCookie: string;
}> {
  const userId = await createTestUser(db, username);
  const token = crypto.randomUUID();
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return {
    userId,
    sessionCookie: `better-auth.session_token=${token}`,
  };
}

/**
 * @deprecated 使用 registerAndGetSession 或 createTestUserWithSession 代替
 * 注册并登录用户，返回 session cookie (向后兼容)
 */
export async function registerAndLogin(username: string): Promise<string> {
  return registerAndGetSession(username);
}

/**
 * 创建测试用户（直接操作数据库）
 */
export async function createTestUser(db: TestDb, username: string = 'testuser'): Promise<string> {
  const now = new Date();
  const [createdUser] = await db.insert(user).values({
    username,
    email: `${username}@example.com`,
    name: username,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    displayUsername: username,
    isAdmin: false,
    isVerified: false,
  }).returning();
  return createdUser.id;
}

// 导出数据库表和eq操作符，方便测试文件使用
// 注意: 'user' 是正确的表名，'users' 是别名保持向后兼容
export { user, user as users, session, account, verification, artifacts, tags, artifactTags, artifactStats, artifactVersions, artifactLineage, projects, projectMaintainers, projectArtifacts, projectRoles, projectPages, projectPosts, artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs, discussions, discussionReplies, articles, eq };
