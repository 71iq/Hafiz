import { Platform } from "react-native";

/**
 * Android 13 (API 33) and later shows its own confirmation whenever an app writes to the clipboard,
 * so an in-app "Copied" toast there doubles the message. Failures are still reported by the app.
 */
export function systemConfirmsCopy(): boolean {
  return Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 33;
}
