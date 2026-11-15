import { Redirect } from "expo-router";

/** Legacy /flashcards link: Home scrolled to its deck cards, without a second deck screen. */
export default function FlashcardsRedirect() {
  return <Redirect href={{ pathname: "/(tabs)/home", params: { section: "decks" } }} />;
}
