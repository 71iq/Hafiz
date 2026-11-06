import type { SQLiteBindParams, SQLiteBindValue } from "expo-sqlite";

export type DbOperation = "exec" | "run" | "getFirst" | "getAll";

type HostProbeMessage = { type: "host-probe"; tabId: string };
type HostReadyMessage = { type: "host-ready"; tabId: string };
type HostClosingMessage = { type: "host-closing"; tabId: string };

export type DbWireParam = SQLiteBindValue | SQLiteBindParams;

export type DbRequestMessage = {
  type: "request";
  requestId: string;
  fromTabId: string;
  targetTabId: string;
  operation: DbOperation;
  source: string;
  params: DbWireParam[];
};

type DbResponseMessage = {
  type: "response";
  requestId: string;
  fromTabId: string;
  targetTabId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type DbMessage = HostProbeMessage | HostReadyMessage | HostClosingMessage | DbRequestMessage | DbResponseMessage;

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
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function isNamedBindParams(value: unknown): value is Record<string, SQLiteBindValue> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isSQLiteBindValue);
}

export function isSQLiteBindParams(value: unknown): value is SQLiteBindParams {
  return (isDenseArray(value) && value.every(isSQLiteBindValue)) || isNamedBindParams(value);
}

function isWireParams(value: unknown): value is DbWireParam[] {
  if (!isDenseArray(value)) return false;
  return value.every(isSQLiteBindValue) || (value.length === 1 && isSQLiteBindParams(value[0]));
}

function isDbOperation(value: unknown): value is DbOperation {
  return value === "exec" || value === "run" || value === "getFirst" || value === "getAll";
}

export function decodeDbMessage(value: unknown): DbMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "host-probe":
    case "host-ready":
    case "host-closing":
      return isNonEmptyString(value.tabId) ? { type: value.type, tabId: value.tabId } : null;
    case "request":
      if (
        !isNonEmptyString(value.requestId) ||
        !isNonEmptyString(value.fromTabId) ||
        !isNonEmptyString(value.targetTabId) ||
        !isDbOperation(value.operation) ||
        typeof value.source !== "string" ||
        !isWireParams(value.params)
      ) {
        return null;
      }
      return {
        type: "request",
        requestId: value.requestId,
        fromTabId: value.fromTabId,
        targetTabId: value.targetTabId,
        operation: value.operation,
        source: value.source,
        params: value.params,
      };
    case "response":
      if (value.error !== undefined && typeof value.error !== "string") {
        return null;
      }
      if (
        !isNonEmptyString(value.requestId) ||
        !isNonEmptyString(value.fromTabId) ||
        !isNonEmptyString(value.targetTabId) ||
        typeof value.ok !== "boolean"
      ) {
        return null;
      }
      return {
        type: "response",
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
