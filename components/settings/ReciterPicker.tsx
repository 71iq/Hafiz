import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Check, Play, Search, Square } from "lucide-react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useOptionalAyahAudio, type AudioFailure } from "@/lib/audio/ayah-audio";
import { audioFailureMessage } from "@/lib/audio/labels";
import {
  buildReciterList,
  filterReciters,
  isReciterCatalogStale,
  readReciterCatalog,
  refreshReciterCatalog,
} from "@/lib/audio/reciter-catalog";
import type { QfReciter } from "@/lib/quran-foundation/recitations";
import { useSettings } from "@/lib/settings/context";
import { inputTextStartStyle, textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  selectedId: number;
  onSelect: (id: number) => void;
  onClose: () => void;
};

/** The loading row appears only when the list takes longer than this to arrive. */
const SLOW_FETCH_MS = 500;

export function ReciterPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const audio = useOptionalAyahAudio();
  const [remote, setRemote] = useState<{ language: "en" | "ar"; reciters: QfReciter[] } | null>(null);
  const [slowFetch, setSlowFetch] = useState(false);
  const [query, setQuery] = useState("");
  const [previewError, setPreviewError] = useState<{ id: number; failure: AudioFailure } | null>(null);
  const ownsPreviewRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Cached list first, then at most one background refresh a week; the bundled list covers failures.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    const language = uiLanguage;
    setSlowFetch(false);
    void (async () => {
      const cached = await readReciterCatalog(language);
      if (cancelled) return;
      if (cached) setRemote({ language, reciters: cached.reciters });
      if (!isReciterCatalogStale(cached)) return;
      if (!cached) slowTimer = setTimeout(() => !cancelled && setSlowFetch(true), SLOW_FETCH_MS);
      const fresh = await refreshReciterCatalog(language);
      if (slowTimer) clearTimeout(slowTimer);
      if (cancelled) return;
      setSlowFetch(false);
      if (fresh) setRemote({ language, reciters: fresh.reciters });
    })();
    return () => {
      cancelled = true;
      if (slowTimer) clearTimeout(slowTimer);
    };
  }, [uiLanguage, visible]);

  // A preview this picker started ends when it closes or unmounts.
  const stopPreview = audio?.stopPreview;
  useEffect(() => {
    if (visible) return;
    if (ownsPreviewRef.current) {
      ownsPreviewRef.current = false;
      stopPreview?.();
    }
    setQuery("");
    setPreviewError(null);
  }, [stopPreview, visible]);
  useEffect(
    () => () => {
      if (ownsPreviewRef.current) stopPreview?.();
    },
    [stopPreview]
  );

  const reciters = useMemo(
    () => buildReciterList(remote?.language === uiLanguage ? remote.reciters : null, selectedId, uiLanguage),
    [remote, selectedId, uiLanguage]
  );
  const shownReciters = useMemo(() => filterReciters(reciters, query), [query, reciters]);

  const session = audio?.session ?? null;
  const previewId = session?.kind === "preview" ? session.recitationId : null;
  const previewBusy = Boolean(audio?.mainActive);

  const handleClose = () => {
    if (ownsPreviewRef.current) {
      ownsPreviewRef.current = false;
      audio?.stopPreview();
    }
    onClose();
  };

  const handleSelect = (id: number) => {
    if (ownsPreviewRef.current) {
      ownsPreviewRef.current = false;
      audio?.stopPreview();
    }
    onSelect(id);
    onClose();
  };

  const handlePreview = async (id: number) => {
    if (!audio || previewBusy) return;
    setPreviewError(null);
    if (previewId === id) {
      ownsPreviewRef.current = false;
      audio.stopPreview();
      return;
    }
    ownsPreviewRef.current = true;
    const result = await audio.previewReciter(id);
    if (!result.ok && result.failure && result.failure !== "busy" && visibleRef.current) {
      setPreviewError({ id, failure: result.failure });
    }
  };

  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#8B8178";

  return (
    <ResponsiveSheet open={visible} onClose={handleClose} dismissOnBackdrop maxWidth={560} maxHeight="82%">
      <OverlayHeader
        title={s.recitationReciterPickerTitle}
        subtitle={s.recitationReciterPickerSubtitle}
        onClose={handleClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pt-2 pb-6">
        <View
          className="mb-3 h-12 items-center gap-2 rounded-2xl bg-surface-low px-3 dark:bg-surface-dark-low"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <Search size={17} color={muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={s.reciterSearch}
            accessibilityLabel={s.reciterSearch}
            placeholderTextColor={isDark ? "#737373" : "#b9a085"}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-12 min-w-0 flex-1 text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 15,
              ...inputTextStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          />
        </View>
        {slowFetch && (
          <View className={`mb-3 flex-row items-center gap-2 px-3 ${isRTL ? "flex-row-reverse" : ""}`}>
            <ActivityIndicator size="small" color={accent} />
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL) }}
            >
              {s.recitationRecitersLoading}
            </Text>
          </View>
        )}
        {previewBusy && audio && (
          <Text
            className="mb-3 px-1 text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
          >
            {s.reciterPreviewBusy}
          </Text>
        )}
        {shownReciters.length === 0 && (
          <Text
            className="px-1 py-4 text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL) }}
          >
            {s.reciterNoMatches}
          </Text>
        )}
        <View className="gap-1">
          {shownReciters.map((reciter) => {
            const selected = reciter.id === selectedId;
            const name = uiLanguage === "ar" ? reciter.nameAr : reciter.nameEn;
            const style = uiLanguage === "ar" ? reciter.styleAr : reciter.styleEn;
            const previewing = previewId === reciter.id;
            const previewLoading = previewing && session?.status === "loading";
            const error = previewError?.id === reciter.id ? audioFailureMessage(previewError.failure, s) : null;
            return (
              <View key={reciter.id}>
                <View
                  className="w-full items-center gap-2 rounded-2xl"
                  style={{
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    width: "100%",
                    backgroundColor: selected
                      ? isDark
                        ? "rgba(45,212,191,0.08)"
                        : "rgba(13,148,136,0.06)"
                      : isDark
                        ? "rgba(255,255,255,0.025)"
                        : "rgba(255,255,255,0.42)",
                  }}
                >
                  <Pressable
                    onPress={() => handleSelect(reciter.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${name}, ${style}`}
                    accessibilityState={{ selected }}
                    className="min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5"
                    style={({ pressed }) => ({
                      direction: "ltr",
                      flexDirection: isRTL ? "row-reverse" : "row",
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <View className={`min-w-0 flex-1 gap-0.5 ${isRTL ? "items-end" : "items-start"}`}>
                      <Text
                        className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
                        style={{
                          fontFamily: selected ? "Manrope_700Bold" : "Manrope_600SemiBold",
                          fontSize: 15,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {name}
                      </Text>
                      <Text
                        className="text-warm-500 dark:text-neutral-400"
                        style={{
                          fontFamily: "Manrope_500Medium",
                          fontSize: 12,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {style}
                      </Text>
                    </View>
                    <View className="h-6 w-6 shrink-0 items-center justify-center">
                      {selected ? <Check size={20} color={accent} /> : null}
                    </View>
                  </Pressable>
                  {audio && (
                    <Pressable
                      onPress={() => void handlePreview(reciter.id)}
                      disabled={previewBusy || previewLoading}
                      accessibilityRole="button"
                      accessibilityLabel={previewing ? s.reciterStopPreview : interpolate(s.reciterPreview, { name })}
                      accessibilityHint={previewBusy ? s.reciterPreviewBusy : undefined}
                      accessibilityState={{ disabled: previewBusy || previewLoading, busy: previewLoading }}
                      className="mx-1 h-11 w-11 shrink-0 items-center justify-center rounded-full"
                      style={({ pressed }) => ({ opacity: previewBusy ? 0.4 : pressed ? 0.7 : 1 })}
                    >
                      {previewLoading ? (
                        <ActivityIndicator size="small" color={accent} />
                      ) : previewing ? (
                        <Square size={16} color={accent} />
                      ) : (
                        <Play size={17} color={muted} />
                      )}
                    </Pressable>
                  )}
                </View>
                {error && (
                  <Text
                    accessibilityLiveRegion="polite"
                    className="px-3 pb-2 pt-1 text-red-600 dark:text-red-400"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
                  >
                    {error}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
