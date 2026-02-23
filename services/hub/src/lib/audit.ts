/**
 * Audit logging for write operations
 * Outputs structured JSON to console for Cloudflare Workers Logs
 */

export type AuditAction = 
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'unpublish'
  | 'link'
  | 'unlink';

export type AuditResourceType =
  | 'artifact'
  | 'artifact_version'
  | 'project'
  | 'article'
  | 'save'
  | 'discussion'
  | 'discussion_reply'
  | 'node'
  | 'user'
  | 'acl'
  | 'access_token';

export interface AuditLogEntry {
  /** Timestamp in ISO format */
  timestamp: string;
  /** User ID who performed the action (null for anonymous) */
  userId: string | null;
  /** Action performed */
  action: AuditAction;
  /** Resource type */
  resourceType: AuditResourceType;
  /** Resource ID */
  resourceId: string;
  /** Additional context (e.g., old/new values, related resources) */
  details?: Record<string, unknown>;
  /** Request ID for correlation */
  requestId?: string;
  /** IP address (from CF-Connecting-IP header) */
  ip?: string;
}

/**
 * Log an audit event to console
 * In Cloudflare Workers, console.log outputs are captured in Workers Logs
 */
export function audit(entry: Omit<AuditLogEntry, 'timestamp'>): void {
  const logEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Output as structured JSON for easy parsing
  console.log(JSON.stringify({ audit: logEntry }));
}

/**
 * Create an audit logger bound to a specific request context
 */
export function createAuditLogger(context: {
  userId: string | null;
  requestId?: string;
  ip?: string;
}) {
  return {
    log(
      action: AuditAction,
      resourceType: AuditResourceType,
      resourceId: string,
      details?: Record<string, unknown>
    ) {
      audit({
        userId: context.userId,
        requestId: context.requestId,
        ip: context.ip,
        action,
        resourceType,
        resourceId,
        details,
      });
    },

    create(resourceType: AuditResourceType, resourceId: string, details?: Record<string, unknown>) {
      this.log('create', resourceType, resourceId, details);
    },

    update(resourceType: AuditResourceType, resourceId: string, details?: Record<string, unknown>) {
      this.log('update', resourceType, resourceId, details);
    },

    delete(resourceType: AuditResourceType, resourceId: string, details?: Record<string, unknown>) {
      this.log('delete', resourceType, resourceId, details);
    },
  };
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;
