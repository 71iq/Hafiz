import type { Session } from "@supabase/supabase-js";

type IdentitySession = Pick<Session, "access_token"> & {
  user: Pick<Session["user"], "id">;
};

export type AuthSessionIdentity =
  | { kind: "anonymous" }
  | { kind: "unidentified" }
  | { kind: "identified"; userId: string; sessionId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account ids are UUIDs; anything else cannot name a user and must not reach the server. */
export function isAccountId(value: string): boolean {
  return UUID.test(value);
}
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodePayload(input: string): string | null {
  if (!input || input.length % 4 === 1) return null;
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of input) {
    const value = BASE64URL.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) return null;
  return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
}

// Identity comparison only. Supabase remains the authentication owner.
export function getAuthSessionIdentity(session: IdentitySession | null): AuthSessionIdentity {
  if (!session) return { kind: "anonymous" };
  try {
    const parts = session.access_token.split(".");
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      return { kind: "unidentified" };
    }
    const decoded = decodePayload(parts[1]);
    if (decoded === null) return { kind: "unidentified" };
    const claims: unknown = JSON.parse(decoded);
    if (
      claims === null ||
      typeof claims !== "object" ||
      Array.isArray(claims) ||
      !("sub" in claims) ||
      claims.sub !== session.user.id ||
      typeof claims.sub !== "string" ||
      !UUID.test(claims.sub) ||
      !("session_id" in claims) ||
      typeof claims.session_id !== "string" ||
      !UUID.test(claims.session_id)
    )
      return { kind: "unidentified" };
    return { kind: "identified", userId: claims.sub.toLowerCase(), sessionId: claims.session_id.toLowerCase() };
  } catch {
    return { kind: "unidentified" };
  }
}
