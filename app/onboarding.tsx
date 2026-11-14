import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { HifzSetupFlow } from "@/components/hifz/HifzSetupFlow";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { writeUserSetting } from "@/lib/database/user-settings";
import type { HifzPlan } from "@/lib/hifz/plan";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useRouter, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * The first route for a new install (5.1): a welcome, then the hifz setup (goal, memorized portion,
 * review tracks, pace and time), then straight into a first short session so the first recitation
 * starts within about 90 seconds (ONB-01). No account is needed, and every step has "Not now".
 */
function OnboardingInner() {
  const db = useDatabase();
  const { isDark, isLoaded, isRTL, themeColors, uiLanguage } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<"welcome" | "setup">("welcome");
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWide = width >= SIDEBAR_BREAKPOINT;
  const dir = isRTL ? "rtl" : "ltr";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const accentColor = isDark ? "#2dd4bf" : "#0d9488";
  // White text needs the deeper teal in every theme: on the bright dark-theme accent it reads at 1.9:1.
  const buttonFill = "#0d9488";
  const buttonPressed = "#0f766e";
  const goldColor = "#FDDC91";
  const textPrimary = isDark ? "#F5F5F5" : "#2D2D2D";
  const textMuted = isDark ? "#A3A3A3" : "#8a7058";
  const panelBg = themeColors.surfaceBright;
  const softPanelBg = themeColors.surfaceLow;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(45,45,45,0.08)";
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  /** ONB-05: completion is a synced setting, so a restored account skips onboarding. */
  const complete = useCallback(
    async (next: Href) => {
      if (completing) return;
      setCompleting(true);
      setError(null);
      try {
        await writeUserSetting(db, "onboarding_completed", "true");
        emitHabitChanged();
        router.replace(next);
      } catch (e) {
        console.warn("[Onboarding] Failed to complete onboarding:", e);
        setError(s.onboardingSaveFailed);
      } finally {
        setCompleting(false);
      }
    },
    [completing, db, router, s.onboardingSaveFailed],
  );

  /** ONB-01, 5.1 step 8: the first session starts right away, on what the plan offers first. */
  const firstSession = (plan: HifzPlan, declaredPages: number): Href => {
    if (plan.unit === "ayah") return "/flashcards/session";
    if (declaredPages > 0) return "/hifz/review";
    if (plan.newPerDay > 0) return "/hifz/sabaq" as Href;
    return "/(tabs)/home";
  };

  const renderWelcomeArt = () => (
    <View
      style={{
        width: "100%",
        maxWidth: 360,
        aspectRatio: 1.08,
        borderRadius: 28,
        backgroundColor: panelBg,
        borderWidth: 1,
        borderColor,
        padding: 22,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 20,
          right: isRTL ? undefined : 20,
          left: isRTL ? 20 : undefined,
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)",
        }}
      />
      <View
        style={{
          flex: 1,
          borderRadius: 20,
          backgroundColor: softPanelBg,
          borderWidth: 1,
          borderColor,
          padding: 18,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: rowDirection, alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: accentColor,
            }}
          >
            <BookOpen size={27} color="#FFFFFF" strokeWidth={1.7} />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 8, width: "72%", borderRadius: 999, backgroundColor: textPrimary, opacity: 0.16 }} />
            <View style={{ height: 8, width: "48%", borderRadius: 999, backgroundColor: goldColor, opacity: 0.85 }} />
          </View>
        </View>

        <View style={{ gap: 10, paddingVertical: 16 }}>
          {[0, 1, 2, 3, 4].map((line) => (
            <View
              key={line}
              style={{
                height: 7,
                width: `${82 - line * 8}%`,
                alignSelf: line % 2 === 0 ? "flex-start" : "flex-end",
                borderRadius: 999,
                backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(45,45,45,0.10)",
              }}
            />
          ))}
        </View>

        <View
          style={{
            flexDirection: rowDirection,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, height: 9, borderRadius: 999, backgroundColor: themeColors.surfaceHigh }} />
          <View style={{ width: 78, height: 9, borderRadius: 999, backgroundColor: accentColor }} />
        </View>
      </View>
    </View>
  );

  const renderWelcome = () => (
    <View style={{ flex: 1, justifyContent: "center", gap: 28 }}>
      <View style={{ alignItems: "center" }}>{renderWelcomeArt()}</View>
      <View style={{ gap: 12 }}>
        <Text
          style={{
            color: accentColor,
            fontFamily: "NotoSerif_700Bold",
            fontSize: isWide ? 44 : 40,
            lineHeight: isWide ? 52 : 46,
            textAlign: "center",
            writingDirection: dir,
          }}
        >
          {s.onboardingWelcome}
        </Text>
        <Text
          style={{
            color: textMuted,
            fontFamily: "Manrope_400Regular",
            fontSize: 16,
            lineHeight: 24,
            textAlign: "center",
            writingDirection: dir,
          }}
        >
          {s.onboardingSubtitle}
        </Text>
        <View style={{ alignItems: "center", gap: 4, paddingTop: 2 }}>
          <Text
            style={{
              color: accentColor,
              fontFamily: "Manrope_700Bold",
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
              writingDirection: dir,
            }}
          >
            {s.onboardingFocusTitle}
          </Text>
          <Text
            style={{
              color: textMuted,
              fontFamily: "Manrope_600SemiBold",
              fontSize: 13,
              lineHeight: 19,
              textAlign: "center",
              writingDirection: dir,
            }}
          >
            {s.onboardingFocusPractice}
          </Text>
        </View>
      </View>
    </View>
  );

  if (!isLoaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.surface }}>
        <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeColors.surface} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      </SafeAreaView>
    );
  }

  if (screen === "setup") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.surface }}>
        <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeColors.surface} />
        <View style={{ flex: 1, width: "100%", maxWidth: 680, alignSelf: "center" }}>
          <HifzSetupFlow
            db={db}
            language={uiLanguage}
            isDark={isDark}
            s={s}
            initialPlan={null}
            onCancel={() => setScreen("welcome")}
            onDone={({ plan, declaredPages }) => complete(firstSession(plan, declaredPages))}
          />
          {error ? (
            <Text style={{ color: "#dc2626", fontFamily: "Manrope_600SemiBold", fontSize: 13, textAlign: "center", writingDirection: dir, paddingBottom: 12 }}>
              {error}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.surface }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeColors.surface} />
      <View style={{ flex: 1, alignItems: "center", backgroundColor: themeColors.surface }}>
        <View style={{ flex: 1, width: "100%", maxWidth: 560, paddingHorizontal: isWide ? 32 : 22, paddingTop: 8, paddingBottom: 12, gap: 18 }}>
          {renderWelcome()}
          <View style={{ gap: 12 }}>
            {error ? (
              <Text style={{ color: "#dc2626", fontFamily: "Manrope_600SemiBold", fontSize: 13, textAlign: "center", writingDirection: dir }}>
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setScreen("setup")}
              style={({ pressed }) => ({
                minHeight: 54,
                borderRadius: 27,
                backgroundColor: pressed ? buttonPressed : buttonFill,
                flexDirection: rowDirection,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                paddingHorizontal: 22,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <ForwardIcon size={18} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: "center", writingDirection: dir }}>
                {s.onboardingGetStarted}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => complete("/(tabs)/home")}
              disabled={completing}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: 44, alignItems: "center", justifyContent: "center", opacity: completing ? 0.5 : pressed ? 0.72 : 1 })}
            >
              <Text style={{ color: textMuted, fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: "center", writingDirection: dir }}>
                {s.onboardingSkipForNow}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function OnboardingScreen() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();

  if (error) {
    return <DatabaseErrorState title={s.databaseError} message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return <OnboardingInner />;
}
