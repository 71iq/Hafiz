import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { ChevronLeft, ChevronRight, ListMusic, LocateFixed, Minus, Play, Plus, Repeat2, Square, Timer } from "lucide-react-native";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { ReciterPicker } from "@/components/settings/ReciterPicker";
import { useAyahAudio, type AyahAudioTarget, type RangeAudioState } from "@/lib/audio/ayah-audio";
import { audioFailureMessage } from "@/lib/audio/labels";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { formatReciterLabel, getReciterById } from "@/lib/quran-foundation/recitations";
import { parseReference } from "@/lib/search/reference";
import {
  AUDIO_DELAY_MAX_SECONDS,
  AUDIO_DELAY_MIN_SECONDS,
  AUDIO_REPEAT_MAX,
  AUDIO_REPEAT_MIN,
  useSettings,
} from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";

type RecitationMode = "single" | "range" | "surah";
type FieldKey = "single" | "start" | "end";
type FieldErrors = Partial<Record<FieldKey | "general", string>>;

type Props = {
  visible: boolean;
  onClose: () => void;
  currentAyah: AyahAudioTarget | null;
};

type AyahRow = {
  surah: number;
  ayah: number;
};

/** A field-specific validation failure, so its message sits under the field that caused it. */
class FieldError extends Error {
  constructor(
    readonly field: FieldKey | "general",
    message: string
  ) {
    super(message);
  }
}

