import { router, type Href } from "expo-router";

export type RootStackState = { index?: number; routes?: readonly { name: string }[] } | undefined;

export function returnToTabs(state: RootStackState, href: Href) {
  const index = state?.index ?? 0;
  if (state?.routes?.[index - 1]?.name === "(tabs)") router.dismissTo(href);
  else router.replace(href);
}
