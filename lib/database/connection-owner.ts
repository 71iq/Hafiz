import type { SQLiteBindParams, SQLiteRunResult, SQLiteVariadicBindParams } from "expo-sqlite";
import { isSQLiteBindParams, isSQLiteBindValue, type DbWireParam } from "@/lib/database/bridge-messages";
import type { AppDatabase, DatabaseExecutor, DatabasePreparedCommand, TransactionDatabase } from "@/lib/database/types";

interface StatementResult<T> extends SQLiteRunResult {
  getFirstAsync(): Promise<T | null>;
  getAllAsync(): Promise<T[]>;
}

interface RawStatement {
  executeAsync<T>(params: SQLiteBindParams): Promise<StatementResult<T>>;
  executeAsync<T>(...params: SQLiteVariadicBindParams): Promise<StatementResult<T>>;
  finalizeAsync(): Promise<void>;
}

interface RawConnection {
  execAsync(source: string): Promise<void>;
  prepareAsync(source: string): Promise<RawStatement>;
  closeAsync(): Promise<void>;
}

type Failure = { error: unknown };
type Schedule = <T>(work: () => Promise<T>) => Promise<T>;

export type TransactionSettlement = { status: "committed" | "rolled-back" } | { status: "failed"; error: unknown };

export interface ConnectionOwner {
  database: AppDatabase;
  reserveTransaction(
    task: (transaction: TransactionDatabase) => Promise<void>,
    admit?: () => boolean,
    onSettlement?: (outcome: TransactionSettlement) => void,
  ): Promise<void>;
  retire(reason?: Error): void;
  close(): Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function withAdditionalErrors(primary: unknown, additional: unknown[]): unknown {
  if (additional.length === 0) return primary;
  return Object.assign(new Error(asError(primary).message + "; additional database cleanup failed"), {
    primaryError: primary,
    additionalErrors: additional,
  });
}

function execute<T>(statement: RawStatement, params: DbWireParam[]): Promise<StatementResult<T>> {
  if (params.length === 1 && isSQLiteBindParams(params[0])) return statement.executeAsync<T>(params[0]);
  if (params.every(isSQLiteBindValue)) return statement.executeAsync<T>(...params);
  return Promise.reject(new Error("Invalid database binding parameters"));
}

function metadata(result: SQLiteRunResult): SQLiteRunResult {
  return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
}

/** Own one private SQLite handle. No raw statement or handle escapes this facade. */
export function createConnectionOwner(
  raw: RawConnection,
  onFatal?: (error: Error) => void | Promise<void>,
): ConnectionOwner {
  let tail = Promise.resolve();
  let retired: Error | null = null;
  let fatal: Failure | null = null;
  let closing: Promise<void> | null = null;

  function quarantine(error: unknown) {
    if (fatal) return;
    fatal = { error };
    retired ??= new Error("Database connection is no longer active");
    try {
      void Promise.resolve(onFatal?.(asError(error))).catch(() => {});
    } catch {
      // Notification cannot prevent the failing operation from settling.
    }
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (retired || fatal) return Promise.reject(retired ?? new Error("Database connection is no longer active"));
    const result = tail.then(() => {
      if (fatal) throw retired ?? new Error("Database connection is no longer active");
      return work();
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async function usingStatement<T>(source: string, read: (statement: RawStatement) => Promise<T>): Promise<T> {
    const statement = await raw.prepareAsync(source);
    let value!: T;
    let failure: Failure | null = null;
    try {
      value = await read(statement);
    } catch (error) {
      failure = { error };
    }
    try {
      await statement.finalizeAsync();
    } catch (error) {
      quarantine(error);
      throw failure ? withAdditionalErrors(failure.error, [error]) : error;
    }
    if (failure) throw failure.error;
    return value;
  }

  function executor(schedule: Schedule): DatabaseExecutor {
    return {
      execAsync: (source: string) => schedule(() => raw.execAsync(source)),
      runAsync: (source: string, ...params: DbWireParam[]) =>
        schedule(() => usingStatement(source, async (statement) => metadata(await execute(statement, params)))),
      getFirstAsync: <T>(source: string, ...params: DbWireParam[]): Promise<T | null> =>
        schedule(() =>
          usingStatement(source, async (statement) => {
            const result = await execute<T>(statement, params);
            return result.getFirstAsync();
          }),
        ),
      getAllAsync: <T>(source: string, ...params: DbWireParam[]): Promise<T[]> =>
        schedule(() =>
          usingStatement(source, async (statement) => {
            const result = await execute<T>(statement, params);
            return result.getAllAsync();
          }),
        ),
    };
  }

  function transactionScope() {
    let queue = Promise.resolve();
    let sealed = false;
    let failure: Failure | null = null;
    type StatementState = { raw: RawStatement; closed: boolean; finalization: Promise<void> | null };
    const statements = new Set<StatementState>();
    const cleanupFailures: Failure[] = [];

    function rejected<T>(): Promise<T> {
      const result = Promise.reject<T>(failure?.error ?? new Error("Database transaction scope is no longer active"));
      void result.catch(() => {});
      return result;
    }

    function schedule<T>(work: () => Promise<T>, cleanup = false): Promise<T> {
      if (sealed || (failure && !cleanup)) return rejected();
      const result = queue.then(() => {
        if (failure && !cleanup) throw failure.error;
        return work();
      });
      queue = result.then(
        () => {},
        (error: unknown) => {
          failure ??= { error };
        },
      );
      return result;
    }

    async function finalize(state: StatementState, explicit = false) {
      try {
        await state.raw.finalizeAsync();
      } catch (error) {
        const cleanupFailure = { error };
        cleanupFailures.push(cleanupFailure);
        if (explicit) failure ??= cleanupFailure;
        quarantine(error);
        throw error;
      } finally {
        statements.delete(state);
      }
    }

    const database: TransactionDatabase = {
      ...executor(schedule),
      prepareAsync: (source: string) =>
        schedule(async () => {
          const statement = await raw.prepareAsync(source);
          const state: StatementState = { raw: statement, closed: false, finalization: null };
          statements.add(state);
          const command: DatabasePreparedCommand = {
            executeAsync: (...params: DbWireParam[]) => {
              if (sealed || state.closed) return rejected();
              // A later finalize admission must not invalidate already queued executions.
              return schedule(async () => metadata(await execute(statement, params)));
            },
            finalizeAsync: () => {
              if (sealed) return rejected();
              if (state.finalization) return state.finalization;
              state.closed = true;
              state.finalization = schedule(() => finalize(state, true), true);
              return state.finalization;
            },
          };
          return command;
        }),
    };
    return {
      database,
      seal() {
        sealed = true;
      },
      drain: () => queue,
      get failure() {
        return failure;
      },
      async finalizeRemaining() {
        for (const state of statements) {
          state.closed = true;
          try {
            await finalize(state);
          } catch {
            // Finalization already recorded this occurrence, including explicit cleanup.
          }
        }
        return cleanupFailures;
      },
    };
  }

  const reserveTransaction: ConnectionOwner["reserveTransaction"] = (task, admit, onSettlement) =>
    enqueue(async () => {
      const settled = (outcome: TransactionSettlement) => {
        try {
          onSettlement?.(outcome);
        } catch {
          // Settlement observation cannot change the database outcome.
        }
      };
      if (retired || (admit && !admit())) throw retired ?? new Error("Database transaction admission cancelled");
      try {
        await raw.execAsync("BEGIN");
      } catch (error) {
        // BEGIN may have succeeded before its acknowledgement was lost.
        quarantine(error);
        settled({ status: "failed", error });
        throw error;
      }
      const scope = transactionScope();
      let callbackFailure: Failure | null = null;
      try {
        await task(scope.database);
      } catch (error) {
        callbackFailure = { error };
      }
      scope.seal();
      await scope.drain();
      const cleanupFailures = await scope.finalizeRemaining();
      let primary = scope.failure ?? callbackFailure ?? cleanupFailures[0] ?? null;
      const cleanupErrors = cleanupFailures.filter((failure) => failure !== primary).map((failure) => failure.error);
      if (
        callbackFailure &&
        primary !== callbackFailure &&
        callbackFailure.error !== primary?.error &&
        !cleanupFailures.some((failure) => failure.error === callbackFailure.error)
      )
        cleanupErrors.unshift(callbackFailure.error);
      if (!primary) {
        try {
          await raw.execAsync("COMMIT");
        } catch (error) {
          primary = { error };
        }
      }
      if (primary) {
        try {
          await raw.execAsync("ROLLBACK");
        } catch (error) {
          quarantine(error);
          cleanupErrors.push(error);
        }
        const error = withAdditionalErrors(primary.error, cleanupErrors);
        settled(fatal ? { status: "failed", error } : { status: "rolled-back" });
        throw error;
      }
      settled({ status: "committed" });
    });

  const database: AppDatabase = { ...executor(enqueue), withTransactionAsync: (task) => reserveTransaction(task) };
  return {
    database,
    reserveTransaction,
    retire(reason = new Error("Database connection is no longer active")) {
      retired ??= reason;
    },
    close() {
      retired ??= new Error("Database connection is no longer active");
      if (!closing)
        closing = (async () => {
          await tail;
          await raw.closeAsync();
        })();
      return closing;
    },
  };
}
