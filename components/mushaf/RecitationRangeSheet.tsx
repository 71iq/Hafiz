import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { ChevronLeft, ChevronRight, ListMusic, Minus, Play, Plus, Repeat2, Square, Timer } from "lucide-react-native";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { ReciterPicker } from "@/components/settings/ReciterPicker";
import { useAyahAudio, type AyahAudioTarget, type RangeAudioState } from "@/lib/audio/ayah-audio";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatReciterLabel, getReciterById } from "@/lib/quran-foundation/recitations";
import { useSettings } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type RecitationMode = "single" | "range" | "surah";

type Props = {
  visible: boolean;
  onClose: () => void;
  currentAyah: AyahAudioTarget | null;
};

type AyahRow = {
  surah: number;
  ayah: number;
};

export function RecitationRangeSheet({ visible, onClose, currentAyah }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const { recitationId, setRecitationId, uiLanguage, isDark, isRTL } = useSettings();
  const { playRange, rangeState, stop } = useAyahAudio();
  const [mode, setMode] = useState<RecitationMode>("single");
  const [singleRef, setSingleRef] = useState("1:1");
  const [rangeStartRef, setRangeStartRef] = useState("1:1");
  const [rangeEndRef, setRangeEndRef] = useState("1:7");
  const [repeatRange, setRepeatRange] = useState(1);
  const [repeatEachAyah, setRepeatEachAyah] = useState(1);
  const [delaySeconds, setDelaySeconds] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const maxHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 760);
  const current = currentAyah ?? { surah: 1, ayah: 1 };
  const reciter = getReciterById(recitationId);
  const reciterLabel = formatReciterLabel(reciter, uiLanguage);

  useEffect(() => {
    if (!visible) return;
    const ref = `${current.surah}:${current.ayah}`;
    setSingleRef(ref);
    setRangeStartRef(ref);
    setRangeEndRef(ref);
    setError(null);
  }, [current.ayah, current.surah, visible]);

  const modeItems = useMemo(
    () => [
      { value: "single" as const, label: s.recitationModeSingle },
      { value: "range" as const, label: s.recitationModeRange },
      { value: "surah" as const, label: s.recitationModeSurah },
    ],
    [s.recitationModeRange, s.recitationModeSingle, s.recitationModeSurah]
  );

  const formatCount = useCallback(
    (value: number) => (isRTL ? toArabicNumber(value) : String(value)),
    [isRTL]
  );

  const resolveAyahs = useCallback(async (): Promise<AyahAudioTarget[]> => {
    if (mode === "surah") {
      return db.getAllAsync<AyahRow>(
        "SELECT surah, ayah FROM quran_text WHERE surah = ? ORDER BY ayah",
        [current.surah]
      );
    }

    const start = parseAyahReference(mode === "single" ? singleRef : rangeStartRef);
    if (!start) throw new Error(s.recitationInvalidReference);

    if (mode === "single") {
      const row = await db.getFirstAsync<AyahRow>(
        "SELECT surah, ayah FROM quran_text WHERE surah = ? AND ayah = ?",
        [start.surah, start.ayah]
      );
      if (!row) throw new Error(s.recitationInvalidReference);
      return [row];
    }

    const end = parseAyahReference(rangeEndRef);
    if (!end) throw new Error(s.recitationInvalidReference);
    const startKey = start.surah * 1000 + start.ayah;
    const endKey = end.surah * 1000 + end.ayah;
    if (endKey < startKey) throw new Error(s.recitationInvalidRange);

    return db.getAllAsync<AyahRow>(
      `SELECT surah, ayah
       FROM quran_text
       WHERE (surah * 1000 + ayah) >= ? AND (surah * 1000 + ayah) <= ?
       ORDER BY surah, ayah`,
      [startKey, endKey]
    );
  }, [current.surah, db, mode, rangeEndRef, rangeStartRef, s.recitationInvalidRange, s.recitationInvalidReference, singleRef]);

  const handleStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const ayahs = await resolveAyahs();
      if (ayahs.length === 0) throw new Error(s.recitationNoAyahs);
      const result = await playRange({
        ayahs,
        recitationId,
        repeatRange,
        repeatEachAyah,
        delayMs: delaySeconds * 1000,
      });
      if (!result.ok) {
        throw new Error(result.code === "not_configured" ? s.qfContentMisconfigured : s.qfContentUnavailable);
      }
    } catch (err: any) {
      setError(err?.message ?? s.qfContentUnavailable);
    } finally {
      setStarting(false);
    }
  }, [
    delaySeconds,
    playRange,
    recitationId,
    repeatEachAyah,
    repeatRange,
    resolveAyahs,
    s.qfContentMisconfigured,
    s.qfContentUnavailable,
    s.recitationNoAyahs,
    starting,
  ]);

  const handlePrimary = rangeState.active ? stop : handleStart;
  const primaryLabel = rangeState.active ? s.recitationStop : s.recitationStart;

  return (
    <>
      <ResponsiveSheet
        open={visible}
        onClose={onClose}
        dismissOnBackdrop
        maxWidth={620}
        maxHeight={maxHeight}
      >
        <OverlayHeader
          title={s.recitationSheetTitle}
          subtitle={s.recitationSheetSubtitle}
          isRTL={isRTL}
          onClose={onClose}
          showHandle={isPhone}
        />

      <OverlayBody contentContainerClassName="px-5 pt-4 pb-5">
        <Pressable
          onPress={() => setReciterPickerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={s.recitationReciterPickerTitle}
          className="rounded-3xl bg-surface-low dark:bg-surface-dark-low p-4"
          style={({ pressed }) => ({
            opacity: pressed ? 0.78 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
        >
          <View
            className="items-center gap-3"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <ListMusic size={19} color={isDark ? "#2dd4bf" : "#0d9488"} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
              >
                {s.recitationReciter}
              </Text>
              <Text
                className="mt-0.5 text-warm-500 dark:text-neutral-400"
                numberOfLines={2}
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 12,
                  lineHeight: 18,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {reciterLabel}
              </Text>
            </View>
            <View className="h-9 w-9 items-center justify-center rounded-full bg-surface dark:bg-surface-dark">
              <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
            </View>
          </View>
        </Pressable>

        <View className="mt-4">
          <ToggleGroup<RecitationMode>
            value={mode}
            onValueChange={(value) => {
              setMode(value);
              setError(null);
            }}
            items={modeItems}
          />
        </View>

        <View className="mt-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low p-4">
          {mode === "single" && (
            <LabeledInput
              label={s.recitationSingleReference}
              value={singleRef}
              onChangeText={setSingleRef}
              placeholder="1:4"
              isDark={isDark}
              isRTL={isRTL}
            />
          )}

          {mode === "range" && (
            <View className={isPhone ? "gap-3" : isRTL ? "flex-row-reverse gap-3" : "flex-row gap-3"}>
              <View className="flex-1">
                <LabeledInput
                  label={s.recitationStartReference}
                  value={rangeStartRef}
                  onChangeText={setRangeStartRef}
                  placeholder="1:1"
                  isDark={isDark}
                  isRTL={isRTL}
                />
              </View>
              <View className="flex-1">
                <LabeledInput
                  label={s.recitationEndReference}
                  value={rangeEndRef}
                  onChangeText={setRangeEndRef}
                  placeholder="1:7"
                  isDark={isDark}
                  isRTL={isRTL}
                />
              </View>
            </View>
          )}

          {mode === "surah" && (
            <View className={isRTL ? "items-end" : "items-start"}>
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
              >
                {s.recitationCurrentSurah}
              </Text>
              <Text
                className="mt-1 text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 18, textAlign: isRTL ? "right" : "left" }}
              >
                {formatCount(current.surah)}
              </Text>
            </View>
          )}
        </View>

        <View className="mt-4 gap-3">
          <LoopControl
            icon={<Repeat2 size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />}
            label={s.recitationRepeatRange}
            value={formatCount(repeatRange)}
            onDecrease={() => setRepeatRange((value) => Math.max(1, value - 1))}
            onIncrease={() => setRepeatRange((value) => Math.min(99, value + 1))}
            isDark={isDark}
            isRTL={isRTL}
          />
          <LoopControl
            icon={<Repeat2 size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />}
            label={s.recitationRepeatEachAyah}
            value={formatCount(repeatEachAyah)}
            onDecrease={() => setRepeatEachAyah((value) => Math.max(1, value - 1))}
            onIncrease={() => setRepeatEachAyah((value) => Math.min(99, value + 1))}
            isDark={isDark}
            isRTL={isRTL}
          />
          <LoopControl
            icon={<Timer size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />}
            label={s.recitationDelayBetweenAyahs}
            value={`${formatCount(delaySeconds)}${isRTL ? "ث" : "s"}`}
            onDecrease={() => setDelaySeconds((value) => Math.max(0, value - 1))}
            onIncrease={() => setDelaySeconds((value) => Math.min(30, value + 1))}
            isDark={isDark}
            isRTL={isRTL}
          />
        </View>

        {rangeState.active && (
          <View className="mt-4 rounded-3xl bg-primary-accent/10 dark:bg-primary-bright/10 p-4">
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
            >
              {s.recitationPlaying}
            </Text>
            <Text
              className="mt-1 text-warm-700 dark:text-neutral-300"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
            >
              {formatPlaybackLine(rangeState, formatCount)}
            </Text>
          </View>
        )}

        {!!error && (
          <Text
            className="mt-4 text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {error}
          </Text>
        )}
      </OverlayBody>

      <OverlayFooter isRTL={isRTL}>
        <Pressable
          onPress={handlePrimary}
          disabled={starting}
          className={`h-12 flex-1 items-center justify-center rounded-full ${rangeState.active ? "bg-surface-high dark:bg-surface-dark-high" : "bg-primary-accent"}`}
          style={({ pressed }) => ({
            opacity: starting ? 0.55 : pressed ? 0.82 : 1,
            transform: [{ scale: pressed && !starting ? 0.98 : 1 }],
          })}
        >
          <View className={isRTL ? "flex-row-reverse items-center gap-2" : "flex-row items-center gap-2"}>
            {starting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : rangeState.active ? (
              <Square size={16} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            ) : (
              <Play size={16} color="#FFFFFF" />
            )}
            <Text
              className={rangeState.active ? "text-charcoal dark:text-neutral-100" : "text-white"}
              style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}
            >
              {primaryLabel}
            </Text>
          </View>
        </Pressable>
      </OverlayFooter>
      </ResponsiveSheet>
      <ReciterPicker
        visible={reciterPickerVisible}
        selectedId={recitationId}
        onSelect={setRecitationId}
        onClose={() => setReciterPickerVisible(false)}
      />
    </>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  isDark,
  isRTL,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#b9a085"}
        keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
        autoCapitalize="none"
        autoCorrect={false}
        className="h-12 rounded-2xl bg-surface dark:bg-surface-dark px-4 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 16,
          textAlign: isRTL ? "right" : "left",
          writingDirection: "ltr",
        }}
      />
    </View>
  );
}

