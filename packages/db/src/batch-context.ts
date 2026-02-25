import type { BatchItem } from 'drizzle-orm/batch';
import type { Table } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Optimistic lock validator configuration
 */
export interface OptimisticLockValidator {
  resultIndex: number;
  expectedRowsAffected: number;
  msg: string;
}

export interface ModifyOptions {
  /** Expected number of affected rows for optimistic lock validation */
  expectAffected?: number;
  /** Error message when optimistic lock fails */
  lockMsg?: string;
}

/**
 * Creates a proxy that wraps the entire chain and updates the operation at each step.
 * This ensures we capture the final operation regardless of where the chain ends.
 */
function createChainProxy<T>(
  initial: T,
  onUpdate: (operation: BatchItem<'sqlite'>) => void
): T {
  const wrapChain = (obj: unknown): unknown => {
    // Update operation at each step (assuming current step might be the endpoint)
    onUpdate(obj as BatchItem<'sqlite'>);
    
    return new Proxy(obj as object, {
      get: (target, prop) => {
        const value = (target as Record<string | symbol, unknown>)[prop];
        if (typeof value === 'function') {
          return (...args: unknown[]) => wrapChain(value.apply(target, args));
        }
        return value;
      }
    });
  };
  
  return wrapChain(initial) as T;
}

/**
 * Optimistic lock conflict error
 */
export class OptimisticLockError extends Error {
  constructor(
    public readonly msg: string,
    public readonly expectedRows: number,
    public readonly actualRows: number
  ) {
    super(
      `Optimistic lock conflict: ${msg} (expected ${expectedRows} row(s), got ${actualRows})`
    );
    this.name = 'OptimisticLockError';
  }
}

/**
 * Database operation context for batched writes
 *
 * Design principles:
 * 1. Encapsulates db instance, preventing direct write method access
 * 2. select() passes through directly, modify() collects write operations
 * 3. commit() executes batch and validates optimistic locks
 *
 * @example
 * ```typescript
 * const ctx = new BatchContext(db);
 * const service = new ArtifactService(ctx);
 *
 * const result = await service.createArtifact(input);
 * if (!result.success) return serviceErrorResponse(c, result.error);
 *
 * await ctx.commit();
 * ```
 */
export class BatchContext {
  private operations: BatchItem<'sqlite'>[] = [];
  private optimisticLocks: OptimisticLockValidator[] = [];

  constructor(private readonly db: Database) {}

  /**
   * Execute query operations (direct passthrough to db.select)
   *
   * @example
   * const users = await ctx.select().from(users).where(...);
   */
  get select() {
    return this.db.select.bind(this.db);
  }

  /**
   * Execute selectDistinct operations (direct passthrough)
   */
  get selectDistinct() {
    return this.db.selectDistinct.bind(this.db);
  }

  /**
   * Execute CTE (WITH) queries (direct passthrough)
   */
  get with() {
    return this.db.with.bind(this.db);
  }

  /**
   * Execute raw SQL query and return all results (direct passthrough)
   * Useful for FTS5 queries and other operations not supported by the query builder.
   *
   * @example
   * const results = await ctx.all<{ id: string, name: string }>(
   *   sql`SELECT id, name FROM artifacts_fts WHERE artifacts_fts MATCH ${query}`
   * );
   */
  get all() {
    return this.db.all.bind(this.db);
  }

  /**
   * Execute raw SQL query and return a single result (direct passthrough)
   *
   * @example
   * const result = await ctx.get<{ total: number }>(
   *   sql`SELECT COUNT(*) as total FROM artifacts_fts WHERE artifacts_fts MATCH ${query}`
   * );
   */
  get get() {
    return this.db.get.bind(this.db);
  }

  /**
   * Collect write operations using chain API (not executed immediately)
   *
   * @example
   * // Simple insert
   * ctx.modify().insert(users).values({...});
   *
   * // Insert with conflict detection (throws OptimisticLockError if already exists)
   * ctx.modify({ expectAffected: 1, lockMsg: 'Artifact already exists' })
   *   .insert(artifacts).values({...}).onConflictDoNothing();
   *
   * // Update with optimistic lock
   * ctx.modify({ expectAffected: 1, lockMsg: `artifact ${id} was modified` })
   *   .update(artifacts)
   *   .set({ currentVersionId: newId })
   *   .where(and(eq(artifacts.id, id), eq(artifacts.currentVersionId, oldId)));
   *
   * // Delete
   * ctx.modify().delete(users).where(eq(users.id, id));
   */
  modify(options?: ModifyOptions) {
    const index = this.operations.length;
    // Placeholder - will be updated by chain proxy
    this.operations.push(undefined as unknown as BatchItem<'sqlite'>);

    if (options?.expectAffected !== undefined) {
      this.optimisticLocks.push({
        resultIndex: index,
        expectedRowsAffected: options.expectAffected,
        msg: options.lockMsg ?? 'Concurrent modification detected',
      });
    }

    const updateOperation = (op: BatchItem<'sqlite'>) => {
      this.operations[index] = op;
    };

    return {
      insert: <T extends Table>(table: T) =>
        createChainProxy(this.db.insert(table), updateOperation),
      update: <T extends Table>(table: T) =>
        createChainProxy(this.db.update(table), updateOperation),
      delete: <T extends Table>(table: T) =>
        createChainProxy(this.db.delete(table), updateOperation),
    };
  }

  /**
   * Get the number of collected operations
   */
  get size(): number {
    return this.operations.length;
  }

  /**
   * Execute all collected write operations and validate optimistic locks
   * @throws OptimisticLockError if optimistic lock validation fails
   */
  async commit(): Promise<void> {
    if (this.operations.length === 0) return;

    const batchResults = await this.db.batch(
      this.operations as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]
    );

    // Validate optimistic locks
    for (const validator of this.optimisticLocks) {
      const result = batchResults[validator.resultIndex];
      if (result.meta?.changes !== validator.expectedRowsAffected) {
        throw new OptimisticLockError(
          validator.msg,
          validator.expectedRowsAffected,
          result.meta?.changes ?? 0
        );
      }
    }
  }

  /**
   * Clear context (usually not needed to call manually)
   */
  clear(): void {
    this.operations = [];
    this.optimisticLocks = [];
  }
}
