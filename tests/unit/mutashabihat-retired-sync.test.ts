import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { MUTASHABIHAT_DATA_VERSION, refreshMutashabihatRows } from "@/lib/database/mutashabihat-rows";
import { fullSync } from "@/lib/database/sync";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * A retired similar-verse slot's card (lib/database/mutashabihat-rows.ts) can reach a device after its
 * launch refresh: a fresh install records the data version first, then the account restore or a pull
 * brings the cards made on the old data. In the old data the ref at nq-sim-6b0cb090bae7db sort order
 * 1 was labelled 2:264 but held 2:265's text; the rows now relabel it to 2:265 at sort order 2, so the
 * card for sort order 1 must not come back. Supabase is mocked; SQLite and the sync queue are real.
 */
// The account can bring back a duplicate-answer card even though its reference still exists.
jest.mock("../../assets/data/mutashabihat/nourquran_hafiz_excluded_cards.json", () => ({
  cards: ["mutashabihat:synthetic-excluded:0"],
}));
const EXCLUDED = "mutashabihat:synthetic-excluded:0";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-02-01T00:00:00.000Z";
const GROUP = "nq-sim-6b0cb090bae7db";
const RETIRED = `mutashabihat:${GROUP}:1`;
const KEPT = `mutashabihat:${GROUP}:0`;
const RELABELLED = `mutashabihat:${GROUP}:2`;

let mockSession: Session | null = null;
const mockRows = new Map<string, Record<string, unknown>[]>();

class MockQuery {
  private since: string | null = null;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  gt(_column: string, value: string) {
    this.since = value;
    return this;
  }
  order() {
    return this;
  }
  async range(start: number, end: number) {
    const mode = this.since === null ? "restore" : "incremental";
    const rows = (mockRows.get(`${this.table}:${mode}`) ?? [])
      .map((row) => ({ user_id: USER_ID, synced_at: NEW, ...row }))
      .filter((row) => this.since === null || row.synced_at > this.since);
    return { data: rows.slice(start, end + 1), error: null };
  }
}

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => new MockQuery(table) },
}));
// The queue is real, so queued deletions can be read back; nothing is pushed.
jest.mock("@/lib/database/sync-queue", () => ({
  ...jest.requireActual<typeof import("@/lib/database/sync-queue")>("@/lib/database/sync-queue"),
  getPendingSyncEntries: async () => [],
}));
jest.mock("@/lib/achievements/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/achievements/queries")>("@/lib/achievements/queries"),
  backfillAchievements: async () => 0,
}));

const groups = [[GROUP, "similar", "وَمَثَلُ ٱلَّذِينَ يُنفِقُونَ أَمْوَٰلَهُمُ", "nourquran:similars", 0]] as const;
/** The bundled rows: 2:261 at sort order 0, the 2:264 ref relabelled to 2:265 at sort order 2. */
const refs = [
  [
    GROUP,
    0,
    2,
    261,
    "البقرة",
    "ينفقون",
    "وَٱعْلَمْ أَنَّ ٱللَّهَ عَزِيزٌ حَكِيمٌ",
    "مَّثَلُ ٱلَّذِينَ يُنفِقُونَ",
    "أَمْوَٰلَهُمْ",
  ],
  [GROUP, 2, 2, 265, "البقرة", "بربوة", "ٱلْكَٰفِرِينَ", "وَمَثَلُ ٱلَّذِينَ يُنفِقُونَ أَمْوَٰلَهُمُ", "ٱبْتِغَآءَ"],
] as const;
const rowsFile = { schema_version: "1.0", version: MUTASHABIHAT_DATA_VERSION, groups, refs };

type CardValues = Record<string, string | number | null>;
function remoteCard(id: string, overrides: CardValues = {}): CardValues {
  return {
    id,
    deck_id: id.startsWith("mutashabihat:")
      ? SMART_DECK_IDS.mutashabihat
      : id.startsWith("similar-tail:")
        ? SMART_DECK_IDS.similarTails
        : "synthetic",
    due: "2026-04-01T00:00:00.000Z",
    stability: 9.5,
    difficulty: 4.2,
    elapsed_days: 3,
    scheduled_days: 9,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    state: 2,
    last_review: OLD,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
    ...overrides,
  };
}

function remoteLog(cardId: string, reviewedAt: string): Record<string, unknown> {
  return {
    card_id: cardId,
    rating: 3,
    state: 2,
    due: "2026-04-01T00:00:00.000Z",
    stability: 9.5,
    difficulty: 4.2,
    elapsed_days: 3,
    scheduled_days: 9,
    reviewed_at: reviewedAt,
  };
}

let store: OutboxDatabase;

const minutesAfter = (time: string, minutes: number) => new Date(Date.parse(time) + minutes * 60_000).toISOString();

const card = (id: string) =>
  store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
/** The queued card uploads; pulled reviews also queue their wird days, which are not under test. */
const queued = () =>
  store.sql
    .prepare("SELECT operation, row_id, data FROM sync_queue WHERE table_name = 'study_cards' ORDER BY id")
    .all() as { operation: string; row_id: string; data: string }[];
const logCount = (id: string) =>
  (store.sql.prepare("SELECT COUNT(*) AS n FROM study_log WHERE card_id = ?").get(id) as { n: number }).n;
const putSetting = (key: string, value: string) =>
  store.sql
    .prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, value, OLD);

