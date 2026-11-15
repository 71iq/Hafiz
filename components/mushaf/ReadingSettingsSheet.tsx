import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { OverlayBody, OverlayHeader, ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { Switch, SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { ReadingStepper } from "@/components/settings/ReadingStepper";
import { formatSecondsPerWord, getNextFasterDelay, getNextSlowerDelay } from "@/components/mushaf/HifzControls";
import { ThemeColorSwatch } from "@/components/ui/ThemeColorSwatch";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { isTajweedStyle, quranBaseFont, styleForBaseFont, styleForTajweed, type QuranBaseFont } from "@/lib/settings/quran-font-choice";
import { toArabicNumber } from "@/lib/arabic";
import { stringByKey, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import {
  FONT_SIZE_STEPS,
  MAX_HIFZ_AUTO_DELAY_MS,
  MIN_HIFZ_AUTO_DELAY_MS,
  useSettings,
  type QuranMarkerStyle,
  type ThemeMode,
} from "@/lib/settings/context";
import { AVAILABLE_TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { textStartStyle, textEndStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  fontSizeLocked?: boolean;
  onClose: () => void;
  onFontSizeChangeStart?: () => void;
};

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

const ACCENT = "#0d9488";
const DARK_ACCENT = "#2dd4bf";

export function ReadingSettingsSheet({
  visible,
  fontSizeLocked = false,
  onClose,
  onFontSizeChangeStart,
}: Props) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  const {
    theme,
    setTheme,
    fontSizeIndex,
    setFontSizeIndex,
    quranFontStyle,
    quranRenderFontStyle,
    setQuranFontStyle,
    quranMarkerStyle,
    setQuranMarkerStyle,
    markSimilarVerses,
    setMarkSimilarVerses,
    hifzAutoDelayMs,
    setHifzAutoDelayMs,
    hifzAutoAdvancePage,
    setHifzAutoAdvancePage,
    tafseerSource,
    setTafseerSource,
    isDark,
    isRTL,
    systemTheme,
    themeSurface,
    effectiveTheme,
  } = useSettings();
  const [markerStylePickerVisible, setMarkerStylePickerVisible] = useState(false);
  const [tajweedLegendVisible, setTajweedLegendVisible] = useState(false);
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  const controlColor = isDark ? "#a3a3a3" : "#7C6A58";
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const baseFont = quranBaseFont(quranFontStyle);
  const tajweedEnabled = isTajweedStyle(quranFontStyle);
  const markerStyleLabel = markerLabelForValue(quranMarkerStyle, s);
  const currentTafseerSource = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource);
  const currentTafseerTitle = currentTafseerSource ? stringByKey(s, currentTafseerSource.labelKey, currentTafseerSource.id) : tafseerSource;
  const fontSizeUsesFittedPageSize = fontSizeLocked;
  const horizontalTextAlign = isRTL ? "right" : "left";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const compactRows = width < 460;
  const modalHorizontalPadding = compactRows ? 16 : 28;
  const titleFontSize = compactRows ? 21 : 24;

  const fontOptions = useMemo<ChoiceOption<QuranBaseFont>[]>(
    () => [
      { value: "qcf2", label: s.quranFontQcf2 },
      { value: "v4", label: s.quranFontV4 },
    ],
    [s.quranFontQcf2, s.quranFontV4]
  );
  const markerStyleOptions = useMemo<ChoiceOption<QuranMarkerStyle>[]>(
    () => [
      { value: "auto", label: s.quranMarkerAuto },
      { value: "light", label: s.quranMarkerLight },
      { value: "dark", label: s.quranMarkerDark },
      { value: "sepia", label: s.quranMarkerSepia },
    ],
    [s.quranMarkerAuto, s.quranMarkerDark, s.quranMarkerLight, s.quranMarkerSepia]
  );

  const handleBaseFontChange = useCallback(
    (font: QuranBaseFont) => setQuranFontStyle(styleForBaseFont(font, quranFontStyle)),
    [quranFontStyle, setQuranFontStyle]
  );

  const handleTajweedToggle = useCallback(
    (enabled: boolean) => setQuranFontStyle(styleForTajweed(enabled, quranFontStyle)),
    [quranFontStyle, setQuranFontStyle]
  );

  const handleFontSizeChange = useCallback(
    (nextIndex: number) => {
      if (fontSizeLocked || nextIndex < 0 || nextIndex >= FONT_SIZE_STEPS.length) return;
      onFontSizeChangeStart?.();
      setFontSizeIndex(nextIndex);
    },
    [fontSizeLocked, onFontSizeChangeStart, setFontSizeIndex]
  );

  return (
    <>
      <ResponsiveOverlay
        open={visible}
        onClose={onClose}
        phonePresentation="dialog"
        desktopPresentation="dialog"
        maxWidth={680}
        maxHeight="82%"
        surfaceColor={themeSurface}
      >
        <View
          className="border-b border-warm-200/35 py-4 dark:border-neutral-800/70"
          style={{ paddingHorizontal: modalHorizontalPadding }}
        >
          <View className="items-start justify-between gap-3" style={{ flexDirection: rowDirection }}>
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "NotoSerif_500Medium",
                  fontSize: titleFontSize,
                  lineHeight: titleFontSize + 6,
                  textAlign: horizontalTextAlign,
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.readingSettingsTitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={s.genericClose}
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-low/70 dark:bg-surface-dark-low/70"
              style={({ pressed }) => ({
                opacity: pressed ? 0.72 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
                cursor: Platform.OS === "web" ? "pointer" : undefined,
              })}
            >
              <X size={16} color={isDark ? "#d4d4d4" : "#6E6258"} />
            </Pressable>
          </View>
        </View>

        <OverlayBody contentContainerStyle={{ paddingHorizontal: modalHorizontalPadding, paddingTop: 18, paddingBottom: 20 }}>
          <SettingsSectionLabel label={s.sectionAppearance} isRTL={isRTL} />
          <ThemeSegmentedControl
            systemTheme={systemTheme}
            options={[
              { value: "white", label: s.themeWhite, active: theme === "white" },
              { value: "beige", label: s.themeBeige, active: theme === "beige" },
              { value: "system", label: s.themeSystem, active: theme === "system" },
              { value: "dark", label: s.themeDark, active: theme === "dark" },
              { value: "amoled", label: s.themeAmoled, active: theme === "amoled" },
            ]}
            onChange={setTheme}
          />

          <SettingsSectionLabel label={s.sectionReading} isRTL={isRTL} />
          <View className="mb-5 overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <View style={{ paddingHorizontal: compactRows ? 14 : 16, paddingVertical: 14, gap: 10 }}>
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.quranFontLabel}
              </Text>
              <ToggleGroup<QuranBaseFont>
                value={baseFont}
                onValueChange={handleBaseFontChange}
                items={fontOptions}
                accessibilityLabel={s.quranFontLabel}
              />
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {quranRenderFontStyle !== quranFontStyle ? `${s.quranFontChoiceHint} ${s.quranFontDarkFallback}` : s.quranFontChoiceHint}
              </Text>
            </View>
            <Divider />
            <SettingsActionRow
              title={s.fontSizeLabel}
              subtitle={fontSizeUsesFittedPageSize ? s.fontSizeFixedPageView : undefined}
              isRTL={isRTL}
              compact={compactRows}
              trailing={
                <ReadingStepper
                  variant="sheet"
                  decrementLabel={s.decreaseArabicFontSize}
                  incrementLabel={s.increaseArabicFontSize}
                  value={`${fontSizeLevelLabel} / ${fontSizeTotalLabel}`}
                  onDecrement={() => handleFontSizeChange(fontSizeIndex - 1)}
                  onIncrement={() => handleFontSizeChange(fontSizeIndex + 1)}
                  decrementDisabled={fontSizeLocked || fontSizeIndex === 0}
                  incrementDisabled={fontSizeLocked || fontSizeIndex === FONT_SIZE_STEPS.length - 1}
                  isDark={isDark}
                  isRTL={isRTL}
                  compact={compactRows}
                />
              }
            />
            <Divider />
            <SettingsActionRow
              title={s.quranFontV4Tajweed}
              subtitle={s.quranTajweedHint}
              isRTL={isRTL}
              trailing={<Switch accessibilityLabel={s.quranFontV4Tajweed} value={tajweedEnabled} onValueChange={handleTajweedToggle} />}
              compact={compactRows}
            />
            <Pressable
              onPress={() => setTajweedLegendVisible(true)}
              accessibilityRole="button"
              className="min-h-[44px] justify-center"
              style={{ paddingHorizontal: compactRows ? 14 : 16, paddingBottom: 8 }}
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.tajweedLegendOpen}
              </Text>
            </Pressable>
          </View>

          <SettingsSectionLabel label={s.readingSettingsAyahDisplay} isRTL={isRTL} />
          <View className="mb-5 overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.quranMarkerStyleLabel}
              subtitle={quranRenderFontStyle === "qcf2" ? s.quranMarkerModernOnly : undefined}
              value={markerStyleLabel}
              isRTL={isRTL}
              onPress={() => setMarkerStylePickerVisible(true)}
              disabled={quranRenderFontStyle === "qcf2"}
              trailing={<Chevron size={17} color={controlColor} />}
              compact={compactRows}
            />
            <Divider />
            {/* The whole row is the switch, so its target is the row, not the 24 px track. */}
            <SwitchRow
              label={s.hifzSimilarMarkSetting}
              hint={s.hifzSimilarMarkSettingHint}
              value={markSimilarVerses}
              onValueChange={setMarkSimilarVerses}
            >
              <SettingsActionRow
                title={s.hifzSimilarMarkSetting}
                subtitle={s.hifzSimilarMarkSettingHint}
                isRTL={isRTL}
                trailing={<SwitchTrack value={markSimilarVerses} />}
                compact={compactRows}
              />
            </SwitchRow>
          </View>

          {/* Page reveal mode: the auto reveal pace and whether a revealed page moves on by itself. */}
          <SettingsSectionLabel label={s.hifzAutoReveal} isRTL={isRTL} />
          <View className="mb-5 overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.hifzTimeBetweenWords}
              isRTL={isRTL}
              compact={compactRows}
              trailing={
                <ReadingStepper
                  variant="sheet"
                  decrementLabel={s.hifzDecreaseSpeed}
                  incrementLabel={s.hifzIncreaseSpeed}
                  value={formatSecondsPerWord(hifzAutoDelayMs, isRTL, s.revealSecondsPerWord)}
                  onDecrement={() => setHifzAutoDelayMs(getNextSlowerDelay(hifzAutoDelayMs))}
                  onIncrement={() => setHifzAutoDelayMs(getNextFasterDelay(hifzAutoDelayMs))}
                  decrementDisabled={hifzAutoDelayMs >= MAX_HIFZ_AUTO_DELAY_MS}
                  incrementDisabled={hifzAutoDelayMs <= MIN_HIFZ_AUTO_DELAY_MS}
                  isDark={isDark}
                  isRTL={isRTL}
                  compact={compactRows}
                />
              }
            />
            <Divider />
            <SwitchRow label={s.hifzAutoNextPage} value={hifzAutoAdvancePage} onValueChange={setHifzAutoAdvancePage}>
              <SettingsActionRow
                title={s.hifzAutoNextPage}
                isRTL={isRTL}
                trailing={<SwitchTrack value={hifzAutoAdvancePage} />}
                compact={compactRows}
              />
            </SwitchRow>
          </View>

          <SettingsSectionLabel label={s.tafseer} isRTL={isRTL} />
          <View className="overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.tafseerSourceLabel}
              value={currentTafseerTitle}
              isRTL={isRTL}
              onPress={() => setTafseerPickerVisible(true)}
              trailing={<Chevron size={17} color={controlColor} />}
              compact={compactRows}
            />
          </View>

          <View className="mt-5 items-center justify-center">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 11,
                lineHeight: 16,
                textAlign: "center",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.readingSettingsSavedAutomatically}
            </Text>
          </View>
        </OverlayBody>
      </ResponsiveOverlay>

      <ChoiceDialog
        visible={markerStylePickerVisible}
        title={s.readingSettingsChooseMarkerStyle}
        value={quranMarkerStyle}
        options={markerStyleOptions}
        onChange={setQuranMarkerStyle}
        onClose={() => setMarkerStylePickerVisible(false)}
        isRTL={isRTL}
        isDark={isDark}
        surfaceColor={themeSurface}
        closeLabel={s.genericClose}
      />
      <TajweedLegendSheet
        visible={tajweedLegendVisible}
        onClose={() => setTajweedLegendVisible(false)}
        theme={effectiveTheme}
        isRTL={isRTL}
      />
      <TafsirSourcePicker
        visible={tafseerPickerVisible}
        selectedSource={tafseerSource}
        onSelected={setTafseerSource}
        logLabel="[ReadingSettingsSheet]"
        onClose={() => setTafseerPickerVisible(false)}
        helperText={s.tafseerDownloadHint}
      />
    </>
  );
}

