import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { strings, type UIStrings } from "@/lib/i18n/strings";

type Props = {
  title: string;
  message: string;
  variant?: "startup" | "profile";
};

const MAX_DETAIL_LENGTH = 600;

/**
 * Diagnostic text shown behind "Show details". Email addresses, URL query strings, long tokens and
 * device file paths are masked so a screenshot of the error does not leak account or device data.
 */
export function sanitizeDatabaseErrorDetails(message: string): string {
  const masked = message
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, "$1")
    .replace(/(?:file:\/\/)?(?:\/[\w.@%+-]+){2,}\/([\w.@%+-]+)/g, ".../$1")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
  return masked.length > MAX_DETAIL_LENGTH ? `${masked.slice(0, MAX_DETAIL_LENGTH)}...` : masked;
}

/**
 * The caller chooses the title language (startup cache or app language); the buttons follow that
 * title so the screen never mixes languages.
 */
function stringsForTitle(title: string): UIStrings {
  return title === strings.ar.databaseError ? strings.ar : strings.en;
}

export function DatabaseErrorState({ title, message, variant = "startup" }: Props) {
  const isProfile = variant === "profile";
  const { retry } = useDatabaseStatus();
  const [showDetails, setShowDetails] = useState(false);
  const s = stringsForTitle(title);
  const isRTL = s === strings.ar;
  return (
    <View
      className={
        isProfile
          ? "flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark"
          : "flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6"
      }
    >
      <Text
        accessibilityRole="header"
        className={
          isProfile
            ? "mb-2 text-center text-red-600 dark:text-red-400"
            : "mb-4 text-center text-red-600 dark:text-red-400"
        }
        style={{ fontFamily: "Manrope_700Bold", fontSize: 18, writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {title}
      </Text>
      <View className="items-center gap-2">
        {retry ? (
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            className="min-h-11 items-center justify-center rounded-full bg-primary-muted px-6 dark:bg-primary-bright"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
          >
            <Text className="text-white dark:text-primary" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.databaseRetry}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setShowDetails((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          className="min-h-11 items-center justify-center px-4"
        >
          <Text
            className="text-warm-700 underline dark:text-neutral-300"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
          >
            {showDetails ? s.databaseHideDetails : s.databaseShowDetails}
          </Text>
        </Pressable>
      </View>
      {showDetails ? (
        <Text
          selectable
          className="mt-2 text-center text-warm-700 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_400Regular", fontSize: isProfile ? 13 : 14, writingDirection: "ltr" }}
        >
          {sanitizeDatabaseErrorDetails(message)}
        </Text>
      ) : null}
    </View>
  );
}
