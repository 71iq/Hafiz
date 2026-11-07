import type { SQLiteBindParams, SQLiteBindValue } from "expo-sqlite";

export const DB_BRIDGE_VERSION = 1;
export type DbOperation = "exec" | "run" | "getFirst" | "getAll";
export type DbWireParam = SQLiteBindValue | SQLiteBindParams;
export type DbTransactionIdentity = { nonce: string; token: string };

type HostMessage = {
  type: "host-probe" | "host-ready" | "host-closing";
  version: typeof DB_BRIDGE_VERSION;
  tabId: string;
};

type RequestIdentity = {
  type: "request";
  version: typeof DB_BRIDGE_VERSION;
  requestId: string;
  fromTabId: string;
  targetTabId: string;
};

export type DbRequestMessage = RequestIdentity & {
  operation: DbOperation;
  source: string;
  params: DbWireParam[];
  transaction?: DbTransactionIdentity;
};

export type DbTransactionRequestMessage = RequestIdentity &
  (
    | { operation: "begin" | "cancel"; nonce: string }
    | { operation: "commit" | "rollback" | "renew"; nonce: string; token: string }
  );

export type DbResponseMessage = {
  type: "response";
  version: typeof DB_BRIDGE_VERSION;
  requestId: string;
  fromTabId: string;
  targetTabId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type DbMessage = HostMessage | DbRequestMessage | DbTransactionRequestMessage | DbResponseMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
export function isSQLiteBindValue(value: unknown): value is SQLiteBindValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  );
}
function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  return true;
}
function isNamedBindParams(value: unknown): value is Record<string, SQLiteBindValue> {
  return isRecord(value) && Object.values(value).every(isSQLiteBindValue);
}
export function isSQLiteBindParams(value: unknown): value is SQLiteBindParams {
  return (isDenseArray(value) && value.every(isSQLiteBindValue)) || isNamedBindParams(value);
}
function isWireParams(value: unknown): value is DbWireParam[] {
  return (
    isDenseArray(value) && (value.every(isSQLiteBindValue) || (value.length === 1 && isSQLiteBindParams(value[0])))
  );
}
function isDbOperation(value: unknown): value is DbOperation {
  return value === "exec" || value === "run" || value === "getFirst" || value === "getAll";
}
function transactionIdentity(value: unknown): DbTransactionIdentity | null {
  return isRecord(value) && isNonEmptyString(value.nonce) && isNonEmptyString(value.token)
    ? { nonce: value.nonce, token: value.token }
    : null;
}

export function decodeDbMessage(value: unknown): DbMessage | null {
  if (!isRecord(value) || value.version !== DB_BRIDGE_VERSION) return null;
  switch (value.type) {
    case "host-probe":
    case "host-ready":
    case "host-closing":
      return isNonEmptyString(value.tabId)
        ? { type: value.type, version: DB_BRIDGE_VERSION, tabId: value.tabId }
        : null;
    case "request": {
      if (
        !isNonEmptyString(value.requestId) ||
        !isNonEmptyString(value.fromTabId) ||
        !isNonEmptyString(value.targetTabId)
      )
        return null;
      const base: RequestIdentity = {
        type: "request" as const,
        version: DB_BRIDGE_VERSION,
        requestId: value.requestId,
        fromTabId: value.fromTabId,
        targetTabId: value.targetTabId,
      };
      if (isDbOperation(value.operation)) {
        if (typeof value.source !== "string" || !isWireParams(value.params)) return null;
        const transaction = value.transaction === undefined ? undefined : transactionIdentity(value.transaction);
        if (transaction === null) return null;
        return {
          ...base,
          operation: value.operation,
          source: value.source,
          params: value.params,
          ...(transaction ? { transaction } : {}),
        };
      }
      if (!isNonEmptyString(value.nonce)) return null;
      switch (value.operation) {
        case "begin":
        case "cancel":
          return { ...base, operation: value.operation, nonce: value.nonce };
        case "commit":
        case "rollback":
        case "renew":
          return isNonEmptyString(value.token)
            ? { ...base, operation: value.operation, nonce: value.nonce, token: value.token }
            : null;
        default:
          return null;
      }
    }
    case "response":
      if (value.error !== undefined && typeof value.error !== "string") return null;
      if (
        !isNonEmptyString(value.requestId) ||
        !isNonEmptyString(value.fromTabId) ||
        !isNonEmptyString(value.targetTabId) ||
        typeof value.ok !== "boolean"
      )
        return null;
      return {
        type: "response",
        version: DB_BRIDGE_VERSION,
        requestId: value.requestId,
        fromTabId: value.fromTabId,
        targetTabId: value.targetTabId,
        ok: value.ok,
        ...(value.result !== undefined ? { result: value.result } : {}),
        ...(typeof value.error === "string" ? { error: value.error } : {}),
      };
    default:
      return null;
  }
}
