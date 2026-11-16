import { Redirect } from "expo-router";

export default function FlashcardsRedirect() {
  return <Redirect href={{ pathname: "/(tabs)/home", params: { section: "decks" } }} />;
}
