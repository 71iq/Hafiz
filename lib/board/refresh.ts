import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys, refreshBoardBandsRemote, type BoardInputs } from "@/lib/board/api";
import { useDatabase } from "@/lib/database/provider";
import { hasCompletedAccountRestore } from "@/lib/database/sync";
import type { AppDatabase } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { localDateOf } from "@/lib/habit/dates";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { captureSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";
import { subscribeSyncCompleted } from "@/lib/sync/events";

const SENT_PREFIX = "device_board_bands_sent:";
export const BOARD_ACTIVITY_SETTLE_MS = 30_000;

export function boardBandsSentKey(userId: string): string {
  return `${SENT_PREFIX}${userId}`;
}

const sentSchema = z.object({ date: z.string(), inputs: z.string().nullable(), joined: z.boolean().optional() });
type SentRecord = z.infer<typeof sentSchema>;

function inputsKey(inputs: BoardInputs): string {
  return JSON.stringify([inputs.bands.levelBand, inputs.bands.paceBand, inputs.bands.utcOffsetMinutes, inputs.weekStart]);
}

function parseSent(value: string | undefined): SentRecord | null {
  if (!value) return null;
  try {
    const parsed = sentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const noted = new Map<string, Readonly<{ date: string; joined: boolean }>>();

export function noteBoardMembership(userId: string, joined: boolean, now: Date = new Date()): boolean {
  const date = localDateOf(now);
  const previous = noted.get(userId);
  noted.set(userId, { date, joined });
  return joined && !(previous?.date === date && previous.joined);
}

function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

export function membershipFromQuery(queryKey: QueryKey, data: unknown, userId: string): boolean | null {
  if (!data || typeof data !== "object") return null;
  if (startsWith(queryKey, profilePrivacyKeys.mine(userId))) {
    const joined = (data as { boardJoined?: unknown }).boardJoined;
    return typeof joined === "boolean" ? joined : null;
  }
  if (startsWith(queryKey, boardKeys.all(userId))) {
    const snapshot = data as { source?: unknown; data?: { status?: unknown } };
    if (snapshot.source !== "network") return null;
    const status = snapshot.data?.status;
    return status === "not_joined" ? false : status === "gathering" || status === "ready" ? true : null;
  }
  return null;
}

function knownMembership(userId: string, today: string, sent: SentRecord | null): boolean | null {
  const note = noted.get(userId);
  if (note?.date === today) return note.joined;
  return sent?.date === today && sent.joined !== undefined ? sent.joined : null;
}

async function readMembership(owner: SocialOwner): Promise<boolean | null> {
  try {
    return (await fetchProfilePrivacy(owner)).boardJoined;
  } catch {
    return null;
  }
}

export type BoardBandsRefresh =
  | { status: "skipped" }
  | { status: "restoring" }
  | { status: "off_board" }
  | { status: "unchanged" }
  | { status: "sent" };

async function runRefresh(db: AppDatabase, userId: string, language: "en" | "ar", now: Date): Promise<BoardBandsRefresh> {
  const owner = captureSocialOwner(userId);
  if (!owner) return { status: "skipped" };
  const restored = await hasCompletedAccountRestore(db, userId);
  if (!owner.isCurrent()) return { status: "skipped" };
  if (!restored) return { status: "restoring" };
  const key = boardBandsSentKey(userId);
  const stored = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]);
  if (!owner.isCurrent()) return { status: "skipped" };
  const today = localDateOf(now);
  const sent = parseSent(stored?.value);
  let joined = knownMembership(userId, today, sent);
  if (joined === null) {
    joined = await readMembership(owner);
    if (!owner.isCurrent()) return { status: "skipped" };
  }
  if (joined === false) {
    if (sent?.date !== today || sent.joined !== false) {
      await putUserSetting(db, key, JSON.stringify({ date: today, inputs: sent?.inputs ?? null, joined: false }));
    }
    return { status: "off_board" };
  }
  const inputs = await readLocalBoardInputs(db, language, now);
  if (!owner.isCurrent()) return { status: "skipped" };
  const current = inputsKey(inputs);
  if (sent?.date === today && sent.inputs === current && sent.joined === true) return { status: "unchanged" };
  await refreshBoardBandsRemote(inputs, today, owner);
  if (!owner.isCurrent()) return { status: "skipped" };
  await putUserSetting(db, key, JSON.stringify({ date: today, inputs: current, joined: true }));
  return { status: "sent" };
}

type Request = Readonly<{ db: AppDatabase; language: "en" | "ar"; now: Date | undefined }>;
type Flight = { again: Request | null; readonly done: Promise<BoardBandsRefresh> };

const flights = new Map<string, Flight>();

async function drain(userId: string, first: Request, takeAgain: () => Request | null): Promise<BoardBandsRefresh> {
  try {
    let next: Request | null = first;
    let result: BoardBandsRefresh = { status: "skipped" };
    while (next) {
      const request: Request = next;
      try {
        result = await runRefresh(request.db, userId, request.language, request.now ?? new Date());
        next = takeAgain();
      } catch (error) {
        next = takeAgain();
        if (!next) throw error;
      }
    }
    return result;
  } finally {
    flights.delete(userId);
  }
}

export function refreshBoardBands(
  db: AppDatabase,
  userId: string | null,
  language: "en" | "ar",
  now?: Date,
): Promise<BoardBandsRefresh> {
  if (!userId || !isSupabaseConfigured()) return Promise.resolve({ status: "skipped" });
  const request: Request = { db, language, now };
  const existing = flights.get(userId);
  if (existing) {
    existing.again = request;
    return existing.done;
  }
  let flight: Flight | null = null;
  const takeAgain = () => {
    const next = flight?.again ?? null;
    if (flight) flight.again = null;
    return next;
  };
  flight = { again: null, done: drain(userId, request, takeAgain) };
  flights.set(userId, flight);
  return flight.done;
}

export function useBoardBandRefresh(): void {
  const db = useDatabase();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { uiLanguage } = useSettings();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      if (!active) return;
      refreshBoardBands(db, userId, uiLanguage).catch((error: unknown) => {
        const kind = socialFailureOf(error).kind;
        if (kind !== "offline" && kind !== "account_changed" && kind !== "unconfigured") {
          console.warn("[Board] Band refresh failed:", error);
        }
      });
    };
    const settleThenRun = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(run, BOARD_ACTIVITY_SETTLE_MS);
    };
    run();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    const unsubscribeSync = subscribeSyncCompleted((summary) => {
      if (active && (summary.pulled > 0 || summary.restoreCompleted || summary.accountRestored))
        void queryClient.invalidateQueries({ queryKey: ["boardInputs", userId] });
      if (summary.restoreCompleted || summary.accountRestored) run();
      else settleThenRun();
    });
    const unsubscribeHabit = subscribeHabitChanged(settleThenRun);
    const unsubscribeReview = subscribeReviewActivity(settleThenRun);
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const joined = membershipFromQuery(event.query.queryKey, event.query.state.data, userId);
      if (joined !== null && noteBoardMembership(userId, joined)) settleThenRun();
    });
    return () => {
      active = false;
      if (settleTimer) clearTimeout(settleTimer);
      appState.remove();
      unsubscribeSync();
      unsubscribeHabit();
      unsubscribeReview();
      unsubscribeQueries();
    };
  }, [db, userId, uiLanguage, queryClient]);
}
