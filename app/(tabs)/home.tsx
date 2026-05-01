import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Plus, Trash2, Play, Layers, Flame, Search, LayoutGrid, Languages, UserPlus, X as XIcon } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { interpolate } from "@/lib/i18n/useStrings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CreateDeckSheet } from "@/components/flashcards/CreateDeckSheet";
import { SearchCommand } from "@/components/SearchCommand";
import { Toast } from "@/components/ui/Toast";
import {
  getDecks,
  getDueCount,
  getTotalCardCount,
  getNewCount,
  deleteDeck,
  getStudyStreak,
  getLastReviewDate,
  MEANINGS_DECK_ID,
} from "@/lib/fsrs/queries";
import type { DeckScope } from "@/lib/fsrs/types";

type DeckDisplay = {
  id: string;
  scope: DeckScope;
  createdAt: string;
  cardCount: number;
  dueCount: number;
  newCount: number;
};

export default function HomeScreen() {
  const db = useDatabase();
  const { isDark, dailyReviewLimit, isRTL } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const [decks, setDecks] = useState<DeckDisplay[]>([]);
  const [vocabStats, setVocabStats] = useState<{ total: number; due: number }>({ total: 0, due: 0 });
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const user = useAuthStore((state) => state.user);
  const [totalDue, setTotalDue] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastReview, setLastReview] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});
  const [resume, setResume] = useState<{ surah: number; ayah: number; page: number } | null>(null);

  const loadData = useCallback(async () => {
    // Load surah names for deck labels
    const surahRows = await db.getAllAsync<{ number: number; name_arabic: string }>(
      "SELECT number, name_arabic FROM surahs"
    );
    const nameMap: Record<number, string> = {};
    for (const row of surahRows) nameMap[row.number] = row.name_arabic;
    setSurahNames(nameMap);

    const rawDecks = (await getDecks(db)).filter((d) => d.id !== MEANINGS_DECK_ID);
    const deckDisplays: DeckDisplay[] = [];
    for (const d of rawDecks) {
      const [cardCount, dueCount, newCount] = await Promise.all([
        getTotalCardCount(db, d.id),
        getDueCount(db, d.id),
        getNewCount(db, d.id),
      ]);
      deckDisplays.push({ ...d, cardCount, dueCount, newCount });
    }
    setDecks(deckDisplays);
    setTotalDue(await getDueCount(db));
    setTotalCards(await getTotalCardCount(db));
    setStreak(await getStudyStreak(db));
    setLastReview(await getLastReviewDate(db));
    setVocabStats({
      total: await getTotalCardCount(db, MEANINGS_DECK_ID),
      due: await getDueCount(db, MEANINGS_DECK_ID),
    });

    try {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'"
      );
      if (!row?.value) {
        setResume(null);
        return;
      }
      const parsed = JSON.parse(row.value);
      if (parsed?.mode === "page" && typeof parsed.page === "number") {
        const pageMeta = await db.getFirstAsync<{ surah_start: number; ayah_start: number }>(
          "SELECT surah_start, ayah_start FROM page_map WHERE page = ?",
          [parsed.page]
        );
        if (pageMeta) {
          setResume({ surah: pageMeta.surah_start, ayah: pageMeta.ayah_start, page: parsed.page });
        } else {
          setResume(null);
        }
      } else if (
        parsed?.mode === "verse" &&
        typeof parsed.surah === "number" &&
        typeof parsed.ayah === "number"
      ) {
        const page = await db.getFirstAsync<{ v2_page: number }>(
          "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
          [parsed.surah, parsed.ayah]
        );
        setResume({ surah: parsed.surah, ayah: parsed.ayah, page: page?.v2_page ?? 1 });
      } else {
        setResume(null);
      }
    } catch {
      setResume(null);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleDeleteDeck = (deckId: string) => {
    const runDelete = async () => {
      try {
        await deleteDeck(db, deckId);
        setDecks((prev) => prev.filter((d) => d.id !== deckId));
        await loadData();
      } catch (e) {
        console.warn("[Home] Failed to delete deck:", e);
        setToast(s.reviewActionFailed);
      }
    };

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(`${s.flashcardsDeleteDeck}\n${s.flashcardsDeleteConfirm}`) ?? false;
      if (confirmed) runDelete();
      return;
    }

    Alert.alert(s.flashcardsDeleteDeck, s.flashcardsDeleteConfirm, [
      { text: s.flashcardsCancel, style: "cancel" },
      { text: s.flashcardsDelete, style: "destructive", onPress: runDelete },
    ]);
  };

  const handleStartReview = (deckId?: string) => {
    router.push({ pathname: "/flashcards/session", params: deckId ? { deckId } : {} });
  };

  const getDeckLabel = (scope: DeckScope): string => {
    switch (scope.type) {
      case "surah": {
        const nums = [...scope.surahs].sort((a, b) => a - b);
        const getName = (n: number) => surahNames[n] ? `${s.flashcardsScopeBysurah} ${surahNames[n]}` : String(n);
        if (nums.length === 1) {
          return `${getName(nums[0])} (${nums[0]})`;
        }
        const isContiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
        if (isContiguous) {
          return `${getName(nums[0])} - ${getName(nums[nums.length - 1])} (${nums[0]}-${nums[nums.length - 1]})`;
        }
        return `${nums.map(getName).join("، ")} (${nums.join(", ")})`;
      }
      case "juz":
        return `${s.flashcardsScopeByjuz}: ${scope.juzNumbers.join(", ")}`;
      case "hizb":
        return `${s.flashcardsScopeByhizb}: ${scope.hizbNumbers.join(", ")}`;
      case "custom":
        return `${scope.surahStart}:${scope.ayahStart} → ${scope.surahEnd}:${scope.ayahEnd}`;
    }
  };

  const formatLastReview = (): string => {
    if (!lastReview) return s.flashcardsNever;
    const d = new Date(lastReview);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reviewDay = new Date(d);
    reviewDay.setHours(0, 0, 0, 0);
    if (reviewDay.getTime() === today.getTime()) return s.flashcardsToday;
    return d.toLocaleDateString();
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="pt-8 pb-4">
          <View className={`flex-row items-start justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
            <View className={isRTL ? "items-end" : "items-start"}>
              <Text
                className="text-warm-400 dark:text-neutral-500 uppercase"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}
              >
                {new Date().toLocaleDateString()}
              </Text>
              <Text
                className="text-charcoal dark:text-neutral-100 mt-1"
                style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
              >
                {s.homeTitle}
              </Text>
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28, marginTop: -4 }}
              >
                {user ? (user.email?.split("@")[0] ?? "Hafiz") : "Hafiz"}
              </Text>
            </View>
            <Pressable
              onPress={() => setShowSearch(true)}
              className="w-10 h-10 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center mt-1"
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Search size={16} color={isDark ? "#a3a3a3" : "#8B8178"} />
            </Pressable>
          </View>
        </View>

        {/* Resume reading */}
        {resume && (
          <Pressable
            onPress={() => router.push("/(tabs)/mushaf")}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            className="mb-6"
          >
            <Card elevation="low" className="p-4 rounded-3xl">
              <View className="flex-row items-center gap-3">
                <View className="w-11 h-11 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                  <Play size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className="flex-1">
                  <Text className="text-warm-400 dark:text-neutral-500 uppercase" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.5 }}>
                    {s.goTo}
                  </Text>
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {`${s.flashcardsScopeBysurah} ${surahNames[resume.surah] ?? resume.surah} · ${resume.surah}:${resume.ayah}`}
                  </Text>
                  <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                    {interpolate(s.pageN, { n: resume.page })}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        )}

        {/* Today focus */}
        <View className="mb-6">
          <Text className="text-warm-400 dark:text-neutral-500 uppercase" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}>
            {s.flashcardsDueToday}
          </Text>
          <View className="flex-row items-end justify-between mt-2">
            <View>
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 68, lineHeight: 68 }}>
                {totalDue > dailyReviewLimit ? dailyReviewLimit : totalDue}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                {s.homeTodayReviews}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}>
                {totalCards || "—"}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.homeMemorized}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center justify-between mt-4 pt-4 border-t border-warm-200 dark:border-neutral-800">
            <View className="flex-row items-center gap-1.5">
              <Flame size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}>
                {streak}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.homeStreak}
              </Text>
            </View>
            <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
              {formatLastReview()}
            </Text>
          </View>
        </View>

        {/* Auth banner — only when the user isn't signed in */}
        {!user && !authBannerDismissed && (
          <Card elevation="low" className="p-4 mb-6">
            <View className="flex-row items-start gap-3">
              <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 items-center justify-center">
                <UserPlus size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                  numberOfLines={1}
                >
                  {s.homeAuthCardTitle}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500 mt-0.5 mb-3"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18 }}
                >
                  {s.homeAuthCardSubtitle}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => router.push("/auth/login")}
                    className="rounded-full bg-primary-accent px-4 py-1.5"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
                  >
                    <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                      {s.homeAuthCardSignIn}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push("/auth/signup")}
                    className="rounded-full bg-surface-high dark:bg-surface-dark-high px-4 py-1.5"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
                  >
                    <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                      {s.homeAuthCardSignUp}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Pressable
                onPress={() => setAuthBannerDismissed(true)}
                hitSlop={8}
                className="w-7 h-7 items-center justify-center"
              >
                <XIcon size={14} color={isDark ? "#737373" : "#8B8178"} />
              </Pressable>
            </View>
          </Card>
        )}

        {/* Start Review CTA */}
        {totalDue > 0 && (
          <Pressable
            onPress={() => handleStartReview()}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
          >
            <Card elevation="low" className="p-6 mb-6 bg-primary-soft dark:bg-primary-soft flex-row items-center justify-between">
              <View>
                <Text
                  className="text-gold mb-0.5"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 17 }}
                >
                  {s.flashcardsStartReview}
                </Text>
                <Text
                  className="text-neutral-300"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
                >
                  {interpolate(s.flashcardsCardsRemaining, { n: String(Math.min(totalDue, dailyReviewLimit)) })}
                </Text>
              </View>
              <View className="w-12 h-12 rounded-full bg-gold items-center justify-center">
                <Play size={20} color="#785F22" />
              </View>
            </Card>
          </Pressable>
        )}

        {/* Decks */}
        <View className="flex-row items-center justify-between mb-4">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.flashcardsDecks}
          </Text>
          <Pressable
            onPress={() => setShowCreate(true)}
            className="w-10 h-10 rounded-full bg-primary-accent items-center justify-center"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.9 : 1 }] })}
          >
            <Plus size={20} color="#fff" />
          </Pressable>
        </View>

        {decks.length === 0 ? (
          <Card elevation="low" className="py-4">
            <EmptyState
              icon={LayoutGrid}
              title={s.flashcardsNoDecks}
              subtitle={s.emptyDecksSubtitle}
              actionLabel={s.flashcardsCreateDeck}
              onAction={() => setShowCreate(true)}
              isDark={isDark}
            />
          </Card>
        ) : (
          <View className="gap-3">
            {decks.map((deck) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                getDeckLabel={getDeckLabel}
                onStartReview={() => handleStartReview(deck.id)}
                onDelete={() => handleDeleteDeck(deck.id)}
                isDark={isDark}
                isRTL={isRTL}
                s={s}
              />
            ))}
          </View>
        )}

        {/* Vocabulary deck — shown when at least one word has been saved */}
        {vocabStats.total > 0 && (
          <View className="gap-3 mt-3">
            <Card elevation="low" className="p-5">
              <View className="flex-row items-start justify-between mb-3">
                <View className="flex-1 flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                    <Languages size={18} color="#0d9488" />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-charcoal dark:text-neutral-200"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
                      numberOfLines={1}
                    >
                      {s.vocabDeckTitle}
                    </Text>
                    <Text
                      className="text-warm-400 dark:text-neutral-500 mt-0.5"
                      style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
                    >
                      {s.vocabDeckSubtitle}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="flex-row items-center justify-between">
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                >
                  {vocabStats.due} {s.flashcardsDueToday?.toLowerCase?.() ?? "due"} · {vocabStats.total} {s.flashcardsTotalCards?.toLowerCase?.() ?? "cards"}
                </Text>
                <Pressable
                  onPress={() => router.push({ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } })}
                  className="rounded-full bg-primary-accent px-4 py-1.5"
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
                >
                  <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                    {s.flashcardsStartReview}
                  </Text>
                </Pressable>
              </View>
            </Card>
          </View>
        )}
      </ScrollView>

      <SearchCommand visible={showSearch} onClose={() => setShowSearch(false)} />

      <CreateDeckSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(count) => {
          setToast(interpolate(s.flashcardsCardsCreated, { n: String(count) }));
          loadData();
        }}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </SafeAreaView>
  );
}

function DeckCard({
  deck,
  getDeckLabel,
  onStartReview,
  onDelete,
  isDark,
  isRTL,
  s,
}: {
  deck: DeckDisplay;
  getDeckLabel: (scope: DeckScope) => string;
  onStartReview: () => void;
  onDelete: () => void;
  isDark: boolean;
  isRTL: boolean;
  s: any;
}) {
  return (
    <Card elevation="low" className="p-5">
      <View className={`mb-3 flex-row items-start justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
        <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
            numberOfLines={1}
          >
            {getDeckLabel(deck.scope)}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-0.5"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {deck.cardCount} {s.flashcardsTotalCards?.toLowerCase?.() ?? "cards"}
          </Text>
        </View>
        <Pressable
          onPress={onDelete}
          className="w-8 h-8 rounded-full items-center justify-center"
          hitSlop={8}
        >
          <Trash2 size={15} color={isDark ? "#525252" : "#DFD9D1"} />
        </Pressable>
      </View>

      <View className={`flex-row gap-3 ${isRTL ? "flex-row-reverse self-end" : ""}`}>
        <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
          <View className="w-2 h-2 rounded-full bg-primary-accent" />
          <Text
            className="text-charcoal dark:text-neutral-300"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {deck.dueCount} {s.flashcardsDueToday?.toLowerCase?.() ?? "due"}
          </Text>
        </View>
        <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
          <View className="w-2 h-2 rounded-full bg-blue-400" />
          <Text
            className="text-charcoal dark:text-neutral-300"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {deck.newCount} {s.flashcardsNewCards?.toLowerCase?.() ?? "new"}
          </Text>
        </View>
      </View>

      {deck.dueCount > 0 && (
        <Button onPress={onStartReview} size="sm" className={`mt-4 ${isRTL ? "self-end" : "self-start"}`}>
          <View className={`flex-row items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
            <Play size={14} color="#fff" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#fff" }}>
              {s.flashcardsStartReview}
            </Text>
          </View>
        </Button>
      )}
    </Card>
  );
}
