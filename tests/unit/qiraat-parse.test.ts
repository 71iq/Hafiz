import fs from "node:fs";
import path from "node:path";
import * as fc from "fast-check";
import { parseQiraatText, type QiraatBlock } from "@/lib/qiraat/parse";

const cases = [
  { name: "blank input", raw: " \n\t", expected: [] },
  { name: "unmarked literal text", raw: "  Plain\nمتن  ", expected: [{ heading: null, body: "Plain\nمتن" }] },
  { name: "one headed reading", raw: "Heading...: قرئ: body", expected: [{ heading: "Heading", body: "body" }] },
  { name: "one unheaded reading", raw: "قرئ: body", expected: [{ heading: null, body: "body" }] },
  {
    name: "two readings keep the final body",
    raw: "Heading قرئ: first وقرئ: second",
    expected: [
      { heading: "Heading", body: "first" },
      { heading: null, body: "second" },
    ],
  },
  {
    name: "all marker spellings retain order",
    raw: "عنوان قرئ: one وقرئ شاذا: two قرئ  شاذا : three وقرئ: four",
    expected: [
      { heading: "عنوان", body: "one" },
      { heading: null, body: "two" },
      { heading: null, body: "three" },
      { heading: null, body: "four" },
    ],
  },
  {
    name: "identical bodies remain separate readings",
    raw: "قرئ: repeat وقرئ: repeat",
    expected: [
      { heading: null, body: "repeat" },
      { heading: null, body: "repeat" },
    ],
  },
  {
    name: "empty intervening readings are omitted",
    raw: "عنوان قرئ: first وقرئ: قرئ: last",
    expected: [
      { heading: "عنوان", body: "first" },
      { heading: null, body: "last" },
    ],
  },
  {
    name: "initial heading belongs to first retained body",
    raw: "Heading قرئ: وقرئ: retained",
    expected: [{ heading: "Heading", body: "retained" }],
  },
  { name: "all empty bodies remain empty", raw: "Heading قرئ: وقرئ: ", expected: [] },
  {
    name: "unrecognized diacritized marker remains literal",
    raw: "قُرِئ: untouched",
    expected: [{ heading: null, body: "قُرِئ: untouched" }],
  },
  {
    name: "existing numbered-line formatting stays exact",
    raw: "Head قرئ: note.1 - first.٢ - second",
    expected: [{ heading: "Head", body: "note.\n1 - first.\n٢ - second" }],
  },
  { name: "punctuation-only heading stays absent", raw: "...: قرئ: body", expected: [{ heading: null, body: "body" }] },
] satisfies { name: string; raw: string; expected: QiraatBlock[] }[];

it.each(cases)("$name", ({ raw, expected }) => {
  expect(parseQiraatText(raw)).toEqual(expected);
});

it("roundtrips every generated body once and in order", () => {
  const body = fc
    .array(fc.constantFrom("a", "ن", "ص", "١", "2", "\n", " ", ".", "-", "🧪", "\t"), { maxLength: 40 })
    .map((parts) => `x${parts.join("")}y`);
  const marker = fc.constantFrom("قرئ:", "وقرئ:", "قرئ شاذا:", "وقرئ  شاذا :");
  const input = fc.record({
    heading: fc.constantFrom("", "Synthetic heading", "عنوان تجريبي"),
    readings: fc.array(fc.tuple(marker, body), { minLength: 1, maxLength: 12 }),
  });
  fc.assert(
    fc.property(input, ({ heading, readings }) => {
      const raw = `${heading} ${readings.map(([token, text]) => `${token} ${text}`).join(" ")}`;
      const parsed = parseQiraatText(raw);
      const normalize = (value: string) => value.replace(/\s+/g, "");
      expect(parsed.map((block) => normalize(block.body))).toEqual(readings.map(([, text]) => normalize(text)));
      expect(parsed.map((block) => block.heading)).toEqual(
        readings.map((_, index) => (index === 0 ? heading || null : null)),
      );
    }),
    { seed: 506096, numRuns: 500 },
  );
});

it("preserves normalized source content without exposing corpus text", () => {
  const dataset: unknown = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../assets/data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json"), "utf8"),
  );
  if (typeof dataset !== "object" || dataset === null || Array.isArray(dataset))
    throw new Error("Expected Qiraat source object");
  const entries: unknown[] = Object.values(dataset);
  const normalize = (value: string) => value.replace(/\s+/g, "");
  let checked = 0;
  let bodyMismatches = 0;
  let contentMismatches = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || !("text" in entry) || typeof entry.text !== "string") continue;
    checked += 1;
    const text = entry.text.replace(/<[^>]*>/g, "").trim();
    const parts = text.split(/((?:و?قرئ)(?:\s*شاذا)?\s*:)/);
    const parsed = parseQiraatText(text);
    let expectedContent = normalize(text);
    if (parts.length > 1) {
      const bodies = parts
        .filter((_, index) => index > 0 && index % 2 === 0)
        .map((body) => body.trim())
        .filter(Boolean);
      if (JSON.stringify(parsed.map((block) => normalize(block.body))) !== JSON.stringify(bodies.map(normalize)))
        bodyMismatches += 1;
      expectedContent = bodies.length ? normalize(parts[0].replace(/[:.\s]+$/, "").trim() + bodies.join("")) : "";
    }
    const rendered = normalize(parsed.map((block) => (block.heading || "") + block.body).join(""));
    if (rendered !== expectedContent) contentMismatches += 1;
  }
  expect({ checked, bodyMismatches, contentMismatches }).toEqual({
    checked: 3706,
    bodyMismatches: 0,
    contentMismatches: 0,
  });
});
