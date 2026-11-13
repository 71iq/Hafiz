import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { X as XIcon } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { formatShortDate } from "@/components/habit/WirdStreakCard";
import type { AppDatabase } from "@/lib/database/types";
import { addDays, localDateOf } from "@/lib/habit/dates";
import {
  clearExcusedDay,
  EXCUSE_DAYS_AHEAD,
  EXCUSE_DAYS_BACK,
  endHabitPause,
  markExcusedDays,
  readExcusedDays,
  setHabitPause,
  type ExcusedDay,
} from "@/lib/habit/queries";
import type { HabitPause } from "@/lib/habit/types";
import { EXCUSE_REASONS, type ExcuseReason } from "@/lib/habit/types";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { formatDays } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = {
  open: boolean;
  onClose: () => void;
  db: AppDatabase;
  pause: HabitPause | null;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
};

type Tab = "excuse" | "pause";

const START_OFFSETS = [-3, -2, -1, 0, 1] as const;
const LENGTHS = [1, 2, 3, 5, 7, 14] as const;
const PAUSE_LENGTHS = [7, 14, 30, 60] as const;

function reasonLabel(reason: ExcuseReason, s: UIStrings): string {
  switch (reason) {
    case "illness":
      return s.habitExcuseIllness;
    case "travel":
      return s.habitExcuseTravel;
    case "menstruation":
      return s.habitExcuseMenstruation;
    case "other":
      return s.habitExcuseOther;
  }
}

