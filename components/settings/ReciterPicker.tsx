import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { toArabicNumber } from "@/lib/arabic";
import { fetchQfReciters, type QfContentReciter } from "@/lib/quran-foundation/content";
import { RECITERS, getReciterById, type QfReciter } from "@/lib/quran-foundation/recitations";
import { useSettings } from "@/lib/settings/context";

type Props = {
  visible: boolean;
  selectedId: number;
  onSelect: (id: number) => void;
  onClose: () => void;
};

export function ReciterPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [reciters, setReciters] = useState<QfReciter[]>(RECITERS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    fetchQfReciters(uiLanguage)
      .then((response) => {
        if (cancelled) return;
        if (response.ok && response.reciters.length > 0) {
          setReciters(mergeReciters(response.reciters.map((reciter) => toSettingsReciter(reciter, uiLanguage)), RECITERS));
        } else {
          setReciters(RECITERS);
        }
      })
      .catch(() => {
        if (!cancelled) setReciters(RECITERS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uiLanguage, visible]);

  const pickerReciters = reciters.some((reciter) => reciter.id === selectedId)
    ? reciters
    : [getReciterById(selectedId), ...reciters].filter(
        (reciter, index, list) => list.findIndex((item) => item.id === reciter.id) === index
      );

  const handleSelect = (id: number) => {
    onSelect(id);
    onClose();
  };

  return (
    <ResponsiveSheet open={visible} onClose={onClose} dismissOnBackdrop maxWidth={560} maxHeight="82%">
      <OverlayHeader
        title={s.recitationReciterPickerTitle}
        subtitle={s.recitationReciterPickerSubtitle}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pt-2 pb-6">
        {loading && (
          <View className={`mb-3 flex-row items-center gap-2 px-3 ${isRTL ? "flex-row-reverse" : ""}`}>
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
            >
              {s.recitationRecitersLoading}
            </Text>
          </View>
        )}
        <View className="gap-1">
          {pickerReciters.map((reciter) => {
            const selected = reciter.id === selectedId;
            const reciterNumber = isRTL ? toArabicNumber(reciter.id) : String(reciter.id);
            return (
              <Pressable
                key={reciter.id}
                onPress={() => handleSelect(reciter.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={`w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: selected
                    ? isDark
                      ? "rgba(45,212,191,0.08)"
                      : "rgba(13,148,136,0.06)"
                    : pressed
                      ? isDark
                        ? "rgba(45,212,191,0.04)"
                        : "rgba(13,148,136,0.03)"
                      : isDark
                        ? "rgba(255,255,255,0.025)"
                        : "rgba(255,255,255,0.42)",
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  justifyContent: "space-between",
                  width: "100%",
                })}
              >
                <View
                  className="h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                  style={{
                    backgroundColor: selected
                      ? isDark
                        ? "rgba(45,212,191,0.16)"
                        : "rgba(13,148,136,0.12)"
                      : isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(95,78,64,0.08)",
                  }}
                >
                  <Text
                    className={selected ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
                  >
                    {reciterNumber}
                  </Text>
                </View>
                <View className={`min-w-0 flex-1 gap-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
                    style={{
                      fontFamily: selected ? "Manrope_700Bold" : "Manrope_600SemiBold",
                      fontSize: 15,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                    numberOfLines={1}
                  >
                    {uiLanguage === "ar" ? reciter.nameAr : reciter.nameEn}
                  </Text>
                  <View style={{ alignItems: isRTL ? "flex-end" : "flex-start" }}>
                    <View
                      className="rounded-full px-2.5 py-1"
                      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(95,78,64,0.07)" }}
                    >
                      <Text
                        className="text-warm-500 dark:text-neutral-400"
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          fontSize: 11,
                          textAlign: isRTL ? "right" : "left",
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {uiLanguage === "ar" ? reciter.styleAr : reciter.styleEn}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full">
                  {selected ? (
                    <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  ) : (
                    <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function toSettingsReciter(reciter: QfContentReciter, language: "en" | "ar"): QfReciter {
  const fallback = getReciterById(reciter.id);
  const translatedName = reciter.translatedName?.trim();
  const sourceName = reciter.reciterName.trim();
  const style = reciter.style.trim();
  return {
    id: reciter.id,
    nameEn: language === "en" ? translatedName || sourceName : fallback.nameEn,
    nameAr: language === "ar" ? translatedName || sourceName : fallback.nameAr,
    styleEn: language === "en" ? style || fallback.styleEn : fallback.styleEn,
    styleAr: language === "ar" ? localizeRecitationStyle(style) || fallback.styleAr : fallback.styleAr,
  };
}

function localizeRecitationStyle(style: string): string {
  const normalized = style.trim().toLowerCase();
  if (normalized === "murattal") return "مرتل";
  if (normalized === "mujawwad") return "مجود";
  if (normalized === "muallim") return "معلم";
  return style;
}

function mergeReciters(primary: QfReciter[], fallback: QfReciter[]): QfReciter[] {
  const byId = new Map<number, QfReciter>();
  fallback.forEach((reciter) => byId.set(reciter.id, reciter));
  primary.forEach((reciter) => byId.set(reciter.id, reciter));
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}
