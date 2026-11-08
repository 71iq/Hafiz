import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { captureQfRequestOwner } from "@/lib/quran-foundation/request-owner";

function session(userIndex = 1, sessionIndex = 1, revision = 0): Session {
  const id = "00000000-0000-4000-8000-" + String(userIndex).padStart(12, "0");
  const sessionId = "10000000-0000-4000-8000-" + String(sessionIndex).padStart(12, "0");
  const claims = Buffer.from(JSON.stringify({ sub: id, session_id: sessionId, revision })).toString("base64url");
  return {
    access_token: "e30." + claims + ".c2ln",
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2000-01-01" },
  };
}
let state: { user: Session["user"] | null; session: Session | null };
const getState = () => state;
const readSession = jest.fn();
function publish(next: Session | null) {
  state = { user: next?.user ?? null, session: next };
  observeAuthSession(next);
}
beforeEach(() => {
  observeAuthSession(null);
  publish(session());
  readSession.mockReset().mockImplementation(async () => ({ data: { session: state.session }, error: null }));
});
afterEach(() => publish(null));

it("captures the current session when no explicit source is supplied", async () => {
  const owner = captureQfRequestOwner({ getState, readSession });
  expect(owner?.isCurrent()).toBe(true);
  await expect(owner?.getAccessToken()).resolves.toBe(state.session?.access_token);
});
it.each([
  { label: "explicit null", sourceSession: null },
  { label: "unidentified", sourceSession: { ...session(), access_token: "unidentified" } },
  { label: "foreign account", sourceSession: session(2, 2) },
  { label: "same user new session", sourceSession: session(1, 2) },
])("does not replace a $label source with the current account", ({ sourceSession }) => {
  expect(captureQfRequestOwner({ getState, readSession, sourceSession })).toBeNull();
  expect(readSession).not.toHaveBeenCalled();
});
it("rejects an explicit source whose current session no longer matches even if the user field does", () => {
  const sourceSession = session();
  state.session = session(2, 2);
  expect(captureQfRequestOwner({ getState, readSession, sourceSession })).toBeNull();
  expect(readSession).not.toHaveBeenCalled();
});
it("does not bind an explicit source to a missing current user", () => {
  state.user = null;
  expect(captureQfRequestOwner({ getState, readSession, sourceSession: session() })).toBeNull();
  expect(readSession).not.toHaveBeenCalled();
});
it("accepts matching original source identity with refreshed current SDK credentials", async () => {
  const sourceSession = session();
  const refreshed = session(1, 1, 42);
  publish(refreshed);
  const owner = captureQfRequestOwner({ getState, readSession, sourceSession });
  await expect(owner?.getAccessToken()).resolves.toBe(refreshed.access_token);
  expect(owner?.isCurrent()).toBe(true);
});
it("retires a captured source after a closed account round trip", async () => {
  const sourceSession = state.session;
  const owner = captureQfRequestOwner({ getState, readSession, sourceSession });
  publish(session(2, 2));
  publish(sourceSession);
  expect(owner?.isCurrent()).toBe(false);
  await expect(owner?.getAccessToken()).rejects.toThrow("account changed");
  expect(readSession).not.toHaveBeenCalled();
});
