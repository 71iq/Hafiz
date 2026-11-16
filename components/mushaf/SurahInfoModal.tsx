import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { toArabicNumber } from "@/lib/arabic";
import { findJuzForAyah, loadMushafIndex } from "@/lib/mushaf/position";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { textStartStyle } from "@/lib/ui/direction";

export type SurahInfoTarget = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
  ayahCount?: number;
  revelationType?: string;
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [juzRange, setJuzRange] = useState<{ first: number; last: number } | null>(null);

  useEffect(() => {
    if (!target) {
      setJuzRange(null);
      return;
    }
    let cancelled = false;
    loadMushafIndex(db)
      .then((index) => {
        if (cancelled) return;
        const first = findJuzForAyah(index, target.surahNumber, 1);
        const last = target.ayahCount ? findJuzForAyah(index, target.surahNumber, target.ayahCount) : first;
        setJuzRange({ first, last });
      })
      .catch(() => {
        if (!cancelled) setJuzRange(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, target?.surahNumber, target?.ayahCount]);

  useEffect(() => {
    if (!target) {
      setInfo(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
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
        if (!cancelled) {
          setInfo(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [db, target?.surahNumber, uiLanguage, attempt]);

  const contentIsRTL = info?.language === "ar";
  const title = target ? (uiLanguage === "ar" ? target.nameArabic : target.nameEnglish) : s.surahInfoTitle;
  const subtitle = target
    ? `${s.surahInfoTitle}${uiLanguage === "ar" ? "، " : " · "}${uiLanguage === "ar" ? toArabicNumber(target.surahNumber) : target.surahNumber}`
    : s.surahInfoTitle;
  const sections = useMemo(() => info?.sections.filter((section) => section.body.trim().length > 0) ?? [], [info]);
  const digits = (value: number) => (uiLanguage === "ar" ? toArabicNumber(value) : String(value));
  const shownInEnglish = !!info && uiLanguage !== info.language && info.language === "en";
  const facts = target
    ? [
        target.revelationType ? (target.revelationType === "Makkiyah" ? s.meccan : s.medinan) : null,
        target.ayahCount ? `${digits(target.ayahCount)} ${s.ayahs}` : null,
        juzRange
          ? juzRange.first === juzRange.last
            ? `${s.tabJuz} ${digits(juzRange.first)}`
            : `${s.tabJuz} ${digits(juzRange.first)}-${digits(juzRange.last)}`
          : null,
      ].filter((fact): fact is string => !!fact)
    : [];
  const writingDirection = isRTL ? "rtl" : "ltr";

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
        {shownInEnglish ? (
          <Text
            className="mb-3 text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection }}
          >
            {s.surahInfoShownInEnglish}
          </Text>
        ) : null}
        {facts.length > 0 ? (
          <View className="mb-4 flex-row flex-wrap gap-2" style={{ direction: writingDirection }}>
            {facts.map((fact) => (
              <View key={fact} className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5">
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                  {fact}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
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
        ) : failed ? (
          <View className="min-h-[160px] items-center justify-center gap-3 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-4">
            <Text
              className="text-warm-600 dark:text-neutral-300 text-center"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14, lineHeight: 22, writingDirection }}
            >
              {s.surahInfoLoadFailed}
            </Text>
            <Pressable
              onPress={() => setAttempt((value) => value + 1)}
              accessibilityRole="button"
              className="min-h-[44px] justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-5"
            >
              <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                {s.errorTryAgain}
              </Text>
            </Pressable>
          </View>
        ) : !info ? (
          <View className="min-h-[160px] justify-center rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-4">
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 14,
                lineHeight: 22,
                ...textStartStyle(isRTL),
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
                      ...textStartStyle(contentIsRTL),
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
                    ...textStartStyle(contentIsRTL),
                    writingDirection: contentIsRTL ? "rtl" : "ltr",
                  }}
                >
                  {section.body}
                </Text>
              </View>
            ))}

            {info.sourceName ? (
              <View className="flex-row flex-wrap items-center gap-1" style={{ direction: writingDirection }}>
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, writingDirection }}
                >
                  {s.surahInfoSourcePrefix}
                </Text>
                {info.sourceUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void Linking.openURL(info.sourceUrl!).catch(() => {});
                    }}
                    className="min-h-[44px] justify-center"
                  >
                    <Text
                      className="text-primary-accent dark:text-primary-bright underline"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                    >
                      {info.sourceName}
                    </Text>
                  </Pressable>
                ) : (
                  <Text className="text-warm-600 dark:text-neutral-300" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                    {info.sourceName}
                  </Text>
                )}
              </View>
            ) : null}
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
  } catch {}
  return fallback.trim() ? [{ title: null, body: fallback }] : [];
}
