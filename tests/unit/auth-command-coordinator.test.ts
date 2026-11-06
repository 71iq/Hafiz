import { createAuthCoordinator } from "@/lib/auth/coordinator";
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Not initialized");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}
it("serializes complete commands and invalidates the old result at replacement intent", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  const held = deferred<number>();
  const order: string[] = [];
  const first = c.owned(a, async () => {
    order.push("A-start");
    const n = await held.promise;
    order.push("A-end");
    return n;
  });
  await tick();
  const second = c.replace(async () => {
    order.push("B-start");
    c.observeIdentity("B");
    return 2;
  });
  expect(a.isCurrent()).toBe(false);
  expect(c.isLoading()).toBe(true);
  expect(order).toEqual(["A-start"]);
  held.resolve(1);
  expect(await first).toEqual({ status: "superseded" });
  const next = await second;
  expect(next.status).toBe("completed");
  expect(order).toEqual(["A-start", "A-end", "B-start"]);
  expect(c.isLoading()).toBe(false);
});
it("does not recapture a queued password under a later replacement", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  const gate = deferred<void>();
  const replacement = c.replace(async () => {
    await gate.promise;
    c.observeIdentity("B");
  });
  const request = jest.fn(async () => 1);
  expect(await c.owned(a, request)).toEqual({ status: "superseded" });
  expect(request).not.toHaveBeenCalled();
  gate.resolve();
  await replacement;
});
it("cancels an owned command before dispatch when external ownership changes while queued", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  const gate = deferred<void>();
  const first = c.owned(a, () => gate.promise);
  await tick();
  const request = jest.fn(async () => 2);
  const queued = c.owned(a, request);
  c.observeIdentity("B");
  gate.resolve();
  await first;
  expect(await queued).toEqual({ status: "superseded" });
  expect(request).not.toHaveBeenCalled();
});
it("keeps ownership across repeated observations of a stable session", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  c.observeIdentity("A");
  c.observeIdentity("A");
  expect(a.isCurrent()).toBe(true);
  expect((await c.owned(a, async () => 1)).status).toBe("completed");
});
it("rejects A-B-A reuse of an earlier capability", () => {
  const c = createAuthCoordinator("A");
  const old = c.captureOwner();
  c.observeIdentity("B");
  c.observeIdentity("A");
  expect(old.isCurrent()).toBe(false);
  expect(c.captureOwner().isCurrent()).toBe(true);
});
it("skips an obsolete not-yet-started replacement and keeps the latest", async () => {
  const c = createAuthCoordinator("A");
  const old = jest.fn(async () => 1);
  const first = c.replace(old);
  const second = c.replace(async () => {
    c.observeIdentity("C");
    return 2;
  });
  expect(await first).toEqual({ status: "superseded" });
  expect(old).not.toHaveBeenCalled();
  expect((await second).status).toBe("completed");
});
it("preserves the current failure identity and recovers the queue tail", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  const error = new Error("synthetic");
  const failure = c.owned(a, async () => {
    throw error;
  });
  const next = c.owned(a, async () => 2);
  await expect(failure).rejects.toBe(error);
  expect((await next).status).toBe("completed");
  expect(c.isLoading()).toBe(false);
});
it("suppresses an obsolete rejection without clobbering a later pending operation", async () => {
  const c = createAuthCoordinator("A");
  const a = c.captureOwner();
  const gate = deferred<number>();
  const first = c.owned(a, () => gate.promise);
  await tick();
  const nextGate = deferred<number>();
  const second = c.replace(async () => {
    c.observeIdentity("B");
    return nextGate.promise;
  });
  gate.reject(new Error("obsolete"));
  expect(await first).toEqual({ status: "superseded" });
  await tick();
  expect(c.isLoading()).toBe(true);
  nextGate.resolve(2);
  await second;
  expect(c.isLoading()).toBe(false);
});
it("drops inherited old-owner busy after an external replacement", async () => {
  const c = createAuthCoordinator("A");
  const gate = deferred<void>();
  const work = c.owned(c.captureOwner(), () => gate.promise);
  await tick();
  expect(c.isLoading()).toBe(true);
  c.observeIdentity("B");
  expect(c.isLoading()).toBe(false);
  gate.resolve();
  await work;
});
it("revokes an unmounted caller before dispatch", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const work = jest.fn(async () => 1);
  const pending = c.owned(owner, work);
  owner.cancel();
  expect(await pending).toEqual({ status: "superseded" });
  expect(work).not.toHaveBeenCalled();
});
it("does not roll back a request already issued when its caller cancels", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const gate = deferred<number>();
  const work = jest.fn(() => gate.promise);
  const pending = c.owned(owner, work);
  await tick();
  owner.cancel();
  gate.resolve(1);
  expect(await pending).toEqual({ status: "superseded" });
  expect(work).toHaveBeenCalledTimes(1);
});
it("preserves legitimate owned signout with a synchronous SDK callback", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const result = await c.owned(
    owner,
    async () => {
      expect(owner.adoptOwnSignOut?.()).toBe(true);
      c.observeIdentity(null);
      return "out";
    },
    true,
  );
  expect(result.status).toBe("completed");
  expect(owner.isCurrent()).toBe(true);
});
it("allows successful signout without a callback but rejects later ownership", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  expect((await c.owned(owner, async () => "out", true)).status).toBe("completed");
  c.observeIdentity("B");
  expect(owner.isCurrent()).toBe(false);
});
it("does not adopt an old signout transition after another owner appears", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const gate = deferred<void>();
  const pending = c.owned(
    owner,
    async () => {
      await gate.promise;
      c.observeIdentity(null);
    },
    true,
  );
  await tick();
  c.observeIdentity("B");
  gate.resolve();
  expect(await pending).toEqual({ status: "superseded" });
  expect(owner.isCurrent()).toBe(false);
});
it("requires recovery to establish an owner before an account-bound command", async () => {
  const c = createAuthCoordinator(null);
  const write = jest.fn(async () => 1);
  expect(await c.owned(c.captureOwner(), write)).toEqual({ status: "superseded" });
  expect(write).not.toHaveBeenCalled();
  const restore = await c.replace(async () => {
    c.observeIdentity("A");
  });
  if (restore.status !== "completed") throw new Error("Unexpected cancellation");
  expect((await c.owned(restore.owner, write)).status).toBe("completed");
});

