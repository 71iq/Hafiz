import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Check, ChevronLeft, ChevronRight, Download } from "lucide-react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { stringByKey, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useTafsirSourceSelection } from "@/lib/settings/use-tafsir-source-selection";
import {
  AVAILABLE_TAFSIR_SOURCES,
  BUNDLED_TAFSIR_SOURCE_IDS,
  isAvailableTafsirSourceId,
  isBundledTafsirSourceId,
  type TafsirSourceConfig,
  type TafsirSourceId,
} from "@/lib/tafsir/sources";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  selectedSource: TafsirSourceId;
  onSelected: (sourceId: TafsirSourceId) => void;
  onClose: () => void;
  logLabel?: string;
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
  onSelected,
  onClose,
  logLabel = "[TafsirSourcePicker]",
  helperText,
}: Props) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  const netInfo = useNetInfo();
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const accentColor = isDark ? "#2dd4bf" : "#0d9488";
  const [importedSourceIds, setImportedSourceIds] = useState<TafsirSourceId[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const rowOffsets = useRef(new Map<TafsirSourceId, number>());
  const sectionOffsets = useRef(new Map<"installed" | "available", number>());
  const scrolledForOpen = useRef(false);

  const handleError = useCallback(
    (error: unknown) => console.warn(`${logLabel} Failed to import tafsir source:`, error),
    [logLabel],
  );
  const { importingSource, failedSource, select, cancel } = useTafsirSourceSelection({
    db,
    onSelected,
    onError: handleError,
  });

  const installedSources = useMemo(
    () => new Set<TafsirSourceId>([...BUNDLED_TAFSIR_SOURCE_IDS, ...importedSourceIds]),
    [importedSourceIds],
  );
  const installedRows = AVAILABLE_TAFSIR_SOURCES.filter((source) => installedSources.has(source.id));
  const availableRows = AVAILABLE_TAFSIR_SOURCES.filter((source) => !installedSources.has(source.id));

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
      cancel();
      scrolledForOpen.current = false;
      return;
    }
    refreshImportedSources().catch(console.warn);
  }, [visible, importingSource, refreshImportedSources, cancel]);

  const handleClose = () => {
    cancel();
    onClose();
  };

  const choose = (sourceId: TafsirSourceId, needsDownload: boolean) => {
    if (sourceId === importingSource) return;
    if (sourceId === selectedSource && !needsDownload) {
      handleClose();
      return;
    }
    void select(sourceId, needsDownload).then((outcome) => {
      if (outcome === "selected") onClose();
    });
  };

  const scrollToSelected = () => {
    if (scrolledForOpen.current || !visible) return;
    const section = installedSources.has(selectedSource) ? "installed" : "available";
    const sectionY = sectionOffsets.current.get(section);
    const rowY = rowOffsets.current.get(selectedSource);
    if (sectionY == null || rowY == null) return;
    scrolledForOpen.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionY + rowY - 24), animated: false });
  };

  const renderRow = (source: TafsirSourceConfig, needsDownload: boolean) => {
    const isSelected = source.id === selectedSource && !needsDownload;
    const isImporting = source.id === importingSource;
    const isFailed = source.id === failedSource;
    const isIncluded = isBundledTafsirSourceId(source.id);
    const disabled = isImporting || (needsDownload && importingSource !== null);
    const title = stringByKey(s, source.labelKey, source.id);
    const description = stringByKey(s, source.descriptionKey);
    const statusText = isImporting
      ? s.tafseerDownloading
      : isFailed
        ? needsDownload
          ? offline
            ? s.tafsirDownloadOffline
            : s.tafsirDownloadFailed
          : s.tafseerSourceImportFailed
        : needsDownload
          ? s.tafseerDownloadAction
          : isSelected
            ? s.tafseerSelected
            : isIncluded
              ? s.tafseerIncluded
              : s.tafseerDownloaded;

    return (
      <View
        key={source.id}
        onLayout={(event) => {
          rowOffsets.current.set(source.id, event.nativeEvent.layout.y);
          if (source.id === selectedSource) scrollToSelected();
        }}
      >
        <DisclosureRow
          onPress={() => choose(source.id, needsDownload)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected, busy: isImporting, disabled }}
          accessibilityLabel={isIncluded ? `${title}, ${s.tafsirOfflineTag}, ${statusText}` : `${title}, ${statusText}`}
          className={`items-center justify-between gap-3 rounded-2xl px-3 py-3.5 ${
            isSelected ? "bg-primary-soft/10 dark:bg-primary-bright/10" : ""
          }`}
          dir={isRTL ? "rtl" : "ltr"}
          style={({ pressed }) => ({
            minHeight: 44,
            opacity: disabled && !isImporting ? 0.45 : pressed ? 0.8 : 1,
            cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined,
          })}
          trailing={
            isImporting ? (
              <ActivityIndicator size="small" color={accentColor} />
            ) : needsDownload ? (
              <Download size={19} color={accentColor} />
            ) : isSelected ? (
              <Check size={20} color={accentColor} />
            ) : (
              <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
            )
          }
        >
          <View className="items-center gap-2" style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", flexWrap: "wrap" }}>
            <Text
              className={isSelected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
              style={{
                fontFamily: isSelected ? "Manrope_600SemiBold" : "Manrope_500Medium",
                fontSize: 15,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {title}
            </Text>
            {isIncluded ? (
              <Text
                className="rounded-full bg-primary-accent/10 px-2 py-0.5 text-primary-accent dark:bg-primary-bright/15 dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              >
                {s.tafsirOfflineTag}
              </Text>
            ) : null}
          </View>
          <Text
            className="mt-0.5 text-warm-500 dark:text-neutral-400"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 13,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {description}
          </Text>
          <Text
            accessibilityLiveRegion={isFailed ? "polite" : undefined}
            className={
              isFailed
                ? "mt-1 text-red-600 dark:text-red-400"
                : needsDownload
                  ? "mt-1 text-primary-accent dark:text-primary-bright"
                  : "mt-1 text-warm-500 dark:text-neutral-400"
            }
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 12,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {statusText}
          </Text>
        </DisclosureRow>
        {isFailed ? (
          <Pressable
            onPress={() => choose(source.id, needsDownload)}
            disabled={importingSource !== null}
            accessibilityRole="button"
            accessibilityLabel={`${s.detailRetry}, ${title}`}
            className={`mx-3 mb-2 min-h-[44px] justify-center rounded-full bg-surface-low px-4 dark:bg-surface-dark-low ${
              isRTL ? "self-end" : "self-start"
            }`}
            style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
          >
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {s.detailRetry}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const sectionLabel = (label: string) => (
    <Text
      accessibilityRole="header"
      className="mb-1 mt-2 px-3 text-warm-500 dark:text-neutral-400"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 12,
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {label}
    </Text>
  );

  return (
    <ResponsiveSheet
      open={visible}
      onClose={handleClose}
      dismissOnBackdrop
      maxWidth={520}
      maxHeight="80%"
    >
      <OverlayHeader
        title={s.tafseerSourceLabel}
        onClose={handleClose}
        showHandle
        isRTL={isRTL}
      />

      <OverlayBody scrollRef={scrollRef} contentContainerClassName="px-5 pt-2 pb-6">
        <Text
          className="mb-3 text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            lineHeight: 20,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {helperText ?? s.tafseerDownloadHint}
        </Text>

        <View
          className="gap-1"
          onLayout={(event) => {
            sectionOffsets.current.set("installed", event.nativeEvent.layout.y);
            scrollToSelected();
          }}
        >
          {sectionLabel(s.tafsirPickerOnDevice)}
          {installedRows.map((source) => renderRow(source, false))}
        </View>

        {availableRows.length > 0 ? (
          <View
            className="mt-4 gap-1"
            onLayout={(event) => {
              sectionOffsets.current.set("available", event.nativeEvent.layout.y);
              scrollToSelected();
            }}
          >
            {sectionLabel(s.tafsirPickerAvailable)}
            {availableRows.map((source) => renderRow(source, true))}
          </View>
        ) : null}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
