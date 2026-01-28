/**
 * E2E 测试辅助函数
 * 使用 @pubwiki/api 的 createAuthClient 进行认证
 */

import { createAuthClient } from '@pubwiki/api/client';
import type { Quad } from '@pubwiki/api';

// 存储 cookies 的简单实现
let storedCookies: Map<string, string> = new Map();

/**
 * 自定义 fetch，用于在 Node.js 环境中管理 cookies
 */
function createCookieFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    
    // 添加存储的 cookies
    if (storedCookies.size > 0) {
      const cookieStr = Array.from(storedCookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      headers.set('Cookie', cookieStr);
    }
    
    const response = await fetch(input, { ...init, headers });
    
    // 保存响应中的 Set-Cookie
    const setCookie = response.headers.get('Set-Cookie');
    if (setCookie) {
      // 解析 Set-Cookie header
      const cookieParts = setCookie.split(';')[0];
      const [name, value] = cookieParts.split('=');
      if (name && value) {
        storedCookies.set(name.trim(), value.trim());
      }
    }
    
    return response;
  };
}

/**
 * 清除存储的 cookies
 */
export function clearCookies() {
  storedCookies = new Map();
}

/**
 * 获取当前存储的 session cookie 字符串
 */
export function getSessionCookie(): string {
  const sessionToken = storedCookies.get('better-auth.session_token');
  return sessionToken ? `better-auth.session_token=${sessionToken}` : '';
}

/**
 * 通过 Better-Auth 注册用户并返回 session cookie
 * @param baseUrl API 基础 URL (例如 http://localhost:8787/api)
 * @param username 用户名
 * @returns session cookie 字符串和 userId
 */
export async function registerUser(
  baseUrl: string,
  username: string
): Promise<{ sessionCookie: string; userId: string }> {
  // 清除之前的 cookies
  clearCookies();
  
  // 提取 origin（不包含 /api）
  const origin = new URL(baseUrl).origin;
  
  // 创建带自定义 fetch 的 auth client
  const authClient = createAuthClient(origin);
  
  // 使用 better-auth 客户端注册
  // 由于 better-auth/client 在 Node.js 环境中不会自动处理 cookies，
  // 我们直接使用 fetch API
  const response = await fetch(`${baseUrl}/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.com`,
      password: 'password123',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register user: ${response.status} - ${text}`);
  }

  const setCookie = response.headers.get('Set-Cookie') || '';
  const sessionCookie = setCookie.split(';')[0];
  
  // 保存 cookie
  const [name, value] = sessionCookie.split('=');
  if (name && value) {
    storedCookies.set(name.trim(), value.trim());
  }
  
  const data = (await response.json()) as { user: { id: string } };
  
  return {
    sessionCookie,
    userId: data.user.id,
  };
}

/**
 * 通过 Better-Auth 登录并返回 session cookie
 * @param baseUrl API 基础 URL
 * @param email 邮箱
 * @param password 密码
 * @returns session cookie 字符串和 userId
 */
export async function loginUser(
  baseUrl: string,
  email: string,
  password: string
): Promise<{ sessionCookie: string; userId: string }> {
  // 清除之前的 cookies
  clearCookies();
  
  const origin = new URL(baseUrl).origin;
  
  const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to login: ${response.status} - ${text}`);
  }

  const setCookie = response.headers.get('Set-Cookie') || '';
  const sessionCookie = setCookie.split(';')[0];
  
  // 保存 cookie
  const [name, value] = sessionCookie.split('=');
  if (name && value) {
    storedCookies.set(name.trim(), value.trim());
  }
  
  const data = (await response.json()) as { user: { id: string } };
  
  return {
    sessionCookie,
    userId: data.user.id,
  };
}

/**
 * 创建带认证的 fetch 函数
 * @param sessionCookie session cookie 字符串
 * @returns 带 Cookie header 的 fetch 函数
 */
export function createAuthenticatedFetch(sessionCookie: string) {
  return (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', sessionCookie);
    return fetch(url, { ...init, headers });
  };
}

/**
 * 创建 VFS 节点的 tar.gz 归档
 * 实现简化的 tar 格式 + gzip 压缩
 * @param files 文件数组，每个文件包含 name 和 content
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
    
    // 链接名 (157-256): 空
    
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
    
    // Padding to 512 byte boundary
    const paddingSize = (512 - (content.length % 512)) % 512;
    if (paddingSize > 0) {
      tarParts.push(new Uint8Array(paddingSize));
    }
  }
  
  // 添加 tar 结束标记 (两个 512 字节的零块)
  tarParts.push(new Uint8Array(1024));
  
  // 合并为单个数组
  const totalSize = tarParts.reduce((acc, part) => acc + part.length, 0);
  const tarData = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of tarParts) {
    tarData.set(part, offset);
    offset += part.length;
  }
  
  // 使用 CompressionStream 进行 gzip 压缩
  const compressedStream = new Blob([tarData])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  
  const compressedBlob = await new Response(compressedStream).blob();
  return compressedBlob.arrayBuffer();
}

/**
 * 创建云端存档 (Cloud Save)
 * @param baseUrl API 基础 URL
 * @param sessionCookie session cookie 字符串
 * @param stateNodeId 关联的 STATE node ID
 * @param name 存档名称
 * @returns 创建的 saveId
 */
export async function createCloudSave(
  baseUrl: string,
  sessionCookie: string,
  stateNodeId: string,
  name: string = 'Test Save'
): Promise<string> {
  const response = await fetch(`${baseUrl}/saves`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stateNodeId, name }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create cloud save: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * 创建 checkpoint
 * @param baseUrl API 基础 URL
 * @param sessionCookie session cookie 字符串
 * @param saveId 存档 ID
 * @param quads checkpoint 包含的 quads 数组
 * @param options 可选配置 (id, visibility)
 * @returns 创建的 checkpointId
 */
export async function createCheckpoint(
  baseUrl: string,
  sessionCookie: string,
  saveId: string,
  quads: Quad[] = [],
  options: {
    id?: string;
    visibility?: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
    name?: string;
  } = {}
): Promise<string> {
  const { id: checkpointId, visibility = 'PUBLIC', name } = options;
  const response = await fetch(`${baseUrl}/saves/${saveId}/checkpoints`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      quads,
      id: checkpointId,
      name: name ?? `Test Checkpoint ${checkpointId || Date.now()}`,
      visibility,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create checkpoint: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}
