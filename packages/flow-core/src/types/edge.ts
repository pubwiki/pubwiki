/**
 * Graph Edge Types
 * 
 * Defines edge types independent of any rendering framework.
 */

/**
 * Edge in the flow graph
 */
export interface GraphEdge {
  /** Unique edge identifier */
  id: string
  /** Source node ID */
  source: string
  /** Target node ID */
  target: string
  /** Source handle ID */
  sourceHandle?: string | null
  /** Target handle ID */
  targetHandle?: string | null
}
