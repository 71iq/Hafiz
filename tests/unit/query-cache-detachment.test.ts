import { QueryClient, QueryObserver, isCancelledError } from "@tanstack/react-query";

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("detaches before a real abort callback can publish a same-key replacement", async () => {
  const c = client();
  const key = ["publicProfile", "detachment"];
  c.setQueryData(key, "old");
  const old = c.getQueryCache().find({ queryKey: key, exact: true });
  const work = deferred<string>();
  let absent = false;
  const pending = c
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          absent = c.getQueryCache().get(old!.queryHash) === undefined;
          c.setQueryData(key, "fresh");
        });
        return work.promise;
      },
    })
    .catch((error: unknown) => error);
  try {
    c.getQueryCache().removeMany([old!]);
    expect(absent).toBe(true);
    expect(c.getQueryData(key)).toBe("fresh");
    expect(c.getQueryCache().get(old!.queryHash)).not.toBe(old);
    expect(isCancelledError(await pending)).toBe(true);
    work.resolve("late");
    await Promise.resolve();
    expect(c.getQueryData(key)).toBe("fresh");
  } finally {
    work.resolve("cleanup");
    await pending;
    c.clear();
  }
});

it("removed notification names the old object while lookup returns its abort-created replacement", async () => {
  const c = client();
  const key = ["leaderboard", "remove-order"];
  c.setQueryData(key, "old");
  const old = c.getQueryCache().find({ queryKey: key, exact: true });
  const work = deferred<string>();
  let observed = false;
  const pending = c
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => c.setQueryData(key, "new"));
        return work.promise;
      },
    })
    .catch((error: unknown) => error);
  const stop = c.getQueryCache().subscribe((event) => {
    if (event.type === "removed" && event.query === old) {
      observed = true;
      expect(c.getQueryData(key)).toBe("new");
      expect(c.getQueryCache().get(old!.queryHash)).not.toBe(old);
    }
  });
  try {
    c.getQueryCache().removeMany([old!]);
    expect(observed).toBe(true);
    expect(c.getQueryData(key)).toBe("new");
  } finally {
    stop();
    work.resolve("cleanup");
    await pending;
    c.clear();
  }
});

it("removing an old object leaves the current same-key object untouched", () => {
  const c = client();
  const key = ["publicProfile", "stale-object"];
  c.setQueryData(key, "old");
  const old = c.getQueryCache().find({ queryKey: key, exact: true })!;
  c.getQueryCache().removeMany([old]);
  c.setQueryData(key, "new");
  const current = c.getQueryCache().find({ queryKey: key, exact: true });
  const destroy = jest.spyOn(old, "destroy");
  let removed = 0;
  const stop = c.getQueryCache().subscribe((e) => {
    if (e.type === "removed" && e.query === old) removed++;
  });
  try {
    c.getQueryCache().removeMany([old]);
    expect(destroy).not.toHaveBeenCalled();
    expect(removed).toBe(0);
    expect(c.getQueryCache().get(old.queryHash)).toBe(current);
    expect(c.getQueryData(key)).toBe("new");
  } finally {
    stop();
    destroy.mockRestore();
    c.clear();
  }
});

it("removing an object with no current cache entry remains a no-op", () => {
  const c = client();
  const key = ["reflections", "absent"];
  c.setQueryData(key, "old");
  const old = c.getQueryCache().find({ queryKey: key, exact: true })!;
  c.getQueryCache().removeMany([old]);
  const destroy = jest.spyOn(old, "destroy");
  let removed = 0;
  const stop = c.getQueryCache().subscribe((e) => {
    if (e.type === "removed") removed++;
  });
  try {
    c.getQueryCache().removeMany([old]);
    expect(destroy).not.toHaveBeenCalled();
    expect(removed).toBe(0);
  } finally {
    stop();
    destroy.mockRestore();
    c.clear();
  }
});

it("clears an observer still attached to the detached old object without clearing replacement data", () => {
  const c = client();
  const key = ["reflections", "old-observer"];
  c.setQueryData(key, "A");
  const observer = new QueryObserver(c, { queryKey: key, queryFn: async () => "current", staleTime: Infinity });
  const stop = observer.subscribe(() => undefined);
  const old = c.getQueryCache().find({ queryKey: key, exact: true })!;
  try {
    c.getQueryCache().removeMany([old]);
    c.setQueryData(key, "B");
    expect(observer.getCurrentResult().data).toBe("A");
    old.reset();
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(c.getQueryData(key)).toBe("B");
  } finally {
    stop();
    observer.destroy();
    c.clear();
  }
});

it("resetting the detached old object leaves a migrated observer and fresh pending query intact", async () => {
  const c = client();
  const key = ["reflections", "migrated-observer"];
  c.setQueryData(key, "A");
  const work = deferred<string>();
  const observer = new QueryObserver(c, { queryKey: key, queryFn: () => work.promise, staleTime: Infinity });
  const stop = observer.subscribe(() => undefined);
  const old = c.getQueryCache().find({ queryKey: key, exact: true })!;
  let pending: Promise<unknown> | undefined;
  try {
    c.getQueryCache().removeMany([old]);
    c.setQueryData(key, "B");
    pending = observer.refetch();
    expect(observer.getCurrentResult().data).toBe("B");
    old.reset();
    expect(observer.getCurrentResult().data).toBe("B");
    expect(c.getQueryState(key)?.fetchStatus).toBe("fetching");
    work.resolve("fresh B");
    await pending;
    expect(observer.getCurrentResult().data).toBe("fresh B");
  } finally {
    work.resolve("cleanup");
    await pending;
    stop();
    observer.destroy();
    c.clear();
  }
});

