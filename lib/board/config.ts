import Constants from "expo-constants";

const expoExtra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<
  string,
  string | undefined
>;

const BOARD_ENABLED = process.env.EXPO_PUBLIC_BOARD_ENABLED ?? expoExtra.EXPO_PUBLIC_BOARD_ENABLED ?? "false";

/**
 * Whether the Board appears in the app. It is off until enough people use Hafiz for weekly groups of
 * at least five: while off, its entry rows and sidebar item are hidden and its route opens Home. The
 * Board screen, its server functions and band refresh keep working, so turning it on needs no other
 * change.
 */
export function isBoardEnabled(): boolean {
  return ["1", "true", "yes"].includes(BOARD_ENABLED.trim().toLowerCase());
}
