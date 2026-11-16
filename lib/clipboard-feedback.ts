import { Platform } from "react-native";

export function systemConfirmsCopy(): boolean {
  return Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 33;
}