it("detaches the whole exact snapshot before the first removed notification and deduplicates it", () => {
  const c = client();
  const cache = c.getQueryCache();
  const first = ["reflections", "first"],
    second = ["reflections", "second"];
  c.setQueryData(first, "A1");
  c.setQueryData(second, "A2");
  const a = cache.find({ queryKey: first, exact: true })!;
  const b = cache.find({ queryKey: second, exact: true })!;
  const events: unknown[] = [];
  const stop = cache.subscribe((event) => {
    if (event.type !== "removed") return;
    events.push(event.query);
    if (event.query === a) {
      expect(cache.get(b.queryHash)).toBeUndefined();
      c.setQueryData(second, "fresh B");
    }
  });
  try {
    cache.removeMany([a, b, a, b]);
    expect(events).toEqual([a, b]);
    expect(c.getQueryData(second)).toBe("fresh B");
  } finally {
    stop();
    c.clear();
  }
});

it.each([{ error: new Error("first listener failed") }, { error: undefined }])(
  "finishes retiring later transports before propagating the first listener error: %p",
  async ({ error }) => {
    const c = client(),
      cache = c.getQueryCache();
    const keys = [
      ["reflections", "throw-first"],
      ["reflectionComments", "throw-second"],
    ];
    const work = [deferred<string>(), deferred<string>()];
    const signals: AbortSignal[] = [];
    keys.forEach((key, index) => c.setQueryData(key, `old ${index}`));
    const queries = keys.map((queryKey) => cache.find({ queryKey, exact: true })!);
    const pending = keys.map((queryKey, index) =>
      c
        .fetchQuery({
          queryKey,
          queryFn: ({ signal }) => {
            signals[index] = signal;
            return work[index].promise;
          },
        })
        .catch((e: unknown) => e),
    );
    const removed: unknown[] = [];
    const stop = cache.subscribe((event) => {
      if (event.type === "removed") {
        removed.push(event.query);
        if (event.query === queries[0]) {
          c.setQueryData(keys[1], "fresh replacement");
          throw error;
        }
      }
    });
    let didThrow = false,
      caught: unknown;
    try {
      try {
        cache.removeMany(queries);
      } catch (e) {
        didThrow = true;
        caught = e;
      }
      expect(didThrow).toBe(true);
      expect(caught).toBe(error);
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
      expect(removed).toEqual(queries);
      expect(c.getQueryData(keys[1])).toBe("fresh replacement");
      expect((await Promise.all(pending)).every(isCancelledError)).toBe(true);
    } finally {
      stop();
      work.forEach((item) => item.resolve("cleanup"));
      await Promise.all(pending);
      c.clear();
    }
  },
);

it("continues notifying later queries after a destroy error and propagates the first error", () => {
  const c = client(),
    cache = c.getQueryCache();
  c.setQueryData(["reflections", 1], "A");
  c.setQueryData(["reflections", 2], "A");
  const queries = cache.getAll();
  const firstError = new Error("destroy failed"),
    nextError = new Error("notification failed");
  const destroy = jest.spyOn(queries[0], "destroy").mockImplementation(() => {
    throw firstError;
  });
  const secondDestroy = jest.spyOn(queries[1], "destroy");
  const events: unknown[] = [];
  const stop = cache.subscribe((event) => {
    if (event.type === "removed") {
      events.push(event.query);
      if (event.query === queries[0]) throw nextError;
    }
  });
  try {
    expect(() => cache.removeMany(queries)).toThrow(firstError);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
    expect(events).toEqual(queries);
    expect(cache.getAll()).toEqual([]);
  } finally {
    stop();
    destroy.mockRestore();
    secondDestroy.mockRestore();
    c.clear();
  }
});

it("leaves the original single-object remove semantics unchanged", async () => {
  const c = client(),
    cache = c.getQueryCache(),
    key = ["publicProfile", "original"];
  c.setQueryData(key, "original");
  const original = cache.find({ queryKey: key, exact: true })!;
  const work = deferred<string>();
  let wasStillCached = false;
  const pending = c
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          wasStillCached = cache.get(original.queryHash) === original;
        });
        return work.promise;
      },
    })
    .catch((error: unknown) => error);
  try {
    cache.remove(original);
    expect(wasStillCached).toBe(true);
    expect(cache.get(original.queryHash)).toBeUndefined();
    c.setQueryData(key, "replacement");
    const replacement = cache.get(original.queryHash);
    const destroy = jest.spyOn(original, "destroy");
    cache.remove(original);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cache.get(original.queryHash)).toBe(replacement);
    destroy.mockRestore();
    cache.remove(replacement!);
    const absentDestroy = jest.spyOn(original, "destroy");
    cache.remove(original);
    expect(absentDestroy).not.toHaveBeenCalled();
    absentDestroy.mockRestore();
  } finally {
    work.resolve("cleanup");
    await pending;
    c.clear();
  }
});
