import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  X,
} from "lucide-react-native";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { OverlayBody, ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { Switch } from "@/components/ui/Switch";
import { Toast } from "@/components/ui/Toast";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { useDatabase } from "@/lib/database/provider";
import { toArabicNumber } from "@/lib/arabic";
import { stringByKey, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import {
  FONT_SIZE_STEPS,
  getThemeChoiceVisual,
  useSettings,
  type QuranFontStyle,
  type QuranMarkerStyle,
  type ThemeMode,
} from "@/lib/settings/context";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";

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
  const db = useDatabase();
  const s = useStrings();
  const { width } = useWindowDimensions();
  const {
    theme,
    setTheme,
    fontSizeIndex,
    setFontSizeIndex,
    quranFontStyle,
    setQuranFontStyle,
    quranMarkerStyle,
    setQuranMarkerStyle,
    tafseerSource,
    setTafseerSource,
    isDark,
    isRTL,
    systemTheme,
    themeSurface,
  } = useSettings();
  const [fontPickerVisible, setFontPickerVisible] = useState(false);
  const [markerStylePickerVisible, setMarkerStylePickerVisible] = useState(false);
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const [importingTafseerSource, setImportingTafseerSource] = useState<TafsirSourceId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  const controlColor = isDark ? "#a3a3a3" : "#7C6A58";
  const accentColor = isDark ? DARK_ACCENT : ACCENT;
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const quranBaseFont = quranFontStyle === "qcf2" ? "qcf2" : "v4";
  const quranBaseFontLabel = quranBaseFont === "qcf2" ? s.quranFontQcf2 : s.quranFontV4;
  const tajweedEnabled = quranFontStyle === "v4-tajweed";
  const markerStyleLabel = markerLabelForValue(quranMarkerStyle, s);
  const currentTafseerSource = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource);
  const currentTafseerTitle = currentTafseerSource ? stringByKey(s, currentTafseerSource.labelKey, currentTafseerSource.id) : tafseerSource;
  const fontSizeUsesFittedPageSize = fontSizeLocked;
  const horizontalTextAlign = isRTL ? "right" : "left";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const compactRows = width < 460;
  const modalHorizontalPadding = compactRows ? 16 : 28;
  const titleFontSize = compactRows ? 21 : 24;

  const fontOptions = useMemo<ChoiceOption<"qcf2" | "v4">[]>(
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
    (font: "qcf2" | "v4") => {
      if (font === "qcf2") {
        setQuranFontStyle("qcf2");
        return;
      }
      setQuranFontStyle(tajweedEnabled ? "v4-tajweed" : "v4");
    },
    [setQuranFontStyle, tajweedEnabled]
  );

  const handleTajweedToggle = useCallback(
    (enabled: boolean) => {
      setQuranFontStyle(enabled ? "v4-tajweed" : quranFontStyle === "qcf2" ? "qcf2" : "v4");
    },
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

  const handleTafseerSourceSelect = useCallback(
    async (sourceId: TafsirSourceId) => {
      if (importingTafseerSource) return false;
      setImportingTafseerSource(sourceId);
      try {
        await ensureTafsirSourceImported(db, sourceId);
        setTafseerSource(sourceId);
        return true;
      } catch (err) {
        console.warn("[ReadingSettingsSheet] Failed to import tafsir source:", err);
        setToast(s.tafseerSourceImportFailed);
        return false;
      } finally {
        setImportingTafseerSource(null);
      }
    },
    [db, importingTafseerSource, s.tafseerSourceImportFailed, setTafseerSource]
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
              <Text
                className="mt-1 text-warm-500 dark:text-neutral-400"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 13,
                  lineHeight: 19,
                  textAlign: horizontalTextAlign,
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.readingSettingsSubtitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={s.genericClose}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full bg-surface-low/70 dark:bg-surface-dark-low/70"
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
            isRTL={isRTL}
            options={[
              { value: "white", label: s.themeLight, active: theme === "white" },
              { value: "beige", label: s.themeBeige, active: theme === "beige" },
              { value: "dark", label: s.themeDark, active: theme === "dark" },
              { value: "amoled", label: s.themeAmoled, active: theme === "amoled" },
              { value: "system", label: s.themeSystem, active: theme === "system" },
            ]}
            onChange={setTheme}
          />

          <SettingsSectionLabel label={s.sectionReading} isRTL={isRTL} />
          <View className="mb-5 overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.quranFontLabel}
              value={quranBaseFontLabel}
              isRTL={isRTL}
              onPress={() => setFontPickerVisible(true)}
              trailing={<Chevron size={17} color={controlColor} />}
              compact={compactRows}
            />
            <Divider />
            <SettingsActionRow
              title={s.fontSizeLabel}
              subtitle={fontSizeUsesFittedPageSize ? s.fontSizeFixedPageView : undefined}
              isRTL={isRTL}
              compact={compactRows}
              trailing={
                <SettingsStepper
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
              isRTL={isRTL}
              trailing={<Switch value={tajweedEnabled} onValueChange={handleTajweedToggle} />}
              compact={compactRows}
            />
          </View>

          <SettingsSectionLabel label={s.readingSettingsAyahDisplay} isRTL={isRTL} />
          <View className="mb-5 overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.quranMarkerStyleLabel}
              value={markerStyleLabel}
              isRTL={isRTL}
              onPress={() => setMarkerStylePickerVisible(true)}
              trailing={<Chevron size={17} color={controlColor} />}
              compact={compactRows}
            />
          </View>

          <SettingsSectionLabel label={s.tafseer} isRTL={isRTL} />
          <View className="overflow-hidden rounded-xl border border-warm-200/45 bg-surface-bright/80 dark:border-neutral-800/80 dark:bg-surface-dark-low/70">
            <SettingsActionRow
              title={s.tafseerSourceLabel}
              value={currentTafseerTitle}
              isRTL={isRTL}
              onPress={() => setTafseerPickerVisible(true)}
              trailing={importingTafseerSource ? <ActivityIndicator size="small" color={accentColor} /> : <Chevron size={17} color={controlColor} />}
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
        visible={fontPickerVisible}
        title={s.readingSettingsChooseFont}
        value={quranBaseFont}
        options={fontOptions}
        onChange={handleBaseFontChange}
        onClose={() => setFontPickerVisible(false)}
        isRTL={isRTL}
        isDark={isDark}
        surfaceColor={themeSurface}
      />
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
      />
      <TafsirSourcePicker
        visible={tafseerPickerVisible}
        selectedSource={tafseerSource}
        importingSource={importingTafseerSource}
        onSelect={handleTafseerSourceSelect}
        onClose={() => setTafseerPickerVisible(false)}
        helperText={s.tafseerDownloadHint}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function ThemeSegmentedControl({
  options,
  systemTheme,
  isRTL,
  onChange,
}: {
  options: Array<{ value: ThemeMode; label: string; active: boolean }>;
  systemTheme: "dark" | "white";
  isRTL: boolean;
  onChange: (theme: ThemeMode) => void;
}) {
  return (
    <View
      className="mb-5 rounded-xl border border-warm-200/45 bg-surface-bright/70 p-1 dark:border-neutral-800/80 dark:bg-surface-dark-low/70"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      {options.map((option) => {
        const themeVisual = getThemeChoiceVisual(option.value, systemTheme, option.active);
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: option.active }}
            className="h-10 flex-1 items-center justify-center rounded-lg px-2"
            style={({ pressed }) => ({
              backgroundColor: themeVisual.backgroundColor,
              borderColor: themeVisual.borderColor,
              borderWidth: 1,
              opacity: pressed ? 0.72 : 1,
              cursor: Platform.OS === "web" ? "pointer" : undefined,
            })}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={{
                color: themeVisual.textColor,
                fontFamily: option.active ? "Manrope_600SemiBold" : "Manrope_500Medium",
                fontSize: 13,
                lineHeight: 17,
                textAlign: "center",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {option.label}
            </Text>
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
        textAlign: isRTL ? "right" : "left",
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
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-1 text-warm-500 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
              lineHeight: 17,
              textAlign: isRTL ? "right" : "left",
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
            textAlign: isRTL ? "left" : "right",
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

function SettingsStepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
  compact = false,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  isDark: boolean;
  isRTL: boolean;
  compact?: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6E6258";
  const buttonSizeClass = compact ? "h-8 w-8" : "h-8 w-8";
  return (
    <View
      className="rounded-lg border border-warm-200/40 bg-surface-low/60 p-0.5 dark:border-neutral-800 dark:bg-surface-dark-high/70"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={onDecrement}
        disabled={decrementDisabled}
        className={`${buttonSizeClass} items-center justify-center rounded-full`}
        style={({ pressed }) => ({
          opacity: decrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !decrementDisabled ? 0.96 : 1 }],
          cursor: Platform.OS === "web" ? (decrementDisabled ? "auto" : "pointer") : undefined,
        })}
      >
        <Minus size={15} color={iconColor} />
      </Pressable>
      <View className={`${compact ? "min-w-11" : "min-w-12"} items-center justify-center px-1`}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12.5 }}
        >
          {value}
        </Text>
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={incrementDisabled}
        className={`${buttonSizeClass} items-center justify-center rounded-full`}
        style={({ pressed }) => ({
          opacity: incrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !incrementDisabled ? 0.96 : 1 }],
          cursor: Platform.OS === "web" ? (incrementDisabled ? "auto" : "pointer") : undefined,
        })}
      >
        <Plus size={15} color={iconColor} />
      </Pressable>
    </View>
  );
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
}: {
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
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        <Pressable
          onPress={onClose}
          className="h-10 w-10 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            cursor: Platform.OS === "web" ? "pointer" : undefined,
          })}
        >
          <X size={18} color={isDark ? "#d4d4d4" : "#6E6258"} />
        </Pressable>
      </View>
      <OverlayBody contentContainerClassName="px-4 py-3">
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
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
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
                    textAlign: isRTL ? "right" : "left",
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
                      textAlign: isRTL ? "right" : "left",
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
