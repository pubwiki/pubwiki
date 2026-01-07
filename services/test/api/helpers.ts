import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import app from '../../src/index';
import { createDb, users, artifacts, tags, artifactTags, artifactStats, artifactVersions, artifactLineage, projects, projectMaintainers, projectArtifacts, projectRoles, projectPages, projectPosts, artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs, discussions, discussionReplies, eq } from '@pubwiki/db';
import type { RegisterResponse } from '@pubwiki/api';

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
  await db.delete(users);
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
 * 注册并登录用户，返回token
 */
export async function registerAndLogin(username: string): Promise<string> {
  const registerRequest = new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'password123',
    }),
  });
  const response = await sendRequest(registerRequest);
  const data = await response.json<RegisterResponse>();
  return data.token;
}

/**
 * 创建测试用户（直接操作数据库）
 */
export async function createTestUser(db: TestDb, username: string = 'testuser'): Promise<string> {
  const [user] = await db.insert(users).values({
    username,
    email: `${username}@example.com`,
    passwordHash: 'hashedpassword',
  }).returning();
  return user.id;
}

// 导出数据库表和eq操作符，方便测试文件使用
export { users, artifacts, tags, artifactTags, artifactStats, artifactVersions, artifactLineage, projects, projectMaintainers, projectArtifacts, projectRoles, projectPages, projectPosts, artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs, discussions, discussionReplies, eq };
