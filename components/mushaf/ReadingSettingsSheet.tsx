import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import {
  BookOpen,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Info,
  Minus,
  Monitor,
  Moon,
  Palette,
  Plus,
  Sun,
  Type,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { OverlayBody, ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { Switch } from "@/components/ui/Switch";
import { Toast } from "@/components/ui/Toast";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { useDatabase } from "@/lib/database/provider";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  FONT_SIZE_STEPS,
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
    showAyahMarkers,
    setShowAyahMarkers,
    quranMarkerStyle,
    setQuranMarkerStyle,
    tafseerSource,
    setTafseerSource,
    isDark,
    isRTL,
    themeSurface,
  } = useSettings();
  const [fontPickerVisible, setFontPickerVisible] = useState(false);
  const [markerVisibilityPickerVisible, setMarkerVisibilityPickerVisible] = useState(false);
  const [markerStylePickerVisible, setMarkerStylePickerVisible] = useState(false);
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const [importingTafseerSource, setImportingTafseerSource] = useState<TafsirSourceId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  const iconColor = isDark ? "#a3a3a3" : "#7C6A58";
  const accentColor = isDark ? DARK_ACCENT : ACCENT;
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const quranBaseFont = quranFontStyle === "qcf2" ? "qcf2" : "v4";
  const quranBaseFontLabel = quranBaseFont === "qcf2" ? s.quranFontQcf2 : s.quranFontV4;
  const tajweedEnabled = quranFontStyle === "v4-tajweed";
  const markerVisibilityValue = showAyahMarkers ? "shown" : "hidden";
  const markerVisibilityLabel = showAyahMarkers ? s.quranMarkersShown : s.quranMarkersHidden;
  const markerStyleLabel = markerLabelForValue(quranMarkerStyle, s);
  const currentTafseerSource = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource);
  const currentTafseerTitle = currentTafseerSource ? s[currentTafseerSource.labelKey] ?? currentTafseerSource.id : tafseerSource;
  const fontSizeUsesFittedPageSize = fontSizeLocked;
  const horizontalTextAlign = isRTL ? "right" : "left";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const compactRows = width < 460;
  const useFourColumnThemeGrid = width >= 768;
  const modalHorizontalPadding = compactRows ? 16 : 24;
  const titleFontSize = compactRows ? 22 : 24;

  const fontOptions = useMemo<ChoiceOption<"qcf2" | "v4">[]>(
    () => [
      { value: "qcf2", label: s.quranFontQcf2 },
      { value: "v4", label: s.quranFontV4 },
    ],
    [s.quranFontQcf2, s.quranFontV4]
  );
  const markerVisibilityOptions = useMemo<ChoiceOption<"shown" | "hidden">[]>(
    () => [
      { value: "shown", label: s.quranMarkersShown },
      { value: "hidden", label: s.quranMarkersHidden },
    ],
    [s.quranMarkersHidden, s.quranMarkersShown]
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
        maxWidth={620}
        maxHeight="80%"
        surfaceColor={themeSurface}
      >
        <View
          className="border-b border-warm-200/40 pt-3 pb-4 dark:border-neutral-800/70"
          style={{ paddingHorizontal: modalHorizontalPadding }}
        >
          <View className="items-center pb-3">
            <View className="h-1 w-12 rounded-full bg-surface-high dark:bg-surface-dark-high" />
          </View>
          <View className="items-start justify-between gap-3" style={{ flexDirection: rowDirection, direction: "ltr" }}>
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
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
              style={({ pressed }) => ({
                opacity: pressed ? 0.72 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
                cursor: Platform.OS === "web" ? "pointer" : undefined,
              })}
            >
              <X size={18} color={isDark ? "#d4d4d4" : "#6E6258"} />
            </Pressable>
          </View>
        </View>

        <OverlayBody contentContainerStyle={{ paddingHorizontal: modalHorizontalPadding, paddingTop: 18, paddingBottom: 22 }}>
          <SettingsSectionLabel label={s.sectionAppearance} isRTL={isRTL} />
          <View className="mb-6" style={{ flexDirection: rowDirection, flexWrap: "wrap", gap: 10 }}>
            <ThemeTile
              label={s.themeLight}
              value="white"
              active={theme === "white"}
              icon={Sun}
              isDark={isDark}
              fourColumns={useFourColumnThemeGrid}
              onPress={setTheme}
            />
            <ThemeTile
              label={s.themeBeige}
              value="beige"
              active={theme === "beige"}
              icon={BookOpen}
              isDark={isDark}
              fourColumns={useFourColumnThemeGrid}
              onPress={setTheme}
            />
            <ThemeTile
              label={s.themeDark}
              value="dark"
              active={theme === "dark" || theme === "amoled"}
              icon={Moon}
              isDark={isDark}
              fourColumns={useFourColumnThemeGrid}
              onPress={setTheme}
            />
            <ThemeTile
              label={s.themeSystem}
              value="system"
              active={theme === "system" || theme === "scheduled"}
              icon={Monitor}
              isDark={isDark}
              fourColumns={useFourColumnThemeGrid}
              onPress={setTheme}
            />
          </View>

          <SettingsSectionLabel label={s.sectionReading} isRTL={isRTL} />
          <View className="mb-6 overflow-hidden rounded-2xl border border-warm-200/50 bg-surface-bright dark:border-neutral-800/80 dark:bg-surface-dark-low">
            <SettingsActionRow
              icon={<BookOpenText size={20} color={iconColor} />}
              title={s.quranFontLabel}
              value={quranBaseFontLabel}
              isRTL={isRTL}
              onPress={() => setFontPickerVisible(true)}
              trailing={<Chevron size={18} color={iconColor} />}
              compact={compactRows}
            />
            <Divider />
            <SettingsActionRow
              icon={<Type size={20} color={iconColor} />}
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
              icon={<Palette size={20} color={iconColor} />}
              title={s.quranFontV4Tajweed}
              isRTL={isRTL}
              trailing={<Switch value={tajweedEnabled} onValueChange={handleTajweedToggle} />}
              compact={compactRows}
            />
          </View>

          <SettingsSectionLabel label={s.readingSettingsAyahDisplay} isRTL={isRTL} />
          <View className="mb-6 overflow-hidden rounded-2xl border border-warm-200/50 bg-surface-bright dark:border-neutral-800/80 dark:bg-surface-dark-low">
            <SettingsActionRow
              icon={<CircleDot size={20} color={iconColor} />}
              title={s.quranMarkersVisibilityLabel}
              value={markerVisibilityLabel}
              isRTL={isRTL}
              onPress={() => setMarkerVisibilityPickerVisible(true)}
              trailing={<Chevron size={18} color={iconColor} />}
              compact={compactRows}
            />
            <Divider />
            <SettingsActionRow
              icon={<BookOpen size={20} color={iconColor} />}
              title={s.quranMarkerStyleLabel}
              value={markerStyleLabel}
              isRTL={isRTL}
              onPress={() => showAyahMarkers && setMarkerStylePickerVisible(true)}
              disabled={!showAyahMarkers}
              trailing={<Chevron size={18} color={iconColor} />}
              compact={compactRows}
            />
          </View>

          <SettingsSectionLabel label={s.tafseer} isRTL={isRTL} />
          <View className="overflow-hidden rounded-2xl border border-warm-200/50 bg-surface-bright dark:border-neutral-800/80 dark:bg-surface-dark-low">
            <SettingsActionRow
              icon={
                importingTafseerSource ? (
                  <ActivityIndicator size="small" color={accentColor} />
                ) : (
                  <BookOpenText size={20} color={iconColor} />
                )
              }
              title={s.tafseerSourceLabel}
              value={currentTafseerTitle}
              isRTL={isRTL}
              onPress={() => setTafseerPickerVisible(true)}
              trailing={<Chevron size={18} color={iconColor} />}
              compact={compactRows}
            />
          </View>

          <View className="mt-5 items-center justify-center gap-2" style={{ flexDirection: rowDirection }}>
            <Info size={14} color={isDark ? "#737373" : "#B4AAA0"} />
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
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
        visible={markerVisibilityPickerVisible}
        title={s.readingSettingsChooseMarkerVisibility}
        value={markerVisibilityValue}
        options={markerVisibilityOptions}
        onChange={(value) => setShowAyahMarkers(value === "shown")}
        onClose={() => setMarkerVisibilityPickerVisible(false)}
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

function ThemeTile({
  label,
  value,
  active,
  icon: Icon,
  isDark,
  fourColumns,
  onPress,
}: {
  label: string;
  value: ThemeMode;
  active: boolean;
  icon: LucideIcon;
  isDark: boolean;
  fourColumns: boolean;
  onPress: (theme: ThemeMode) => void;
}) {
  const isDarkTile = value === "dark";
  const activeBackgroundColor = isDark ? "rgba(45,212,191,0.08)" : "rgba(13,148,136,0.05)";
  const iconColor = active
    ? isDark
      ? DARK_ACCENT
      : ACCENT
    : isDarkTile
      ? "#E5E7EB"
      : value === "beige"
        ? "#9A7658"
        : "#7A7A7A";
  const labelColor = isDarkTile
      ? "#F5F5F5"
      : value === "beige"
        ? "#9A7658"
        : isDark
          ? "#D4D4D4"
          : "#7C6A58";

  return (
    <Pressable
      onPress={() => onPress(value)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="items-center justify-center gap-2 rounded-2xl px-2 py-3"
      style={{
        flexBasis: fourColumns ? "22%" : "47%",
        flexGrow: 1,
        minHeight: fourColumns ? 82 : 78,
        backgroundColor:
          active
            ? activeBackgroundColor
            : value === "dark"
            ? "#262626"
            : value === "beige"
              ? isDark
                ? "rgba(154,118,88,0.12)"
                : "#FBF7F1"
              : isDark
                ? "rgba(255,255,255,0.03)"
                : "#FFFFFF",
        borderColor: active ? (isDark ? "rgba(45,212,191,0.55)" : "rgba(13,148,136,0.45)") : isDark ? "rgba(255,255,255,0.08)" : "#EEE8E0",
        borderWidth: 1,
        cursor: Platform.OS === "web" ? "pointer" : undefined,
      }}
    >
      <Icon size={22} color={iconColor} strokeWidth={active ? 2 : 1.7} />
      <Text
        style={{
          color: labelColor,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
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
  icon,
  title,
  subtitle,
  value,
  trailing,
  isRTL,
  onPress,
  disabled = false,
  compact = false,
}: {
  icon: React.ReactNode;
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
      <View className={`${compact ? "w-8" : "w-9"} items-center justify-center`}>{icon}</View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: compact ? 14 : 15,
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

  const rowClassName = `${compact ? "min-h-14 gap-2 px-3 py-3" : "min-h-16 gap-3 px-4 py-3"} ${
    isRTL ? "flex-row-reverse" : "flex-row"
  } items-center`;
  const rowStyle = {
    direction: isRTL ? "rtl" : "ltr",
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
  const buttonSizeClass = "h-9 w-9";
  return (
    <View
      className="rounded-full bg-surface-low p-0.5 dark:bg-surface-dark-high"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
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
        <Minus size={16} color={iconColor} />
      </Pressable>
      <View className={`${compact ? "min-w-12" : "min-w-14"} items-center justify-center px-1`}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
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
        <Plus size={16} color={iconColor} />
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

function markerLabelForValue(value: QuranMarkerStyle, s: Record<string, string>) {
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
