import * as fc from "fast-check";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
const USER = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
function token(payload: unknown) {
  return [JSON.stringify({ alg: "HS256", typ: "JWT" }), JSON.stringify(payload), "synthetic-signature"]
    .map((value) => Buffer.from(value).toString("base64url"))
    .join(".");
}
function read(payload: unknown) {
  return getAuthSessionIdentity({ user: { id: USER }, access_token: token(payload) });
}
it("distinguishes anonymous from an invalid signed-in identity", () => {
  expect(getAuthSessionIdentity(null)).toEqual({ kind: "anonymous" });
  expect(getAuthSessionIdentity({ user: { id: USER }, access_token: "invalid" })).toEqual({ kind: "unidentified" });
});
it("reads the validated identity without Buffer, atob or TextDecoder in implementation", () => {
  expect(read({ sub: USER, session_id: OWNER })).toEqual({ kind: "identified", userId: USER, sessionId: OWNER });
});
it.each([
  null,
  [],
  true,
  1,
  "text",
  {},
  { sub: USER },
  { session_id: OWNER },
  { sub: USER, session_id: null },
  { sub: USER, session_id: 2 },
  { sub: USER, session_id: "not-a-uuid" },
  { sub: "00000000-0000-4000-8000-000000000002", session_id: OWNER },
  { sub: "someone-else", session_id: OWNER },
  { sub: { id: USER }, session_id: OWNER },
])("rejects invalid claims %#", (payload) => {
  expect(read(payload)).toEqual({ kind: "unidentified" });
});
it.each([
  "",
  "a",
  "a.b",
  "a.b.c.d",
  "a..c",
  ".e30.c",
  "a.e30.",
  "a.e30=.c",
  "a.*.c",
  "a.A.c",
  "a.AB.c",
  "a._w.c",
  "a.ew.c",
])("rejects malformed token %#", (access_token) => {
  expect(getAuthSessionIdentity({ user: { id: USER }, access_token })).toEqual({ kind: "unidentified" });
});
it("preserves Unicode metadata while identifying only the validated owner fields", () => {
  expect(read({ sub: USER, session_id: OWNER, user_metadata: { name: "اختبار 🌙 é" } })).toEqual({
    kind: "identified",
    userId: USER,
    sessionId: OWNER,
  });
});
it("accepts a valid case-insensitive UUID representation and keeps session generations distinct", () => {
  const owner = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  expect(read({ sub: USER, session_id: owner.toUpperCase() })).toEqual({
    kind: "identified",
    userId: USER,
    sessionId: owner,
  });
  expect(read({ sub: USER, session_id: OWNER })).not.toEqual(read({ sub: USER, session_id: owner }));
});
it("round-trips arbitrary metadata without changing the owner", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (metadata) => {
      expect(read({ sub: USER, session_id: OWNER, user_metadata: metadata })).toEqual({
        kind: "identified",
        userId: USER,
        sessionId: OWNER,
      });
    }),
    { seed: 1252026, numRuns: 1000 },
  );
});

it("rejects invalid UTF8 inside an otherwise valid owner payload", () => {
  const payload = Buffer.concat([
    Buffer.from(JSON.stringify({ sub: USER, session_id: OWNER }).slice(0, -1) + ',"metadata":"'),
    Buffer.from([255]),
    Buffer.from('"}'),
  ]).toString("base64url");
  expect(getAuthSessionIdentity({ user: { id: USER }, access_token: `header.${payload}.signature` })).toEqual({
    kind: "unidentified",
  });
});
it("rejects noncanonical unused base64url bits in an otherwise valid owner payload", () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let raw = JSON.stringify({ sub: USER, session_id: OWNER });
  while (Buffer.byteLength(raw) % 3 === 0) raw += " ";
  const payload = Buffer.from(raw).toString("base64url");
  const last = alphabet.indexOf(payload.at(-1) ?? "");
  const noncanonical = payload.slice(0, -1) + alphabet[last + 1];
  expect(getAuthSessionIdentity({ user: { id: USER }, access_token: `header.${noncanonical}.signature` })).toEqual({
    kind: "unidentified",
  });
});
it("runs with Node and browser decoder globals unavailable", () => {
  const session = { user: { id: USER }, access_token: token({ sub: USER, session_id: OWNER }) };
  const names = ["Buffer", "atob", "TextDecoder"];
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let result;
  try {
    for (const name of names)
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: undefined });
    result = getAuthSessionIdentity(session);
  } finally {
    for (const name of names) {
      const old = descriptors.get(name);
      if (old) Object.defineProperty(globalThis, name, old);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
  expect(result).toEqual({ kind: "identified", userId: USER, sessionId: OWNER });
});
