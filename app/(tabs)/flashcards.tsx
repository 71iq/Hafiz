import { useState, useCallback } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSQLiteContext } from "expo-sqlite";
import { useSettings } from "../../src/context/SettingsContext";
import {
  getAyahsBySurah,
  getAyahsByJuz,
  getAyahsByHizb,
  getStudyLogEntry,
  getAllDueCards,
  getNewAyahs,
  getAyah,
} from "../../src/db/database";
import { buildDeck, type FlashCard } from "../../src/lib/uniqueness";
import DeckSelector from "../../src/components/flashcards/DeckSelector";
import FlashcardSession from "../../src/components/flashcards/FlashcardSession";
import SessionSummary, { type SessionStats } from "../../src/components/flashcards/SessionSummary";

type Screen = "select" | "session" | "summary";

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function FlashcardsTab() {
  const { colorScheme, newCardLimit, reviewCardLimit } = useSettings();
  const db = useSQLiteContext();
  const [screen, setScreen] = useState<Screen>("select");
  const [deck, setDeck] = useState<FlashCard[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });

  const handleStartSession = useCallback(
    async (mode: "surah" | "juz" | "hizb", id: number) => {
      const ayahs =
        mode === "surah" ? await getAyahsBySurah(db, id) :
        mode === "juz" ? await getAyahsByJuz(db, id) :
        await getAyahsByHizb(db, id);
      const cards = await buildDeck(db, ayahs);
      if (cards.length === 0) return;

      const today = new Date().toISOString().slice(0, 10);
      const due: FlashCard[] = [];
      const newCards: FlashCard[] = [];

      for (const card of cards) {
        const log = await getStudyLogEntry(db, card.ayah.surah, card.ayah.ayah);
        if (log && log.next_review_date <= today) {
          due.push(card);
        } else if (!log) {
          newCards.push(card);
        }
      }

      let sessionDeck = [...due, ...newCards.slice(0, newCardLimit)];
      if (sessionDeck.length === 0) {
        sessionDeck = cards.slice(0, newCardLimit);
      }
      setDeck(shuffle(sessionDeck));
      setScreen("session");
    },
    [db, newCardLimit]
  );

  const handleStartHifz = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Get due review cards
    const dueEntries = await getAllDueCards(db, today);
    const dueAyahs = [];
    for (const entry of dueEntries.slice(0, reviewCardLimit)) {
      const ayah = await getAyah(db, entry.surah, entry.ayah);
      if (ayah) dueAyahs.push(ayah);
    }

    // Get new cards
    const newAyahs = await getNewAyahs(db, newCardLimit);

    const allAyahs = [...dueAyahs, ...newAyahs];
    if (allAyahs.length === 0) return;

    const cards = await buildDeck(db, allAyahs);
    if (cards.length === 0) return;

    setDeck(shuffle(cards));
    setScreen("session");
  }, [db, newCardLimit, reviewCardLimit]);

  const handleSessionComplete = useCallback((sessionStats: SessionStats) => {
    setStats(sessionStats);
    setScreen("summary");
  }, []);

  const handleReturnToSelector = useCallback(() => {
    setScreen("select");
    setDeck([]);
  }, []);

  return (
    <View className="flex-1 pt-12">
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      {screen === "select" && (
        <DeckSelector onStartSession={handleStartSession} onStartHifz={handleStartHifz} />
      )}
      {screen === "session" && (
        <FlashcardSession deck={deck} onComplete={handleSessionComplete} onExit={handleReturnToSelector} />
      )}
      {screen === "summary" && (
        <SessionSummary stats={stats} onReturn={handleReturnToSelector} />
      )}
    </View>
  );
}