beforeEach(async () => {
  mockRows.clear();
  observeAuthSession(null);
  const payload = Buffer.from(
    JSON.stringify({ sub: USER_ID, session_id: "10000000-0000-4000-8000-000000000001" }),
  ).toString("base64url");
  mockSession = {
    user: { id: USER_ID, aud: "authenticated", created_at: OLD, app_metadata: {}, user_metadata: {} },
    access_token: `e30.${payload}.c2ln`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
  observeAuthSession(mockSession);
  jest.spyOn(console, "warn").mockImplementation(() => {});
  store = await openOutboxDatabase();
  // A fresh install: the bundled rows are already these, so the launch refresh records the version.
  const group = store.sql.prepare(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of groups) group.run(...row);
  const ref = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text, post_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of refs) ref.run(...row);
  await refreshMutashabihatRows(store.db, async () => rowsFile);
});

afterEach(async () => {
  await store.close();
  mockSession = null;
  observeAuthSession(null);
  jest.restoreAllMocks();
});

describe("a retired similar-verse card arriving from the account", () => {
  it.each([RETIRED, EXCLUDED])("deletes %s on restore, queues its upload and keeps its log", async (id) => {
    mockRows.set("study_cards:restore", [remoteCard(id), remoteCard(KEPT), remoteCard("2:255")]);
    mockRows.set("study_log:restore", [remoteLog(id, "2026-01-10T08:00:00.000Z"), remoteLog(id, OLD)]);

    const result = await fullSync(store.db);

    expect(result.accountRestored).toBe(true);
    expect(card(id)?.deleted_at).toEqual(expect.any(String));
    expect(queued().map((entry) => [entry.operation, entry.row_id])).toEqual([["DELETE", id]]);
    // The upload carries the whole card, so the server keeps its schedule with the deletion.
    expect(JSON.parse(queued()[0].data)).toMatchObject({ id, deck_id: SMART_DECK_IDS.mutashabihat, reps: 3 });
    expect(logCount(id)).toBe(2);

    // The next launch finds nothing more to do.
    await refreshMutashabihatRows(store.db, async () => rowsFile);
    expect(queued()).toHaveLength(1);
  });

  it.each([RETIRED, EXCLUDED])("deletes %s on a pull and keeps it deleted across later pulls", async (id) => {
    putSetting(`sync_account_restore_${USER_ID}_20260614_account_restore_v1`, "true");
    putSetting(`sync_initial_backfill_${USER_ID}_20260525_sync_v1`, "true");
    putSetting(`sync_user_settings_backfill_${USER_ID}_20260528_user_settings_v1`, "true");
    putSetting(`sync_habit_backfill_${USER_ID}_20261113_habit_v1`, "true");
    putSetting("last_pull_at", OLD);

    // A device still on the old data uploads the card after this device's refresh.
    mockRows.set("study_cards:incremental", [remoteCard(id)]);
    mockRows.set("study_log:incremental", [remoteLog(id, "2026-01-20T08:00:00.000Z")]);
    await fullSync(store.db);
    const deletedAt = card(id)?.deleted_at as string;
    expect(deletedAt).toEqual(expect.any(String));
    expect(queued().map((entry) => [entry.operation, entry.row_id])).toEqual([["DELETE", id]]);
    expect(logCount(id)).toBe(1);

    // Reviewed there again after this device deleted it, it comes down live and newer. A pull never
    // makes a deleted card live again, so it stays deleted and there is nothing more to upload.
    const reviewedAgain = minutesAfter(deletedAt, 1);
    mockRows.set("study_cards:incremental", [
      remoteCard(id, { updated_at: reviewedAgain, last_review: reviewedAgain, reps: 4, synced_at: reviewedAgain }),
    ]);
    await fullSync(store.db);
    expect(card(id)?.deleted_at).toBe(deletedAt);
    expect(queued()).toHaveLength(1);

    // The server's copy of the deletion comes back down: nothing more is queued either.
    const echoed = minutesAfter(reviewedAgain, 1);
    mockRows.set("study_cards:incremental", [
      remoteCard(id, { updated_at: echoed, deleted_at: echoed, synced_at: echoed }),
    ]);
    await fullSync(store.db);
    expect(card(id)?.deleted_at).toEqual(expect.any(String));
    expect(queued()).toHaveLength(1);
  });

  it("catches a live excluded card on launch when the rows are current and no retired slot is live", async () => {
    const row = remoteCard(EXCLUDED);
    const columns = Object.keys(row);
    store.sql
      .prepare(`INSERT INTO study_cards (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...Object.values(row));
    const load = jest.fn(async () => rowsFile);

    await expect(refreshMutashabihatRows(store.db, load)).resolves.toEqual({
      replaced: false,
      retiredCards: [EXCLUDED],
    });
    expect(load).not.toHaveBeenCalled();
    expect(card(EXCLUDED)?.deleted_at).toEqual(expect.any(String));
    expect(queued().map((entry) => [entry.operation, entry.row_id])).toEqual([["DELETE", EXCLUDED]]);
  });

  it("leaves every live card alone, on kept and relabelled slots and in other decks", async () => {
    mockRows.set("study_cards:restore", [
      remoteCard(KEPT),
      remoteCard(RELABELLED),
      remoteCard("2:255"),
      remoteCard(`similar-tail:${GROUP}:1`),
    ]);
    await fullSync(store.db);
    for (const id of [KEPT, RELABELLED, "2:255", `similar-tail:${GROUP}:1`]) {
      expect(card(id)).toMatchObject({ deleted_at: null, reps: 3, updated_at: NEW });
    }
    expect(queued()).toEqual([]);
  });
});
