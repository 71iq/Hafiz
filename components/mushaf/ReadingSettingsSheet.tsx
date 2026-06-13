import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ChevronDown, Minus, Plus } from "lucide-react-native";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { Toast } from "@/components/ui/Toast";
import { useDatabase } from "@/lib/database/provider";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import {
  FONT_SIZE_STEPS,
  useSettings,
  type QuranFontStyle,
  type QuranMarkerStyle,
  type ThemeMode,
} from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { toArabicNumber } from "@/lib/arabic";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";

type Props = {
  visible: boolean;
  fontSizeLocked: boolean;
  onClose: () => void;
  onFontSizeChangeStart?: () => void;
};

type MarkerVisibility = "shown" | "hidden";

export function ReadingSettingsSheet({
  visible,
  fontSizeLocked,
  onClose,
  onFontSizeChangeStart,
}: Props) {
  const db = useDatabase();
  const s = useStrings();
  const {
    theme,
    setTheme,
    fontSizeIndex,
    setFontSizeIndex,
    isDark,
    isRTL,
    quranFontStyle,
    setQuranFontStyle,
    quranMarkerStyle,
    setQuranMarkerStyle,
    showAyahMarkers,
    setShowAyahMarkers,
    tafseerSource,
    setTafseerSource,
  } = useSettings();
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const [importingTafseerSource, setImportingTafseerSource] = useState<TafsirSourceId | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const markerVisibility = showAyahMarkers ? "shown" : "hidden";
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const currentTafseerSource = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource) ?? AVAILABLE_TAFSIR_SOURCES[0];
  const currentTafseerTitle = s[currentTafseerSource.labelKey] ?? currentTafseerSource.id;
  const mutedColor = isDark ? "#737373" : "#8B8178";

  const themeItems = useMemo(
    () => [
      { value: "white" as ThemeMode, label: s.themeWhite },
      { value: "beige" as ThemeMode, label: s.themeBeige },
      { value: "dark" as ThemeMode, label: s.themeDark },
      { value: "system" as ThemeMode, label: s.themeSystem },
    ],
    [s.themeBeige, s.themeDark, s.themeSystem, s.themeWhite]
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

  const handleFontSizeChange = (nextIndex: number) => {
    if (fontSizeLocked || nextIndex < 0 || nextIndex >= FONT_SIZE_STEPS.length) return;
    onFontSizeChangeStart?.();
    setFontSizeIndex(nextIndex);
  };

  return (
    <>
      <ResponsiveSheet
        open={visible}
        onClose={onClose}
        dismissOnBackdrop
        maxWidth={540}
        maxHeight="86%"
      >
        <OverlayHeader
          title={s.readingSettingsTitle}
          subtitle={s.readingSettingsSubtitle}
          onClose={onClose}
          showHandle
          isRTL={isRTL}
        />

        <OverlayBody contentContainerClassName="px-5 pt-4 pb-6">
          <View className="gap-5">
            <SettingsSection title={s.sectionAppearance} isRTL={isRTL}>
              <ToggleGroup<ThemeMode>
                value={theme}
                onValueChange={setTheme}
                items={themeItems}
                dir={isRTL ? "rtl" : "ltr"}
              />
            </SettingsSection>

            <SettingsSection title={s.readingSettingsTypography} isRTL={isRTL}>
              <ControlLabel label={s.quranFontLabel} isRTL={isRTL} />
              <ToggleGroup<QuranFontStyle>
                value={quranFontStyle}
                onValueChange={setQuranFontStyle}
                items={[
                  { value: "qcf2", label: s.quranFontQcf2 },
                  { value: "v4", label: s.quranFontV4 },
                  { value: "v4-tajweed", label: s.quranFontV4Tajweed },
                ]}
                dir={isRTL ? "rtl" : "ltr"}
              />

              <View
                className="mt-4 items-center justify-between gap-3"
                style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", flexWrap: "wrap" }}
              >
                <View className="min-w-0 flex-1">
                  <ControlLabel label={s.fontSizeLabel} isRTL={isRTL} />
                  {fontSizeLocked && (
                    <Text
                      className="mt-1 text-warm-400 dark:text-neutral-500"
                      style={{
                        fontFamily: "Manrope_500Medium",
                        fontSize: 12,
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
                    >
                      {s.fontSizeFixedPageView}
                    </Text>
                  )}
                </View>
                <SettingsStepper
                  value={`${fontSizeLevelLabel}/${fontSizeTotalLabel}`}
                  onDecrement={() => handleFontSizeChange(fontSizeIndex - 1)}
                  onIncrement={() => handleFontSizeChange(fontSizeIndex + 1)}
                  decrementDisabled={fontSizeLocked || fontSizeIndex === 0}
                  incrementDisabled={fontSizeLocked || fontSizeIndex === FONT_SIZE_STEPS.length - 1}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              </View>
            </SettingsSection>

            <SettingsSection title={s.readingSettingsAyahDisplay} isRTL={isRTL}>
              <ControlLabel label={s.quranMarkersVisibility} isRTL={isRTL} />
              <ToggleGroup<MarkerVisibility>
                value={markerVisibility}
                onValueChange={(value) => setShowAyahMarkers(value === "shown")}
                items={[
                  { value: "shown", label: s.quranMarkersShown },
                  { value: "hidden", label: s.quranMarkersHidden },
                ]}
                dir={isRTL ? "rtl" : "ltr"}
              />

              {showAyahMarkers && quranFontStyle !== "qcf2" && (
                <View className="mt-4">
                  <ControlLabel label={s.quranMarkerLabel} isRTL={isRTL} />
                  <ToggleGroup<QuranMarkerStyle>
                    value={quranMarkerStyle}
                    onValueChange={setQuranMarkerStyle}
                    items={[
                      { value: "auto", label: s.quranMarkerAuto },
                      { value: "light", label: s.quranMarkerLight },
                      { value: "dark", label: s.quranMarkerDark },
                      { value: "sepia", label: s.quranMarkerSepia },
                    ]}
                    dir={isRTL ? "rtl" : "ltr"}
                  />
                </View>
              )}
            </SettingsSection>

            <SettingsSection title={s.readingSettingsTafsir} isRTL={isRTL}>
              <Pressable
                onPress={() => setTafseerPickerVisible(true)}
                className="items-center justify-between gap-3 rounded-3xl bg-surface-high dark:bg-surface-dark-high px-4 py-4"
                style={({ pressed }) => ({
                  direction: isRTL ? "rtl" : "ltr",
                  flexDirection: "row",
                  opacity: pressed ? 0.78 : 1,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                })}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 14,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.tafseerSourceLabel}
                  </Text>
                  <Text
                    className="mt-1 text-warm-400 dark:text-neutral-500"
                    numberOfLines={2}
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {currentTafseerTitle}
                  </Text>
                </View>
                {importingTafseerSource ? (
                  <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : (
                  <ChevronDown size={18} color={mutedColor} />
                )}
              </Pressable>
            </SettingsSection>
          </View>
        </OverlayBody>
      </ResponsiveSheet>

      <TafsirSourcePicker
        visible={tafseerPickerVisible}
        selectedSource={tafseerSource}
        importingSource={importingTafseerSource}
        onSelect={handleTafseerSourceSelect}
        onClose={() => setTafseerPickerVisible(false)}
        helperText={s.tafseerPanelDownloadHint}
      />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}

function SettingsSection({
  title,
  isRTL,
  children,
}: {
  title: string;
  isRTL: boolean;
  children: ReactNode;
}) {
  return (
    <View>
      <Text
        className="mb-3 text-warm-400 dark:text-neutral-500"
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 12,
          textAlign: isRTL ? "right" : "left",
          textTransform: "uppercase",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
      <View className="rounded-3xl bg-surface-low dark:bg-surface-dark-low p-3">
        {children}
      </View>
    </View>
  );
}

function ControlLabel({ label, isRTL }: { label: string; isRTL: boolean }) {
  return (
    <Text
      className="mb-2 text-charcoal dark:text-neutral-200"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 13,
        textAlign: isRTL ? "right" : "left",
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {label}
    </Text>
  );
}

function SettingsStepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  return (
    <View
      className="self-start rounded-full bg-surface dark:bg-surface-dark p-1"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={onDecrement}
        disabled={decrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: decrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !decrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Minus size={17} color={iconColor} />
      </Pressable>
      <View className="min-w-16 items-center justify-center px-3">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}
        >
          {value}
        </Text>
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={incrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: incrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !incrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Plus size={17} color={iconColor} />
      </Pressable>
    </View>
  );
}
