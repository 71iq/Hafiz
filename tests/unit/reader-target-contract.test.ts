import {
  consumePendingDeepLink,
  peekPendingDeepLink,
  setPendingDeepLink,
  subscribePendingDeepLink,
} from "@/lib/deep-link";
import {
  INITIAL_POSITION_SESSION,
  captureReturnToken,
  expireReturnToken,
  mayApplySavedPosition,
  mayPersistPosition,
  parseSavedPosition,
  reducePositionSession,
  serializePosition,
  takeReturnToken,
  type ReaderPositionEvent,
} from "@/lib/navigation/reader-session";

const run = (...events: ReaderPositionEvent[]) => events.reduce(reducePositionSession, INITIAL_POSITION_SESSION);

describe("C06 target store", () => {
  afterEach(() => {
    consumePendingDeepLink();
  });

  it("consumes a target once, however many times the reader re-renders or refocuses", () => {
    setPendingDeepLink({ surah: 2, ayah: 255 });
    expect(peekPendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
    for (let render = 0; render < 5; render += 1) expect(consumePendingDeepLink()).toBeNull();
  });

  it("lets a later submission replace an unconsumed one and tells a focused reader", () => {
    const listener = jest.fn();
    const unsubscribe = subscribePendingDeepLink(listener);
    setPendingDeepLink({ surah: 1, ayah: 1 });
    setPendingDeepLink({ surah: 36, ayah: 1 });
    unsubscribe();
    setPendingDeepLink({ surah: 18, ayah: 10 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(consumePendingDeepLink()).toEqual({ surah: 18, ayah: 10 });
  });

  it("keeps its own copy, so a caller mutating the object cannot change the target", () => {
    const target = { surah: 2, ayah: 255 };
    setPendingDeepLink(target);
    target.ayah = 1;
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });
});

describe("saved reading position around a jump", () => {
  it("never lets hydration or the first rendered rows turn a 2:255 jump into a saved 1:1", () => {
    // A cold link: the explicit target arrives before the saved-position read finishes.
    const session = run("explicit-jump");
    expect(mayApplySavedPosition(session)).toBe(false);
    const settled = reducePositionSession(session, "restore-settled");
    // Verse view first reports 1:1, then the 2:255 arrival; neither is saved until the reader engages.
    expect(mayPersistPosition(settled)).toBe(false);
    expect(mayPersistPosition(reducePositionSession(settled, "deliberate-move"))).toBe(true);
  });

  it("applies the saved position on an ordinary visit and saves only after the restore settled", () => {
    expect(mayApplySavedPosition(INITIAL_POSITION_SESSION)).toBe(true);
    expect(mayPersistPosition(INITIAL_POSITION_SESSION)).toBe(false);
    expect(mayPersistPosition(run("restore-settled"))).toBe(true);
  });

  it("holds saving again after each later jump", () => {
    const session = run("restore-settled", "deliberate-move", "explicit-jump");
    expect(mayPersistPosition(session)).toBe(false);
    expect(mayApplySavedPosition(session)).toBe(false);
  });

  it("keeps the stored JSON shape and rejects malformed or out-of-range values", () => {
    expect(serializePosition({ mode: "verse", surah: 2, ayah: 255 })).toBe('{"mode":"verse","surah":2,"ayah":255}');
    expect(serializePosition({ mode: "page", page: 42 })).toBe('{"mode":"page","page":42}');
    expect(parseSavedPosition('{"mode":"verse","surah":2,"ayah":255}')).toEqual({ mode: "verse", surah: 2, ayah: 255 });
    expect(parseSavedPosition('{"mode":"verse","surah":2,"ayah":999}')).toBeNull();
    expect(parseSavedPosition('{"mode":"page","page":605}')).toBeNull();
    expect(parseSavedPosition("not json")).toBeNull();
    expect(parseSavedPosition(null)).toBeNull();
  });
});

describe("Back to where I was", () => {
  const before = { mode: "page" as const, page: 300 };

  it("restores the captured position and mode once", () => {
    const token = captureReturnToken(before, "user-1", 1);
    const first = takeReturnToken(token, 1, "user-1");
    expect(first.position).toEqual(before);
    expect(first.next).toBeNull();
    expect(takeReturnToken(first.next, 1, "user-1").position).toBeNull();
  });

  it("is replaced by a later jump and never stacks history", () => {
    const first = captureReturnToken(before, null, 1);
    const second = captureReturnToken({ mode: "verse", surah: 2, ayah: 255 }, null, 2);
    expect(takeReturnToken(second, 1, null).position).toBeNull();
    expect(takeReturnToken(second, 2, null).position).toEqual({ mode: "verse", surah: 2, ayah: 255 });
    expect(first).not.toBe(second);
  });

  it("lets only its own five-second timer expire it", () => {
    const newer = captureReturnToken(before, null, 2);
    expect(expireReturnToken(newer, 1)).toBe(newer);
    expect(expireReturnToken(newer, 2)).toBeNull();
  });

  it("does not appear without a previous position and never restores another account's state", () => {
    expect(captureReturnToken(null, "user-1", 1)).toBeNull();
    const token = captureReturnToken(before, "user-1", 1);
    expect(takeReturnToken(token, 1, "user-2")).toEqual({ position: null, next: null });
  });
});
