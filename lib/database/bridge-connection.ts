import type { SQLiteRunResult } from "expo-sqlite";
import {
  DB_BRIDGE_VERSION,
  isSQLiteBindParams,
  isSQLiteBindValue,
  type DbMessage,
  type DbOperation,
  type DbRequestMessage,
  type DbResponseMessage,
  type DbTransactionIdentity,
  type DbTransactionRequestMessage,
  type DbWireParam,
} from "@/lib/database/bridge-messages";
import type { ConnectionOwner, TransactionSettlement } from "@/lib/database/connection-owner";
import type { AppDatabase, DatabaseExecutor, DatabasePreparedCommand, TransactionDatabase } from "@/lib/database/types";

const REQUEST_TIMEOUT_MS = 60000;
const LEASE_MS = 60000;
const HEARTBEAT_MS = 15000;
const MAX_SETTLED_RESERVATIONS = 64;
type Request = DbRequestMessage | DbTransactionRequestMessage;
type Transport = { postMessage: (message: DbMessage) => boolean; uniqueId: () => string };
type Failure = { error: unknown };
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function isSqlRequest(message: Request): message is DbRequestMessage {
  return (
    message.operation === "exec" ||
    message.operation === "run" ||
    message.operation === "getFirst" ||
    message.operation === "getAll"
  );
}
function executeSql(db: DatabaseExecutor, message: DbRequestMessage): Promise<unknown> {
  if (message.operation === "exec") return db.execAsync(message.source);
  const params = message.params;
  if (params.length === 1 && isSQLiteBindParams(params[0])) {
    switch (message.operation) {
      case "run":
        return db.runAsync(message.source, params[0]);
      case "getFirst":
        return db.getFirstAsync(message.source, params[0]);
      case "getAll":
        return db.getAllAsync(message.source, params[0]);
    }
  }
  if (params.every(isSQLiteBindValue)) {
    switch (message.operation) {
      case "run":
        return db.runAsync(message.source, ...params);
      case "getFirst":
        return db.getFirstAsync(message.source, ...params);
      case "getAll":
        return db.getAllAsync(message.source, ...params);
    }
  }
  return Promise.reject(new Error("Invalid database binding parameters"));
}
function cloneResult(value: unknown): unknown {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

export function createDatabaseBridgeHost(
  owner: ConnectionOwner,
  options: Transport & { hostId: string; isActive: () => boolean },
) {
  type Reservation = {
    key: string;
    client: string;
    nonce: string;
    token: string;
    phase: "pending" | "active" | "committing" | "aborted" | "settled";
    deadline: number;
    timer: ReturnType<typeof setTimeout> | null;
    scope: TransactionDatabase | null;
    signal: ReturnType<typeof deferred>;
    run: Promise<void>;
    beginAcked: boolean;
    reason: Error | null;
    settlement: TransactionSettlement | null;
    receiptDeadline: number;
  };
  let active = true;
  const reservations = new Map<string, Reservation>();
  const receipts = new Map<string, Reservation>();
  const live = () => active && options.isActive();
  const keyFor = (client: string, nonce: string) => JSON.stringify([client, nonce]);
  function respond(message: Request, ok: boolean, value: unknown): boolean {
    if (!live()) return false;
    const result = ok ? cloneResult(value) : undefined;
    try {
      return options.postMessage({
        type: "response",
        version: DB_BRIDGE_VERSION,
        requestId: message.requestId,
        fromTabId: options.hostId,
        targetTabId: message.fromTabId,
        ok,
        ...(ok ? { result } : { error: asError(value).message }),
      });
    } catch {
      return false;
    }
  }
  function clearLease(reservation: Reservation) {
    if (reservation.timer !== null) clearTimeout(reservation.timer);
    reservation.timer = null;
  }
  function forget(reservation: Reservation) {
    clearLease(reservation);
    if (reservations.get(reservation.key) === reservation) reservations.delete(reservation.key);
    if (receipts.get(reservation.key) === reservation) receipts.delete(reservation.key);
  }
  function retainReceipt(reservation: Reservation) {
    reservation.receiptDeadline = Date.now() + LEASE_MS;
    receipts.set(reservation.key, reservation);
    reservation.timer = setTimeout(() => forget(reservation), LEASE_MS);
    while (receipts.size > MAX_SETTLED_RESERVATIONS) {
      const oldest = receipts.values().next().value;
      if (oldest) forget(oldest);
    }
  }
  function abort(reservation: Reservation, error: Error) {
    if (reservation.phase !== "pending" && reservation.phase !== "active") return;
    reservation.phase = "aborted";
    reservation.reason = error;
    clearLease(reservation);
    reservation.signal.reject(error);
  }
  function scheduleLease(reservation: Reservation) {
    clearLease(reservation);
    const deadline = reservation.deadline;
    const timer = setTimeout(
      () => {
        if (reservation.timer !== timer || reservation.deadline !== deadline) return;
        reservation.timer = null;
        if (Date.now() < deadline) {
          scheduleLease(reservation);
          return;
        }
        abort(reservation, new Error("Database transaction lease expired"));
      },
      Math.max(0, deadline - Date.now()),
    );
    reservation.timer = timer;
  }
  function current(message: Request, identity: DbTransactionIdentity): Reservation {
    const reservation = reservations.get(keyFor(message.fromTabId, identity.nonce));
    if (!reservation || reservation.token !== identity.token || reservation.phase !== "active" || !live())
      throw new Error("Database transaction is no longer active");
    if (Date.now() >= reservation.deadline) {
      const error = new Error("Database transaction lease expired");
      abort(reservation, error);
      throw error;
    }
    return reservation;
  }
  function renew(reservation: Reservation) {
    reservation.deadline = Date.now() + LEASE_MS;
    scheduleLease(reservation);
  }
  async function begin(message: DbTransactionRequestMessage & { operation: "begin" | "cancel" }) {
    const key = keyFor(message.fromTabId, message.nonce);
    if (reservations.has(key)) {
      respond(message, false, new Error("Duplicate database transaction nonce"));
      return;
    }
    const reservation: Reservation = {
      key,
      client: message.fromTabId,
      nonce: message.nonce,
      token: options.uniqueId(),
      phase: "pending",
      deadline: Date.now() + LEASE_MS,
      timer: null,
      scope: null,
      signal: deferred(),
      run: Promise.resolve(),
      beginAcked: false,
      reason: null,
      settlement: null,
      receiptDeadline: 0,
    };
    reservations.set(key, reservation);
    scheduleLease(reservation);
    const canBegin = () => {
      if (!live() || reservation.phase !== "pending") return false;
      if (Date.now() >= reservation.deadline) {
        abort(reservation, new Error("Database transaction lease expired"));
        return false;
      }
      return true;
    };
    reservation.run = owner.reserveTransaction(
      async (scope) => {
        if (!canBegin()) throw reservation.reason ?? new Error("Database transaction admission cancelled");
        reservation.phase = "active";
        reservation.scope = scope;
        renew(reservation);
        reservation.beginAcked = true;
        if (!respond(message, true, { token: reservation.token }))
          abort(reservation, new Error("Database channel is unavailable"));
        await reservation.signal.promise;
      },
      canBegin,
      (outcome) => {
        reservation.settlement = outcome;
      },
    );
    try {
      await reservation.run;
    } catch (error) {
      if (!reservation.beginAcked) respond(message, false, reservation.reason ?? error);
    } finally {
      clearLease(reservation);
      const keepReceipt = reservation.phase === "aborted" && reservation.beginAcked && live();
      reservation.phase = "settled";
      if (keepReceipt) retainReceipt(reservation);
      else forget(reservation);
    }
  }
  async function rollback(message: Request, identity: DbTransactionIdentity) {
    const reservation = reservations.get(keyFor(message.fromTabId, identity.nonce));
    if (!reservation || reservation.token !== identity.token || !reservation.beginAcked || !live()) {
      throw new Error("Database transaction settlement is no longer known");
    }
    if (reservation.phase === "settled" && Date.now() >= reservation.receiptDeadline) {
      forget(reservation);
      throw new Error("Database transaction settlement is no longer known");
    }
    if (reservation.phase === "active") {
      abort(
        reservation,
        new Error(
          Date.now() >= reservation.deadline
            ? "Database transaction lease expired"
            : "Database transaction rolled back",
        ),
      );
    }
    try {
      await reservation.run.catch(() => {});
      const outcome = reservation.settlement;
      if (outcome?.status === "failed") throw outcome.error;
      if (outcome?.status !== "rolled-back") throw new Error("Database transaction did not roll back");
      respond(message, true, null);
    } finally {
      if (reservation.phase === "settled") forget(reservation);
    }
  }
  async function handleRequest(message: Request) {
    if (!live() || message.version !== DB_BRIDGE_VERSION || message.targetTabId !== options.hostId) return;
    if (isSqlRequest(message)) {
      let reservation: Reservation | null = null;
      try {
        let executor: DatabaseExecutor = owner.database;
        if (message.transaction) {
          reservation = current(message, message.transaction);
          renew(reservation);
          executor = reservation.scope!;
        }
        const result = await executeSql(executor, message);
        if (!respond(message, true, result) && reservation)
          abort(reservation, new Error("Database channel is unavailable"));
      } catch (error) {
        if (reservation) abort(reservation, asError(error));
        respond(message, false, error);
      }
      return;
    }
    if (message.operation === "begin") {
      await begin(message);
      return;
    }
    if (message.operation === "cancel") {
      const reservation = reservations.get(keyFor(message.fromTabId, message.nonce));
      if (reservation) abort(reservation, new Error("Database transaction cancelled"));
      respond(message, true, null);
      return;
    }
    try {
      if (!("token" in message) || typeof message.token !== "string") {
        throw new Error("Invalid database transaction token");
      }
      const identity = { nonce: message.nonce, token: message.token };
      if (message.operation === "rollback") {
        await rollback(message, identity);
        return;
      }
      const reservation = current(message, identity);
      if (message.operation === "renew") {
        renew(reservation);
        respond(message, true, null);
        return;
      }
      if (message.operation === "commit") {
        reservation.phase = "committing";
        clearLease(reservation);
        reservation.signal.resolve();
        await reservation.run;
        respond(message, true, null);
        return;
      }
      throw new Error("Invalid database transaction operation");
    } catch (error) {
      respond(message, false, error);
    }
  }
  return {
    handleRequest,
    retire(reason: Error) {
      if (!active) return;
      active = false;
      for (const reservation of [...reservations.values()]) {
        abort(reservation, reason);
        if (reservation.phase === "settled") forget(reservation);
      }
    },
  };
}

export function createDatabaseBridgeClient(
  options: Transport & { tabId: string; hostId: string; isActive: () => boolean; onDisconnect: (error: Error) => void },
) {
  type Pending = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  type Transaction = {
    nonce: string;
    token: string | null;
    sealed: boolean;
    stage: "beginning" | "active" | "settling";
    failure: Failure | null;
    signal: ReturnType<typeof deferred>;
  };
  let active = true;
  let retiredError = new Error("Database proxy is no longer active");
  let queue = Promise.resolve();
  let transaction: Transaction | null = null;
  const pending = new Map<string, Pending>();
  const live = () => active && options.isActive();
  function base(
    requestId: string,
  ): Pick<DbRequestMessage, "type" | "version" | "requestId" | "fromTabId" | "targetTabId"> {
    return {
      type: "request",
      version: DB_BRIDGE_VERSION,
      requestId,
      fromTabId: options.tabId,
      targetTabId: options.hostId,
    };
  }
  function cancelNonce(nonce: string) {
    try {
      options.postMessage({ ...base(options.uniqueId()), operation: "cancel", nonce });
    } catch {}
  }
  function abortTransaction(owner: Transaction, error: unknown) {
    owner.failure ??= { error };
    owner.sealed = true;
    owner.signal.reject(error);
  }
  function retire(reason = new Error("Database proxy is no longer active")) {
    if (!active) return;
    active = false;
    retiredError = reason;
    if (transaction) {
      cancelNonce(transaction.nonce);
      abortTransaction(transaction, reason);
    }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    pending.clear();
  }
  function disconnect(reason: Error) {
    if (!active) return;
    retire(reason);
    options.onDisconnect(reason);
  }
  function request(make: (id: string) => Request): Promise<unknown> {
    if (!live()) return Promise.reject(retiredError);
    return new Promise((resolve, reject) => {
      const requestId = options.uniqueId();
      const timer = setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        const error = new Error("Database request timed out");
        reject(error);
        disconnect(error);
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
      try {
        if (options.postMessage(make(requestId))) return;
      } catch {}
      clearTimeout(timer);
      pending.delete(requestId);
      const error = new Error("Database channel is unavailable");
      reject(error);
      disconnect(error);
    });
  }
  function control(operation: "begin" | "cancel" | "commit" | "rollback" | "renew", owner: Transaction) {
    return request((id) =>
      operation === "begin" || operation === "cancel"
        ? { ...base(id), operation, nonce: owner.nonce }
        : { ...base(id), operation, nonce: owner.nonce, token: owner.token! },
    );
  }
  function sql(operation: DbOperation, source: string, params: DbWireParam[], owner?: Transaction) {
    return request((id) => ({
      ...base(id),
      operation,
      source,
      params,
      ...(owner ? { transaction: { nonce: owner.nonce, token: owner.token! } } : {}),
    }));
  }
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (!live()) return Promise.reject(retiredError);
    const result = queue.then(() => {
      if (!live()) throw retiredError;
      return work();
    });
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  function executor(schedule: <T>(work: () => Promise<T>) => Promise<T>, owner?: Transaction): DatabaseExecutor {
    return {
      execAsync: (source: string) =>
        schedule(async () => {
          await sql("exec", source, [], owner);
        }),
      runAsync: (source: string, ...params: DbWireParam[]) =>
        schedule(async () => (await sql("run", source, params, owner)) as SQLiteRunResult),
      getFirstAsync: <T>(source: string, ...params: DbWireParam[]) =>
        schedule(async () => (await sql("getFirst", source, params, owner)) as T | null),
      getAllAsync: <T>(source: string, ...params: DbWireParam[]) =>
        schedule(async () => (await sql("getAll", source, params, owner)) as T[]),
    };
  }
  const database: AppDatabase = {
    ...executor(enqueue),
    withTransactionAsync: (task) =>
      enqueue(async () => {
        const owner: Transaction = {
          nonce: options.uniqueId(),
          token: null,
          sealed: false,
          stage: "beginning",
          failure: null,
          signal: deferred(),
        };
        transaction = owner;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let scopedQueue = Promise.resolve();
        function rejectScope<T>(): Promise<T> {
          const result = Promise.reject<T>(
            owner.failure?.error ?? new Error("Database transaction scope is no longer active"),
          );
          void result.catch(() => {});
          return result;
        }
        function schedule<T>(work: () => Promise<T>): Promise<T> {
          if (owner.sealed || owner.failure || !live()) return rejectScope();
          const result = scopedQueue.then(() => {
            if (owner.failure || !live()) throw owner.failure?.error ?? retiredError;
            return work();
          });
          scopedQueue = result.then(
            () => {},
            (error: unknown) => {
              abortTransaction(owner, error);
            },
          );
          return result;
        }
        const scoped: TransactionDatabase = {
          ...executor(schedule, owner),
          prepareAsync: (source: string) => {
            if (owner.sealed || owner.failure || !live()) return rejectScope();
            let closed = false;
            const command: DatabasePreparedCommand = {
              executeAsync: (...params: DbWireParam[]) => {
                if (closed || owner.sealed || owner.failure || !live()) return rejectScope();
                return schedule(async () => (await sql("run", source, params, owner)) as SQLiteRunResult);
              },
              finalizeAsync: () => {
                if (owner.sealed || !live()) return rejectScope();
                closed = true;
                return Promise.resolve();
              },
            };
            return Promise.resolve(command);
          },
        };
        try {
          const receipt = await control("begin", owner);
          if (
            !receipt ||
            typeof receipt !== "object" ||
            !("token" in receipt) ||
            typeof receipt.token !== "string" ||
            receipt.token.length === 0
          )
            throw new Error("Invalid database transaction acknowledgement");
          if (!live() || owner.failure) throw owner.failure?.error ?? retiredError;
          owner.token = receipt.token;
          owner.stage = "active";
          heartbeat = setInterval(() => {
            if (!live() || owner.stage !== "active" || owner.failure) return;
            void control("renew", owner).catch((error: unknown) => {
              abortTransaction(owner, error);
              cancelNonce(owner.nonce);
            });
          }, HEARTBEAT_MS);
          let callbackFailure: Failure | null = null;
          try {
            const callback = Promise.resolve().then(() => {
              if (!live() || owner.failure) throw owner.failure?.error ?? retiredError;
              return task(scoped);
            });
            await Promise.race([callback, owner.signal.promise]);
          } catch (error) {
            callbackFailure = { error };
          }
          owner.sealed = true;
          await scopedQueue;
          const failure = owner.failure ?? callbackFailure;
          owner.stage = "settling";
          clearInterval(heartbeat);
          heartbeat = null;
          if (failure) {
            const additional: unknown[] = [];
            if (callbackFailure && callbackFailure.error !== failure.error) additional.push(callbackFailure.error);
            if (live()) {
              try {
                await control("rollback", owner);
              } catch (cleanup) {
                additional.push(cleanup);
              }
            }
            if (additional.length > 0)
              throw Object.assign(new Error(asError(failure.error).message + "; additional database cleanup failed"), {
                primaryError: failure.error,
                additionalErrors: additional,
              });
            throw failure.error;
          }
          if (!live()) throw retiredError;
          await control("commit", owner);
        } catch (error) {
          if (owner.token === null) cancelNonce(owner.nonce);
          throw error;
        } finally {
          owner.sealed = true;
          if (heartbeat !== null) clearInterval(heartbeat);
          if (transaction === owner) transaction = null;
        }
      }),
  };
  return {
    database,
    retire,
    handleResponse(message: DbResponseMessage) {
      if (
        !live() ||
        message.version !== DB_BRIDGE_VERSION ||
        message.targetTabId !== options.tabId ||
        message.fromTabId !== options.hostId
      )
        return;
      const entry = pending.get(message.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error ?? "Database request failed"));
    },
  };
}
