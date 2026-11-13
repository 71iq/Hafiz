import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { BookText, Check, HandHeart, Moon, PenLine, X as XIcon } from "lucide-react-native";
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

/** Up to 2 optional extras under the wird (5.4), each hidden with one tap, done marked quietly. */
export function WirdExtras({ db, inboxCount, hasMemorizedPages, sabaqToday, language, isDark, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#8B8178";
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
        return (
          <MirroredRow key={kind} dir={dir} className="min-h-[48px] items-center gap-3 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-2">
            {done ? <Check size={16} color={accent} /> : <Icon size={16} color={accent} />}
            <Text dir={dir} className="flex-1 text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 18 }}>
              {done ? s.habitExtraDone : label(kind, s)}
            </Text>
            {!done && kind === "deepen" ? (
              <Pressable accessibilityRole="button" onPress={() => save(completeExtra(state, kind))} hitSlop={8} className="min-h-[36px] justify-center px-2">
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: accent }}>{s.habitExtraMarkDone}</Text>
              </Pressable>
            ) : null}
            {!done ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.habitExtraHide}
                onPress={() => save(hideExtra(state, kind))}
                hitSlop={10}
                className="w-8 h-8 items-center justify-center"
              >
                <XIcon size={14} color={muted} />
              </Pressable>
            ) : null}
          </MirroredRow>
        );
      })}
    </View>
  );
}
