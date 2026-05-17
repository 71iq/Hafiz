import Constants from "expo-constants";

const expoExtra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, string | undefined>;

const QF_USER_AUTH_ENABLED =
  process.env.EXPO_PUBLIC_QF_USER_AUTH_ENABLED ??
  expoExtra.EXPO_PUBLIC_QF_USER_AUTH_ENABLED ??
  expoExtra.qfUserAuthEnabled ??
  "false";

export function isQfUserAuthEnabled(): boolean {
  return ["1", "true", "yes"].includes(QF_USER_AUTH_ENABLED.trim().toLowerCase());
}
