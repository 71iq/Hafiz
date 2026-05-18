import Constants from "expo-constants";

const expoExtra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, string | undefined>;

const QF_USER_AUTH_ENABLED =
  process.env.EXPO_PUBLIC_QF_USER_AUTH_ENABLED ??
  expoExtra.EXPO_PUBLIC_QF_USER_AUTH_ENABLED ??
  expoExtra.qfUserAuthEnabled ??
  "false";

const QF_LOGIN_ENABLED =
  process.env.EXPO_PUBLIC_QF_LOGIN_ENABLED ??
  expoExtra.EXPO_PUBLIC_QF_LOGIN_ENABLED ??
  expoExtra.qfLoginEnabled ??
  QF_USER_AUTH_ENABLED;

const QF_SYNC_ENABLED =
  process.env.EXPO_PUBLIC_QF_SYNC_ENABLED ??
  expoExtra.EXPO_PUBLIC_QF_SYNC_ENABLED ??
  expoExtra.qfSyncEnabled ??
  QF_USER_AUTH_ENABLED;

export function isQfUserAuthEnabled(): boolean {
  return ["1", "true", "yes"].includes(QF_USER_AUTH_ENABLED.trim().toLowerCase());
}

export function isQfLoginEnabled(): boolean {
  return ["1", "true", "yes"].includes(QF_LOGIN_ENABLED.trim().toLowerCase());
}

export function isQfSyncEnabled(): boolean {
  return ["1", "true", "yes"].includes(QF_SYNC_ENABLED.trim().toLowerCase());
}
