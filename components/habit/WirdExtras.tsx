import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { BookText, Check, ChevronLeft, ChevronRight, HandHeart, Moon, PenLine, X as XIcon } from "lucide-react-native";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { AppDatabase } from "@/lib/database/types";
import { localDateOf } from "@/lib/habit/dates";
import {
  chooseExtras,
  completeExtra,
  EXTRAS_STATE_KEY,
  hideExtra,
  parseExtrasState,
  readExtrasDoneToday,
  type ExtraKind,
  type ExtrasState,
} from "@/lib/habit/extras";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { putUserSetting } from "@/lib/database/user-settings";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = {
  db: AppDatabase;
  inboxCount: number;
  hasMemorizedPages: boolean;
  sabaqToday: boolean;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  /** Opens the mistake drill, where "strengthen" is done. */
  onStrengthen: () => void;
  /** Opens the wird review, where a listener can follow along ("connect"). */
  onConnect: () => void;
};

const ICONS: Record<ExtraKind, typeof BookText> = { strengthen: PenLine, connect: HandHeart, salah: Moon, deepen: BookText };

function label(kind: ExtraKind, s: UIStrings): string {
  switch (kind) {
    case "strengthen":
      return s.habitExtraStrengthen;
    case "connect":
      return s.habitExtraConnect;
    case "salah":
      return s.habitExtraSalah;
    case "deepen":
      return s.habitExtraDeepen;
  }
}

/**
 * Up to 2 optional extras under the wird (5.4), each hidden with one tap, done marked quietly. An extra
 * the app can start (strengthen, connect) opens it; one done away from the app (salah) or already done
 * reads as a plain note, so nothing looks tappable that is not.
 */
export function WirdExtras({ db, inboxCount, hasMemorizedPages, sabaqToday, language, isDark, s, onStrengthen, onConnect }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const accentText = isDark ? "#2dd4bf" : "#0f766e";
  const muted = isDark ? "#a3a3a3" : "#8B8178";
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;
  const openers: Partial<Record<ExtraKind, () => void>> = { strengthen: onStrengthen, connect: onConnect };
  const [state, setState] = useState<ExtrasState | null>(null);
  const [doneToday, setDoneToday] = useState<Set<ExtraKind>>(new Set());

  const load = useCallback(async () => {
    const today = localDateOf(new Date());
    const [row, done] = await Promise.all([
      db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [EXTRAS_STATE_KEY]),
      readExtrasDoneToday(db, today),
    ]);
    setState(parseExtrasState(row?.value, today));
    setDoneToday(done);
  }, [db]);

  useEffect(() => {
    load().catch((error) => console.warn("[Extras] Failed to load:", error));
    return subscribeReviewActivity(() => {
      load().catch(console.warn);
    });
  }, [load]);

  const save = useCallback(
    (next: ExtrasState) => {
      setState(next);
      putUserSetting(db, EXTRAS_STATE_KEY, JSON.stringify(next)).catch((error) => console.warn("[Extras] Failed to save:", error));
    },
    [db],
  );

  if (!state) return null;
  const today = state.date;
  const kinds = chooseExtras(state, { today, inboxCount, hasMemorizedPages, sabaqToday, doneToday });
  if (kinds.length === 0) return null;

  return (
    <View className="mb-6" style={{ gap: 8 }}>
      <Text dir={dir} variant="label-md">
        {s.habitExtrasTitle}
      </Text>
      {kinds.map((kind) => {
        const Icon = ICONS[kind];
        const done = doneToday.has(kind) || state.done.includes(kind);
        const open = done ? undefined : openers[kind];
        const markable = !done && kind === "deepen";
        const hide = done ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.habitExtraHide}
            onPress={() => save(hideExtra(state, kind))}
            className="w-11 h-11 items-center justify-center"
          >
            <XIcon size={14} color={muted} />
          </Pressable>
        );
        const text = (
          <Text
            dir={dir}
            className={`flex-1 ${open || markable ? "text-charcoal dark:text-neutral-200" : "text-warm-600 dark:text-neutral-400"}`}
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 18 }}
          >
            {done ? s.habitExtraDone : label(kind, s)}
          </Text>
        );

        // The icon sits in a slot as wide as the hide button, so both ends of a row line up.
        const leading = (color: string, IconNode: typeof BookText) => (
          <View className="w-11 items-center">
            <IconNode size={16} color={color} />
          </View>
        );

        if (open) {
          return (
            <MirroredRow key={kind} dir={dir} className="min-h-[48px] items-center rounded-2xl bg-surface-low dark:bg-surface-dark-low px-1">
              <Pressable accessibilityRole="button" onPress={open} className="flex-1 min-h-[48px] justify-center py-2">
                <MirroredRow dir={dir} className="items-center gap-2">
                  {leading(accent, Icon)}
                  {text}
                  <Chevron size={16} color={muted} />
                </MirroredRow>
              </Pressable>
              {hide}
            </MirroredRow>
          );
        }

        if (markable) {
          return (
            <MirroredRow key={kind} dir={dir} className="min-h-[48px] items-center gap-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-1 py-1">
              {leading(accent, Icon)}
              {text}
              <Pressable accessibilityRole="button" onPress={() => save(completeExtra(state, kind))} className="min-h-[44px] justify-center px-2">
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: accentText }}>{s.habitExtraMarkDone}</Text>
              </Pressable>
              {hide}
            </MirroredRow>
          );
        }

        // A note: nothing to start here, so no fill and a quiet icon.
        return (
          <MirroredRow key={kind} dir={dir} className="min-h-[44px] items-center gap-2 px-1">
            {done ? leading(accent, Check) : leading(muted, Icon)}
            {text}
            {hide}
          </MirroredRow>
        );
      })}
    </View>
  );
}
