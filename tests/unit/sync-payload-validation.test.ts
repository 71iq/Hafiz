import {
  decodeSyncPage,
  decodeSyncQueueEntry,
  decodeSyncFreshness,
  decodeSyncedStudyLogExists,
  type SyncTable,
} from "@/lib/database/sync-payloads";
import type { SyncQueueEntry } from "@/lib/database/sync-queue";

const OWNER = "00000000-0000-4000-8000-000000000001";
const DATE = "2026-02-01T00:00:00.000Z";
const dates = { created_at: DATE, updated_at: DATE, deleted_at: null };
const fixtures: Record<SyncTable, { rowId: string; row: Record<string, unknown>; bad: Record<string, unknown> }> = {
  user_settings: {
    rowId: "daily_review_limit",
    row: { key: "daily_review_limit", value: "20", ...dates },
    bad: { value: 20 },
  },
  user_word_meanings: {
    rowId: "2:255:1",
    row: { surah: 2, ayah: 255, word_pos: 1, word: null, meaning: "", ...dates },
    bad: { word_pos: Infinity },
  },
  study_cards: {
    rowId: "opaque:legacy:card",
    row: {
      id: "opaque:legacy:card",
      deck_id: "deck",
      due: DATE,
      stability: 1,
      difficulty: 2,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      last_review: null,
      suspended_at: null,
      buried_until: null,
      marked_at: null,
      ...dates,
    },
    bad: { stability: NaN },
  },
  study_log: {
    rowId: `opaque:legacy:card:${DATE}`,
    row: {
      card_id: "opaque:legacy:card",
      rating: 3,
      state: 2,
      due: DATE,
      stability: 1,
      difficulty: 2,
      elapsed_days: 1,
      scheduled_days: 1,
      reviewed_at: DATE,
    },
    bad: { rating: "3" },
  },
  bookmarks: {
    rowId: "2:255",
    row: { surah: 2, ayah: 255, ...dates, qf_is_in_default_collection: false, qf_collections_count: 0 },
    bad: { ayah: 1.5 },
  },
  highlights: {
    rowId: "opaque highlight ID",
    row: {
      sync_id: "opaque highlight ID",
      surah: 2,
      ayah: 255,
      word_start: null,
      word_end: null,
      color: "yellow",
      ...dates,
    },
    bad: { color: null },
  },
  private_notes: {
    rowId: "opaque note ID",
    row: {
      id: "opaque note ID",
      surah: 2,
      ayah_start: 255,
      ayah_end: 255,
      content: "",
      ...dates,
      qf_note_id: null,
      qf_ranges_json: [{ verse: "2:255" }],
    },
    bad: { content: 42 },
  },
  reflection_journey_entries: {
    rowId: "level:legacy",
    row: {
      level_id: "level:legacy",
      status: "draft",
      response_text: "",
      created_at: DATE,
      updated_at: DATE,
      completed_at: null,
    },
    bad: { status: "unknown" },
  },
  achievement_unlocks: {
    rowId: "first_review",
    row: { achievement_id: "first_review", unlocked_at: DATE, public_payload: { reviews: 1 } },
    bad: { achievement_id: "" },
  },
};
const tables = Object.keys(fixtures) as SyncTable[];

function entry(table: SyncTable, row: Record<string, unknown> = fixtures[table].row): SyncQueueEntry {
  return {
    id: 1,
    table_name: table,
    operation: "UPDATE",
    row_id: table === "study_log" ? `${row.card_id}:${row.reviewed_at}` : fixtures[table].rowId,
    data: JSON.stringify(row),
    status: "pending",
    created_at: DATE,
    synced_at: null,
  };
}

it.each(tables)("decodes current unversioned %s rows in both directions without changing values", (table) => {
  const row = { ...fixtures[table].row, user_id: OWNER, synced_at: DATE };
  const page = decodeSyncPage(table, [row], OWNER);
  expect(page).toHaveLength(1);
  expect(page[0]).toMatchObject(row);
  expect(decodeSyncQueueEntry(entry(table, row), OWNER).data).toEqual(row);
  expect(row).toEqual({ ...fixtures[table].row, user_id: OWNER, synced_at: DATE });
});

it.each(tables)("rejects malformed %s fields before returning a partial page", (table) => {
  const row = fixtures[table].row;
  expect(() => decodeSyncPage(table, [row, { ...row, ...fixtures[table].bad }], OWNER)).toThrow();
  // NaN/Infinity serialize as null and must also be rejected on the persisted boundary.
  expect(() => decodeSyncQueueEntry(entry(table, { ...row, ...fixtures[table].bad }), OWNER)).toThrow();
});

