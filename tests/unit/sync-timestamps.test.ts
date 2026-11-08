import * as fc from "fast-check";
import { compareSyncTimestamps, syncTimestampKey } from "@/lib/database/sync-timestamps";

const fractionalScale = 10n ** 30n;
const lowestEpochSecond = -62167219200 + 86400;
const highestEpochSecond = 253402300799 - 86400;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function timestampAt(epochSecond: number, offsetMinutes: number, fraction: string): string {
  const localSecond = epochSecond + offsetMinutes * 60;
  const local = new Date(localSecond * 1000).toISOString().slice(0, 19);
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset =
    offsetMinutes === 0
      ? "Z"
      : (offsetMinutes < 0 ? "-" : "+") + pad2(Math.floor(absoluteOffset / 60)) + ":" + pad2(absoluteOffset % 60);
  return local + (fraction.length === 0 ? "" : "." + fraction) + offset;
}

function oracleTicks(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new Error("Bad test timestamp");
  const localWhole = Math.trunc(
    Date.parse(match[1] + "T" + match[2] + ":" + match[3] + ":" + (match[4] ?? "00") + "Z") / 1000,
  );
  const sign = match[7] === "-" ? -1 : 1;
  const offset = match[6] !== "Z" ? sign * (Number(match[8]) * 60 + Number(match[9])) : 0;
  const utcWhole = localWhole - offset * 60;
  const fraction = (match[5] ?? "").padEnd(30, "0");
  return BigInt(utcWhole) * fractionalScale + BigInt(fraction || "0");
}

const timestampArbitrary = fc
  .record({
    epochSecond: fc.integer({ min: lowestEpochSecond, max: highestEpochSecond }),
    offsetMinutes: fc.integer({ min: -1439, max: 1439 }),
    fractionDigits: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 30 }),
  })
  .map(({ epochSecond, offsetMinutes, fractionDigits }) =>
    timestampAt(epochSecond, offsetMinutes, fractionDigits.join("")),
  );

describe("account sync timestamp instants", () => {
  it.each([
    ["minute-only UTC clock", "2026-06-01T12:34Z", "2026-06-01T12:34:00+00:00", 0],
    ["offset across UTC day boundary", "2026-06-01T00:15:00+01:00", "2026-05-31T23:15:00Z", 0],
    ["year zero offset rollover", "0000-01-01T00:00:00+23:59", "0000-01-01T00:00:00Z", -1],
    ["year 9999 offset rollover", "9999-12-31T23:59:59-23:59", "9999-12-31T23:59:59Z", 1],
    ["leap day", "2000-02-29T23:59:59Z", "2000-03-01T00:00:00Z", -1],
    ["pre-epoch fractions", "1969-12-31T23:59:59.0001Z", "1969-12-31T23:59:59.00009Z", 1],
    ["pre-epoch offset rollover", "1969-12-31T23:59:00-00:01", "1970-01-01T00:00:00Z", 0],
    [
      "arbitrary precision beyond eighteen digits",
      "2026-06-01T00:00:00.123456789012345678901Z",
      "2026-06-01T00:00:00.123456789012345678900Z",
      1,
    ],
    ["maximum positive offset", "2026-06-01T00:00:00+23:59", "2026-05-31T00:01:00Z", 0],
    ["maximum negative offset", "2026-06-01T00:00:00-23:59", "2026-06-02T00:00:00Z", -1],
    ["fractional trailing zeros are the same instant", "2026-06-01T00:00:00.1000Z", "2026-06-01T00:00:00.1Z", 0],
  ] as const)("%s", (_label, left, right, expected) => {
    expect(compareSyncTimestamps(left, right)).toBe(expected);
  });

  it.each(["", "not-a-date", "2026-02-30T00:00:00Z", "2026-01-01T00:00:00+24:00", null, 123])(
    "rejects invalid timestamp input %p",
    (value) => {
      expect(() => compareSyncTimestamps(value, "2026-01-01T00:00:00Z")).toThrow("Invalid sync timestamp");
    },
  );

  it("keys equivalent spellings by exact instant without losing fractional precision", () => {
    expect(syncTimestampKey("2026-06-01T04:00:00.1000+02:00")).toBe(syncTimestampKey("2026-06-01T02:00:00.1Z"));
    expect(syncTimestampKey("1969-12-31T23:59:00-00:01")).toBe(syncTimestampKey("1970-01-01T00:00Z"));
    expect(syncTimestampKey("2026-06-01T00:00:00.1001Z")).not.toBe(syncTimestampKey("2026-06-01T00:00:00.100Z"));
  });

  it("matches comparator equality for correlated instants across offsets and fractions", () => {
    const exactPairArbitrary = fc
      .record({
        epochSecond: fc.integer({ min: lowestEpochSecond, max: highestEpochSecond }),
        leftOffset: fc.integer({ min: -1439, max: 1439 }),
        rightOffset: fc.integer({ min: -1439, max: 1439 }),
        leftFraction: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 10 }),
        rightFraction: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 10 }),
        equivalent: fc.boolean(),
        trailingZeros: fc.integer({ min: 0, max: 20 }),
      })
      .map(({ epochSecond, leftOffset, rightOffset, leftFraction, rightFraction, equivalent, trailingZeros }) => ({
        left: timestampAt(epochSecond, leftOffset, leftFraction.join("")),
        right: timestampAt(
          epochSecond,
          rightOffset,
          (equivalent ? leftFraction : rightFraction).join("") + "0".repeat(trailingZeros),
        ),
      }));

    fc.assert(
      fc.property(exactPairArbitrary, ({ left, right }) => {
        expect(syncTimestampKey(left) === syncTimestampKey(right)).toBe(oracleTicks(left) === oracleTicks(right));
      }),
      { numRuns: 200 },
    );
  });

  it("matches an independent BigInt tick oracle across years, offsets, and arbitrary fractions", () => {
    fc.assert(
      fc.property(timestampArbitrary, timestampArbitrary, (left, right) => {
        const expectedTicks = oracleTicks(left) - oracleTicks(right);
        const expected = expectedTicks < 0n ? -1 : expectedTicks > 0n ? 1 : 0;
        expect(compareSyncTimestamps(left, right)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
