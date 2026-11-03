import * as fc from "fast-check";
import { parseJsonRecord } from "@/lib/serialization/json-record";
import { fetchPublicAchievementUnlocks } from "@/lib/leaderboard/api";

let mockConfigured = true;
let mockData: unknown = [];
let mockError: unknown = null;
const mockFrom = jest.fn((table: string) => {
  if (table !== "achievement_unlocks") throw new Error(`Unexpected table ${table}`);
  return Object.assign(Promise.resolve({ data: mockData, error: mockError }), {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { from: (table: string) => mockFrom(table) },
}));

const invalid: { label: string; value: unknown }[] = [
  { label: "undefined", value: undefined },
  { label: "null", value: null },
  { label: "false", value: false },
  { label: "true", value: true },
  { label: "zero", value: 0 },
  { label: "number", value: 4 },
  { label: "NaN", value: NaN },
  { label: "infinity", value: Infinity },
  { label: "bigint", value: BigInt(2) },
  { label: "symbol", value: Symbol("payload") },
  { label: "function", value: () => ({ key: 1 }) },
  { label: "array", value: [1, { key: 2 }] },
  { label: "empty array", value: [] },
  { label: "empty text", value: "" },
  { label: "whitespace", value: "   " },
  { label: "malformed", value: "{bad}" },
  { label: "trailing comma", value: '{"key":1,}' },
  { label: "JSON null", value: "null" },
  { label: "JSON false", value: "false" },
  { label: "JSON number", value: "4" },
  { label: "JSON string", value: '"text"' },
  { label: "JSON array", value: '[{"key":2}]' },
];

it.each(invalid)("returns a fresh empty record for $label", ({ value }) => {
  const first = parseJsonRecord(value);
  expect(first).toEqual({});
  expect(parseJsonRecord(value)).not.toBe(first);
});

it("decodes nested JSON fields without interpreting domain keys", () => {
  expect(parseJsonRecord(' {"deckId":"x","surah":2,"extra":[null,{"arabic":"عربي"}]} ')).toEqual({
    deckId: "x",
    surah: 2,
    extra: [null, { arabic: "عربي" }],
  });
});

it("returns direct frozen records and nested values by identity", () => {
  const nested = Object.freeze([1, 2]);
  const input = Object.freeze({ nested, unknownField: undefined });
  expect(parseJsonRecord(input)).toBe(input);
  expect(parseJsonRecord(input).nested).toBe(nested);
});

it("preserves non-plain objects and null prototypes", () => {
  class Payload {
    value = 7;
  }
  for (const input of [new Payload(), new Date(0), new Map([["x", 1]]), Object.create(null)]) {
    expect(parseJsonRecord(input)).toBe(input);
  }
});

it("does not serialize direct circular records or invoke toJSON", () => {
  const input: { self?: unknown; toJSON: () => never } = {
    toJSON: jest.fn(() => {
      throw new Error("no serialization");
    }),
  };
  input.self = input;
  expect(parseJsonRecord(input)).toBe(input);
  expect(input.toJSON).not.toHaveBeenCalled();
});

it("retains own special keys without polluting Object.prototype", () => {
  const parsed = parseJsonRecord('{"__proto__":{"rf062":true},"constructor":"payload"}');
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  expect(parsed.__proto__).toEqual({ rf062: true });
  expect(parsed.constructor).toBe("payload");
  expect(Object.hasOwn(Object.prototype, "rf062")).toBe(false);
});

it("roundtrips generated JSON records", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
      expect(parseJsonRecord(JSON.stringify(record))).toEqual(record);
    }),
    { seed: 6201, numRuns: 500 },
  );
});

it("preserves generated direct record identity without copying", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.anything()), (record) => {
      expect(parseJsonRecord(record)).toBe(record);
    }),
    { seed: 6202, numRuns: 500 },
  );
});

describe("actual public achievement payload consumer", () => {
  beforeEach(() => {
    mockConfigured = true;
    mockData = [];
    mockError = null;
    mockFrom.mockClear();
  });

  it("keeps every row and parses payloads with existing empty fallback and field mapping", async () => {
    const direct = Object.freeze({ count: 10 });
    const values = [...invalid.map(({ value }) => value), '{"surah":2}', direct];
    mockData = values.map((value, i) => ({ achievement_id: `id${i}`, unlocked_at: `time${i}`, public_payload: value }));
    const result = await fetchPublicAchievementUnlocks("synthetic-user");
    expect(result).toEqual(
      values.map((_, i) => ({
        achievementId: `id${i}`,
        unlockedAt: `time${i}`,
        seenAt: `time${i}`,
        localPayload: {},
        publicPayload: i === values.length - 2 ? { surah: 2 } : i === values.length - 1 ? direct : {},
      })),
    );
    expect(result[result.length - 1].publicPayload).toBe(direct);
    const query = mockFrom.mock.results[0].value;
    expect(query.select).toHaveBeenCalledWith("achievement_id, unlocked_at, public_payload");
    expect(query.eq).toHaveBeenCalledWith("user_id", "synthetic-user");
    expect(query.order).toHaveBeenCalledWith("unlocked_at", { ascending: false });
  });

  it("keeps absent data fallback", async () => {
    for (const value of [undefined, null]) {
      mockData = value;
      await expect(fetchPublicAchievementUnlocks("synthetic-user")).resolves.toEqual([]);
    }
  });

  it("keeps configured and empty-user guards", async () => {
    mockConfigured = false;
    await expect(fetchPublicAchievementUnlocks("synthetic-user")).resolves.toEqual([]);
    mockConfigured = true;
    await expect(fetchPublicAchievementUnlocks("")).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("propagates service errors by identity before parsing", async () => {
    const error = new Error("unavailable");
    mockError = error;
    mockData = [null];
    await expect(fetchPublicAchievementUnlocks("synthetic-user")).rejects.toBe(error);
  });
});
