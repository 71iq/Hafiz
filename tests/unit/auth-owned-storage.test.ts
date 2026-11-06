import { createAuthCoordinator } from "@/lib/auth/coordinator";
import { createOwnedStorage, createSharedStorage } from "@/lib/auth/owned-storage";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { Session } from "@supabase/supabase-js";

function fixture() {
  const userId = "00000000-0000-4000-8000-000000000001";
  const sessionId = "10000000-0000-4000-8000-000000000001";
  const token = [{ alg: "HS256" }, { sub: userId, session_id: sessionId }, "synthetic"]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  const session = { access_token: token, refresh_token: "synthetic", user: { id: userId } } as Session;
  const key = "synthetic-auth";
  const serialized = JSON.stringify(session);
  const identity = JSON.stringify(getAuthSessionIdentity(session));
  const values = new Map([
    [key, serialized],
    [key + "-user", "user"],
    [key + "-code-verifier", "verifier"],
  ]);
  const raw = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: jest.fn((name: string, value: string) => {
      values.set(name, value);
    }),
    removeItem: jest.fn((name: string) => {
      values.delete(name);
    }),
  };
  const owned = createOwnedStorage(createSharedStorage(raw), key);
  const c = createAuthCoordinator(identity);
  return { key, session, serialized, identity, values, raw, owned, c };
}

it.each(["intent", "ABA"] as const)(
  "owned storage refuses retired %s mutation and post-removal reads",
  async (retirement) => {
    for (const operation of ["session", "user", "verifier", "remove", "read"] as const) {
      const f = fixture();
      const owner = f.c.captureOwner();
      await f.owned.run(owner, f.session, async () => {
        if (operation === "read") await f.owned.storage.removeItem(f.key);
        const before = [...f.values];
        const replacement = retirement === "intent" ? f.c.transition(async () => undefined) : undefined;
        if (retirement === "ABA") {
          f.c.observeIdentity("B");
          f.c.observeIdentity(f.identity);
        }
        const request =
          operation === "session"
            ? f.owned.storage.setItem(f.key, f.serialized)
            : operation === "user"
              ? f.owned.storage.setItem(f.key + "-user", "new")
              : operation === "verifier"
                ? f.owned.storage.removeItem(f.key + "-code-verifier")
                : operation === "remove"
                  ? f.owned.storage.removeItem(f.key)
                  : f.owned.storage.getItem(f.key);
        await expect(request).rejects.toMatchObject({ code: "operation_superseded" });
        expect([...f.values]).toEqual(before);
        await replacement;
      });
    }
  },
);

it("owned storage uses strict fallback for owners without settlement capabilities", async () => {
  const f = fixture();
  let current = true;
  const owner = {
    isCurrent: () => current,
    cancel: () => {
      current = false;
    },
  };
  await f.owned.run(owner, f.session, async () => {
    current = false;
    await expect(f.owned.storage.setItem(f.key, f.serialized)).rejects.toMatchObject({ code: "operation_superseded" });
    expect(f.values.get(f.key)).toBe(f.serialized);
  });
});

it("owned recovery does not create a receipt from a failed backing write", async () => {
  const f = fixture();
  const owner = f.c.captureOwner();
  const failure = new Error("synthetic write failure");
  f.raw.setItem.mockImplementationOnce(() => {
    throw failure;
  });
  await f.owned.restore(owner, f.session, async () => {
    const publish = f.owned.capturePublication(f.session);
    expect(publish()).toBe(false);
    await expect(f.owned.storage.setItem(f.key, f.serialized)).rejects.toBe(failure);
    expect(publish()).toBe(false);
    expect(f.values.get(f.key)).toBe(f.serialized);
  });
});

it.each(["intent", "ABA", "cancel"] as const)("owned recovery receipt cannot outlive %s", async (retirement) => {
  const f = fixture();
  const owner = f.c.captureOwner();
  await f.owned.restore(owner, f.session, async () => {
    await f.owned.storage.setItem(f.key, f.serialized);
    const publish = f.owned.capturePublication(f.session);
    expect(publish()).toBe(true);
    const replacement = retirement === "intent" ? f.c.transition(async () => undefined) : undefined;
    if (retirement === "ABA") {
      f.c.observeIdentity("B");
      f.c.observeIdentity(f.identity);
    } else if (retirement === "cancel") owner.cancel();
    expect(publish()).toBe(false);
    await expect(f.owned.storage.setItem(f.key, f.serialized)).rejects.toMatchObject({ code: "operation_superseded" });
    expect(f.values.get(f.key)).toBe(f.serialized);
    await replacement;
  });
});

it("owned recovery preserves all prior keys while rejecting its token", async () => {
  const f = fixture();
  const before = [...f.values];
  await f.owned.restore(f.c.captureOwner(), f.session, async () => {
    for (const key of f.values.keys()) await f.owned.storage.removeItem(key);
    expect([...f.values]).toEqual(before);
    expect(f.owned.capturePublication(null)()).toBe(false);
  });
});

it("denied private dispatch revokes cleanup even when cancelled work otherwise may settle", async () => {
  const f = fixture();
  const owner = f.c.captureOwner();
  const before = [...f.values];
  await f.owned.run(owner, f.session, async () => {
    owner.cancel();
    expect(owner.canSettleSameLifetime?.()).toBe(true);
    expect(f.owned.canDispatch()).toBe(false);
    for (const key of [f.key, f.key + "-user", f.key + "-code-verifier"]) {
      await expect(f.owned.storage.removeItem(key)).rejects.toMatchObject({ code: "operation_superseded" });
    }
    expect([...f.values]).toEqual(before);
    expect(f.owned.capturePublication(f.session)()).toBe(false);
    expect(f.owned.capturePublication(null)()).toBe(false);
  });
});