function ThemeSegmentedControl({
  options,
  systemTheme,
  onChange,
}: {
  options: Array<{ value: ThemeMode; label: string; active: boolean }>;
  systemTheme: "dark" | "white";
  onChange: (theme: ThemeMode) => void;
}) {
  return (
    <View className="mb-5" style={{ flexDirection: "row", gap: 8 }}>
      {options.map((option) => {
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: option.active }}
            aria-checked={option.active}
            className="flex-1 items-center justify-center"
            style={({ pressed }) => ({
              opacity: pressed ? 0.72 : 1,
              cursor: Platform.OS === "web" ? "pointer" : undefined,
            })}
          >
            <ThemeColorSwatch theme={option.value} systemTheme={systemTheme} selected={option.active} size={40} label={option.label} />
          </Pressable>
        );
      })}
    </View>
  );
}

function SettingsSectionLabel({ label, isRTL }: { label: string; isRTL: boolean }) {
  return (
    <Text
      className="mb-2 text-warm-500 dark:text-neutral-500"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 11,
        letterSpacing: 0,
        textTransform: "uppercase",
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {label}
    </Text>
  );
}

function SettingsActionRow({
  title,
  subtitle,
  value,
  trailing,
  isRTL,
  onPress,
  disabled = false,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  trailing: React.ReactNode;
  isRTL: boolean;
  onPress?: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const content = (
    <>
      <View className="min-w-0 flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: compact ? 14 : 14.5,
            lineHeight: compact ? 19 : 20,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-1 text-warm-500 dark:text-neutral-400"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
              lineHeight: 17,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          className="text-warm-500 dark:text-neutral-400"
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: "Manrope_500Medium",
            fontSize: compact ? 13 : 14,
            ...textEndStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {value}
        </Text>
      ) : null}
      {trailing}
    </>
  );

  const rowClassName = `${compact ? "min-h-14 gap-2 px-3 py-3" : "min-h-16 gap-3 px-4 py-3"} items-center`;
  const rowStyle = {
    direction: "ltr",
    flexDirection: isRTL ? "row-reverse" : "row",
    opacity: disabled ? 0.42 : 1,
  } as const;

  if (!onPress) {
    return (
      <View className={rowClassName} style={rowStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={rowClassName}
      style={[rowStyle, Platform.OS === "web" ? ({ cursor: disabled ? "auto" : "pointer" } as any) : null]}
    >
      {content}
    </Pressable>
  );
}

function Divider() {
  return <View className="h-px bg-warm-200/45 dark:bg-neutral-800/80" />;
}

function ChoiceDialog<T extends string>({
  visible,
  title,
  value,
  options,
  onChange,
  onClose,
  isRTL,
  isDark,
  surfaceColor,
  closeLabel,
}: {
  closeLabel: string;
  visible: boolean;
  title: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  onClose: () => void;
  isRTL: boolean;
  isDark: boolean;
  surfaceColor: string;
}) {
  return (
    <ResponsiveOverlay
      open={visible}
      onClose={onClose}
      phonePresentation="dialog"
      desktopPresentation="dialog"
      maxWidth={420}
      maxHeight="80%"
      surfaceColor={surfaceColor}
    >
      <View
        className="items-center justify-between gap-3 border-b border-warm-200/70 px-5 py-4 dark:border-neutral-800"
        style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: 18,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            cursor: Platform.OS === "web" ? "pointer" : undefined,
          })}
        >
          <X size={18} color={isDark ? "#d4d4d4" : "#6E6258"} />
        </Pressable>
      </View>
      <OverlayBody contentContainerClassName="px-4 py-3">
        <View accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((option) => {
          const active = option.value === value;
          const optionBackgroundColor = active
            ? isDark
              ? "rgba(45,212,191,0.09)"
              : "rgba(13,148,136,0.07)"
            : "transparent";
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onChange(option.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-3 rounded-2xl px-3 py-4`}
              style={{
                backgroundColor: optionBackgroundColor,
                cursor: Platform.OS === "web" ? "pointer" : undefined,
              }}
            >
              <View className="h-7 w-7 items-center justify-center">
                {active ? <Check size={18} color={isDark ? DARK_ACCENT : ACCENT} /> : null}
              </View>
              <View className="min-w-0 flex-1">
                <Text
                  className={active ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 15,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {option.label}
                </Text>
                {option.description ? (
                  <Text
                    className="mt-0.5 text-warm-500 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {option.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        </View>
      </OverlayBody>
    </ResponsiveOverlay>
  );
}

/** One row per color the Tajweed font draws, in the current theme's render palette. */
const TAJWEED_LEGEND_RULES = [
  "ghunnah",
  "ikhfaa",
  "idghaam_ghunnah",
  "iqlab",
  "ikhfaa_shafawi",
  "idghaam_shafawi",
  "idghaam_no_ghunnah",
  "idghaam_mutamaathilayn",
  "idghaam_mutaqaaribayn",
  "idghaam_mutajaanisayn",
  "hamzat_wasl",
  "lam_shamsiyyah",
  "silent",
  "qalqalah",
  "madd_2",
  "madd_246",
  "madd_6",
  "madd_munfasil",
  "madd_muttasil",
] as const;

function TajweedLegendSheet({
  visible,
  onClose,
  theme,
  isRTL,
}: {
  visible: boolean;
  onClose: () => void;
  theme: string;
  isRTL: boolean;
}) {
  const s = useStrings();
  if (!visible) return null;
  // Loaded on first open: the rule table builds its palette colors when the module loads.
  const { getTajweedRule } = require("@/lib/word/tajweed-labels") as typeof import("@/lib/word/tajweed-labels");
  return (
    <ResponsiveOverlay open={visible} onClose={onClose} phonePresentation="sheet" desktopPresentation="dialog" maxWidth={480}>
      <OverlayHeader title={s.tajweedLegendTitle} onClose={onClose} isRTL={isRTL} />
      <OverlayBody contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 4 }}>
        {TAJWEED_LEGEND_RULES.map((ruleId) => {
          const rule = getTajweedRule(ruleId, theme);
          return (
            <View
              key={ruleId}
              className="min-h-[44px] items-center gap-3 py-2"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: rule.color }} />
              <View className="min-w-0 flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {isRTL ? rule.arabic : `${rule.english} · ${rule.arabic}`}
                </Text>
                {!isRTL && rule.description ? (
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 17, ...textStartStyle(false) }}
                  >
                    {rule.description}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </OverlayBody>
    </ResponsiveOverlay>
  );
}

function markerLabelForValue(value: QuranMarkerStyle, s: UIStrings) {
  switch (value) {
    case "light":
      return s.quranMarkerLight;
    case "dark":
      return s.quranMarkerDark;
    case "sepia":
      return s.quranMarkerSepia;
    case "auto":
    default:
      return s.quranMarkerAuto;
  }
}
