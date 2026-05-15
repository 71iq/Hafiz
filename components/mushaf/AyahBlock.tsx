import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { View, Text, Pressable, Animated as RNAnimated, useWindowDimensions, TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import {
  loadQpcFont,
  qpcFontName,
  isQpcFontLoaded,
} from "@/lib/fonts/loader";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { getLanguageByCode } from "@/lib/translations/languages";
import { useSelection } from "@/lib/selection/context";
import { WordToken } from "./WordToken";
import {
  BookOpenText,
  Bookmark,
  Play,
  PlusCircle,
  Share2,
} from "lucide-react-native";
import { useStrings } from "@/lib/i18n/useStrings";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchReflectionCount } from "@/lib/reflections/api";
import { addAyahToDeck, createDeck, generateDeckId, getDecks } from "@/lib/fsrs/queries";
import type { DeckScope } from "@/lib/fsrs/types";
import {
  addBookmark as dbAddBookmark,
  fetchSurahName,
  fetchUthmaniRange,
  removeBookmark as dbRemoveBookmark,
} from "@/lib/selection/queries";
import { formatForCopy } from "@/lib/selection/format";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { AyahDetailModal } from "./AyahDetailModal";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";

type DeckOption = {
  id: string;
  name?: string;
  scope: DeckScope;
  createdAt: string;
};

