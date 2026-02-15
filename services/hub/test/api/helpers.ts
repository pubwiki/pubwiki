import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import app from '../../src/index';
import { createDb, user, session, account, verification, artifacts, tags, artifactTags, artifactStats, artifactVersions, projects, projectArtifacts, projectRoles, projectPages, projectPosts, nodeVersions, nodeVersionRefs, artifactVersionNodes, artifactVersionEdges, discussions, discussionReplies, articles, resourceDiscoveryControl, resourceAcl, PUBLIC_USER_ID, eq } from '@pubwiki/db';

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
  await db.delete(resourceAcl);
  await db.delete(resourceDiscoveryControl);
  await db.delete(discussionReplies);
  await db.delete(discussions);
  await db.delete(articles);
  await db.delete(nodeVersionRefs);
  await db.delete(artifactVersionNodes);
  await db.delete(artifactVersionEdges);
  await db.delete(artifactVersions);
  await db.delete(artifactTags);
  await db.delete(artifactStats);
  await db.delete(projectPosts);
  await db.delete(projectArtifacts);
  await db.delete(projectRoles);
  await db.delete(projectPages);
  // 更新 projects 表清除 homepageId 引用后再删除（因为有循环引用）
  await db.update(projects).set({ homepageId: null });
  await db.delete(projects);
  await db.delete(nodeVersions);
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
    displayName: username,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    displayUsername: username,
    isVerified: false,
  }).returning();
  return createdUser.id;
}

/**
 * 创建 VFS tar.gz 归档
 * @param files 文件列表，每个文件包含名称和内容
 * @returns tar.gz 压缩后的 ArrayBuffer
 */
export async function createVfsTarGz(
  files: { name: string; content: string | Uint8Array }[]
): Promise<ArrayBuffer> {
  // 创建 tar 数据
  const tarParts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const content = typeof file.content === 'string' 
      ? encoder.encode(file.content) 
      : file.content;
    
    // 创建 tar header (512 bytes)
    const header = new Uint8Array(512);
    
    // 文件名 (0-99)
    const nameBytes = encoder.encode(file.name);
    header.set(nameBytes.slice(0, 100), 0);
    
    // 文件模式 (100-107): 0644
    header.set(encoder.encode('0000644\0'), 100);
    
    // UID (108-115): 0
    header.set(encoder.encode('0000000\0'), 108);
    
    // GID (116-123): 0
    header.set(encoder.encode('0000000\0'), 116);
    
    // 文件大小 (124-135): 八进制
    const sizeOctal = content.length.toString(8).padStart(11, '0') + '\0';
    header.set(encoder.encode(sizeOctal), 124);
    
    // 修改时间 (136-147): 当前时间
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.set(encoder.encode(mtime), 136);
    
    // 校验和占位符 (148-155): 8个空格
    header.set(encoder.encode('        '), 148);
    
    // 类型标志 (156): '0' 表示普通文件
    header[156] = 48; // '0'
    
    // USTAR magic (257-262): 'ustar\0'
    header.set(encoder.encode('ustar\0'), 257);
    
    // USTAR version (263-264): '00'
    header.set(encoder.encode('00'), 263);
    
    // 计算校验和
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(checksumOctal), 148);
    
    tarParts.push(header);
    tarParts.push(content);
    
    // 填充到 512 字节边界
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) {
      tarParts.push(new Uint8Array(padding));
    }
  }
  
  // 添加两个空的 512 字节块作为结束标记
  tarParts.push(new Uint8Array(1024));
  
  // 合并所有部分
  const totalLength = tarParts.reduce((acc, part) => acc + part.length, 0);
  const tarData = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of tarParts) {
    tarData.set(part, offset);
    offset += part.length;
  }
  
  // 使用 CompressionStream 进行 gzip 压缩
  const stream = new Blob([tarData]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const compressedBlob = await new Response(compressedStream).blob();
  return compressedBlob.arrayBuffer();
}

// 导出数据库表和eq操作符，方便测试文件使用
// 注意: 'user' 是正确的表名，'users' 是别名保持向后兼容
export { user, user as users, session, account, verification, artifacts, tags, artifactTags, artifactStats, artifactVersions, projects, projectArtifacts, projectRoles, projectPages, projectPosts, nodeVersions, nodeVersionRefs, artifactVersionNodes, artifactVersionEdges, discussions, discussionReplies, articles, resourceDiscoveryControl, resourceAcl, PUBLIC_USER_ID, eq };