function LoopControl({
  icon,
  label,
  value,
  onDecrease,
  onIncrease,
  isDark,
  isRTL,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  return (
    <View className="rounded-3xl bg-surface-low dark:bg-surface-dark-low p-3">
      <View
        className="items-center gap-3"
        style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
          {icon}
        </View>
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
        >
          {label}
        </Text>
        <View
          className="items-center rounded-full bg-surface p-1 dark:bg-surface-dark"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <Pressable onPress={onDecrease} className="h-8 w-8 items-center justify-center rounded-full">
            <Minus size={15} color={iconColor} />
          </Pressable>
          <View className="min-w-12 items-center justify-center px-2">
            <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
              {value}
            </Text>
          </View>
          <Pressable onPress={onIncrease} className="h-8 w-8 items-center justify-center rounded-full">
            <Plus size={15} color={iconColor} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function parseAyahReference(value: string): AyahAudioTarget | null {
  const match = value.trim().match(/^(\d{1,3})\s*[:/.-]\s*(\d{1,3})$/);
  if (!match) return null;
  const surah = Number(match[1]);
  const ayah = Number(match[2]);
  if (!Number.isInteger(surah) || !Number.isInteger(ayah) || surah < 1 || ayah < 1) return null;
  return { surah, ayah };
}

function formatPlaybackLine(rangeState: RangeAudioState, formatCount: (value: number) => string): string {
  const current = rangeState.currentAyah
    ? `${formatCount(rangeState.currentAyah.surah)}:${formatCount(rangeState.currentAyah.ayah)}`
    : "";
  return `${current} • ${formatCount(rangeState.currentIndex + 1)}/${formatCount(rangeState.totalAyahs)} • ${formatCount(rangeState.repeatRangeIndex)}/${formatCount(rangeState.repeatRange)}`;
}
