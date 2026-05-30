import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Search,
} from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { writeUserSetting } from "@/lib/database/user-settings";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import {
  materializeSmartDeckCards,
  SMART_DECK_IDS,
  writeAllDecksFilter,
} from "@/lib/fsrs/smart-decks";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
};

function OnboardingInner() {
  const db = useDatabase();
  const { isDark, isLoaded, isRTL, themeColors, themeSurface } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [currentScreen, setCurrentScreen] = useState(0);
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [surahsLoaded, setSurahsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null);
  const screenAnim = useRef(new Animated.Value(1)).current;

  const isWide = width >= SIDEBAR_BREAKPOINT;
  const dir = isRTL ? "rtl" : "ltr";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const startTextAlign = isRTL ? "right" : "left";
  const endTextAlign = isRTL ? "left" : "right";
  const accentColor = isDark ? "#2dd4bf" : "#0d9488";
  const accentPressed = isDark ? "#14b8a6" : "#0f766e";
  const goldColor = "#FDDC91";
  const textPrimary = isDark ? "#F5F5F5" : "#2D2D2D";
  const textMuted = isDark ? "#A3A3A3" : "#8a7058";
  const subtleText = isDark ? "#737373" : "#9a7c60";
  const panelBg = themeColors.surfaceBright;
  const softPanelBg = themeColors.surfaceLow;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(45,45,45,0.08)";
  const BackIcon = isRTL ? ChevronRight : ChevronLeft;
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  useEffect(() => {
    let cancelled = false;
    db.getAllAsync<SurahRow>(
      "SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"
    )
      .then((rows) => {
        if (cancelled) return;
        setSurahs(rows);
        setSurahsLoaded(true);
      })
      .catch((err) => {
        console.warn("[Onboarding] Failed to load surahs:", err);
        if (cancelled) return;
        setError(s.genericActionFailed);
        setSurahsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [db, s.genericActionFailed]);

  const selectedRows = useMemo(
    () => surahs.filter((surah) => selectedSurahs.has(surah.number)),
    [selectedSurahs, surahs]
  );

  const totalAyahs = useMemo(
    () => selectedRows.reduce((sum, surah) => sum + surah.ayah_count, 0),
    [selectedRows]
  );

  const filteredSurahs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return surahs;
    return surahs.filter((surah) => {
      return (
        String(surah.number).includes(query) ||
        surah.name_english.toLowerCase().includes(query) ||
        surah.name_arabic.includes(query)
      );
    });
  }, [searchQuery, surahs]);

  const selectionSummary = interpolate(
    selectedSurahs.size === 1 ? s.onboardingSelectionSummaryOne : s.onboardingSelectionSummary,
    {
      surahs: selectedSurahs.size,
      ayahs: totalAyahs.toLocaleString(),
    }
  );

  const animateTo = useCallback(
    (screen: number) => {
      if (screen === currentScreen || creating || completing) return;
      setError(null);
      screenAnim.setValue(0);
      setCurrentScreen(screen);
      Animated.timing(screenAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: false,
      }).start();
    },
    [completing, creating, currentScreen, screenAnim]
  );

  const completeOnboarding = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    setError(null);
    try {
      await writeUserSetting(db, "onboarding_completed", "true");
      router.replace("/(tabs)/home");
    } catch (e) {
      console.warn("[Onboarding] Failed to complete onboarding:", e);
      setError(s.onboardingSaveFailed);
    } finally {
      setCompleting(false);
    }
  }, [completing, db, router, s.onboardingSaveFailed]);

  const handleCreateDeck = useCallback(async () => {
    if (selectedSurahs.size === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      await writeAllDecksFilter(db, {
        type: "surah",
        surahs: Array.from(selectedSurahs),
      });
      await materializeSmartDeckCards(db, SMART_DECK_IDS.retention);
      setCreatedDeckId(SMART_DECK_IDS.retention);
    } catch (err) {
      console.error("[Onboarding] Failed to save deck filters:", err);
      setError(s.deckFilterSaveFailed);
    } finally {
      setCreating(false);
    }
  }, [creating, db, selectedSurahs, s.deckFilterSaveFailed]);

  const handleStartReview = useCallback(async () => {
    if (!createdDeckId || completing) return;
    setCompleting(true);
    setError(null);
    try {
      await writeUserSetting(db, "onboarding_completed", "true");
      router.replace({ pathname: "/flashcards/session", params: { deckId: createdDeckId } });
    } catch (e) {
      console.warn("[Onboarding] Failed to start review:", e);
      setError(s.onboardingSaveFailed);
    } finally {
      setCompleting(false);
    }
  }, [completing, createdDeckId, db, router, s.onboardingSaveFailed]);

  const toggleSurah = useCallback((n: number) => {
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const primaryLabel = useMemo(() => {
    if (currentScreen === 0) return s.onboardingGetStarted;
    if (currentScreen === 1) {
      return selectedSurahs.size > 0
        ? `${s.onboardingContinue} (${selectionSummary})`
        : s.onboardingContinue;
    }
    if (createdDeckId) return s.flashcardsStartReview;
    return creating ? s.onboardingCreating : s.onboardingCreateAndStart;
  }, [
    createdDeckId,
    creating,
    currentScreen,
    s.flashcardsStartReview,
    s.onboardingContinue,
    s.onboardingCreateAndStart,
    s.onboardingCreating,
    s.onboardingGetStarted,
    selectedSurahs.size,
    selectionSummary,
  ]);

  const primaryDisabled =
    (currentScreen === 1 && selectedSurahs.size === 0) ||
    creating ||
    completing ||
    (currentScreen === 2 && !createdDeckId && selectedSurahs.size === 0);

  const handlePrimary = () => {
    if (currentScreen === 0) {
      animateTo(1);
      return;
    }
    if (currentScreen === 1) {
      animateTo(2);
      return;
    }
    if (createdDeckId) {
      handleStartReview();
      return;
    }
    handleCreateDeck();
  };

  const renderPrimaryIcon = () => {
    if (creating || completing) return <ActivityIndicator size="small" color="#FFFFFF" />;
    if (currentScreen === 2 && createdDeckId) return <Play size={18} color="#FFFFFF" fill="#FFFFFF" />;
    return <ForwardIcon size={18} color="#FFFFFF" />;
  };

  const renderStepHeader = () => (
    <View style={{ gap: 14 }}>
      <View
        style={{
          minHeight: 44,
          flexDirection: rowDirection,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {currentScreen > 0 && !(currentScreen === 2 && createdDeckId) ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => animateTo(currentScreen - 1)}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: softPanelBg,
              borderWidth: 1,
              borderColor,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <BackIcon size={20} color={textMuted} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}

        <Text
          style={{
            color: textMuted,
            fontFamily: "Manrope_600SemiBold",
            fontSize: 12,
            letterSpacing: 0,
            textAlign: "center",
            writingDirection: dir,
          }}
        >
          {interpolate(s.onboardingStepLabel, {
            current: currentScreen + 1,
            total: 3,
          })}
        </Text>

        <View style={{ width: 40 }} />
      </View>

      <View
        accessibilityRole="progressbar"
        style={{
          height: 3,
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(45,45,45,0.08)",
        }}
      >
        <View
          style={{
            width: `${((currentScreen + 1) / 3) * 100}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: accentColor,
          }}
        />
      </View>
    </View>
  );

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
      </View>
    </View>
  );

  const renderSurahRow = (surah: SurahRow) => {
    const isSelected = selectedSurahs.has(surah.number);
    return (
      <Pressable
        key={surah.number}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        onPress={() => toggleSurah(surah.number)}
        style={({ pressed }) => ({
          minHeight: 68,
          flexDirection: rowDirection,
          alignItems: "center",
          gap: 12,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: isSelected ? accentColor : borderColor,
          backgroundColor: isSelected
            ? isDark
              ? "rgba(45,212,191,0.10)"
              : "rgba(13,148,136,0.08)"
            : pressed
              ? softPanelBg
              : panelBg,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: isSelected ? accentColor : themeColors.surfaceDim,
            backgroundColor: isSelected ? accentColor : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isSelected ? <Check size={15} color="#FFFFFF" strokeWidth={3} /> : null}
        </View>

        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isSelected ? accentColor : softPanelBg,
          }}
        >
          <Text
            style={{
              color: isSelected ? "#FFFFFF" : textMuted,
              fontFamily: "Manrope_700Bold",
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {surah.number}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              color: textPrimary,
              fontFamily: "Manrope_600SemiBold",
              fontSize: 16,
              textAlign: "right",
              writingDirection: "rtl",
            }}
          >
            {surah.name_arabic}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: textMuted,
              fontFamily: "Manrope_400Regular",
              fontSize: 13,
              lineHeight: 18,
              textAlign: startTextAlign,
              writingDirection: dir,
            }}
          >
            {surah.name_english}
          </Text>
        </View>

        <Text
          numberOfLines={1}
          style={{
            color: subtleText,
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            minWidth: 58,
            textAlign: endTextAlign,
            writingDirection: dir,
          }}
        >
          {surah.ayah_count} {s.ayahs}
        </Text>
      </Pressable>
    );
  };

  const renderMemorization = () => (
    <View style={{ flex: 1, gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: textPrimary,
            fontFamily: "NotoSerif_700Bold",
            fontSize: 28,
            lineHeight: 34,
            textAlign: startTextAlign,
            writingDirection: dir,
          }}
        >
          {s.onboardingMemorizedTitle}
        </Text>
        <Text
          style={{
            color: textMuted,
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 21,
            textAlign: startTextAlign,
            writingDirection: dir,
          }}
        >
          {s.onboardingMemorizedSubtitle}
        </Text>
      </View>

      <View
        style={{
          minHeight: 50,
          borderRadius: 18,
          backgroundColor: panelBg,
          borderWidth: 1,
          borderColor,
          flexDirection: rowDirection,
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 14,
        }}
      >
        <Search size={18} color={textMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={s.onboardingSearchSurahs}
          placeholderTextColor={subtleText}
          returnKeyType="search"
          style={{
            flex: 1,
            color: textPrimary,
            fontFamily: "Manrope_500Medium",
            fontSize: 15,
            lineHeight: 20,
            paddingVertical: 0,
            textAlign: startTextAlign,
            writingDirection: dir,
          }}
        />
      </View>

      <View
        style={{
          borderRadius: 22,
          backgroundColor: softPanelBg,
          borderWidth: 1,
          borderColor,
          padding: 8,
          flex: 1,
          minHeight: 260,
        }}
      >
        {!surahsLoaded ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : filteredSurahs.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
            <Text
              style={{
                color: textMuted,
                fontFamily: "Manrope_600SemiBold",
                fontSize: 15,
                textAlign: "center",
                writingDirection: dir,
              }}
            >
              {s.onboardingNoSearchResults}
            </Text>
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
            {filteredSurahs.map(renderSurahRow)}
          </ScrollView>
        )}
      </View>

      {selectedSurahs.size > 0 ? (
        <View
          style={{
            flexDirection: rowDirection,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderRadius: 16,
            backgroundColor: isDark ? "rgba(45,212,191,0.10)" : "rgba(13,148,136,0.08)",
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text
            style={{
              color: accentColor,
              fontFamily: "Manrope_700Bold",
              fontSize: 13,
              textAlign: startTextAlign,
              writingDirection: dir,
            }}
          >
            {selectionSummary}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: textMuted,
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
              textAlign: endTextAlign,
              writingDirection: dir,
            }}
          >
            {selectedRows.slice(0, 3).map((surah) => surah.name_english).join(", ")}
            {selectedRows.length > 3 ? ` +${selectedRows.length - 3}` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderDeckSummary = () => (
    <View style={{ flex: 1, justifyContent: "center", gap: 24 }}>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 86,
            height: 86,
            borderRadius: 30,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: createdDeckId
              ? isDark
                ? "rgba(45,212,191,0.14)"
                : "rgba(13,148,136,0.10)"
              : softPanelBg,
            borderWidth: 1,
            borderColor: createdDeckId ? accentColor : borderColor,
          }}
        >
          {createdDeckId ? (
            <CheckCircle2 size={42} color={accentColor} strokeWidth={1.6} />
          ) : (
            <Layers size={40} color={accentColor} strokeWidth={1.6} />
          )}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text
          style={{
            color: textPrimary,
            fontFamily: "NotoSerif_700Bold",
            fontSize: 28,
            lineHeight: 34,
            textAlign: "center",
            writingDirection: dir,
          }}
        >
          {createdDeckId ? s.onboardingDeckReadyTitle : s.onboardingCreateDeckTitle}
        </Text>
        <Text
          style={{
            color: textMuted,
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 22,
            textAlign: "center",
            writingDirection: dir,
          }}
        >
          {createdDeckId ? s.onboardingDeckReadyDesc : s.onboardingCreateDeckDesc}
        </Text>
      </View>

      <View
        style={{
          borderRadius: 24,
          backgroundColor: panelBg,
          borderWidth: 1,
          borderColor,
          padding: 18,
          gap: 16,
        }}
      >
        <View style={{ flexDirection: rowDirection, gap: 12 }}>
          <View style={{ flex: 1, borderRadius: 18, backgroundColor: softPanelBg, padding: 16, gap: 6 }}>
            <Text
              style={{
                color: accentColor,
                fontFamily: "NotoSerif_700Bold",
                fontSize: 30,
                lineHeight: 36,
                textAlign: "center",
                fontVariant: ["tabular-nums"],
              }}
            >
              {selectedSurahs.size}
            </Text>
            <Text
              style={{
                color: textMuted,
                fontFamily: "Manrope_600SemiBold",
                fontSize: 12,
                textAlign: "center",
                writingDirection: dir,
              }}
            >
              {s.onboardingSurahsLabel}
            </Text>
          </View>
          <View style={{ flex: 1, borderRadius: 18, backgroundColor: softPanelBg, padding: 16, gap: 6 }}>
            <Text
              style={{
                color: accentColor,
                fontFamily: "NotoSerif_700Bold",
                fontSize: 30,
                lineHeight: 36,
                textAlign: "center",
                fontVariant: ["tabular-nums"],
              }}
            >
              {totalAyahs.toLocaleString()}
            </Text>
            <Text
              style={{
                color: textMuted,
                fontFamily: "Manrope_600SemiBold",
                fontSize: 12,
                textAlign: "center",
                writingDirection: dir,
              }}
            >
              {s.ayahs}
            </Text>
          </View>
        </View>

        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(45,45,45,0.08)",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: createdDeckId ? "100%" : "64%",
              height: "100%",
              borderRadius: 999,
              backgroundColor: createdDeckId ? accentColor : goldColor,
            }}
          />
        </View>
      </View>
    </View>
  );

  const renderScreen = () => {
    if (currentScreen === 0) return renderWelcome();
    if (currentScreen === 1) return renderMemorization();
    return renderDeckSummary();
  };

  if (!isLoaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: themeSurface }}>
        <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeSurface} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: themeSurface }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeSurface} />
      <View style={{ flex: 1, alignItems: "center" }}>
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: currentScreen === 1 ? 680 : 560,
            paddingHorizontal: isWide ? 32 : 22,
            paddingTop: 8,
            paddingBottom: 12,
            gap: 18,
          }}
        >
          {renderStepHeader()}

          <Animated.View
            style={{
              flex: 1,
              opacity: screenAnim,
              transform: [
                {
                  translateY: screenAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
            }}
          >
            {renderScreen()}
          </Animated.View>

          <View style={{ gap: 12 }}>
            {error ? (
              <Text
                style={{
                  color: "#dc2626",
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 13,
                  textAlign: "center",
                  writingDirection: dir,
                }}
              >
                {error}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={handlePrimary}
              disabled={primaryDisabled}
              style={({ pressed }) => ({
                minHeight: 54,
                borderRadius: 27,
                backgroundColor: pressed && !primaryDisabled ? accentPressed : accentColor,
                opacity: primaryDisabled ? 0.45 : 1,
                flexDirection: rowDirection,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                paddingHorizontal: 22,
                transform: [{ scale: pressed && !primaryDisabled ? 0.98 : 1 }],
              })}
            >
              {renderPrimaryIcon()}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={{
                  color: "#FFFFFF",
                  fontFamily: "Manrope_700Bold",
                  fontSize: 16,
                  textAlign: "center",
                  writingDirection: dir,
                }}
              >
                {primaryLabel}
              </Text>
            </Pressable>

            {currentScreen > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={createdDeckId ? completeOnboarding : completeOnboarding}
                disabled={creating || completing}
                hitSlop={8}
                style={({ pressed }) => ({
                  minHeight: 38,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: creating || completing ? 0.5 : pressed ? 0.72 : 1,
                })}
              >
                <Text
                  style={{
                    color: textMuted,
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 14,
                    textAlign: "center",
                    writingDirection: dir,
                  }}
                >
                  {createdDeckId ? s.onboardingContinue : s.onboardingSkipForNow}
                </Text>
              </Pressable>
            ) : null}
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
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6">
        <Text
          className="text-red-600 mb-4"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
        >
          {s.databaseError}
        </Text>
        <Text
          className="text-red-500 text-center"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
        >
          {error}
        </Text>
      </View>
    );
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <OnboardingInner />
    </SettingsProvider>
  );
}
