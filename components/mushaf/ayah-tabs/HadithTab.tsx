import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import {
  readCachedAyahHadiths,
  writeCachedAyahHadiths,
  type CachedQfHadith,
} from "@/lib/quran-foundation/cache";
import {
  fetchQfAyahHadiths,
  type QfContentError,
  type QfHadith,
  type QfHadithResponse,
} from "@/lib/quran-foundation/content";

const HADITH_PAGE_SIZE = 4;

type Props = {
  surah: number;
  ayah: number;
};

export function HadithTab({ surah, ayah }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage, isDark, isRTL } = useSettings();
  const language = uiLanguage === "ar" ? "ar" : "en";
  const [pages, setPages] = useState<Record<number, QfHadithResponse>>({});
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<QfContentError | null>(null);

  const orderedPages = useMemo(
    () => Object.values(pages).sort((a, b) => a.page - b.page),
    [pages]
  );
  const hadiths = orderedPages.flatMap((page) => page.hadiths);
  const lastPage = orderedPages[orderedPages.length - 1];
  const hasMore = lastPage?.hasMore ?? false;
  const contentDirection = lastPage?.direction === "rtl" || language === "ar" ? "rtl" : "ltr";

  const applyPage = useCallback((response: QfHadithResponse | CachedQfHadith) => {
    setPages((prev) => ({
      ...prev,
      [response.page]: response,
    }));
  }, []);

  const loadPage = useCallback(
    async (page: number, forceRemote = false) => {
      setError(null);
      let cached: CachedQfHadith | null = null;
      if (!forceRemote) {
        cached = await readCachedAyahHadiths(db, surah, ayah, language, page, HADITH_PAGE_SIZE).catch((e) => {
          console.warn("[HadithTab] Cache read failed:", e);
          return null;
        });
        if (cached) {
          applyPage(cached);
          if (!cached.isStale) return;
        }
      }

      const response = await fetchQfAyahHadiths(surah, ayah, language, page, HADITH_PAGE_SIZE);
      if (!response.ok) {
        if (!cached) setError(response);
        return;
      }

      await writeCachedAyahHadiths(db, response, surah, ayah).catch((e) => {
        console.warn("[HadithTab] Cache write failed:", e);
      });
      applyPage(response);
    },
    [applyPage, ayah, db, language, surah]
  );

  useEffect(() => {
    let cancelled = false;
    setPages({});
    setError(null);
    setLoadingInitial(true);

    async function run() {
      await loadPage(1);
      if (!cancelled) setLoadingInitial(false);
    }

    run().catch((e) => {
      console.warn("[HadithTab] Load failed:", e);
      if (!cancelled) {
        setError({ ok: false, code: "upstream", message: "Hadith references unavailable." });
        setLoadingInitial(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const handleRetry = useCallback(async () => {
    setLoadingInitial(true);
    setPages({});
    await loadPage(1, true);
    setLoadingInitial(false);
  }, [loadPage]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await loadPage((lastPage?.page ?? 1) + 1);
    setLoadingMore(false);
  }, [hasMore, lastPage?.page, loadPage, loadingMore]);

  if (loadingInitial && hadiths.length === 0) {
    return (
      <View className="py-6 items-center">
        <ActivityIndicator color={isDark ? "#5eead4" : "#0d9488"} />
        <Text className="mt-3 text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {s.hadithLoading}
        </Text>
      </View>
    );
  }

  if (error && hadiths.length === 0) {
    return (
      <View className="py-5">
        <Text
          className="text-warm-600 dark:text-neutral-300"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 14,
            lineHeight: 22,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s.hadithOffline}
        </Text>
        <Pressable
          onPress={handleRetry}
          className="mt-3 self-start rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-4 py-2"
          style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
        >
          <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}>
            {s.hadithRetry}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (hadiths.length === 0) {
    return (
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
        {s.hadithEmpty}
      </Text>
    );
  }

  return (
    <View style={{ direction: contentDirection }}>
      {hadiths.map((hadith, index) => (
        <HadithCard
          key={`${hadith.collection ?? "hadith"}-${hadith.urn ?? index}-${hadith.hadithNumber ?? index}`}
          hadith={hadith}
          sourceLabel={s.hadithSource}
          direction={contentDirection}
          isDark={isDark}
        />
      ))}

      {hasMore && (
        <Pressable
          onPress={handleLoadMore}
          disabled={loadingMore}
          className="items-center rounded-full py-3"
          style={{ opacity: loadingMore ? 0.65 : 1 }}
        >
          {loadingMore ? (
            <ActivityIndicator color={isDark ? "#5eead4" : "#0d9488"} />
          ) : (
            <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}>
              {s.hadithLoadMore}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function HadithCard({
  hadith,
  sourceLabel,
  direction,
  isDark,
}: {
  hadith: QfHadith;
  sourceLabel: string;
  direction: "ltr" | "rtl" | string;
  isDark: boolean;
}) {
  const texts = Array.isArray(hadith.hadith) ? hadith.hadith : [];
  const align = direction === "rtl" ? "right" : "left";
  const source = [
    hadith.name,
    hadith.collection,
    hadith.hadithNumber ? `#${hadith.hadithNumber}` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <View className="mb-3 rounded-2xl bg-surface dark:bg-surface-dark px-4 py-3">
      {source ? (
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: 10,
            letterSpacing: 0,
            textTransform: "uppercase",
            textAlign: align,
            writingDirection: direction === "rtl" ? "rtl" : "ltr",
          }}
        >
          {sourceLabel}: {source}
        </Text>
      ) : null}

      {texts.map((text, index) => (
        <View key={`${text.urn ?? index}`} className={index > 0 ? "mt-3" : "mt-2"}>
          {text.chapterTitle ? (
            <Text
              className="mb-1 text-primary-accent dark:text-primary-bright"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 12,
                textAlign: align,
                writingDirection: direction === "rtl" ? "rtl" : "ltr",
              }}
            >
              {text.chapterTitle}
            </Text>
          ) : null}
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 14,
              lineHeight: 24,
              textAlign: align,
              writingDirection: direction === "rtl" ? "rtl" : "ltr",
            }}
          >
            {text.body ?? ""}
          </Text>
          {Array.isArray(text.grades) && text.grades.length > 0 ? (
            <View className="mt-2 flex-row flex-wrap gap-1.5" style={{ justifyContent: direction === "rtl" ? "flex-end" : "flex-start" }}>
              {text.grades.map((grade, gradeIndex) => (
                <View
                  key={`${grade.graded_by ?? "grade"}-${gradeIndex}`}
                  className="rounded-full px-2 py-1"
                  style={{ backgroundColor: isDark ? "#163333" : "#EAF7F4" }}
                >
                  <Text
                    className="text-primary-accent dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
                  >
                    {[grade.grade, grade.graded_by].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
