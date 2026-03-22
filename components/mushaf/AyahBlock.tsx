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
import { useSelection } from "@/lib/selection/context";
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
    tafseerSource,
    isRTL,
    isDark,
  } = useSettings();
  const langInfo = getLanguageByCode(translationLanguage);
  const isTranslationRtl = langInfo?.direction === "rtl";
  const s = useStrings();
  const { selectAyah, isBookmarked, getHighlightColor } = useSelection();

  const [fontVisible, setFontVisible] = useState(() =>
    isQpcFontLoaded(v2Page)
  );
  const [revealed, setRevealed] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [tafseerOpen, setTafseerOpen] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafseerText, setTafseerText] = useState<string | null>(null);
  const [tafseerExpanded, setTafseerExpanded] = useState(false);

  const wordTokens = useMemo(() => {
    const tokens = text.split(" ").filter(Boolean);
    if (tokens.length <= 1) return { words: [], marker: tokens[0] ?? "" };
    return {
      words: tokens.slice(0, -1),
      marker: tokens[tokens.length - 1],
    };
  }, [text]);

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

  useEffect(() => {
    setTranslationText(null);
    setTafseerText(null);
    setTafseerExpanded(false);
  }, [surah, ayah]);

  const fetchedLangRef = useRef(translationLanguage);

  useEffect(() => {
    if (!translationOpen || isTranslationLoading) return;

    const langChanged = fetchedLangRef.current !== translationLanguage;
    if (!langChanged && translationText !== null) return;

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

  const fetchedSourceRef = useRef(tafseerSource);

  useEffect(() => {
    if (!tafseerOpen) return;

    const sourceChanged = fetchedSourceRef.current !== tafseerSource;
    if (!sourceChanged && tafseerText !== null) return;

    if (sourceChanged) {
      setTafseerText(null);
      setTafseerExpanded(false);
      fetchedSourceRef.current = tafseerSource;
    }

    db.getFirstAsync<{ text: string }>(
      "SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = ?",
      [surah, ayah, tafseerSource]
    ).then((row) => {
      setTafseerText(row?.text ?? "");
    }).catch(console.warn);
  }, [tafseerOpen, surah, ayah, db, tafseerText, tafseerSource]);

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

  const handleBadgeLongPress = useCallback(() => {
    selectAyah(surah, ayah);
  }, [surah, ayah, selectAyah]);

  const isBlurred = hideMode && !revealed;
  const fontFamily = qpcFontName(v2Page);
  const bookmarked = isBookmarked(surah, ayah);
  const highlightColor = getHighlightColor(surah, ayah);

  // Muted chevron color — DESIGN.md tonal, not heavy
  const chevronColor = isDark ? "#525252" : "#DFD9D1";

  return (
    <View className="mx-5 py-1">
      {/* Ayah number badge — long-press for context menu */}
      <View className="flex-row items-center justify-between px-1 pt-4 pb-2">
        <View className="flex-row items-center gap-2">
          <Pressable
            onLongPress={handleBadgeLongPress}
            delayLongPress={300}
            hitSlop={8}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.95 : 1 }],
              // @ts-ignore — cursor is valid on web
              cursor: "pointer",
            })}
          >
            <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              >
                {surah}:{ayah}
              </Text>
              {/* Bookmark dot */}
              {bookmarked && (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: "#FDDC91",
                  }}
                />
              )}
            </View>
          </Pressable>
        </View>
      </View>

      {/* Arabic text (QCF2) — interactive word tokens */}
      {isBlurred ? (
        <Pressable onPress={handleReveal} className="px-1 pb-4 pt-1">
          <View
            className="rounded-2xl bg-surface-low dark:bg-surface-dark-low items-center justify-center"
            style={{ height: lineHeight + 16 }}
          >
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.tapToReveal}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View className="px-1 pb-4 pt-1" style={{ opacity: fontVisible ? 1 : 0 }}>
          <View
            style={{
              direction: "ltr",
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              justifyContent: "flex-start",
              alignItems: "center",
              gap: 2,
              ...(highlightColor && {
                backgroundColor: highlightColor + "20",
                borderRadius: 8,
                paddingHorizontal: 4,
                paddingVertical: 2,
              }),
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
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily, fontSize, lineHeight }}
              >
                {wordTokens.marker}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Collapsible sections — no borders, use spacing */}
      <View className="px-1 pb-3">
        {/* Translation toggle */}
        <Pressable
          onPress={toggleTranslation}
          className="flex-row items-center justify-between py-2.5"
        >
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {langInfo?.nameEnglish ?? "Translation"}
          </Text>
          {translationOpen ? (
            <ChevronUp size={14} color={chevronColor} />
          ) : (
            <ChevronDown size={14} color={chevronColor} />
          )}
        </Pressable>
        {translationOpen && (
          <View className="pb-3">
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 22,
                ...(isTranslationRtl ? { writingDirection: "rtl", textAlign: "right" } : {}),
              }}
            >
              {translationText ?? s.loading}
            </Text>
          </View>
        )}

        <View className="h-1" />

        {/* Tafseer toggle */}
        <Pressable
          onPress={toggleTafseer}
          className="flex-row items-center justify-between py-2.5"
        >
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {s.tafseer}
          </Text>
          {tafseerOpen ? (
            <ChevronUp size={14} color={chevronColor} />
          ) : (
            <ChevronDown size={14} color={chevronColor} />
          )}
        </Pressable>
        {tafseerOpen && (
          <View className="pb-3">
            {(() => {
              const text = tafseerText ?? s.loading;
              const TRUNCATE_LIMIT = 200;
              const isLong = text.length > TRUNCATE_LIMIT;
              const displayText = isLong && !tafseerExpanded
                ? text.slice(0, TRUNCATE_LIMIT) + "..."
                : text;
              return (
                <>
                  <Text
                    className="text-warm-600 dark:text-neutral-300"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 14,
                      lineHeight: 26,
                      writingDirection: "rtl",
                      textAlign: "right",
                    }}
                  >
                    {displayText}
                  </Text>
                  {isLong && !tafseerExpanded && (
                    <Pressable onPress={() => setTafseerExpanded(true)} className="mt-1">
                      <Text
                        className="text-primary-accent dark:text-primary-bright"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                      >
                        {s.readMore}
                      </Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </View>
        )}
      </View>
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);
