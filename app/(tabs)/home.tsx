import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Plus, Trash2, Play, Layers, Flame, Clock, Search } from "lucide-react-native";
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
  const { isDark } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const [decks, setDecks] = useState<DeckDisplay[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastReview, setLastReview] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const rawDecks = await getDecks(db);
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
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleDeleteDeck = (deckId: string) => {
    Alert.alert(s.flashcardsDeleteDeck, s.flashcardsDeleteConfirm, [
      { text: s.flashcardsCancel, style: "cancel" },
      {
        text: s.flashcardsDelete,
        style: "destructive",
        onPress: async () => {
          await deleteDeck(db, deckId);
          loadData();
        },
      },
    ]);
  };

  const handleStartReview = (deckId?: string) => {
    router.push({ pathname: "/flashcards/session", params: deckId ? { deckId } : {} });
  };

  const getDeckLabel = (scope: DeckScope): string => {
    switch (scope.type) {
      case "surah":
        return `${s.flashcardsScopeBysurah}: ${scope.surahs.join(", ")}`;
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
        <View className="pt-8 pb-6">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.homeTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
          >
            {s.homeSubtitle}
          </Text>
        </View>

        {/* Search bar trigger */}
        <Pressable
          onPress={() => setShowSearch(true)}
          className="mb-6"
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
        >
          <View className="flex-row items-center bg-surface-low dark:bg-surface-dark-low rounded-full px-4 py-3.5">
            <Search size={18} color={isDark ? "#737373" : "#8B8178"} />
            <Text
              className="text-warm-400 dark:text-neutral-600 flex-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 15, marginLeft: 12 }}
            >
              {s.searchPlaceholder}
            </Text>
          </View>
        </Pressable>

        {/* Progress ring */}
        <Card elevation="low" className="p-8 mb-6 items-center">
          <View
            className="w-40 h-40 rounded-full items-center justify-center"
            style={{ borderWidth: 4, borderColor: isDark ? "#2dd4bf" : "#003638" }}
          >
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 36 }}
            >
              {totalCards || "—"}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11, letterSpacing: 1 }}
            >
              {s.homeMemorized}
            </Text>
          </View>
        </Card>

        {/* Stats row */}
        <View className="flex-row gap-3 mb-6">
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              {totalDue}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.homeTodayReviews}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <View className="flex-row items-center gap-1">
              <Flame size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
              >
                {streak}
              </Text>
            </View>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.homeStreak}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Clock size={16} color={isDark ? "#a3a3a3" : "#b9a085"} />
            <Text
              className="text-charcoal dark:text-neutral-200 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
              numberOfLines={1}
            >
              {formatLastReview()}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-0.5"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.flashcardsLastReview}
            </Text>
          </Card>
        </View>

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
                  {interpolate(s.flashcardsCardsRemaining, { n: String(totalDue) })}
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
          <Card elevation="low" className="p-8 items-center">
            <Layers size={36} color={isDark ? "#525252" : "#DFD9D1"} />
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-3"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
            >
              {s.flashcardsNoDecks}
            </Text>
            <Button
              onPress={() => setShowCreate(true)}
              className="mt-4"
              size="sm"
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#fff" }}>
                {s.flashcardsCreateDeck}
              </Text>
            </Button>
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
                s={s}
              />
            ))}
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
  s,
}: {
  deck: DeckDisplay;
  getDeckLabel: (scope: DeckScope) => string;
  onStartReview: () => void;
  onDelete: () => void;
  isDark: boolean;
  s: any;
}) {
  return (
    <Card elevation="low" className="p-5">
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1">
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            numberOfLines={1}
          >
            {getDeckLabel(deck.scope)}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-0.5"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
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

      <View className="flex-row gap-3">
        <View className="flex-row items-center gap-1.5">
          <View className="w-2 h-2 rounded-full bg-primary-accent" />
          <Text
            className="text-charcoal dark:text-neutral-300"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
          >
            {deck.dueCount} {s.flashcardsDueToday?.toLowerCase?.() ?? "due"}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-2 h-2 rounded-full bg-blue-400" />
          <Text
            className="text-charcoal dark:text-neutral-300"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
          >
            {deck.newCount} {s.flashcardsNewCards?.toLowerCase?.() ?? "new"}
          </Text>
        </View>
      </View>

      {deck.dueCount > 0 && (
        <Button onPress={onStartReview} size="sm" className="mt-4 self-start">
          <View className="flex-row items-center gap-2">
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