it.each(tables)("rejects foreign %s rows and retains unfamiliar outbound semantics", (table) => {
  const row = fixtures[table].row;
  const foreign = { ...row, user_id: "00000000-0000-4000-8000-000000000002" };
  expect(() => decodeSyncPage(table, [foreign], OWNER)).toThrow();
  expect(() => decodeSyncQueueEntry(entry(table, foreign), OWNER)).toThrow();
  expect(decodeSyncPage(table, [{ ...row, future_field: { untouched: true } }], OWNER)).toHaveLength(1);
  expect(() => decodeSyncQueueEntry(entry(table, { ...row, future_field: true }), OWNER)).toThrow();
});

it.each(["2026-02-01T12:30:40Z", "2026-02-01T12:30:40.123456Z", "2026-02-01T12:30:40.123456+02:00"])(
  "preserves valid UTC, offset and fractional timestamps %s",
  (value) => {
    for (const table of tables) {
      const field =
        table === "study_log" ? "reviewed_at" : table === "achievement_unlocks" ? "unlocked_at" : "updated_at";
      const row = { ...fixtures[table].row, [field]: value };
      expect(decodeSyncPage(table, [row], OWNER)[0]).toMatchObject({ [field]: value });
      expect(decodeSyncQueueEntry(entry(table, row), OWNER).data).toMatchObject({ [field]: value });
    }
  },
);

