import { Redirect } from "expo-router";
import { MEANINGS_DECK_ID } from "@/lib/fsrs/queries";

/**
 * Old `/flashcards/vocab` links open the main session for the Vocabulary Review deck, so that deck's
 * settings, grading, card actions and states apply. The redirect replaces this route on its first
 * render, before anything reads the database: the legacy `vocab_cards` queue is never loaded or
 * changed, and its rows stay where they are.
 */
export default function LegacyVocabularyRedirect() {
  return <Redirect href={{ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } }} />;
}
