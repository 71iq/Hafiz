import type { SQLiteBindParams, SQLiteDatabase, SQLiteRunResult, SQLiteVariadicBindParams } from "expo-sqlite";

export type DatabaseExecutor = Pick<SQLiteDatabase, "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync">;

export interface DatabasePreparedCommand {
  executeAsync(params: SQLiteBindParams): Promise<SQLiteRunResult>;
  executeAsync(...params: SQLiteVariadicBindParams): Promise<SQLiteRunResult>;
  finalizeAsync(): Promise<void>;
}

export interface TransactionDatabase extends DatabaseExecutor {
  prepareAsync(source: string): Promise<DatabasePreparedCommand>;
}

export interface AppDatabase extends DatabaseExecutor {
  withTransactionAsync(task: (transaction: TransactionDatabase) => Promise<void>): Promise<void>;
}