it.each(["999", "2026-02-30T00:00:00Z", "2026-02-01", "not-a-date", 12])(
  "rejects malformed timestamps %s without leaking payload values",
  (value) => {
    for (const table of tables) {
      const field =
        table === "study_log" ? "reviewed_at" : table === "achievement_unlocks" ? "unlocked_at" : "updated_at";
      const row = { ...fixtures[table].row, [field]: value, sensitive: "PRIVATE-SENTINEL" };
      let error: unknown;
      try {
        decodeSyncPage(table, [row], OWNER);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("PRIVATE-SENTINEL");
      expect(() => decodeSyncQueueEntry(entry(table, row), OWNER)).toThrow();
    }
  },
);

it.each([null, {}, "", 0, { length: 0 }])("rejects non-array response %p", (value) => {
  for (const table of tables) expect(() => decodeSyncPage(table, value, OWNER)).toThrow();
});

it("ignores unsupported setting payloads without validating their private values", () => {
  expect(
    decodeSyncPage("user_settings", [{ key: "device_only", value: { private: true }, updated_at: "invalid" }], OWNER),
  ).toEqual([{ kind: "ignored", key: "device_only" }]);
  expect(() =>
    decodeSyncQueueEntry(
      {
        ...entry("user_settings"),
        row_id: "device_only",
        data: JSON.stringify({ key: "device_only", value: "value" }),
      },
      OWNER,
    ),
  ).toThrow();
  expect(decodeSyncPage("user_settings", [{ ...fixtures.user_settings.row, kind: "ignored" }], OWNER)[0]).toMatchObject(
    { kind: "setting", value: "20" },
  );
});

it("keeps sparse card tombstones, highlight empty timestamps and fallback dates", () => {
  expect(decodeSyncPage("study_cards", [{ id: "opaque:card", deleted_at: DATE, synced_at: DATE }], OWNER)[0]).toEqual({
    id: "opaque:card",
    deleted_at: DATE,
    synced_at: DATE,
  });
  expect(() => decodeSyncPage("study_cards", [{ id: "opaque:card", deleted_at: DATE }], OWNER)).toThrow();
  expect(
    decodeSyncPage(
      "study_cards",
      [
        {
          id: "opaque:card",
          deleted_at: DATE,
          synced_at: DATE,
          deck_id: null,
          due: null,
          state: null,
          stability: null,
          created_at: null,
        },
      ],
      OWNER,
    )[0],
  ).toMatchObject({ state: null, due: null });
  const row = { ...fixtures.highlights.row, updated_at: "", deleted_at: DATE };
  expect(decodeSyncPage("highlights", [row], OWNER)[0]).toMatchObject({ updated_at: "" });
  expect(
    decodeSyncPage("highlights", [{ ...row, created_at: null, updated_at: null, synced_at: DATE }], OWNER)[0],
  ).toMatchObject({ created_at: null, updated_at: null });
  for (const table of [
    "user_settings",
    "user_word_meanings",
    "study_cards",
    "bookmarks",
    "highlights",
    "private_notes",
  ] as const) {
    expect(() => decodeSyncPage(table, [{ ...fixtures[table].row, deleted_at: "invalid" }], OWNER)).toThrow();
  }
});

it("accepts optional QF metadata, JSON text and SQLite bookmark flags", () => {
  for (const qf_ranges_json of [null, '[{"verse":"2:255"}]', { ranges: [] }]) {
    const row = { ...fixtures.private_notes.row, qf_ranges_json, qf_synced_at: null, qf_sync_error: null };
    expect(decodeSyncQueueEntry(entry("private_notes", row), OWNER).data).toEqual(row);
  }
  for (const qf_is_in_default_collection of [false, true, 0, 1]) {
    expect(
      decodeSyncQueueEntry(entry("bookmarks", { ...fixtures.bookmarks.row, qf_is_in_default_collection }), OWNER).data,
    ).toMatchObject({ qf_is_in_default_collection });
  }
  expect(() =>
    decodeSyncQueueEntry(entry("private_notes", { ...fixtures.private_notes.row, qf_ranges_json: "{bad" }), OWNER),
  ).toThrow();
});

it.each(["BOGUS", "delete", "UPSERT"])("rejects an unknown operation %s", (operation) => {
  expect(() => decodeSyncQueueEntry({ ...entry("private_notes"), operation }, OWNER)).toThrow();
});
it.each(["unknown", "__proto__", "constructor"])("rejects an unknown table %s", (table_name) => {
  expect(() => decodeSyncQueueEntry({ ...entry("private_notes"), table_name }, OWNER)).toThrow();
});
it("rejects unsupported envelope fields, malformed JSON and primitives", () => {
  expect(() => decodeSyncQueueEntry({ ...entry("private_notes"), version: 2 }, OWNER)).toThrow();
  for (const data of ["null", "[]", "true", "{broken"]) {
    expect(() => decodeSyncQueueEntry({ ...entry("private_notes"), data }, OWNER)).toThrow();
  }
});

it("validates highlight dispatch identity while preserving numeric local IDs and opaque remote IDs", () => {
  const row = { ...fixtures.highlights.row, id: 42 };
  expect(decodeSyncQueueEntry({ ...entry("highlights", row), row_id: "42" }, OWNER).data).toEqual(row);
  expect(decodeSyncQueueEntry({ ...entry("highlights", row), operation: "DELETE" }, OWNER).data).toEqual(row);
  expect(() =>
    decodeSyncQueueEntry(
      { ...entry("highlights", row), operation: "DELETE", row_id: "highlight:2:255:ayah:ayah:yellow" },
      OWNER,
    ),
  ).toThrow();
  for (const row_id of ["42junk", "0", "-1", "2:255", "opaque unmatched"]) {
    expect(() => decodeSyncQueueEntry({ ...entry("highlights", {}), operation: "DELETE", row_id }, OWNER)).toThrow();
  }
});

it("does not normalize timestamps or introduce date-order rules", () => {
  const row = { ...fixtures.private_notes.row, created_at: "2026-03-01T12:00:00+03:00", updated_at: DATE };
  expect(decodeSyncQueueEntry(entry("private_notes", row), OWNER).data).toEqual(row);
});

it.each(tables.filter((table) => table !== "study_log"))(
  "validates the %s freshness projection before suppressing uploads",
  (table) => {
    expect(decodeSyncFreshness(table, [], OWNER)).toBeNull();
    const row = table === "achievement_unlocks" ? { unlocked_at: DATE } : { created_at: DATE };
    expect(decodeSyncFreshness(table, [row], OWNER)).toBe(DATE);
    expect(decodeSyncFreshness(table, [{ ...row, synced_at: "2026-02-01T12:30:40.123456+02:00" }], OWNER)).toBe(DATE);
    for (const input of [
      null,
      {},
      [null],
      [{}],
      [{ ...row, updated_at: "invalid" }],
      [{ ...row, user_id: "foreign" }],
      [row, row],
    ]) {
      expect(() => decodeSyncFreshness(table, input, OWNER)).toThrow();
    }
  },
);
it("preserves the explicit empty highlight freshness timestamp", () => {
  expect(decodeSyncFreshness("highlights", [{ updated_at: "", created_at: DATE }], OWNER)).toBe("");
});
it("validates a study-log existence projection without coercing or logging payloads", () => {
  expect(decodeSyncedStudyLogExists(null, OWNER)).toBe(false);
  expect(decodeSyncedStudyLogExists({ id: 42 }, OWNER)).toBe(true);
  expect(decodeSyncedStudyLogExists({ id: "42", user_id: OWNER }, OWNER)).toBe(true);
  for (const input of [
    undefined,
    [],
    {},
    { id: "42junk" },
    { id: 0 },
    { id: "9223372036854775808" },
    { id: 1, user_id: "foreign" },
  ]) {
    expect(() => decodeSyncedStudyLogExists(input, OWNER)).toThrow();
  }
});

it.each(["0", "-1", "1e3", "42junk", "9223372036854775808"])(
  "rejects malformed database integer ID %s before dispatch",
  (id) => {
    expect(() =>
      decodeSyncQueueEntry({ ...entry("highlights", {}), operation: "DELETE", row_id: id }, OWNER),
    ).toThrow();
  },
);
