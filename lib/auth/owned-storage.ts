import { AuthError, type Session } from "@supabase/supabase-js";
import type { AuthOwner } from "@/lib/auth/coordinator";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
type Storage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};
function identity(value: string | null): string | null {
  if (value === null) return null;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !data ||
      typeof data !== "object" ||
      !("access_token" in data) ||
      typeof data.access_token !== "string" ||
      !("user" in data) ||
      !data.user ||
      typeof data.user !== "object" ||
      !("id" in data.user) ||
      typeof data.user.id !== "string"
    )
      return null;
    const parsed = getAuthSessionIdentity({ access_token: data.access_token, user: { id: data.user.id } });
    return parsed.kind === "identified" ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}
export function createSharedStorage(
  backing: Storage,
  lock: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
) {
  let tail: Promise<unknown> = Promise.resolve();
  function atomic<T>(work: (raw: Storage) => Promise<T>): Promise<T> {
    const next = tail.then(
      () => lock(() => work(backing)),
      () => lock(() => work(backing)),
    );
    tail = next.catch(() => undefined);
    return next;
  }
  const storage: Storage = {
    getItem: (name) => atomic(async (raw) => raw.getItem(name)),
    setItem: (name, value) => atomic(async (raw) => raw.setItem(name, value)),
    removeItem: (name) => atomic(async (raw) => raw.removeItem(name)),
  };
  return { atomic, storage };
}
export function createOwnedStorage(shared: Pick<ReturnType<typeof createSharedStorage>, "atomic">, key: string) {
  type Guard = { owner: AuthOwner; identity: string | null; removed: boolean; recovery: boolean; committed: boolean };
  let active: Guard | null = null;
  const matches = (value: string | null, expected: string | null) =>
    expected === null ? value === null : identity(value) === expected;
  const supersede = (guard: Guard): never => {
    guard.owner.cancel();
    throw new AuthError("Auth operation superseded", 409, "operation_superseded");
  };
  const storage: Storage = {
    getItem: (name) =>
      shared.atomic(async (raw) => {
        const value = await raw.getItem(name);
        const guard = active;
        if (
          guard &&
          name === key &&
          !(guard.removed && value === null) &&
          ((!(guard.recovery && guard.committed) && !guard.owner.isCurrent()) || !matches(value, guard.identity))
        )
          supersede(guard);
        return value;
      }),
    setItem: (name, value) =>
      shared.atomic(async (raw) => {
        const guard = active;
        let next: string | null = null;
        if (guard && name === key) {
          const current = await raw.getItem(key);
          next = identity(value);
          if (
            !matches(current, guard.identity) ||
            next === null ||
            (guard.recovery && !guard.committed ? !guard.owner.isCurrent() : next !== guard.identity)
          )
            supersede(guard);
        }
        await raw.setItem(name, value);
        if (guard && name === key && guard.recovery) {
          guard.identity = next;
          guard.committed = true;
        }
      }),
    removeItem: (name) =>
      shared.atomic(async (raw) => {
        const guard = active;
        if (guard?.recovery && !guard.committed) {
          // Recovery must not delete the existing session or its auxiliary state when its own token fails.
          if (name === key || name === key + "-code-verifier" || name === key + "-user") return;
        }
        if (guard && (name === key || name === key + "-code-verifier" || name === key + "-user")) {
          const current = await raw.getItem(key);
          if (guard.removed ? current !== null : !matches(current, guard.identity)) supersede(guard);
        }
        await raw.removeItem(name);
        if (guard && name === key) guard.removed = true;
      }),
  };
  async function run<T>(
    owner: AuthOwner,
    session: Session | null,
    work: () => Promise<T>,
    recovery: boolean,
  ): Promise<T> {
    const parsed = getAuthSessionIdentity(session);
    if (active) throw new Error("Overlapping owned SDK operation");
    if (!owner.isCurrent() || parsed.kind === "unidentified" || (!recovery && parsed.kind !== "identified"))
      throw new AuthError("Auth operation superseded", 409, "operation_superseded");
    active = {
      owner,
      identity: parsed.kind === "identified" ? JSON.stringify(parsed) : null,
      removed: false,
      recovery,
      committed: false,
    };
    try {
      return await work();
    } finally {
      active = null;
    }
  }
  return {
    storage,
    canDispatch: () => active !== null && active.owner.isCurrent(),
    run: <T>(owner: AuthOwner, session: Session | null, work: () => Promise<T>) => run(owner, session, work, false),
    restore: <T>(owner: AuthOwner, session: Session | null, work: () => Promise<T>) => run(owner, session, work, true),
  };
}
