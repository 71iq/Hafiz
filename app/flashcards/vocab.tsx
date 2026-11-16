import { Redirect } from "expo-router";
import { MEANINGS_DECK_ID } from "@/lib/fsrs/queries";

export default function LegacyVocabularyRedirect() {
  return <Redirect href={{ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } }} />;
}
