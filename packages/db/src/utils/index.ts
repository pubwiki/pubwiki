// SQLite 最大绑定参数数量限制
export const MAX_BIND_PARAMS = 100;

/**
 * 将数组分块以遵守 SQLite 参数限制
 * @param array - 要分块的数组
 * @param fieldsPerRow - 每行的字段数量
 * @returns 分块后的数组
 */
export function chunkArray<T>(array: T[], fieldsPerRow: number): T[][] {
  const chunkSize = Math.floor(MAX_BIND_PARAMS / fieldsPerRow);
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Export NodeGraphFactory and ImmutableGraph for graph validation
export {
  NodeGraphFactory,
  ImmutableGraph,
  validateGraph,
  validateStructure,
  validateSaveNodes,
  validateEntrypoint,
  type NodeGraphPatch,
  // Type exports from flow-core
  type ImmutableGraphNode,
  type ImmutableGraphEdge,
  type GraphValidationResult,
  type EntrypointConfig,
} from './node-graph';