type Props = {
  surah: number;
  ayah: number;
  text: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  hideMode?: boolean;
  highlighted?: boolean;
  highlightedWordPos?: number | null;
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
  highlightedWordPos = null,
}: Props) {
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const db = useDatabase();
  const { translationLanguage, isRTL, isDark } = useSettings();
  const langInfo = getLanguageByCode(translationLanguage);
  const s = useStrings();
  const { isBookmarked, getHighlightColor, showToast, refreshBookmarks } = useSelection();
  const reflectionsEnabled = isSupabaseConfigured();
  const { data: reflectionCount = 0 } = useQuery({
    queryKey: ["reflectionCount", surah, ayah],
    queryFn: () => fetchReflectionCount(surah, ayah),
    enabled: reflectionsEnabled,
    staleTime: 1000 * 60 * 5,
  });

  const [fontVisible, setFontVisible] = useState(() =>
    isQpcFontLoaded(v2Page)
  );
  const [revealed, setRevealed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"translation" | "tafsir" | "reflections">("translation");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [deckOptions, setDeckOptions] = useState<DeckOption[]>([]);
  const [deckLoading, setDeckLoading] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});

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
    setRevealed(false);
  }, [hideMode]);

  const openDetail = useCallback((tab: "translation" | "tafsir" | "reflections") => {
    setDetailTab(tab);
    setDetailOpen(true);
  }, []);

  const handleReveal = useCallback(() => {
    if (hideMode) setRevealed((prev) => !prev);
  }, [hideMode]);

  const isBlurred = hideMode && !revealed;
  const fontFamily = qpcFontName(v2Page);
  const bookmarked = isBookmarked(surah, ayah);
  const highlightColor = getHighlightColor(surah, ayah);
  const qcf2LineHeight = Math.ceil(lineHeight + Math.max(6, fontSize * 0.16));

  const handleBookmark = useCallback(async () => {
    try {
      if (bookmarked) {
        await dbRemoveBookmark(db, surah, ayah);
        showToast(s.bookmarkRemoved);
      } else {
        await dbAddBookmark(db, surah, ayah);
        showToast(s.bookmarkAdded);
      }
      await refreshBookmarks();
    } catch (e) {
      console.warn("[AyahBlock] Failed to toggle bookmark:", e);
    }
  }, [bookmarked, db, surah, ayah, showToast, s.bookmarkAdded, s.bookmarkRemoved, refreshBookmarks]);

  const handleShare = useCallback(async () => {
    try {
      const [text, surahName] = await Promise.all([
        fetchUthmaniRange(db, surah, ayah, ayah),
        fetchSurahName(db, surah),
      ]);
      await Clipboard.setStringAsync(formatForCopy(text, surahName, surah, ayah, ayah));
      showToast(s.copied);
    } catch (e) {
      console.warn("[AyahBlock] Failed to copy share text:", e);
    }
  }, [db, surah, ayah, showToast, s.copied]);

  const formatDeckLabel = useCallback((deck: DeckOption): string => {
    if (deck.name?.trim()) return deck.name.trim();
    const { scope } = deck;
    switch (scope.type) {
      case "surah": {
        const nums = [...scope.surahs].sort((a, b) => a - b);
        if (nums.length === 1) return `${s.flashcardsScopeBysurah} ${surahNames[nums[0]] ?? nums[0]}`;
        return `${s.flashcardsScopeBysurah}: ${nums.join(", ")}`;
      }
      case "juz":
        return `${s.flashcardsScopeByjuz}: ${scope.juzNumbers.join(", ")}`;
      case "hizb":
        return `${s.flashcardsScopeByhizb}: ${scope.hizbNumbers.join(", ")}`;
      case "custom":
        return `${scope.surahStart}:${scope.ayahStart} → ${scope.surahEnd}:${scope.ayahEnd}`;
    }
  }, [s.flashcardsScopeByhizb, s.flashcardsScopeByjuz, s.flashcardsScopeBysurah, surahNames]);

  const loadDeckPicker = useCallback(async () => {
    setDeckLoading(true);
    setNewDeckName("");
    try {
      const [decks, surahRows] = await Promise.all([
        getDecks(db),
        db.getAllAsync<{ number: number; name_arabic: string }>("SELECT number, name_arabic FROM surahs"),
      ]);
      const names: Record<number, string> = {};
      surahRows.forEach((row) => {
        names[row.number] = row.name_arabic;
      });
      setSurahNames(names);
      const filtered = decks.filter((d) => {
        if (d.scope.type !== "custom") return true;
        return !(d.scope.surahStart === d.scope.surahEnd && d.scope.ayahStart === d.scope.ayahEnd);
      });
      setDeckOptions(filtered);
      setDeckPickerOpen(true);
    } catch (e) {
      console.warn("[AyahBlock] Failed to load decks:", e);
      showToast(s.reviewActionFailed);
    } finally {
      setDeckLoading(false);
    }
  }, [db, showToast, s.reviewActionFailed]);

  const handleCreateDeckAndAdd = useCallback(async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const trimmedName = newDeckName.trim();
      const scope: DeckScope = {
        type: "custom",
        surahStart: surah,
        ayahStart: ayah,
        surahEnd: surah,
        ayahEnd: ayah,
      };
      const deckId = generateDeckId(scope);
      await createDeck(db, deckId, scope, trimmedName || undefined);
      showToast(s.reviewActionAdded);
      setDeckPickerOpen(false);
    } catch (e) {
      console.warn("[AyahBlock] Failed to create deck:", e);
      showToast(s.reviewActionFailed);
    } finally {
      setReviewBusy(false);
    }
  }, [reviewBusy, newDeckName, surah, ayah, db, showToast, s.reviewActionAdded, s.reviewActionFailed]);

  const handleAddToExistingDeck = useCallback(async (deckId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const inserted = await addAyahToDeck(db, deckId, surah, ayah);
      showToast(inserted ? s.reviewActionAdded : (s.reviewActionAlreadyExists ?? s.reviewActionAdded));
      setDeckPickerOpen(false);
    } catch (e) {
      console.warn("[AyahBlock] Failed to add ayah to deck:", e);
      showToast(s.reviewActionFailed);
    } finally {
      setReviewBusy(false);
    }
  }, [reviewBusy, db, surah, ayah, showToast, s.reviewActionAdded, s.reviewActionAlreadyExists, s.reviewActionFailed]);

  const iconColor = isDark ? "#a3a3a3" : "#8B8178";

  return (
    <View
      className="mb-4 rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4"
      style={{
        position: "relative",
        width: Math.max(0, Math.min(width - 24, 840)),
        alignSelf: "center",
        overflow: "visible",
      }}
    >
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
      <View
        className={isRTL ? "flex-row-reverse items-center justify-between gap-3" : "flex-row items-center justify-between gap-3"}
        style={{
          paddingTop: isPhone ? 34 : 28,
        }}
      >
        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-2" style={{ position: "relative" }}>
            <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
              {surah}:{ayah}
            </Text>
            {bookmarked && (
              <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" />
            )}
          </View>
          <ActionIcon icon={<Play size={15} color={iconColor} />} onPress={() => {}} disabled />
          <ActionIcon icon={<Share2 size={15} color={iconColor} />} onPress={handleShare} />
        </View>

        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          <ActionIcon
            icon={<Bookmark size={15} color={bookmarked ? "#FDDC91" : iconColor} fill={bookmarked ? "#FDDC91" : "none"} />}
            onPress={handleBookmark}
          />
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
          className={isPhone ? "pt-8 pb-1" : "pt-6 pb-1"}
          style={{ opacity: fontVisible ? 1 : 0, direction: "ltr", alignItems: "flex-end", paddingHorizontal: 3, alignSelf: "stretch", width: "100%" }}
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
              rowGap: Math.max(4, fontSize * 0.12),
              width: "100%",
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
                lineHeight={qcf2LineHeight}
                surah={surah}
                ayah={ayah}
                wordPos={i + 1}
                v2Page={v2Page}
                disabled={hideMode}
                highlightColor={highlightedWordPos === i + 1 ? "#0d9488" : undefined}
              />
            ))}
            {/* Ayah end marker */}
            {wordTokens.marker && (
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily, fontSize, lineHeight: qcf2LineHeight, paddingHorizontal: 2 }}
              >
                {wordTokens.marker}
              </Text>
            )}
          </View>
        </View>
      )}

      <View className="pt-3">
        <View className={isRTL ? "mt-1 flex-row-reverse flex-wrap gap-2" : "mt-1 flex-row flex-wrap gap-2"}>
          <ActionPill
            label={langInfo?.nameEnglish ?? s.wordTranslation}
            icon={<BookOpenText size={14} color={iconColor} />}
            onPress={() => openDetail("translation")}
          />
          <ActionPill
            label={s.reflections}
            badge={reflectionCount}
            icon={<BookOpenText size={14} color={iconColor} />}
            onPress={() => openDetail("reflections")}
          />
          <ActionPill
            label={s.addToReview}
            icon={<PlusCircle size={14} color={iconColor} />}
            onPress={loadDeckPicker}
            active={reviewBusy}
          />
          <ActionPill
            label={s.tafseer}
            icon={<BookOpenText size={14} color={iconColor} />}
            onPress={() => openDetail("tafsir")}
          />
        </View>
      </View>
      <AyahDetailModal
        target={detailOpen ? { surah, ayah } : null}
        onClose={() => setDetailOpen(false)}
        initialTab={detailTab}
      />
      <ResponsiveSheet open={deckPickerOpen} onClose={() => setDeckPickerOpen(false)} maxWidth={560} maxHeight={640}>
        <OverlayHeader
          title={s.reviewSelectDeck ?? s.flashcardsDecks}
          onClose={() => setDeckPickerOpen(false)}
          isRTL={isRTL}
          showHandle={isPhone}
        />
        <OverlayBody contentContainerClassName="px-5 pb-5 pt-4">
          <View className="rounded-2xl bg-surface-low dark:bg-surface-dark-low p-3">
            <TextInput
              value={newDeckName}
              onChangeText={setNewDeckName}
              placeholder={s.reviewNewDeckName}
              placeholderTextColor={isDark ? "#525252" : "#b9a085"}
              className="rounded-xl bg-surface dark:bg-surface-dark px-3 py-2 text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
            />
            <Pressable
              onPress={handleCreateDeckAndAdd}
              disabled={reviewBusy || newDeckName.trim().length === 0}
              className="mt-3 rounded-2xl bg-primary-soft px-4 py-3"
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: reviewBusy || newDeckName.trim().length === 0 ? 0.55 : 1 })}
            >
              <Text className="text-gold" style={{ fontFamily: "Manrope_700Bold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}>
                {s.reviewCreateAndSelectDeck}
              </Text>
            </Pressable>
          </View>
          <View className="mt-3">
            {deckLoading ? (
              <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>{s.loading}</Text>
            ) : deckOptions.length === 0 ? (
              <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>{s.flashcardsNoDecks}</Text>
            ) : (
              deckOptions.map((deck) => (
                <Pressable key={deck.id} onPress={() => handleAddToExistingDeck(deck.id)} disabled={reviewBusy} className="mb-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3" style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }], opacity: reviewBusy ? 0.7 : 1 })}>
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>{formatDeckLabel(deck)}</Text>
                </Pressable>
              ))
            )}
          </View>
        </OverlayBody>
      </ResponsiveSheet>
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);

function ActionIcon({ icon, onPress, disabled = false }: { icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={{
        opacity: disabled ? 0.45 : 1,
        // @ts-ignore — cursor is valid on web
        cursor: disabled ? "auto" : "pointer",
      }}
    >
      {icon}
    </Pressable>
  );
}

function ActionPill({
  label,
  icon,
  active,
  badge,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
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
      {badge !== undefined && badge > 0 && (
        <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-1.5 py-0.5">
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
          >
            {badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
