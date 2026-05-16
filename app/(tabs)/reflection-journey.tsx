import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { BookMarked, Lock, Sparkles } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Toast } from "@/components/ui/Toast";
import { JourneyAyahCard } from "@/components/reflection-journey/JourneyAyahCard";
import { useDatabase } from "@/lib/database/provider";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import {
  localizeReflectionJourneyText,
  REFLECTION_JOURNEY_MAX_RESPONSE_CHARS,
  REFLECTION_JOURNEY_MIN_RESPONSE_CHARS,
} from "@/lib/reflection-journey/schema";
import {
  completeReflectionJourneyLevel,
  listReflectionJourneyLevels,
  saveReflectionJourneyDraft,
} from "@/lib/reflection-journey/queries";
import type { ReflectionJourneyLevelListItem } from "@/lib/reflection-journey/types";
import { useSelection, SelectionProvider } from "@/lib/selection/context";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

export default function ReflectionJourneyScreen() {
  return (
    <SelectionProvider>
      <ReflectionJourneyInner />
    </SelectionProvider>
  );
}

function ReflectionJourneyInner() {
  const db = useDatabase();
  const router = useRouter();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width } = useWindowDimensions();
  const { toastMessage, dismissToast, showToast } = useSelection();
  const [levels, setLevels] = useState<ReflectionJourneyLevelListItem[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingComplete, setSavingComplete] = useState(false);

  const isWide = width >= SIDEBAR_BREAKPOINT;
  const selectedLevel = levels.find((level) => level.id === selectedLevelId) ?? null;
  const selectedIndex = selectedLevel ? levels.findIndex((level) => level.id === selectedLevel.id) : -1;
  const nextLevel = selectedIndex >= 0 ? levels[selectedIndex + 1] ?? null : null;

  const loadLevels = useCallback(
    async (preferredLevelId?: string | null) => {
      const items = await listReflectionJourneyLevels(db);
      setLevels(items);

      const preferred =
        (preferredLevelId && items.find((item) => item.id === preferredLevelId)?.id) ??
        items.find((item) => item.status === "available" || item.status === "draft")?.id ??
        items[0]?.id ??
        null;

      setSelectedLevelId(preferred);
    },
    [db]
  );

  useFocusEffect(
    useCallback(() => {
      loadLevels();
    }, [loadLevels])
  );

  useEffect(() => {
    setResponseText(selectedLevel?.entry?.responseText ?? "");
    setError(null);
  }, [selectedLevel?.id, selectedLevel?.entry?.updatedAt]);

  const completedCount = useMemo(
    () => levels.filter((level) => level.status === "completed").length,
    [levels]
  );

  const currentCountLabel = interpolate(s.reflectionJourneyProgress, {
    completed: completedCount,
    total: levels.length,
  });

  const handleSaveDraft = useCallback(async () => {
    if (!selectedLevel) return;
    setSavingDraft(true);
    setError(null);
    try {
      await saveReflectionJourneyDraft(db, selectedLevel.id, responseText);
      await loadLevels(selectedLevel.id);
      showToast(s.reflectionJourneyDraftSaved);
    } catch (saveError) {
      console.warn("[ReflectionJourney] Failed to save draft:", saveError);
      setError(s.reflectionJourneySaveFailed);
    } finally {
      setSavingDraft(false);
    }
  }, [db, loadLevels, responseText, s.reflectionJourneyDraftSaved, s.reflectionJourneySaveFailed, selectedLevel, showToast]);

  const handleComplete = useCallback(async () => {
    if (!selectedLevel) return;

    const trimmed = responseText.trim();
    if (trimmed.length < REFLECTION_JOURNEY_MIN_RESPONSE_CHARS) {
      setError(interpolate(s.reflectionJourneyMinChars, { n: REFLECTION_JOURNEY_MIN_RESPONSE_CHARS }));
      return;
    }
    if (trimmed.length > REFLECTION_JOURNEY_MAX_RESPONSE_CHARS) {
      setError(interpolate(s.reflectionJourneyMaxChars, { n: REFLECTION_JOURNEY_MAX_RESPONSE_CHARS }));
      return;
    }

    setSavingComplete(true);
    setError(null);
    try {
      await completeReflectionJourneyLevel(db, selectedLevel.id, trimmed);
      await loadLevels(selectedLevel.id);
      showToast(s.reflectionJourneyCompletedToast);
    } catch (saveError) {
      console.warn("[ReflectionJourney] Failed to complete level:", saveError);
      setError(s.reflectionJourneySaveFailed);
    } finally {
      setSavingComplete(false);
    }
  }, [db, loadLevels, responseText, s.reflectionJourneyCompletedToast, s.reflectionJourneyMaxChars, s.reflectionJourneyMinChars, s.reflectionJourneySaveFailed, selectedLevel, showToast]);

  if (levels.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 px-6">
          <View className="pt-8 pb-4">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28, textAlign: isRTL ? "right" : "left" }}
            >
              {s.reflectionJourneyTitle}
            </Text>
          </View>
          <Card elevation="low" className="rounded-4xl">
            <EmptyState
              icon={BookMarked}
              title={s.reflectionJourneyEmptyTitle}
              subtitle={s.reflectionJourneyEmptySubtitle}
              isDark={isDark}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="pt-8 pb-4">
          <View className={`items-start justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <View className={isRTL ? "items-end" : "items-start"}>
              <Text
                className="text-warm-400 dark:text-neutral-500 uppercase"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}
              >
                {currentCountLabel}
              </Text>
              <Text
                className="text-charcoal dark:text-neutral-100 mt-1"
                style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28, textAlign: isRTL ? "right" : "left" }}
              >
                {s.reflectionJourneyTitle}
              </Text>
              <Text
                className="text-warm-500 dark:text-neutral-400 mt-1"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 21, textAlign: isRTL ? "right" : "left" }}
              >
                {s.reflectionJourneySubtitle}
              </Text>
            </View>
            <Button variant="ghost" size="sm" onPress={() => router.push("/home")} className="mt-1">
              <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {s.tabHome}
              </Text>
            </Button>
          </View>
        </View>

        <View className={isWide ? `flex-row gap-4 ${isRTL ? "flex-row-reverse" : ""}` : "gap-4"}>
          <Card
            elevation="low"
            className={isWide ? "rounded-4xl p-4 self-start" : "rounded-4xl p-4"}
            style={isWide ? { width: 280 } : undefined}
          >
            <Text
              className="text-charcoal dark:text-neutral-100 mb-3"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
            >
              {s.reflectionJourneyLevels}
            </Text>

            {isWide ? (
              <View className="gap-2">
                {levels.map((level) => (
                  <LevelPill
                    key={level.id}
                    level={level}
                    selected={level.id === selectedLevelId}
                    onPress={() => !level.isLocked && setSelectedLevelId(level.id)}
                  />
                ))}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  gap: 8,
                  flexDirection: isRTL ? "row-reverse" : "row",
                }}
              >
                {levels.map((level) => (
                  <LevelPill
                    key={level.id}
                    level={level}
                    selected={level.id === selectedLevelId}
                    onPress={() => !level.isLocked && setSelectedLevelId(level.id)}
                  />
                ))}
              </ScrollView>
            )}
          </Card>

          <View className="flex-1 gap-4">
            {selectedLevel ? (
              <>
                <Card elevation="low" className="rounded-4xl p-5">
                  <View className={`items-start justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                    <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                      <Text
                        className="text-charcoal dark:text-neutral-100"
                        style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22, textAlign: isRTL ? "right" : "left" }}
                      >
                        {localizeReflectionJourneyText(selectedLevel.title, uiLanguage)}
                      </Text>
                      {selectedLevel.summary ? (
                        <Text
                          className="text-warm-500 dark:text-neutral-400 mt-2"
                          style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 24, textAlign: isRTL ? "right" : "left" }}
                        >
                          {localizeReflectionJourneyText(selectedLevel.summary, uiLanguage)}
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge status={selectedLevel.status} />
                  </View>

                  {selectedLevel.estimatedMinutes ? (
                    <Text
                      className="text-warm-400 dark:text-neutral-500 mt-3"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                    >
                      {interpolate(s.reflectionJourneyMinutes, { n: selectedLevel.estimatedMinutes })}
                    </Text>
                  ) : null}
                </Card>

                {selectedLevel.blocks.map((block, index) => (
                  block.type === "custom_text" ? (
                    <Card key={`${selectedLevel.id}-${index}`} elevation="low" className="rounded-4xl p-5">
                      {block.title ? (
                        <Text
                          className="text-charcoal dark:text-neutral-100 mb-2"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
                        >
                          {localizeReflectionJourneyText(block.title, uiLanguage)}
                        </Text>
                      ) : null}
                      <Text
                        className="text-charcoal dark:text-neutral-100"
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 15,
                          lineHeight: 26,
                          textAlign: isRTL ? "right" : "left",
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {localizeReflectionJourneyText(block.body, uiLanguage)}
                      </Text>
                    </Card>
                  ) : (
                    <JourneyAyahCard key={`${selectedLevel.id}-${index}`} block={block} />
                  )
                ))}

                <Card elevation="low" className="rounded-4xl p-5">
                  <Text
                    className="text-charcoal dark:text-neutral-100 mb-2"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
                  >
                    {s.reflectionJourneyResponseLabel}
                  </Text>
                  <Text
                    className="text-warm-500 dark:text-neutral-400 mb-3"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 22, textAlign: isRTL ? "right" : "left" }}
                  >
                    {localizeReflectionJourneyText(selectedLevel.responsePrompt, uiLanguage)}
                  </Text>

                  <TextInput
                    value={responseText}
                    onChangeText={(text) => {
                      setResponseText(text);
                      if (error) setError(null);
                    }}
                    multiline
                    maxLength={REFLECTION_JOURNEY_MAX_RESPONSE_CHARS}
                    placeholder={s.reflectionJourneyResponsePlaceholder}
                    placeholderTextColor={isDark ? "#737373" : "#A39B93"}
                    textAlignVertical="top"
                    className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-3.5 text-charcoal dark:text-neutral-100"
                    style={{
                      minHeight: 180,
                      fontFamily: "Manrope_400Regular",
                      fontSize: 14,
                      lineHeight: 24,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  />

                  <View className={`mt-3 items-center justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                    <Text
                      className="text-warm-500 dark:text-neutral-400"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                    >
                      {interpolate(s.reflectionJourneyResponseCount, { n: responseText.trim().length })}
                    </Text>
                    {responseText.trim().length > 0 && responseText.trim().length < REFLECTION_JOURNEY_MIN_RESPONSE_CHARS ? (
                      <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#ef4444" }}>
                        {interpolate(s.reflectionJourneyMinChars, { n: REFLECTION_JOURNEY_MIN_RESPONSE_CHARS })}
                      </Text>
                    ) : null}
                  </View>

                  {error ? (
                    <Text
                      style={{
                        marginTop: 10,
                        fontFamily: "Manrope_500Medium",
                        fontSize: 12,
                        color: "#ef4444",
                        textAlign: isRTL ? "right" : "left",
                      }}
                    >
                      {error}
                    </Text>
                  ) : null}

                  <View className={`mt-4 gap-3 ${isWide ? (isRTL ? "flex-row-reverse" : "flex-row") : ""}`}>
                    {!selectedLevel.entry || selectedLevel.entry.status !== "completed" ? (
                      <Button
                        variant="outline"
                        onPress={handleSaveDraft}
                        disabled={savingDraft || savingComplete || selectedLevel.isLocked}
                        className={isWide ? "flex-1 border border-warm-200 dark:border-neutral-700" : ""}
                      >
                        <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                          {savingDraft ? s.saving : s.reflectionJourneySaveDraft}
                        </Text>
                      </Button>
                    ) : null}
                    <Button
                      onPress={handleComplete}
                      disabled={savingDraft || savingComplete || selectedLevel.isLocked}
                      className={isWide ? "flex-1" : ""}
                    >
                      <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                        {savingComplete ? s.saving : s.reflectionJourneySaveComplete}
                      </Text>
                    </Button>
                  </View>

                  {selectedLevel.status === "completed" && nextLevel && !nextLevel.isLocked ? (
                    <Button
                      variant="ghost"
                      onPress={() => setSelectedLevelId(nextLevel.id)}
                      className={`mt-3 ${isRTL ? "self-end" : "self-start"}`}
                    >
                      <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                        <Sparkles size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
                        <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                          {s.reflectionJourneyOpenNext}
                        </Text>
                      </View>
                    </Button>
                  ) : null}
                </Card>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {toastMessage ? <Toast message={toastMessage} onDismiss={dismissToast} /> : null}
    </SafeAreaView>
  );
}

function LevelPill({
  level,
  selected,
  onPress,
}: {
  level: ReflectionJourneyLevelListItem;
  selected: boolean;
  onPress: () => void;
}) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const title = localizeReflectionJourneyText(level.title, uiLanguage);
  const mutedColor = isDark ? "#737373" : "#8B8178";
  const locked = level.isLocked;

  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      className={`rounded-3xl px-4 py-3 ${selected ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface dark:bg-surface-dark"}`}
      style={({ pressed }) => ({
        opacity: locked ? 0.55 : pressed ? 0.92 : 1,
        transform: [{ scale: pressed && !locked ? 0.99 : 1 }],
      })}
    >
      <View className={`items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
        <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 11,
              color: mutedColor,
              textAlign: isRTL ? "right" : "left",
            }}
          >
            {level.order}
          </Text>
        </View>
        {locked ? <Lock size={14} color={mutedColor} /> : null}
      </View>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: ReflectionJourneyLevelListItem["status"] }) {
  const s = useStrings();

  const label =
    status === "completed"
      ? s.reflectionJourneyStatusCompleted
      : status === "draft"
        ? s.reflectionJourneyStatusDraft
        : status === "locked"
          ? s.reflectionJourneyStatusLocked
          : s.reflectionJourneyStatusAvailable;

  const className =
    status === "completed"
      ? "bg-primary-accent/10 dark:bg-primary-bright/10"
      : status === "draft"
        ? "bg-gold/20"
        : status === "locked"
          ? "bg-surface dark:bg-surface-dark"
          : "bg-surface-mid dark:bg-surface-dark-mid";

  const textClassName =
    status === "completed"
      ? "text-primary-accent dark:text-primary-bright"
      : status === "draft"
        ? "text-gold-dark"
        : "text-warm-500 dark:text-neutral-400";

  return (
    <View className={`rounded-full px-3 py-1.5 ${className}`}>
      <Text className={textClassName} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}
