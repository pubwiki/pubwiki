// Main entry point for @pubwiki/db package

// Export database client
export { createDb, type Database } from './client';

// Export batch context
export { BatchContext, OptimisticLockError, type ModifyOptions, type OptimisticLockValidator } from './batch-context';

// Export all schema tables and types
export * from './schema';

// Export relations
export * from './relations';

// Export services
export * from './services';

// Export utils
export * from './utils';

// Re-export drizzle-orm utilities for convenience
export { sql, eq, ne, gt, gte, lt, lte, and, or, not, inArray, notInArray, isNull, isNotNull, like, ilike, asc, desc } from 'drizzle-orm';
