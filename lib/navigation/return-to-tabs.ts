import { router, type Href } from "expo-router";

export type RootStackState = { index?: number; routes?: readonly { name: string }[] } | undefined;

/**
 * Leaves a screen pushed on the root stack for a tab. When the tabs are directly below, return to
 * them; replacing would stack another full tab tree, growing memory and leaving an old tab screen
 * behind Back (RF196). Otherwise (cold start, or a session, auth or onboarding screen below)
 * replace this screen so that flow stays underneath.
 */
export function returnToTabs(state: RootStackState, href: Href) {
  const index = state?.index ?? 0;
  if (state?.routes?.[index - 1]?.name === "(tabs)") router.dismissTo(href);
  else router.replace(href);
}
