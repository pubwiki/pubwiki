/**
 * Hub Worker 环境类型
 */
import type { GameSaveRPC } from 'pubwiki-gamesave';

export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string; // 逗号分隔的 origin 列表
  GAMESAVE: GameSaveRPC; // Service Binding 到 gamesave Worker
}