it("legacy transitions retain both results in FIFO order without silent cancellation", async () => {
  const c = createAuthCoordinator("A");
  const order: number[] = [];
  const first = c.transition(async () => {
    order.push(1);
    c.observeIdentity("B");
    return "B";
  });
  const second = c.transition(async () => {
    order.push(2);
    c.observeIdentity("C");
    return "C";
  });
  expect(await first).toBe("B");
  expect(await second).toBe("C");
  expect(order).toEqual([1, 2]);
});
it("legacy transition rejection retains original identity and releases the queue", async () => {
  const c = createAuthCoordinator("A");
  const error = new Error("legacy error");
  const first = c.transition(async () => {
    throw error;
  });
  const second = c.transition(async () => "next");
  await expect(first).rejects.toBe(error);
  expect(await second).toBe("next");
});
it("legacy transition intent invalidates an active password result immediately", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const gate = deferred<number>();
  const first = c.owned(owner, () => gate.promise);
  await tick();
  const second = c.transition(async () => {
    c.observeIdentity("B");
    return "B";
  });
  expect(owner.isCurrent()).toBe(false);
  gate.resolve(1);
  expect(await first).toEqual({ status: "superseded" });
  expect(await second).toBe("B");
});
it("a newly captured ticket during a queued legacy transition cannot target its future session", async () => {
  const c = createAuthCoordinator("A");
  const gate = deferred<void>();
  const change = c.transition(async () => {
    await gate.promise;
    c.observeIdentity("B");
  });
  const work = jest.fn(async () => 1);
  expect(await c.owned(c.captureOwner(), work)).toEqual({ status: "superseded" });
  expect(work).not.toHaveBeenCalled();
  gate.resolve();
  await change;
});

it("settlement authority ignores screen cancellation but never a new intent or closed ABA", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  owner.cancel();
  expect(owner.isCurrent()).toBe(false);
  expect(owner.canSettleSameLifetime?.()).toBe(true);
  c.observeIdentity("B");
  c.observeIdentity("A");
  expect(owner.canSettleSameLifetime?.()).toBe(false);
  const next = c.captureOwner();
  const transition = c.transition(async () => undefined);
  expect(next.canSettleSameLifetime?.()).toBe(false);
  await transition;
});
it("an unrelated null observation cannot be adopted by an active terminal signout", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const gate = deferred<void>();
  const pending = c.owned(owner, () => gate.promise, true);
  await tick();
  c.observeIdentity(null);
  expect(owner.isCurrent()).toBe(false);
  expect(owner.adoptOwnSignOut?.()).toBe(false);
  gate.resolve();
  expect(await pending).toEqual({ status: "superseded" });
});
it("an issued cancelled own logout settles without restoring its result authority", async () => {
  const c = createAuthCoordinator("A");
  const owner = c.captureOwner();
  const result = await c.owned(
    owner,
    async () => {
      owner.cancel();
      expect(owner.adoptOwnSignOut?.()).toBe(true);
      c.observeIdentity(null);
      expect(owner.isCurrent()).toBe(false);
      expect(owner.canSettleSameLifetime?.()).toBe(true);
    },
    true,
  );
  expect(result).toEqual({ status: "superseded" });
});
