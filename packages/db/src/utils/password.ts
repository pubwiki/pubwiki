// Password hashing using Web Crypto API (Cloudflare Workers compatible)
// Using PBKDF2 with SHA-256

const ITERATIONS = 100000;
const KEY_LENGTH = 64; // bytes
const SALT_LENGTH = 32; // bytes

// 生成随机盐值
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

// 将 ArrayBuffer 或 Uint8Array 转换为 hex 字符串
function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(uint8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 将 hex 字符串转换为 Uint8Array
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// 使用 PBKDF2 派生密钥
async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_LENGTH * 8 // bits
  );
}

// Hash 密码
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const derivedKey = await deriveKey(password, salt);
  
  // 格式: salt:hash (both in hex)
  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(derivedKey);
  
  return `${saltHex}:${hashHex}`;
}

// 验证密码
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(':');
  
  if (!saltHex || !hashHex) {
    return false;
  }
  
  const salt = hexToBuffer(saltHex);
  const derivedKey = await deriveKey(password, salt);
  const derivedHashHex = bufferToHex(derivedKey);
  
  // 使用时间恒定比较防止时序攻击
  return timingSafeEqual(hashHex, derivedHashHex);
}

// 时间恒定比较
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}
