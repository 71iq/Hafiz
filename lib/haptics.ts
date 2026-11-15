import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// The Vibration setting (device_haptics_enabled) gates every native haptic. SettingsProvider keeps
// this flag in step with the saved value; web never vibrates.
let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}

function canVibrate() {
  return Platform.OS !== "web" && hapticsEnabled;
}

/**
 * Trigger a light haptic tap — useful for selection actions (bookmark, like).
 */
export function hapticLight() {
  if (!canVibrate()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * Trigger a medium haptic tap — useful for grading actions (flashcard buttons).
 */
export function hapticMedium() {
  if (!canVibrate()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/**
 * Trigger a success notification haptic.
 */
export function hapticSuccess() {
  if (!canVibrate()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
