import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Check, ChevronLeft, ChevronRight, Download } from "lucide-react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import {
  AVAILABLE_TAFSIR_SOURCES,
  BUNDLED_TAFSIR_SOURCE_IDS,
  isAvailableTafsirSourceId,
  isBundledTafsirSourceId,
  type TafsirSourceConfig,
  type TafsirSourceId,
} from "@/lib/tafsir/sources";

type Props = {
  visible: boolean;
  selectedSource: TafsirSourceId;
  importingSource: TafsirSourceId | null;
  onSelect: (sourceId: TafsirSourceId) => Promise<boolean>;
  onClose: () => void;
  helperText?: string;
};

type TafsirSourceCount = {
  source: string;
  count: number;
};

function sourceIsComplete(source: TafsirSourceConfig, count: number) {
  if (isBundledTafsirSourceId(source.id)) return count > 0;
  return count >= (source.expectedRows ?? 6236);
}

export function TafsirSourcePicker({
  visible,
  selectedSource,
  importingSource,
  onSelect,
  onClose,
  helperText,
}: Props) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [pressedSource, setPressedSource] = useState<TafsirSourceId | null>(null);
  const [importedSourceIds, setImportedSourceIds] = useState<TafsirSourceId[]>([]);

  const importedSources = useMemo(
    () => new Set<TafsirSourceId>([...BUNDLED_TAFSIR_SOURCE_IDS, ...importedSourceIds]),
    [importedSourceIds]
  );

  const refreshImportedSources = useCallback(async () => {
    const rows = await db.getAllAsync<TafsirSourceCount>(
      "SELECT source, COUNT(*) as count FROM tafseer GROUP BY source"
    );
    const nextSources = rows.flatMap<TafsirSourceId>((row) => {
      if (!isAvailableTafsirSourceId(row.source)) return [];
      const source = AVAILABLE_TAFSIR_SOURCES.find((item) => item.id === row.source);
      return source && sourceIsComplete(source, row.count) ? [source.id] : [];
    });
    setImportedSourceIds(nextSources);
  }, [db]);

  useEffect(() => {
    if (!visible) {
      setPressedSource(null);
      return;
    }
    refreshImportedSources().catch(console.warn);
  }, [visible, importingSource, refreshImportedSources]);

  const handleSelect = (sourceId: TafsirSourceId, needsDownload: boolean) => {
    if (importingSource) return;
    if (sourceId === selectedSource && !needsDownload) {
      onClose();
      return;
    }

    const selection = onSelect(sourceId);
    if (needsDownload) {
      void selection.then((selected) => {
        if (selected) refreshImportedSources().catch(console.warn);
      }).catch(console.warn);
      return;
    }

    void selection.then((selected) => {
      if (selected) onClose();
    }).catch(console.warn);
  };

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={520}
      maxHeight="80%"
    >
      <OverlayHeader
        title={s.tafseerSourceLabel}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />

      <OverlayBody contentContainerClassName="px-5 pt-2 pb-6">
        <Text
          className="mb-3 text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            lineHeight: 20,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {helperText ?? s.tafseerDownloadHint}
        </Text>

        <View className="gap-1">
          {AVAILABLE_TAFSIR_SOURCES.map((source) => {
            const isSelected = source.id === selectedSource;
            const isPressed = source.id === pressedSource;
            const isImporting = source.id === importingSource;
            const isIncluded = isBundledTafsirSourceId(source.id);
            const isDownloaded = importedSources.has(source.id);
            const needsDownload = !isDownloaded;
            const title = s[source.labelKey] ?? source.id;
            const description = s[source.descriptionKey] ?? "";
            const statusText = isImporting
              ? s.tafseerDownloading
              : needsDownload
                ? s.tafseerDownloadAction
                : isSelected
                  ? s.tafseerSelected
                  : isIncluded
                    ? s.tafseerIncluded
                    : s.tafseerDownloaded;

            return (
              <Pressable
                key={source.id}
                onPress={() => handleSelect(source.id, needsDownload)}
                disabled={!!importingSource}
                accessibilityRole="button"
                onPressIn={() => setPressedSource(source.id)}
                onPressOut={() => setPressedSource(null)}
                className="flex-row items-center justify-between gap-3 rounded-2xl px-3 py-3.5"
                style={({ pressed }) => ({
                  direction: isRTL ? "rtl" : "ltr",
                  backgroundColor: isSelected
                    ? isDark
                      ? "rgba(45,212,191,0.08)"
                      : "rgba(13,148,136,0.06)"
                    : isPressed || pressed
                      ? isDark
                        ? "rgba(45,212,191,0.04)"
                        : "rgba(13,148,136,0.03)"
                      : "transparent",
                  opacity: importingSource && !isImporting ? 0.45 : 1,
                  cursor: Platform.OS === "web" ? (importingSource ? "auto" : "pointer") : undefined,
                })}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className={isSelected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
                    style={{
                      fontFamily: isSelected ? "Manrope_600SemiBold" : "Manrope_500Medium",
                      fontSize: 15,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {title}
                  </Text>
                  <Text
                    className="mt-0.5 text-warm-400 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {description}
                  </Text>
                  <Text
                    className={needsDownload ? "mt-1 text-primary-accent dark:text-primary-bright" : "mt-1 text-warm-400 dark:text-neutral-500"}
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 11,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {statusText}
                  </Text>
                </View>

                {isImporting ? (
                  <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : needsDownload ? (
                  <Download size={19} color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : isSelected ? (
                  <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : (
                  <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
                )}
              </Pressable>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
