export type AuthOwner = {
  isCurrent: () => boolean;
  cancel: () => void;
  // Only already-issued SDK work may settle after its screen cancels.
  canSettleSameLifetime?: () => boolean;
  canCompleteRecovery?: (identity: string | null) => boolean;
  // Called only after the owned adapter verifies its own session-removal receipt.
  adoptOwnSignOut?: () => boolean;
};
export type AuthCommandResult<T> = { status: "completed"; value: T; owner: AuthOwner } | { status: "superseded" };

type Ticket = { epoch: number; intent: number; cancelled: boolean; key: string | null };
type Pending = { kind: "replacement"; intent: number } | { kind: "owned"; owner: AuthOwner };

// Identity resolution and SDK notification attribution remain in their adapters.
export function createAuthCoordinator(initialIdentity: string | null) {
  let identity = initialIdentity;
  let epoch = 0;
  let intent = 0;
  let nextId = 0;
  let tail: Promise<void> = Promise.resolve();
  const tickets = new WeakMap<AuthOwner, Ticket>();
  const pending = new Map<number, Pending>();
  let active: { owner: AuthOwner; allowSignOut: boolean } | null = null;

  function current(owner: AuthOwner): boolean {
    const ticket = tickets.get(owner);
    return !!ticket && !ticket.cancelled && ticket.epoch === epoch && ticket.intent === intent;
  }
  function sameLifetime(owner: AuthOwner): boolean {
    const ticket = tickets.get(owner);
    return !!ticket && ticket.epoch === epoch && ticket.intent === intent;
  }
  function captureOwner(): AuthOwner {
    const ticket: Ticket = { epoch, intent, cancelled: false, key: identity };
    const owner: AuthOwner = {
      isCurrent: () => current(owner),
      canSettleSameLifetime: () => sameLifetime(owner),
      canCompleteRecovery: (next) => canCompleteRecovery(owner, next),
      adoptOwnSignOut: () => {
        if (!sameLifetime(owner) || identity === null) return false;
        identity = null;
        epoch += 1;
        ticket.epoch = epoch;
        ticket.key = null;
        // A successful terminal logout keeps its result authority. Cleanup from another
        // issued SDK operation may publish null, but cannot revive that command's result.
        if (active?.owner === owner && active.allowSignOut) active.allowSignOut = false;
        else ticket.cancelled = true;
        return true;
      },
      cancel: () => {
        ticket.cancelled = true;
      },
    };
    tickets.set(owner, ticket);
    return owner;
  }
  function observeIdentity(next: string | null): void {
    if (next === identity) return;
    identity = next;
    epoch += 1;
  }
  // A read begun without a session may observe its own one-step SDK restore.
  // A changed signed-in owner or any intervening A-B-A sequence stays obsolete.
  function canRestore(owner: AuthOwner, next: string | null): boolean {
    if (current(owner)) return identity === null || identity === next;
    const ticket = tickets.get(owner);
    return (
      !!ticket &&
      !ticket.cancelled &&
      ticket.intent === intent &&
      ticket.key === null &&
      next !== null &&
      identity === next &&
      epoch === ticket.epoch + 1
    );
  }
  function canCompleteRecovery(owner: AuthOwner, next: string | null): boolean {
    if (current(owner)) return true;
    const ticket = tickets.get(owner);
    return (
      !!ticket &&
      !ticket.cancelled &&
      ticket.intent === intent &&
      next !== null &&
      identity === next &&
      epoch === ticket.epoch + 1
    );
  }
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function replace<T>(work: (isCurrent: () => boolean) => Promise<T>): Promise<AuthCommandResult<T>> {
    const ownIntent = ++intent;
    const id = ++nextId;
    pending.set(id, { kind: "replacement", intent: ownIntent });
    return enqueue(async () => {
      const isCurrent = () => ownIntent === intent;
      try {
        if (!isCurrent()) return { status: "superseded" };
        const value = await work(isCurrent);
        if (!isCurrent()) return { status: "superseded" };
        return { status: "completed", value, owner: captureOwner() };
      } catch (error) {
        if (!isCurrent()) return { status: "superseded" };
        throw error;
      } finally {
        pending.delete(id);
      }
    });
  }
  // Startup reads share ordering without impersonating a newer explicit auth intent.
  function bootstrap<T>(work: () => Promise<T>): Promise<T> {
    return enqueue(work);
  }
  function captureIntent(): () => boolean {
    const captured = intent;
    return () => intent === captured;
  }
  // Legacy session-changing callers still receive their original values/errors.
  // Only account-bound owned commands have a superseded result contract.
  function transition<T>(work: () => Promise<T>): Promise<T> {
    const ownIntent = ++intent;
    const id = ++nextId;
    pending.set(id, { kind: "replacement", intent: ownIntent });
    return enqueue(async () => {
      try {
        return await work();
      } finally {
        pending.delete(id);
      }
    });
  }
  function owned<T>(owner: AuthOwner, work: () => Promise<T>, allowSignOut = false): Promise<AuthCommandResult<T>> {
    const replacementPending = [...pending.values()].some((row) => row.kind === "replacement" && row.intent === intent);
    if (!current(owner) || identity === null || replacementPending) {
      return Promise.resolve({ status: "superseded" });
    }
    const id = ++nextId;
    pending.set(id, { kind: "owned", owner });
    return enqueue(async () => {
      try {
        if (!current(owner)) return { status: "superseded" };
        active = { owner, allowSignOut };
        const value = await work();
        if (!current(owner)) return { status: "superseded" };
        return { status: "completed", value, owner };
      } catch (error) {
        if (!current(owner)) return { status: "superseded" };
        throw error;
      } finally {
        active = null;
        pending.delete(id);
      }
    });
  }
  function isLoading(): boolean {
    return [...pending.values()].some((row) =>
      row.kind === "replacement" ? row.intent === intent : current(row.owner),
    );
  }
  return {
    bootstrap,
    captureIntent,
    captureOwner,
    observeIdentity,
    canRestore,
    canCompleteRecovery,
    replace,
    transition,
    owned,
    isLoading,
  };
}