export function RecitationRangeSheet({ visible, onClose, currentAyah }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const {
    recitationId,
    setRecitationId,
    uiLanguage,
    isDark,
    isRTL,
    audioFollow,
    setAudioFollow,
    audioRepeatRange,
    setAudioRepeatRange,
    audioRepeatEach,
    setAudioRepeatEach,
    audioDelaySeconds,
    setAudioDelaySeconds,
  } = useSettings();
  const { playRange, rangeState, stop } = useAyahAudio();
  const [mode, setMode] = useState<RecitationMode>("single");
  const [singleRef, setSingleRef] = useState("1:1");
  const [rangeStartRef, setRangeStartRef] = useState("1:1");
  const [rangeEndRef, setRangeEndRef] = useState("1:7");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [starting, setStarting] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);
  const [surahName, setSurahName] = useState<{ surah: number; en: string; ar: string } | null>(null);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const maxHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 760);
  const current = currentAyah ?? { surah: 1, ayah: 1 };
  const reciter = getReciterById(recitationId);
  const reciterLabel = formatReciterLabel(reciter, uiLanguage);
  const accent = isDark ? "#2dd4bf" : "#0d9488";

  useEffect(() => {
    if (!visible) return;
    const ref = `${current.surah}:${current.ayah}`;
    setSingleRef(ref);
    setRangeStartRef(ref);
    setRangeEndRef(ref);
    setErrors({});
  }, [current.ayah, current.surah, visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    db.getFirstAsync<{ name_english: string; name_arabic: string }>(
      "SELECT name_english, name_arabic FROM surahs WHERE number = ?",
      [current.surah]
    )
      .then((row) => {
        if (active && row) setSurahName({ surah: current.surah, en: row.name_english, ar: row.name_arabic });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [current.surah, db, visible]);

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

  const surahLabel =
    surahName?.surah === current.surah
      ? interpolate(s.recitationSurahLabel, {
          name: uiLanguage === "ar" ? surahName.ar : surahName.en,
          number: formatCount(current.surah),
        })
      : formatCount(current.surah);

  const resolveAyahs = useCallback(async (): Promise<AyahAudioTarget[]> => {
    if (mode === "surah") {
      return db.getAllAsync<AyahRow>(
        "SELECT surah, ayah FROM quran_text WHERE surah = ? ORDER BY ayah",
        [current.surah]
      );
    }

    const startField: FieldKey = mode === "single" ? "single" : "start";
    const start = parseAyahReference(mode === "single" ? singleRef : rangeStartRef);
    if (!start) throw new FieldError(startField, s.recitationInvalidReference);

    if (mode === "single") {
      const row = await db.getFirstAsync<AyahRow>(
        "SELECT surah, ayah FROM quran_text WHERE surah = ? AND ayah = ?",
        [start.surah, start.ayah]
      );
      if (!row) throw new FieldError("single", s.recitationInvalidReference);
      return [row];
    }

    const end = parseAyahReference(rangeEndRef);
    if (!end) throw new FieldError("end", s.recitationInvalidReference);
    const startKey = start.surah * 1000 + start.ayah;
    const endKey = end.surah * 1000 + end.ayah;
    if (endKey < startKey) throw new FieldError("end", s.recitationInvalidRange);

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
    setErrors({});
    try {
      const ayahs = await resolveAyahs();
      if (ayahs.length === 0) throw new FieldError("general", s.recitationNoAyahs);
      const result = await playRange({
        ayahs,
        recitationId,
        repeatRange: audioRepeatRange,
        repeatEachAyah: audioRepeatEach,
        delayMs: audioDelaySeconds * 1000,
      });
      if (!result.ok) {
        throw new FieldError(
          "general",
          result.failure && result.failure !== "busy" ? audioFailureMessage(result.failure, s) : s.audioPlaybackFailed
        );
      }
      // The reader and its player bar take over once a valid recitation starts.
      onClose();
    } catch (err) {
      const field = err instanceof FieldError ? err.field : "general";
      const message = err instanceof FieldError ? err.message : s.audioPlaybackFailed;
      setErrors({ [field]: message });
    } finally {
      setStarting(false);
    }
  }, [audioDelaySeconds, audioRepeatEach, audioRepeatRange, onClose, playRange, recitationId, resolveAyahs, s, starting]);

  const handlePrimary = rangeState.active ? stop : handleStart;
  const primaryLabel = rangeState.active ? s.recitationStop : s.recitationStart;
  const clearFieldError = (field: FieldKey) =>
    setErrors((prev) => (prev[field] || prev.general ? { ...prev, [field]: undefined, general: undefined } : prev));

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
        <DisclosureRow
          onPress={() => setReciterPickerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={s.recitationReciterPickerTitle}
          className="rounded-3xl bg-surface-low dark:bg-surface-dark-low p-4"
          dir={isRTL ? "rtl" : "ltr"}
          style={({ pressed }) => ({
            opacity: pressed ? 0.78 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
          leading={
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <ListMusic size={19} color={accent} />
            </View>
          }
          trailing={
            <View className="h-9 w-9 items-center justify-center rounded-full bg-surface dark:bg-surface-dark">
              <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
            </View>
          }
        >
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 14, ...textStartStyle(isRTL)}}
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
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {reciterLabel}
          </Text>
        </DisclosureRow>

        <View className="mt-4">
          <ToggleGroup<RecitationMode>
            value={mode}
            onValueChange={(value) => {
              setMode(value);
              setErrors({});
            }}
            items={modeItems}
          />
        </View>

        <View className="mt-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low p-4">
          {mode === "single" && (
            <LabeledInput
              label={s.recitationSingleReference}
              value={singleRef}
              onChangeText={(value) => {
                setSingleRef(value);
                clearFieldError("single");
              }}
              placeholder="1:4"
              error={errors.single}
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
                  onChangeText={(value) => {
                    setRangeStartRef(value);
                    clearFieldError("start");
                  }}
                  placeholder="1:1"
                  error={errors.start}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              </View>
              <View className="flex-1">
                <LabeledInput
                  label={s.recitationEndReference}
                  value={rangeEndRef}
                  onChangeText={(value) => {
                    setRangeEndRef(value);
                    clearFieldError("end");
                  }}
                  placeholder="1:7"
                  error={errors.end}
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
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL)}}
              >
                {s.recitationCurrentSurah}
              </Text>
              <Text
                className="mt-1 text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 18, ...textStartStyle(isRTL)}}
              >
                {surahLabel}
              </Text>
            </View>
          )}
        </View>

        <View className="mt-4 gap-3">
          <LoopControl
            icon={<Repeat2 size={16} color={accent} />}
            label={s.recitationRepeatRange}
            value={formatCount(audioRepeatRange)}
            decreaseLabel={s.recitationDecreaseRepeatRange}
            increaseLabel={s.recitationIncreaseRepeatRange}
            canDecrease={audioRepeatRange > AUDIO_REPEAT_MIN}
            canIncrease={audioRepeatRange < AUDIO_REPEAT_MAX}
            onDecrease={() => setAudioRepeatRange(audioRepeatRange - 1)}
            onIncrease={() => setAudioRepeatRange(audioRepeatRange + 1)}
            isDark={isDark}
            isRTL={isRTL}
          />
          <LoopControl
            icon={<Repeat2 size={16} color={accent} />}
            label={s.recitationRepeatEachAyah}
            value={formatCount(audioRepeatEach)}
            decreaseLabel={s.recitationDecreaseRepeatEach}
            increaseLabel={s.recitationIncreaseRepeatEach}
            canDecrease={audioRepeatEach > AUDIO_REPEAT_MIN}
            canIncrease={audioRepeatEach < AUDIO_REPEAT_MAX}
            onDecrease={() => setAudioRepeatEach(audioRepeatEach - 1)}
            onIncrease={() => setAudioRepeatEach(audioRepeatEach + 1)}
            isDark={isDark}
            isRTL={isRTL}
          />
          <LoopControl
            icon={<Timer size={16} color={accent} />}
            label={s.recitationDelayBetweenAyahs}
            value={`${formatCount(audioDelaySeconds)}${isRTL ? "ث" : "s"}`}
            decreaseLabel={s.recitationDecreaseDelay}
            increaseLabel={s.recitationIncreaseDelay}
            canDecrease={audioDelaySeconds > AUDIO_DELAY_MIN_SECONDS}
            canIncrease={audioDelaySeconds < AUDIO_DELAY_MAX_SECONDS}
            onDecrease={() => setAudioDelaySeconds(audioDelaySeconds - 1)}
            onIncrease={() => setAudioDelaySeconds(audioDelaySeconds + 1)}
            isDark={isDark}
            isRTL={isRTL}
          />
          {/* The whole row is the switch, so its target is the row, not the 24 px track. */}
          <SwitchRow
            label={s.recitationFollow}
            hint={s.recitationFollowHint}
            value={audioFollow}
            onValueChange={setAudioFollow}
            className="rounded-3xl bg-surface-low p-3 dark:bg-surface-dark-low"
          >
            <MirroredRow dir={isRTL ? "rtl" : "ltr"} className="min-h-[36px] items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                <LocateFixed size={16} color={accent} />
              </View>
              <View className="min-w-0 flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL) }}
                >
                  {s.recitationFollow}
                </Text>
                <Text
                  className="mt-0.5 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 17, ...textStartStyle(isRTL) }}
                >
                  {s.recitationFollowHint}
                </Text>
              </View>
              <SwitchTrack value={audioFollow} />
            </MirroredRow>
          </SwitchRow>
        </View>

        {rangeState.active && (
          <View className="mt-4 rounded-3xl bg-primary-accent/10 dark:bg-primary-bright/10 p-4">
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL)}}
            >
              {rangeState.paused ? s.recitationPaused : s.recitationPlaying}
            </Text>
            <Text
              className="mt-1 text-warm-700 dark:text-neutral-300"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
            >
              {formatPlaybackLine(rangeState, formatCount, s.recitationAyahRepeat)}
            </Text>
          </View>
        )}

        {!!errors.general && (
          <Text
            accessibilityLiveRegion="polite"
            className="mt-4 text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL)}}
          >
            {errors.general}
          </Text>
        )}

        <Text
          className="mt-4 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
        >
          {s.recitationNeedsInternet}
        </Text>
      </OverlayBody>

      <OverlayFooter isRTL={isRTL}>
        <Pressable
          onPress={handlePrimary}
          disabled={starting}
          accessibilityRole="button"
          accessibilityState={{ disabled: starting, busy: starting }}
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
  error,
  isDark,
  isRTL,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  error?: string;
  isDark: boolean;
  isRTL: boolean;
}) {
  // The label is shown, not only announced: Range mode has two identical-looking fields.
  return (
    <View className="gap-1.5">
      <Text
        className="px-1 text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL) }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        accessibilityHint={error}
        aria-invalid={error ? true : undefined}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#b9a085"}
        keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
        autoCapitalize="none"
        autoCorrect={false}
        className="h-12 rounded-2xl bg-surface dark:bg-surface-dark px-4 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 16,
          ...inputTextStartStyle(isRTL),
          writingDirection: "ltr",
          borderWidth: error ? 1.5 : 0,
          borderColor: error ? (isDark ? "#f87171" : "#dc2626") : "transparent",
        }}
      />
      {!!error && (
        <Text
          accessibilityLiveRegion="polite"
          className="px-1 text-red-600 dark:text-red-400"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, lineHeight: 17, ...textStartStyle(isRTL) }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

function LoopControl({
  icon,
  label,
  value,
  decreaseLabel,
  increaseLabel,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  isDark,
  isRTL,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  decreaseLabel: string;
  increaseLabel: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  return (
    <View className="rounded-3xl bg-surface-low dark:bg-surface-dark-low p-3">
      <MirroredRow
        dir={isRTL ? "rtl" : "ltr"}
        className="items-center gap-3"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
          {icon}
        </View>
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL)}}
        >
          {label}
        </Text>
        <MirroredRow
          dir={isRTL ? "rtl" : "ltr"}
          className="items-center rounded-full bg-surface p-1 dark:bg-surface-dark"
        >
          <Pressable onPress={onDecrease}
            disabled={!canDecrease}
            accessibilityRole="button"
            accessibilityLabel={decreaseLabel}
            accessibilityState={{ disabled: !canDecrease }}
            hitSlop={6}
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ opacity: canDecrease ? 1 : 0.35 }}
          >
            <Minus size={15} color={iconColor} />
          </Pressable>
          <View className="min-w-12 items-center justify-center px-2">
            <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
              {value}
            </Text>
          </View>
          <Pressable onPress={onIncrease}
            disabled={!canIncrease}
            accessibilityRole="button"
            accessibilityLabel={increaseLabel}
            accessibilityState={{ disabled: !canIncrease }}
            hitSlop={6}
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ opacity: canIncrease ? 1 : 0.35 }}
          >
            <Plus size={15} color={iconColor} />
          </Pressable>
        </MirroredRow>
      </MirroredRow>
    </View>
  );
}

/** An exact "surah:ayah" in any digits, within the canonical ayah counts; the shared C06 parser. */
function parseAyahReference(value: string): AyahAudioTarget | null {
  const parsed = parseReference(value, { context: "goto" });
  return parsed.kind === "ayah" ? { surah: parsed.surah, ayah: parsed.ayah } : null;
}

function formatPlaybackLine(
  rangeState: RangeAudioState,
  formatCount: (value: number) => string,
  ayahRepeatTemplate: string
): string {
  const current = rangeState.currentAyah
    ? `${formatCount(rangeState.currentAyah.surah)}:${formatCount(rangeState.currentAyah.ayah)}`
    : "";
  const parts = [
    current,
    `${formatCount(rangeState.currentIndex + 1)}/${formatCount(rangeState.totalAyahs)}`,
    `${formatCount(rangeState.repeatRangeIndex)}/${formatCount(rangeState.repeatRange)}`,
  ];
  if (rangeState.repeatEachAyah > 1) {
    parts.push(
      interpolate(ayahRepeatTemplate, {
        current: formatCount(rangeState.repeatEachAyahIndex),
        total: formatCount(rangeState.repeatEachAyah),
      })
    );
  }
  return parts.filter(Boolean).join(" • ");
}
