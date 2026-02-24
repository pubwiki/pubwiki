/**
 * Validation Types
 * 
 * Common types used across validation modules.
 */

/**
 * Error codes for graph validation
 * These match the ServiceError codes in @pubwiki/db for compatibility
 */
export type GraphValidationErrorCode = 'BAD_REQUEST' | 'INTERNAL_ERROR';

/**
 * Validation error details
 */
export interface GraphValidationError {
  /** Error code */
  code: GraphValidationErrorCode;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of a graph validation operation
 */
export interface GraphValidationResult {
  /** Whether validation passed */
  success: boolean;
  /** Error details if validation failed */
  error?: GraphValidationError;
  /** Validated data if needed (undefined for void validation) */
  data?: undefined;
}

/**
 * Entrypoint configuration for artifact
 */
export interface EntrypointConfig {
  /** Commit hash of the SAVE node to use as entrypoint */
  saveCommit: string;
  /** ID of the SANDBOX node to use as entrypoint */
  sandboxNodeId: string;
}
