import { useEffect } from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { useSettings } from "@/lib/settings/context";
import { socialFailureOf } from "@/lib/social/remote";
import { refreshBoardBandsRemote, type BoardInputs } from "@/lib/board/api";
import type { AppDatabase } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { localDateOf } from "@/lib/habit/dates";
import { captureSocialOwner } from "@/lib/social/owner";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * 8.13: keeps the bands the server holds for the weekly board pass current, so a joined user who has
 * not opened the Board tab is placed from their current level, pace and zone. Sends when the bands or
 * the week start changed, and otherwise at most once a day. The server ignores users off the board.
 *
 * The device keeps what it last sent per account under a "device_" key, which is off the sync
 * allowlist (lib/database/user-settings.ts).
 */
const SENT_PREFIX = "device_board_bands_sent:";

export function boardBandsSentKey(userId: string): string {
  return `${SENT_PREFIX}${userId}`;
}

const sentSchema = z.object({ date: z.string(), inputs: z.string() });

function inputsKey(inputs: BoardInputs): string {
  return JSON.stringify([inputs.bands.levelBand, inputs.bands.paceBand, inputs.bands.utcOffsetMinutes, inputs.weekStart]);
}

function parseSent(value: string | undefined): z.infer<typeof sentSchema> | null {
  if (!value) return null;
  try {
    const parsed = sentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type BoardBandsRefresh =
  /** Signed out, no account service, or the account changed. */
  | { status: "skipped" }
  /** Same bands, already sent today. */
  | { status: "unchanged" }
  | { status: "sent" };

async function runRefresh(db: AppDatabase, userId: string, language: "en" | "ar", now: Date): Promise<BoardBandsRefresh> {
  const owner = captureSocialOwner(userId);
  if (!owner) return { status: "skipped" };
  const key = boardBandsSentKey(userId);
  const [inputs, stored] = await Promise.all([
    readLocalBoardInputs(db, language, now),
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]),
  ]);
  if (!owner.isCurrent()) return { status: "skipped" };
  const today = localDateOf(now);
  const sent = parseSent(stored?.value);
  const current = inputsKey(inputs);
  if (sent?.date === today && sent.inputs === current) return { status: "unchanged" };
  await refreshBoardBandsRemote(inputs, today, owner);
  if (!owner.isCurrent()) return { status: "skipped" };
  await putUserSetting(db, key, JSON.stringify({ date: today, inputs: current }));
  return { status: "sent" };
}

const running = new Map<string, Promise<BoardBandsRefresh>>();

/**
 * Reports this device's board bands for the signed-in account when they changed, or once a day.
 * Safe to call on every foreground and after plan or progress changes; calls for one account while a
 * report is in flight share it.
 */
export function refreshBoardBands(
  db: AppDatabase,
  userId: string | null,
  language: "en" | "ar",
  now: Date = new Date(),
): Promise<BoardBandsRefresh> {
  if (!userId || !isSupabaseConfigured()) return Promise.resolve({ status: "skipped" });
  const current = running.get(userId);
  if (current) return current;
  const refresh = runRefresh(db, userId, language, now).finally(() => running.delete(userId));
  running.set(userId, refresh);
  return refresh;
}

/**
 * Keeps the server's board bands current for the signed-in account: on start, on return to the
 * foreground, and after plan or progress changes. refreshBoardBands sends only when something changed
 * or once a day, so frequent calls are cheap.
 */
export function useBoardBandRefresh(): void {
  const db = useDatabase();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { uiLanguage } = useSettings();
  useEffect(() => {
    if (!userId) return;
    const run = () => {
      refreshBoardBands(db, userId, uiLanguage).catch((error: unknown) => {
        const kind = socialFailureOf(error).kind;
        if (kind !== "offline" && kind !== "account_changed" && kind !== "unconfigured") {
          console.warn("[Board] Band refresh failed:", error);
        }
      });
    };
    run();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    const unsubscribeHabit = subscribeHabitChanged(run);
    const unsubscribeReview = subscribeReviewActivity(run);
    return () => {
      appState.remove();
      unsubscribeHabit();
      unsubscribeReview();
    };
  }, [db, userId, uiLanguage]);
}
