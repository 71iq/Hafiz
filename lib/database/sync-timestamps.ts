import { z } from "zod";

export const syncTimestampSchema = z.iso.datetime({ offset: true });

type TimestampParts = { wholeSeconds: number; fraction: string };

function parseTimestamp(value: unknown): TimestampParts {
  const parsed = syncTimestampSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid sync timestamp");

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(
    parsed.data,
  );
  if (!match) throw new Error("Invalid sync timestamp");

  const fraction = match[7] ?? "";
  const clock = match[6] === undefined ? `${match[4]}:${match[5]}:00` : `${match[4]}:${match[5]}:${match[6]}`;
  const wholeSeconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${clock}${match[8]}`) / 1000;
  if (!Number.isSafeInteger(wholeSeconds)) throw new Error("Invalid sync timestamp");

  return { wholeSeconds, fraction };
}

export function syncTimestampKey(value: unknown): string {
  const { wholeSeconds, fraction } = parseTimestamp(value);
  return `${wholeSeconds}:${fraction.replace(/0+$/, "")}`;
}

export function compareSyncTimestamps(left: unknown, right: unknown): -1 | 0 | 1 {
  const leftParts = parseTimestamp(left);
  const rightParts = parseTimestamp(right);
  if (leftParts.wholeSeconds < rightParts.wholeSeconds) return -1;
  if (leftParts.wholeSeconds > rightParts.wholeSeconds) return 1;

  const fractionLength = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  for (let index = 0; index < fractionLength; index += 1) {
    const leftDigit = leftParts.fraction.charCodeAt(index) || 48;
    const rightDigit = rightParts.fraction.charCodeAt(index) || 48;
    if (leftDigit < rightDigit) return -1;
    if (leftDigit > rightDigit) return 1;
  }
  return 0;
}
