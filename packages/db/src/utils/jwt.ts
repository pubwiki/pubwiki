import { SignJWT, jwtVerify } from 'jose';
import type { User } from '../schema/users';

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRATION = '7d';

export interface JWTPayload {
  sub: string; // user id
  username: string;
  email: string;
  isAdmin: boolean;
  exp?: number;
  iat?: number;
}

// 生成 JWT token
export async function generateToken(user: User, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  
  const token = await new SignJWT({
    sub: user.id,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION)
    .sign(secretKey);
  
  return token;
}

// 验证 JWT token
export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [JWT_ALGORITHM],
    });
    
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// 从 Authorization header 提取 token
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}
