import type { BatchItem } from 'drizzle-orm/batch';
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
   * Collect write operations (not executed immediately)
   *
   * @example
   * // Simple insert
   * ctx.modify(db => db.insert(users).values({...}));
   *
   * // Update with optimistic lock
   * ctx.modify(
   *   db => db.update(artifacts)
   *     .set({ currentVersionId: newId })
   *     .where(and(eq(artifacts.id, id), eq(artifacts.currentVersionId, oldId))),
   *   { expectAffected: 1, lockMsg: `artifact ${id} was modified` }
   * );
   */
  modify(
    operation: (db: Database) => BatchItem<'sqlite'>,
    options?: ModifyOptions
  ): void {
    const index = this.operations.length;
    this.operations.push(operation(this.db));

    if (options?.expectAffected !== undefined) {
      this.optimisticLocks.push({
        resultIndex: index,
        expectedRowsAffected: options.expectAffected,
        msg: options.lockMsg ?? 'Concurrent modification detected',
      });
    }
  }

  /**
   * Collect multiple write operations (optimistic lock not supported)
   */
  modifyMany(
    operations: ((db: Database) => BatchItem<'sqlite'>)[]
  ): void {
    for (const op of operations) {
      this.operations.push(op(this.db));
    }
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
      if (result.rowsAffected !== validator.expectedRowsAffected) {
        throw new OptimisticLockError(
          validator.msg,
          validator.expectedRowsAffected,
          result.rowsAffected
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
