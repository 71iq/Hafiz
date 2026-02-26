import { useState, useCallback } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSQLiteContext } from "expo-sqlite";
import { useSettings } from "../../src/context/SettingsContext";
import { getAyahsBySurah, getAyahsByJuz, getStudyLogEntry } from "../../src/db/database";
import { buildDeck, type FlashCard } from "../../src/lib/uniqueness";
import DeckSelector from "../../src/components/flashcards/DeckSelector";
import FlashcardSession from "../../src/components/flashcards/FlashcardSession";
import SessionSummary, { type SessionStats } from "../../src/components/flashcards/SessionSummary";

type Screen = "select" | "session" | "summary";

export default function FlashcardsTab() {
  const { colorScheme } = useSettings();
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
    async (mode: "surah" | "juz", id: number) => {
      const ayahs = mode === "surah" ? await getAyahsBySurah(db, id) : await getAyahsByJuz(db, id);
      const cards = await buildDeck(db, ayahs);
      if (cards.length === 0) return;

      // Sort: due cards first, then new cards (cap 20 new per session)
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
        // Cards not yet due are skipped
      }

      let sessionDeck = [...due, ...newCards.slice(0, 20)];
      if (sessionDeck.length === 0) {
        // All cards reviewed and not yet due — use all cards anyway
        sessionDeck = cards.slice(0, 20);
      }
      // Shuffle using Fisher-Yates
      for (let i = sessionDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sessionDeck[i], sessionDeck[j]] = [sessionDeck[j], sessionDeck[i]];
      }
      setDeck(sessionDeck);
      setScreen("session");
    },
    [db]
  );

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
      {screen === "select" && <DeckSelector onStartSession={handleStartSession} />}
      {screen === "session" && (
        <FlashcardSession deck={deck} onComplete={handleSessionComplete} onExit={handleReturnToSelector} />
      )}
      {screen === "summary" && (
        <SessionSummary stats={stats} onReturn={handleReturnToSelector} />
      )}
    </View>
  );
}
