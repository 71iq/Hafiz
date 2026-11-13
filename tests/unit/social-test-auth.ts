/**
 * Shared fixtures for the halaqa and board tests: a signed-in auth state whose session token
 * getAuthSessionIdentity accepts, and a Supabase rpc builder that records the token it was sent with.
 */
export type FakeAuthState = {
  user: { id: string } | null;
  session: { user: { id: string }; access_token: string } | null;
};

function token(payload: unknown): string {
  return [JSON.stringify({ alg: "HS256", typ: "JWT" }), JSON.stringify(payload), "synthetic-signature"]
    .map((value) => Buffer.from(value).toString("base64url"))
    .join(".");
}

/** A signed-in state for `userId`; `sessionId` tells two sign-ins of one account apart. */
export function signedIn(userId: string, sessionId = "00000000-0000-4000-9000-000000000001"): FakeAuthState {
  return { user: { id: userId }, session: { user: { id: userId }, access_token: token({ sub: userId, session_id: sessionId }) } };
}

export function signedOut(): FakeAuthState {
  return { user: null, session: null };
}

/** The account a recorded Authorization header belongs to, or null without one. */
export function bearerSubject(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const payload = header.slice("Bearer ".length).split(".")[1];
  return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string }).sub;
}

/** Wraps a pending rpc result like PostgREST's builder: awaitable, with setHeader recording headers. */
export function rpcBuilder<T>(result: Promise<T>, headers: Record<string, string>): Promise<T> & {
  setHeader: (name: string, value: string) => Promise<T>;
} {
  return Object.assign(result, {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
      return result;
    },
  });
}
