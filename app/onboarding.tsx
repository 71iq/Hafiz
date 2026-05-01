import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BookOpen, Check, Layers } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { createDeck, generateDeckId } from "@/lib/fsrs/queries";
import type { DeckScope } from "@/lib/fsrs/types";

// ─── Types ───────────────────────────────────────────────────

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
};

// ─── Inner component (needs SettingsProvider) ────────────────

function OnboardingInner() {
  const db = useDatabase();
  const { isDark } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const [currentScreen, setCurrentScreen] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Screen 2 state
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [surahsLoaded, setSurahsLoaded] = useState(false);

  // Screen 3 state
  const [creating, setCreating] = useState(false);
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null);

  // Load surahs
  useEffect(() => {
    db.getAllAsync<SurahRow>(
      "SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"
    ).then((rows) => {
      setSurahs(rows);
      setSurahsLoaded(true);
    });
  }, [db]);

  // Computed
  const totalAyahs = Array.from(selectedSurahs).reduce((sum, n) => {
    const s = surahs.find((r) => r.number === n);
    return sum + (s?.ayah_count ?? 0);
  }, 0);

  // ─── Navigation ─────────────────────────────────────────────

  const animateTo = useCallback(
    (screen: number) => {
      Animated.spring(slideAnim, {
        toValue: -screen * screenWidth,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }).start();
      setCurrentScreen(screen);
    },
    [slideAnim, screenWidth]
  );

  const completeOnboarding = useCallback(async () => {
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('onboarding_completed', 'true')"
    );
    router.replace("/(tabs)/mushaf");
  }, [db, router]);

  const handleCreateDeck = useCallback(async () => {
    if (selectedSurahs.size === 0) return;
    setCreating(true);
    try {
      const scope: DeckScope = {
        type: "surah",
        surahs: Array.from(selectedSurahs),
      };
      const deckId = generateDeckId(scope);
      await createDeck(db, deckId, scope);
      setCreatedDeckId(deckId);
      setCreating(false);
    } catch (err) {
      console.error("[Onboarding] Failed to create deck:", err);
      setCreating(false);
    }
  }, [db, selectedSurahs]);

  const handleStartReview = useCallback(async () => {
    if (!createdDeckId) return;
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('onboarding_completed', 'true')"
    );
    router.replace({ pathname: "/flashcards/session", params: { deckId: createdDeckId } });
  }, [createdDeckId, db, router]);

  const toggleSurah = useCallback((n: number) => {
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  // ─── Colors ─────────────────────────────────────────────────

  const teal = "#0d9488";
  const tealDark = "#2dd4bf";
  const accentColor = isDark ? tealDark : teal;
  const bgColor = isDark ? "#0A0A0A" : "#FFF8F1";
  const cardBg = isDark ? "#1A1A1A" : "#FFFFFF";
  const textPrimary = isDark ? "#F5F5F5" : "#2D2D2D";
  const textMuted = isDark ? "#A3A3A3" : "#8a7058";
  const dotInactive = isDark ? "#404040" : "#DFD9D1";
  const checkboxBorder = isDark ? "#525252" : "#DFD9D1";
  const checkboxChecked = accentColor;
  const surahNumberBg = isDark ? "#262626" : "#F0EBE3";

  // ─── Screen 1: Welcome ─────────────────────────────────────

  const renderWelcome = () => (
    <View
      style={{ width: screenWidth, flex: 1, paddingHorizontal: 32 }}
    >
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <View
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: isDark ? "rgba(13,148,136,0.15)" : "rgba(13,148,136,0.08)",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 32,
          }}
        >
          <BookOpen size={64} color={accentColor} strokeWidth={1.5} />
        </View>

        <Text
          style={{
            fontFamily: "NotoSerif_700Bold",
            fontSize: 40,
            color: accentColor,
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          {s.onboardingWelcome}
        </Text>

        <Text
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 16,
            color: textMuted,
            textAlign: "center",
            lineHeight: 24,
          }}
        >
          {s.onboardingSubtitle}
        </Text>
      </View>

      <View style={{ paddingBottom: 40, alignItems: "center" }}>
        <Pressable
          onPress={() => animateTo(1)}
          style={(state) => ({
            backgroundColor: accentColor,
            paddingHorizontal: 48,
            height: 52,
            borderRadius: 26,
            justifyContent: "center",
            alignItems: "center",
            transform: [{ scale: state.pressed ? 0.98 : 1 }],
            width: "100%",
          })}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 17,
              color: "#FFFFFF",
            }}
          >
            {s.onboardingGetStarted}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Screen 2: Memorization Selection ──────────────────────

  const renderSurahRow = (surah: SurahRow) => {
    const isSelected = selectedSurahs.has(surah.number);
    return (
      <Pressable
        key={surah.number}
        onPress={() => toggleSurah(surah.number)}
        style={(state) => ({
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: state.pressed
            ? isDark
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.03)"
            : "transparent",
        })}
      >
        {/* Checkbox */}
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: isSelected ? checkboxChecked : checkboxBorder,
            backgroundColor: isSelected ? checkboxChecked : "transparent",
            justifyContent: "center",
            alignItems: "center",
            marginRight: 12,
          }}
        >
          {isSelected && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
        </View>

        {/* Surah number */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: surahNumberBg,
            justifyContent: "center",
            alignItems: "center",
            marginRight: 12,
          }}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 13,
              color: textMuted,
            }}
          >
            {surah.number}
          </Text>
        </View>

        {/* Surah info */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 16,
              color: textPrimary,
              writingDirection: "rtl",
              textAlign: "right",
            }}
          >
            {surah.name_arabic}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 13,
              color: textMuted,
            }}
          >
            {surah.name_english}
          </Text>
        </View>

        {/* Ayah count */}
        <Text
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            color: textMuted,
            marginLeft: 8,
          }}
        >
          {surah.ayah_count} {s.ayahs}
        </Text>
      </Pressable>
    );
  };

  const renderMemorization = () => (
    <View
      style={{ width: screenWidth, flex: 1, paddingTop: 16 }}
    >
      {/* Header */}
      <View style={{ paddingHorizontal: 24, marginBottom: 8 }}>
        <Text
          style={{
            fontFamily: "NotoSerif_700Bold",
            fontSize: 24,
            color: textPrimary,
            marginBottom: 8,
          }}
        >
          {s.onboardingMemorizedTitle}
        </Text>
        <Text
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            color: textMuted,
            lineHeight: 20,
          }}
        >
          {s.onboardingMemorizedSubtitle}
        </Text>
      </View>

      {/* Surah list */}
      <View style={{ flex: 1 }}>
        {!surahsLoaded ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {surahs.map(renderSurahRow)}
          </ScrollView>
        )}
      </View>

      {/* Bottom actions */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: 24,
          paddingTop: 12,
          backgroundColor: bgColor,
        }}
      >
        {/* Continue button */}
        <Pressable
          onPress={() => animateTo(2)}
          disabled={selectedSurahs.size === 0}
          style={(state) => ({
            backgroundColor: accentColor,
            paddingHorizontal: 48,
            height: 52,
            borderRadius: 26,
            justifyContent: "center",
            alignItems: "center",
            opacity: selectedSurahs.size === 0 ? 0.4 : 1,
            transform: [{ scale: state.pressed && selectedSurahs.size > 0 ? 0.98 : 1 }],
            width: "100%",
          })}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 17,
              color: "#FFFFFF",
            }}
          >
            {selectedSurahs.size > 0
              ? `${s.onboardingContinue} (${interpolate(s.onboardingSelected, { n: String(selectedSurahs.size) })})`
              : s.onboardingContinue}
          </Text>
        </Pressable>

        {/* Skip button */}
        <Pressable
          onPress={completeOnboarding}
          style={(state) => ({
            marginTop: 16,
            alignItems: "center",
            transform: [{ scale: state.pressed ? 0.98 : 1 }],
          })}
        >
          <Text
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              color: textMuted,
            }}
          >
            {s.onboardingSkip}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Screen 3: Create Deck ────────────────────────────────

  const renderCreateDeck = () => (
    <View
      style={{
        width: screenWidth,
        flex: 1,
        paddingHorizontal: 32,
      }}
    >
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        {/* Deck icon */}
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: isDark ? "rgba(13,148,136,0.15)" : "rgba(13,148,136,0.08)",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 32,
          }}
        >
          <Layers size={48} color={accentColor} strokeWidth={1.5} />
        </View>

        <Text
          style={{
            fontFamily: "NotoSerif_700Bold",
            fontSize: 24,
            color: textPrimary,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          {createdDeckId ? s.flashcardsSummaryTitle : s.onboardingCreateDeckTitle}
        </Text>

        {/* Summary card */}
        <View
          style={{
            backgroundColor: cardBg,
            borderRadius: 16,
            padding: 20,
            width: "100%",
            marginBottom: 24,
            shadowColor: "#003638",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.04,
            shadowRadius: 32,
            elevation: 2,
          }}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 18,
              color: accentColor,
              textAlign: "center",
              marginBottom: 4,
            }}
          >
            {interpolate(s.onboardingSurahsSelected, { n: String(selectedSurahs.size) })}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              color: textMuted,
              textAlign: "center",
            }}
          >
            {interpolate(s.onboardingAyahsTotal, { n: totalAyahs.toLocaleString() })}
          </Text>
        </View>

        {/* Explanation */}
        <Text
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            color: textMuted,
            textAlign: "center",
            lineHeight: 22,
            paddingHorizontal: 8,
          }}
        >
          {createdDeckId ? s.onboardingCreateDeckDesc : s.onboardingCreateDeckDesc}
        </Text>
      </View>

      {/* Bottom actions */}
      <View style={{ paddingBottom: 40, alignItems: "center" }}>
        {!createdDeckId ? (
          <>
            <Pressable
              onPress={handleCreateDeck}
              disabled={creating}
              style={(state) => ({
                backgroundColor: accentColor,
                paddingHorizontal: 48,
                height: 52,
                borderRadius: 26,
                justifyContent: "center",
                alignItems: "center",
                flexDirection: "row",
                gap: 8,
                opacity: creating ? 0.7 : 1,
                transform: [{ scale: state.pressed && !creating ? 0.98 : 1 }],
                width: "100%",
              })}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : null}
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 17,
                  color: "#FFFFFF",
                }}
              >
                {creating ? s.onboardingCreating : s.onboardingCreateAndStart}
              </Text>
            </Pressable>

            <Pressable
              onPress={completeOnboarding}
              disabled={creating}
              style={(state) => ({
                marginTop: 16,
                alignItems: "center",
                transform: [{ scale: state.pressed ? 0.98 : 1 }],
              })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 15,
                  color: textMuted,
                }}
              >
                {s.onboardingSkipForNow}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={handleStartReview}
              style={(state) => ({
                backgroundColor: accentColor,
                paddingHorizontal: 48,
                height: 52,
                borderRadius: 26,
                justifyContent: "center",
                alignItems: "center",
                transform: [{ scale: state.pressed ? 0.98 : 1 }],
                width: "100%",
              })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 17,
                  color: "#FFFFFF",
                }}
              >
                {s.flashcardsStartReview}
              </Text>
            </Pressable>

            <Pressable
              onPress={completeOnboarding}
              style={(state) => ({
                marginTop: 16,
                alignItems: "center",
                transform: [{ scale: state.pressed ? 0.98 : 1 }],
              })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 15,
                  color: textMuted,
                }}
              >
                {s.onboardingContinue}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );

  // ─── Dot indicators ────────────────────────────────────────

  const renderDots = () => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 8,
        paddingBottom: 12,
      }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: currentScreen === i ? 24 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: currentScreen === i ? accentColor : dotInactive,
          }}
        />
      ))}
    </View>
  );

  // ─── Main render ───────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Screens container */}
      <View style={{ flex: 1, overflow: "hidden" }}>
        <Animated.View
          style={{
            flex: 1,
            flexDirection: "row",
            width: screenWidth * 3,
            transform: [{ translateX: slideAnim }],
          }}
        >
          {renderWelcome()}
          {renderMemorization()}
          {renderCreateDeck()}
        </Animated.View>
      </View>

      {/* Dot indicators */}
      {renderDots()}
    </SafeAreaView>
  );
}

// ─── Exported screen (wraps with SettingsProvider) ───────────

export default function OnboardingScreen() {
  return (
    <SettingsProvider>
      <OnboardingInner />
    </SettingsProvider>
  );
}
