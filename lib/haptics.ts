import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Trigger a light haptic tap — useful for selection actions (bookmark, like).
 */
export function hapticLight() {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * Trigger a medium haptic tap — useful for grading actions (flashcard buttons).
 */
export function hapticMedium() {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/**
 * Trigger a success notification haptic.
 */
export function hapticSuccess() {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/**
 * Trigger a selection change haptic.
 */
export function hapticSelection() {
  if (Platform.OS === "web") return;
  Haptics.selectionAsync().catch(() => {});
}
