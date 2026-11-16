export type FakeAuthState = {
  user: { id: string } | null;
  session: { user: { id: string }; access_token: string } | null;
};

function token(payload: unknown): string {
  return [JSON.stringify({ alg: "HS256", typ: "JWT" }), JSON.stringify(payload), "synthetic-signature"]
    .map((value) => Buffer.from(value).toString("base64url"))
    .join(".");
}

export function signedIn(userId: string, sessionId = "00000000-0000-4000-9000-000000000001"): FakeAuthState {
  return { user: { id: userId }, session: { user: { id: userId }, access_token: token({ sub: userId, session_id: sessionId }) } };
}

export function signedOut(): FakeAuthState {
  return { user: null, session: null };
}

export function bearerSubject(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const payload = header.slice("Bearer ".length).split(".")[1];
  return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string }).sub;
}

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
