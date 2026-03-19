import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { View, Text, Pressable } from "react-native";
import {
  loadQpcFont,
  qpcFontName,
  isQpcFontLoaded,
} from "@/lib/fonts/loader";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";
import { WordToken } from "./WordToken";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  text: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  hideMode?: boolean;
};

function AyahBlockInner({
  surah,
  ayah,
  text,
  v2Page,
  fontSize,
  lineHeight,
  hideMode = false,
}: Props) {
  const db = useDatabase();
  const {
    showTranslation: defaultShowTranslation,
    showTafseer: defaultShowTafseer,
    translationLanguage,
    isTranslationLoading,
    isRTL,
  } = useSettings();
  const langInfo = getLanguageByCode(translationLanguage);
  const isTranslationRtl = langInfo?.direction === "rtl";
  const s = useStrings();

  const [fontVisible, setFontVisible] = useState(() =>
    isQpcFontLoaded(v2Page)
  );
  const [revealed, setRevealed] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [tafseerOpen, setTafseerOpen] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafseerText, setTafseerText] = useState<string | null>(null);

  // Split QCF2 text into word tokens (last token is ayah end marker)
  const wordTokens = useMemo(() => {
    const tokens = text.split(" ").filter(Boolean);
    if (tokens.length <= 1) return { words: [], marker: tokens[0] ?? "" };
    return {
      words: tokens.slice(0, -1),
      marker: tokens[tokens.length - 1],
    };
  }, [text]);

  // Sync with global defaults when they change
  useEffect(() => {
    setTranslationOpen(defaultShowTranslation);
  }, [defaultShowTranslation]);

  useEffect(() => {
    setTafseerOpen(defaultShowTafseer);
  }, [defaultShowTafseer]);

  useEffect(() => {
    if (isQpcFontLoaded(v2Page)) {
      setFontVisible(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(v2Page).then(() => {
      if (!cancelled) {
        requestAnimationFrame(() => setFontVisible(true));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [v2Page]);

  // Reset cached text when FlashList reuses component with different ayah
  useEffect(() => {
    setTranslationText(null);
    setTafseerText(null);
  }, [surah, ayah]);

  // Track which language the cached translation belongs to
  const fetchedLangRef = useRef(translationLanguage);

  // Fetch translation on-demand; re-fetch when language changes or import completes
  useEffect(() => {
    if (!translationOpen || isTranslationLoading) return;

    const langChanged = fetchedLangRef.current !== translationLanguage;
    if (!langChanged && translationText !== null) return;

    // Reset stale text from previous language
    if (langChanged) {
      setTranslationText(null);
      fetchedLangRef.current = translationLanguage;
    }

    if (translationLanguage === DEFAULT_LANGUAGE) {
      db.getFirstAsync<{ text_en: string }>(
        "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
        [surah, ayah]
      ).then((row) => {
        setTranslationText(row?.text_en ?? "");
      }).catch(console.warn);
    } else {
      db.getFirstAsync<{ text: string }>(
        "SELECT text FROM translation_active WHERE surah = ? AND ayah = ?",
        [surah, ayah]
      ).then((row) => {
        setTranslationText(row?.text ?? "");
      }).catch(console.warn);
    }
  }, [translationOpen, surah, ayah, db, translationText, translationLanguage, isTranslationLoading]);

  // Fetch tafseer on-demand
  useEffect(() => {
    if (!tafseerOpen || tafseerText !== null) return;
    db.getFirstAsync<{ text: string }>(
      "SELECT text FROM tafseer WHERE surah = ? AND ayah = ?",
      [surah, ayah]
    ).then((row) => {
      setTafseerText(row?.text ?? "");
    }).catch(console.warn);
  }, [tafseerOpen, surah, ayah, db, tafseerText]);

  // Reset revealed state when hideMode changes
  useEffect(() => {
    setRevealed(false);
  }, [hideMode]);

  const toggleTranslation = useCallback(() => {
    setTranslationOpen((prev) => !prev);
  }, []);

  const toggleTafseer = useCallback(() => {
    setTafseerOpen((prev) => !prev);
  }, []);

  const handleReveal = useCallback(() => {
    if (hideMode) setRevealed((prev) => !prev);
  }, [hideMode]);

  const isBlurred = hideMode && !revealed;
  const fontFamily = qpcFontName(v2Page);

  return (
    <View className="border-b border-warm-100 dark:border-neutral-800 mx-4">
      {/* Ayah number badge */}
      <View className="flex-row items-center justify-between px-2 pt-3 pb-1">
        <View className="flex-row items-center gap-2">
          <View className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/40 items-center justify-center border border-teal-200 dark:border-teal-700">
            <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
              {surah}:{ayah}
            </Text>
          </View>
        </View>
      </View>

      {/* Arabic text (QCF2) — interactive word tokens */}
      {isBlurred ? (
        <Pressable onPress={handleReveal} className="px-2 pb-3 pt-1">
          <View
            className="rounded-xl bg-warm-100 dark:bg-neutral-800 items-center justify-center"
            style={{ height: lineHeight + 16 }}
          >
            <Text className="text-warm-400 dark:text-neutral-500 text-sm">
              {s.tapToReveal}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View className="px-2 pb-3 pt-1" style={{ opacity: fontVisible ? 1 : 0 }}>
          <View
            style={{
              // In RTL context (Arabic UI), direction:rtl already flows row right-to-left,
              // so "row" is correct. In LTR context, "row-reverse" simulates RTL.
              flexDirection: isRTL ? "row" : "row-reverse",
              flexWrap: "wrap",
              justifyContent: "flex-start",
              alignItems: "center",
              gap: 2,
            }}
          >
            {wordTokens.words.map((glyph, i) => (
              <WordToken
                key={`${surah}-${ayah}-w${i}`}
                glyph={glyph}
                fontFamily={fontFamily}
                fontSize={fontSize}
                lineHeight={lineHeight}
                surah={surah}
                ayah={ayah}
                wordPos={i + 1}
                v2Page={v2Page}
                disabled={hideMode}
              />
            ))}
            {/* Ayah end marker */}
            {wordTokens.marker && (
              <Text
                className="text-warm-900 dark:text-neutral-100"
                style={{ fontFamily, fontSize, lineHeight }}
              >
                {wordTokens.marker}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Collapsible sections */}
      <View className="px-2 pb-2">
        {/* Translation toggle */}
        <Pressable
          onPress={toggleTranslation}
          className="flex-row items-center justify-between py-2"
        >
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider">
            {langInfo?.nameEnglish ?? "Translation"}
          </Text>
          {translationOpen ? (
            <ChevronUp size={14} color="#a8a29e" />
          ) : (
            <ChevronDown size={14} color="#a8a29e" />
          )}
        </Pressable>
        {translationOpen && (
          <View className="pb-3">
            <Text
              className="text-sm text-warm-500 dark:text-neutral-400 leading-5"
              style={isTranslationRtl ? { writingDirection: "rtl", textAlign: "right" } : undefined}
            >
              {translationText ?? s.loading}
            </Text>
          </View>
        )}

        {/* Tafseer toggle */}
        <Pressable
          onPress={toggleTafseer}
          className="flex-row items-center justify-between py-2 border-t border-warm-50 dark:border-neutral-800/50"
        >
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider">
            {s.tafseer}
          </Text>
          {tafseerOpen ? (
            <ChevronUp size={14} color="#a8a29e" />
          ) : (
            <ChevronDown size={14} color="#a8a29e" />
          )}
        </Pressable>
        {tafseerOpen && (
          <View className="pb-3">
            <Text
              className="text-sm text-warm-600 dark:text-neutral-300 leading-6"
              style={{ writingDirection: "rtl", textAlign: "right" }}
            >
              {tafseerText ?? "...جاري التحميل"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);
