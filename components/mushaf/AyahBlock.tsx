import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { View, Text, Pressable, Animated as RNAnimated } from "react-native";
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
import {
  BookOpenText,
  Bookmark,
  Copy,
  MessageCircle,
  MoreHorizontal,
  Play,
  PlusCircle,
  Share2,
} from "lucide-react-native";
import { useStrings } from "@/lib/i18n/useStrings";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";

type Props = {
  surah: number;
  ayah: number;
  text: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  hideMode?: boolean;
  highlighted?: boolean;
};

function AyahBlockInner({
  surah,
  ayah,
  text,
  v2Page,
  fontSize,
  lineHeight,
  hideMode = false,
  highlighted = false,
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
  const { selectAyah, isBookmarked, getHighlightColor, showToast } = useSelection();

  const [fontVisible, setFontVisible] = useState(() =>
    isQpcFontLoaded(v2Page)
  );
  const [revealed, setRevealed] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(defaultShowTranslation);
  const [tafseerOpen, setTafseerOpen] = useState(false);
  const [reflectionsOpen, setReflectionsOpen] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafseerText, setTafseerText] = useState<string | null>(null);
  const [tafseerExpanded, setTafseerExpanded] = useState(false);

  // Deep link pulse highlight
  const pulseAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (highlighted) {
      pulseAnim.setValue(1);
      RNAnimated.timing(pulseAnim, {
        toValue: 0,
        duration: 1500,
        useNativeDriver: true,
      }).start();
    }
  }, [highlighted, pulseAnim]);

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

  const toggleReflections = useCallback(() => {
    setReflectionsOpen((prev) => !prev);
  }, []);

  const handleReveal = useCallback(() => {
    if (hideMode) setRevealed((prev) => !prev);
  }, [hideMode]);

  const handleBadgeLongPress = useCallback(() => {
    selectAyah(surah, ayah);
  }, [surah, ayah, selectAyah]);

  const handleMoreActions = useCallback(() => {
    selectAyah(surah, ayah);
  }, [surah, ayah, selectAyah]);

  const handleAddToReview = useCallback(() => {
    showToast(s.reviewActionUnavailable);
  }, [showToast, s.reviewActionUnavailable]);

  const isBlurred = hideMode && !revealed;
  const fontFamily = qpcFontName(v2Page);
  const bookmarked = isBookmarked(surah, ayah);
  const highlightColor = getHighlightColor(surah, ayah);

  const iconColor = isDark ? "#a3a3a3" : "#8B8178";
  const activeIconColor = isDark ? "#2dd4bf" : "#0d9488";

  return (
    <View className="mx-3 mb-3 w-full max-w-[840px] self-center rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3" style={{ position: "relative" }}>
      {/* Deep link pulse highlight overlay */}
      {highlighted && (
        <RNAnimated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: -8,
            right: -8,
            bottom: 0,
            borderRadius: 12,
            backgroundColor: "#0d9488",
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.15],
            }),
          }}
        />
      )}
      <View className={isRTL ? "flex-row-reverse items-center justify-between gap-3" : "flex-row items-center justify-between gap-3"}>
        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          <Pressable
            onLongPress={handleBadgeLongPress}
            onPress={handleMoreActions}
            delayLongPress={300}
            hitSlop={8}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.95 : 1 }],
              // @ts-ignore — cursor is valid on web
              cursor: "pointer",
            })}
          >
            <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-2">
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              >
                {surah}:{ayah}
              </Text>
              {bookmarked && (
                <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" />
              )}
            </View>
          </Pressable>
          <ActionIcon icon={<Play size={15} color={iconColor} />} onPress={handleMoreActions} />
          <ActionIcon
            icon={<Bookmark size={15} color={bookmarked ? "#FDDC91" : iconColor} fill={bookmarked ? "#FDDC91" : "none"} />}
            onPress={handleMoreActions}
          />
        </View>

        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          <ActionIcon icon={<Copy size={15} color={iconColor} />} onPress={handleMoreActions} />
          <ActionIcon icon={<Share2 size={15} color={iconColor} />} onPress={handleMoreActions} />
          <ActionIcon icon={<MoreHorizontal size={17} color={iconColor} />} onPress={handleMoreActions} />
        </View>
      </View>

      {/* Arabic text (QCF2) — interactive word tokens */}
      {isBlurred ? (
        <Pressable onPress={handleReveal} className="pt-4">
          <View
            className="rounded-2xl bg-surface-mid dark:bg-surface-dark-mid items-center justify-center"
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
        <View
          className="pt-4"
          style={{ opacity: fontVisible ? 1 : 0, direction: "ltr", alignItems: "flex-end" }}
        >
          <View
            className="self-end"
            style={{
              direction: "ltr",
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              justifyContent: "flex-start",
              alignItems: "center",
              gap: 2,
              maxWidth: "100%",
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

      <View className="pt-3">
        {translationOpen && (
          <View className="rounded-2xl bg-surface dark:bg-surface-dark px-4 py-3">
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 15,
                lineHeight: 24,
                writingDirection: isTranslationRtl ? "rtl" : "ltr",
                textAlign: isTranslationRtl ? "right" : "left",
              }}
            >
              {translationText ?? s.loading}
            </Text>
          </View>
        )}

        <View className={isRTL ? "mt-3 flex-row-reverse flex-wrap gap-2" : "mt-3 flex-row flex-wrap gap-2"}>
          <ActionPill
            label={langInfo?.nameEnglish ?? s.wordTranslation}
            active={translationOpen}
            icon={<BookOpenText size={14} color={translationOpen ? activeIconColor : iconColor} />}
            onPress={toggleTranslation}
          />
          <ActionPill
            label={s.tafseer}
            active={tafseerOpen}
            icon={<BookOpenText size={14} color={tafseerOpen ? activeIconColor : iconColor} />}
            onPress={toggleTafseer}
          />
          <ActionPill
            label={s.reflections}
            active={reflectionsOpen}
            icon={<MessageCircle size={14} color={reflectionsOpen ? activeIconColor : iconColor} />}
            onPress={toggleReflections}
          />
          <ActionPill
            label={s.addToReview}
            icon={<PlusCircle size={14} color={iconColor} />}
            onPress={handleAddToReview}
          />
        </View>

        {tafseerOpen && (
          <View className="mt-3 rounded-2xl bg-surface dark:bg-surface-dark px-4 py-3">
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
                    className="text-warm-700 dark:text-neutral-300"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 14,
                      lineHeight: 24,
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

        {reflectionsOpen && (
          <View className="mt-3">
            <ReflectionsSection surah={surah} ayah={ayah} />
          </View>
        )}
      </View>
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);

function ActionIcon({ icon, onPress }: { icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface dark:bg-surface-dark"
    >
      {icon}
    </Pressable>
  );
}

function ActionPill({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 ${
        active
          ? "bg-primary-accent/10 dark:bg-primary-bright/10"
          : "bg-surface dark:bg-surface-dark"
      }`}
    >
      {icon}
      <Text
        className={active ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
