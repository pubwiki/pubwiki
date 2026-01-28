/**
 * GameSave 类型定义
 * 所有类型从 rpc-types 导入（rpc-types 会 re-export @pubwiki/api 类型）
 */

export type {
  // From @pubwiki/api via rpc-types
  Quad,
  CheckpointVisibility,
  // Local types
  SaveMetadata,
  CreateCheckpointOptions,
  CheckpointInfo,
  ExportCheckpointResult,
  GameSaveRPC,
} from './rpc-types';
