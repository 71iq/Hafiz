import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";

export type SurahInfoTarget = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
};

type SurahInfoRow = {
  surah: number;
  language: "en" | "ar";
  summary: string;
  sections_json: string;
  source_name: string;
  source_url: string | null;
};

type SurahInfoSection = {
  title?: string | null;
  body: string;
};

type LoadedSurahInfo = {
  language: "en" | "ar";
  summary: string;
  sections: SurahInfoSection[];
  sourceName: string;
  sourceUrl: string | null;
};

export function SurahInfoModal({
  target,
  onClose,
}: {
  target: SurahInfoTarget | null;
  onClose: () => void;
}) {
  const db = useDatabase();
  const { uiLanguage, isRTL, isDark } = useSettings();
  const s = useStrings();
  const [info, setInfo] = useState<LoadedSurahInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setInfo(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    db.getAllAsync<SurahInfoRow>(
      "SELECT surah, language, summary, sections_json, source_name, source_url FROM surah_info WHERE surah = ?",
      [target.surahNumber]
    )
      .then((rows) => {
        if (cancelled) return;
        const selected = rows.find((row) => row.language === uiLanguage) ?? rows.find((row) => row.language === "en") ?? rows[0];
        setInfo(selected ? normalizeInfo(selected) : null);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [db, target?.surahNumber, uiLanguage]);

  const contentIsRTL = info?.language === "ar";
  const title = target ? (uiLanguage === "ar" ? target.nameArabic : target.nameEnglish) : s.surahInfoTitle;
  const subtitle = target ? `${s.surahInfoTitle} · ${target.surahNumber}` : s.surahInfoTitle;
  const sections = useMemo(() => info?.sections.filter((section) => section.body.trim().length > 0) ?? [], [info]);

  return (
    <ResponsiveSheet
      open={!!target}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={760}
      maxHeight="86%"
    >
      <OverlayHeader
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pt-4 pb-6">
        {loading ? (
          <View className="min-h-[160px] items-center justify-center">
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
            <Text
              className="mt-3 text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.surahInfoLoading}
            </Text>
          </View>
        ) : !info ? (
          <View className="min-h-[160px] justify-center rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-4">
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 14,
                lineHeight: 22,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.surahInfoUnavailable}
            </Text>
          </View>
        ) : (
          <View className="gap-5">
            {sections.map((section, index) => (
              <View key={`${section.title ?? "section"}-${index}`} className="gap-2">
                {!!section.title && (
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{
                      fontFamily: "Manrope_700Bold",
                      fontSize: 16,
                      lineHeight: 24,
                      textAlign: contentIsRTL ? "right" : "left",
                      writingDirection: contentIsRTL ? "rtl" : "ltr",
                    }}
                  >
                    {section.title}
                  </Text>
                )}
                <Text
                  className="text-warm-700 dark:text-neutral-300"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 15,
                    lineHeight: 27,
                    textAlign: contentIsRTL ? "right" : "left",
                    writingDirection: contentIsRTL ? "rtl" : "ltr",
                  }}
                >
                  {section.body}
                </Text>
              </View>
            ))}

          </View>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function normalizeInfo(row: SurahInfoRow): LoadedSurahInfo {
  return {
    language: row.language,
    summary: row.summary,
    sections: parseSections(row.sections_json, row.summary),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
  };
}

function parseSections(value: string, fallback: string): SurahInfoSection[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const sections = parsed
        .map((section) => ({
          title: typeof section?.title === "string" ? section.title : null,
          body: typeof section?.body === "string" ? section.body : "",
        }))
        .filter((section) => section.body.trim().length > 0);
      if (sections.length > 0) return sections;
    }
  } catch (_) {}
  return fallback.trim() ? [{ title: null, body: fallback }] : [];
}