function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      className={`min-h-[44px] justify-center rounded-full px-3.5 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
    >
      <Text
        className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Excused days and pause (STR-11 to STR-13). Both are free, private and easy to undo. Excused days
 * can be marked 3 days back to 30 ahead; a pause lasts up to 60 days.
 */
export function HabitBreakSheet({ open, onClose, db, pause, language, isDark, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [tab, setTab] = useState<Tab>("excuse");
  const [reason, setReason] = useState<ExcuseReason>("illness");
  const [startOffset, setStartOffset] = useState<number>(0);
  const [length, setLength] = useState<number>(1);
  const [pauseLength, setPauseLength] = useState<number>(7);
  const [marked, setMarked] = useState<ExcusedDay[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = localDateOf(new Date());

  const loadMarked = useCallback(async () => {
    const now = localDateOf(new Date());
    setMarked(await readExcusedDays(db, addDays(now, -EXCUSE_DAYS_BACK), addDays(now, EXCUSE_DAYS_AHEAD)));
  }, [db]);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    loadMarked().catch((error) => console.warn("[Habit] Could not load excused days:", error));
  }, [loadMarked, open]);

  const from = addDays(today, startOffset);
  const to = useMemo(() => {
    const end = addDays(from, length - 1);
    const limit = addDays(today, EXCUSE_DAYS_AHEAD);
    return end > limit ? limit : end;
  }, [from, length, today]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setMessage(null);
      try {
        await work();
        emitHabitChanged();
        await loadMarked();
        setMessage(s.habitBreakSaved);
      } catch (error) {
        console.warn("[Habit] Break change failed:", error);
        setMessage(s.habitBreakFailed);
      } finally {
        setBusy(false);
      }
    },
    [loadMarked, s.habitBreakFailed, s.habitBreakSaved],
  );

  const startLabel = (offset: number) => {
    if (offset === -1) return s.habitExcuseYesterday;
    if (offset === 0) return s.habitExcuseToday;
    if (offset === 1) return s.habitExcuseTomorrow;
    return formatShortDate(addDays(today, offset), language);
  };

  const pauseActive = pause !== null && pause.end >= today;

  return (
    <ResponsiveSheet open={open} onClose={onClose} maxWidth={480} maxHeight={720}>
      <OverlayHeader title={s.habitBreakTitle} subtitle={s.habitBreakSubtitle} onClose={onClose} isRTL={dir === "rtl"} showHandle />
      <OverlayBody contentContainerClassName="px-5 py-4" contentContainerStyle={{ gap: 16 }}>
        <ToggleGroup<Tab>
          value={tab}
          onValueChange={setTab}
          dir={dir}
          items={[
            { value: "excuse", label: s.habitBreakTabExcuse },
            { value: "pause", label: s.habitBreakTabPause },
          ]}
        />

        {tab === "excuse" ? (
          <View style={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              <Text dir={dir} variant="label-lg">
                {s.habitExcuseReason}
              </Text>
              <MirroredRow dir={dir} className="flex-wrap gap-2">
                {EXCUSE_REASONS.map((value) => (
                  <Chip key={value} label={reasonLabel(value, s)} selected={reason === value} onPress={() => setReason(value)} />
                ))}
              </MirroredRow>
              {reason === "menstruation" ? (
                <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
                  {s.habitMenstruationNote}
                </Text>
              ) : null}
              {reason === "illness" ? (
                <Text dir={dir} variant="caption">
                  {s.habitExcuseShifa}
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 8 }}>
              <Text dir={dir} variant="label-lg">
                {s.habitExcuseFrom}
              </Text>
              <MirroredRow dir={dir} className="flex-wrap gap-2">
                {START_OFFSETS.map((offset) => (
                  <Chip key={offset} label={startLabel(offset)} selected={startOffset === offset} onPress={() => setStartOffset(offset)} />
                ))}
              </MirroredRow>
            </View>

            <View style={{ gap: 8 }}>
              <Text dir={dir} variant="label-lg">
                {s.habitExcuseDays}
              </Text>
              <MirroredRow dir={dir} className="flex-wrap gap-2">
                {LENGTHS.map((days) => (
                  <Chip key={days} label={formatDays(days, language)} selected={length === days} onPress={() => setLength(days)} />
                ))}
              </MirroredRow>
            </View>

            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.habitExcuseHint}
            </Text>
            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.habitExcuseHadith}
            </Text>

            {marked.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text dir={dir} variant="label-lg">
                  {s.habitExcuseMarked}
                </Text>
                {marked.map((day) => (
                  <MirroredRow
                    key={day.localDate}
                    dir={dir}
                    className="items-center justify-between rounded-2xl bg-surface-low dark:bg-surface-dark-low px-3 min-h-[44px]"
                  >
                    <Text dir={dir} style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }} className="text-charcoal dark:text-neutral-200">
                      {`${formatShortDate(day.localDate, language)} · ${reasonLabel(day.reason, s)}`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={interpolate(s.habitExcuseRemoveLabel, { date: formatShortDate(day.localDate, language) })}
                      onPress={() => run(() => clearExcusedDay(db, { date: day.localDate }))}
                      disabled={busy}
                      className="w-11 h-11 items-center justify-center"
                    >
                      <XIcon size={15} color={isDark ? "#a3a3a3" : "#8B8178"} />
                    </Pressable>
                  </MirroredRow>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {pauseActive ? (
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }} className="text-charcoal dark:text-neutral-100">
                {interpolate(s.habitPauseActive, { date: formatShortDate(pause!.end, language) })}
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                <Text dir={dir} variant="label-lg">
                  {s.habitPauseLength}
                </Text>
                <MirroredRow dir={dir} className="flex-wrap gap-2">
                  {PAUSE_LENGTHS.map((days) => (
                    <Chip key={days} label={formatDays(days, language)} selected={pauseLength === days} onPress={() => setPauseLength(days)} />
                  ))}
                </MirroredRow>
              </View>
            )}
            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.habitPauseHint}
            </Text>
          </View>
        )}

        {message ? (
          <Text dir={dir} variant="caption" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={dir === "rtl"}>
        {tab === "excuse" ? (
          <Button
            className="flex-1"
            disabled={busy}
            onPress={() => run(() => markExcusedDays(db, { from, to, reason }))}
            label={s.habitExcuseSave}
          />
        ) : pauseActive ? (
          <Button
            className="flex-1 border border-warm-300 dark:border-neutral-700"
            variant="outline"
            disabled={busy}
            onPress={() => run(() => endHabitPause(db))}
            label={s.habitPauseEnd}
          />
        ) : (
          <Button
            className="flex-1"
            disabled={busy}
            onPress={() => run(() => setHabitPause(db, { start: today, end: addDays(today, pauseLength - 1) }))}
            label={s.habitPauseStart}
          />
        )}
      </OverlayFooter>
    </ResponsiveSheet>
  );
}
