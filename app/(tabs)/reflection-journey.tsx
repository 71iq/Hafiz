import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter, type Href } from "expo-router";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import {
  AlertCircle,
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  PencilLine,
  Sparkles,
} from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { JourneyAyahCard } from "@/components/reflection-journey/JourneyAyahCard";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { formatNumber } from "@/lib/i18n/count";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import {
  localizeReflectionJourneyText,
  REFLECTION_JOURNEY_MAX_RESPONSE_CHARS,
} from "@/lib/reflection-journey/schema";
import {
  completeReflectionJourneyLevel,
  listReflectionJourneyLevels,
  saveReflectionJourneyDraft,
} from "@/lib/reflection-journey/queries";
import {
  checkJourneyCompletion,
  isJourneyComplete,
  journeyNextLevelId,
  selectDefaultJourneyLevel,
} from "@/lib/reflection-journey/selection";
import type { ReflectionJourneyLevelListItem } from "@/lib/reflection-journey/types";
import { useSelection, SelectionProvider } from "@/lib/selection/context";
import { useSettings } from "@/lib/settings/context";
import { useShowZayt } from "@/lib/zayt/presentation";
import { ZaytAnimation } from "@/components/habit/ZaytAnimation";
import { PERSISTENT_SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";
import { accentIconColor, errorIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

/** Lesson text keeps a comfortable line length on wide screens. */
const CONTENT_MAX_WIDTH = 720;
const SIDE_LIST_WIDTH = 280;
const COLUMN_GAP = 16;
const RESPONSE_MIN_HEIGHT = 120;
const STRIP_FADE_WIDTH = 24;

type SaveKind = "draft" | "complete";

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
  const { isDark, isRTL, uiLanguage, effectiveTheme } = useSettings();
  const { width, height } = useWindowDimensions();
  const { showToast } = useSelection();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [levels, setLevels] = useState<ReflectionJourneyLevelListItem[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const latestLoad = useRef(0);
  const ownerRef = useRef(userId);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  // Only typed text lives here; without an edit the field shows the saved response.
  const [edit, setEdit] = useState<{ levelId: string; text: string } | null>(null);
  const [error, setError] = useState<{ levelId: string; kind: SaveKind } | null>(null);
  const [pending, setPending] = useState<SaveKind | null>(null);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);
  /** Set only when this device completes the last level, so a later visit shows the still. */
  const [journeyZaytEvent, setJourneyZaytEvent] = useState<string | null>(null);
  const showZayt = useShowZayt(db) === true;
  const [inputHeight, setInputHeight] = useState(RESPONSE_MIN_HEIGHT);

  const isWide = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const selectedLevel =
    levels.find((level) => level.id === selectedLevelId) ?? selectDefaultJourneyLevel(levels);
  const selectedIndex = selectedLevel ? levels.findIndex((level) => level.id === selectedLevel.id) : -1;
  const previousLevel = selectedIndex > 0 ? levels[selectedIndex - 1] : null;
  const nextLevel = selectedIndex >= 0 ? (levels[selectedIndex + 1] ?? null) : null;
  const nextMarkerId = journeyNextLevelId(levels);
  const journeyComplete = isJourneyComplete(levels);
  const firstUnfinished = levels.find((level) => level.status !== "completed") ?? null;

  const savedText = selectedLevel?.entry?.responseText ?? "";
  const responseText = edit && selectedLevel && edit.levelId === selectedLevel.id ? edit.text : savedText;
  const dirty = isEditableTextDirty(responseText, savedText);
  const completion = checkJourneyCompletion(responseText);
  const isCompleted = selectedLevel?.status === "completed";
  const visibleError = error && selectedLevel && error.levelId === selectedLevel.id ? error : null;
  const showCompletedCard = isCompleted && completedNotice === selectedLevel?.id && !dirty;

  const accent = accentIconColor(effectiveTheme);
  const muted = mutedIconColor(effectiveTheme);
  const errorColor = errorIconColor(effectiveTheme);
  const columnStyle = { width: "100%" as const, maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" as const };
  const rowStyle = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };

  // Only the latest request for the current account may publish; a failure keeps the levels shown.
  // The first successful load pins the shared default, so saving never moves the user elsewhere.
  const loadLevels = useCallback(async (): Promise<boolean> => {
    const request = ++latestLoad.current;
    const owner = ownerRef.current;
    setLoadStatus((current) => (current === "error" ? "loading" : current));
    let items: ReflectionJourneyLevelListItem[];
    try {
      items = await listReflectionJourneyLevels(db);
    } catch (loadError) {
      console.warn("[ReflectionJourney] Failed to load levels:", loadError);
      if (request === latestLoad.current && owner === ownerRef.current) setLoadStatus("error");
      return false;
    }
    if (request !== latestLoad.current || owner !== ownerRef.current) return true;
    setLevels(items);
    setLoadStatus("ready");
    setSelectedLevelId((currentId) =>
      currentId && items.some((item) => item.id === currentId)
        ? currentId
        : (selectDefaultJourneyLevel(items)?.id ?? null)
    );
    return true;
  }, [db]);


  // An account or session change clears private text and cached responses at once, without a
  // prompt, and loads the new owner's Journey.
  useEffect(() => {
    if (ownerRef.current === userId) return;
    ownerRef.current = userId;
    latestLoad.current += 1;
    setEdit(null);
    setError(null);
    setPending(null);
    setCompletedNotice(null);
    setJourneyZaytEvent(null);
    setLevels([]);
    setSelectedLevelId(null);
    setLoadStatus("loading");
    void loadLevels();
  }, [loadLevels, userId]);

  const { guard, dialogProps } = useDiscardGuard(dirty && pending === null);

  const selectLevel = useCallback(
    (levelId: string) => {
      if (selectedLevel?.id === levelId) return;
      guard(() => {
        setEdit(null);
        setError(null);
        setCompletedNotice(null);
        setInputHeight(RESPONSE_MIN_HEIGHT);
        setSelectedLevelId(levelId);
      });
    },
    [guard, selectedLevel?.id]
  );

  const leave = useCallback(() => {
    guard(() => {
      setEdit(null);
      if (router.canGoBack?.()) router.back();
      else router.navigate("/home" as Href);
    });
  }, [guard, router]);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty && pending === null;
  // Focus reloads the levels; while focused, Android Back asks before dropping unsaved text and
  // otherwise keeps its usual behavior.
  useFocusEffect(
    useCallback(() => {
      void loadLevels();
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!dirtyRef.current) return false;
        leave();
        return true;
      });
      return () => subscription.remove();
    }, [leave, loadLevels])
  );

  const completedCount = useMemo(
    () => levels.filter((level) => level.status === "completed").length,
    [levels]
  );
  const currentCountLabel = interpolate(s.reflectionJourneyProgress, {
    completed: formatNumber(completedCount, uiLanguage),
    total: formatNumber(levels.length, uiLanguage),
  });

  const save = useCallback(
    async (kind: SaveKind) => {
      if (!selectedLevel || pending) return;
      const owner = ownerRef.current;
      const levelId = selectedLevel.id;
      const text = responseText;
      const finishesJourney =
        kind === "complete" &&
        selectedLevel.status !== "completed" &&
        levels.every((level) => level.id === levelId || level.status === "completed");
      setPending(kind);
      setError(null);
      try {
        // Editing a completed level saves through the completion path, which keeps its completion
        // record and timestamp. Saving never publishes the response.
        const entry =
          kind === "draft"
            ? await saveReflectionJourneyDraft(db, levelId, text)
            : await completeReflectionJourneyLevel(db, levelId, text);
        if (owner !== ownerRef.current) return;
        setLevels((current) =>
          current.map((level) => (level.id === levelId ? { ...level, entry, status: entry.status } : level))
        );
        setEdit((current) => (current && current.levelId === levelId && current.text === text ? null : current));
        if (kind === "draft") showToast(s.reflectionJourneyDraftSaved);
        else setCompletedNotice(levelId);
        if (finishesJourney) setJourneyZaytEvent(`journey:${levelId}:${entry.updatedAt}`);
        void loadLevels();
      } catch (saveError) {
        console.warn("[ReflectionJourney] Failed to save:", saveError);
        if (owner === ownerRef.current) setError({ levelId, kind });
      } finally {
        if (owner === ownerRef.current) setPending(null);
      }
    },
    [db, levels, loadLevels, pending, responseText, s.reflectionJourneyDraftSaved, selectedLevel, showToast]
  );

  if (levels.length === 0 && loadStatus !== "ready") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 px-6 pt-8" style={columnStyle}>
          <Card elevation="low" className="w-full rounded-4xl">
            {loadStatus === "loading" ? (
              <View
                className="items-center justify-center"
                style={{ paddingVertical: 48 }}
                accessible
                accessibilityLabel={s.reflectionJourneyLoading}
              >
                <BusyIndicator size={36} color={accent} />
              </View>
            ) : (
              <EmptyState
                icon={AlertCircle}
                title={s.reflectionJourneyLoadFailed}
                actionLabel={s.reflectionJourneyRetry}
                onAction={() => void loadLevels()}
                isDark={isDark}
                tone="error"
              />
            )}
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (levels.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 px-6 pt-8" style={columnStyle}>
          <Card elevation="low" className="w-full rounded-4xl">
            <EmptyState
              icon={BookMarked}
              title={s.reflectionJourneyEmptyTitle}
              subtitle={s.journeyEmptySubtitle}
              actionLabel={s.tabHome}
              onAction={() => router.navigate("/home" as Href)}
              isDark={isDark}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const statusLabel = (level: ReflectionJourneyLevelListItem) =>
    level.status === "completed"
      ? s.reflectionJourneyStatusCompleted
      : level.status === "draft"
        ? s.reflectionJourneyStatusDraft
        : level.id === nextMarkerId
          ? s.journeyNextMarker
          : "";

  const renderPill = (level: ReflectionJourneyLevelListItem, onLayout?: (event: LayoutChangeEvent) => void) => (
    <LevelPill
      key={level.id}
      level={level}
      selected={level.id === selectedLevel?.id}
      isNext={level.id === nextMarkerId}
      statusLabel={statusLabel(level)}
      onPress={() => selectLevel(level.id)}
      onLayout={onLayout}
      fixedWidth={!isWide}
    />
  );

  const levelList = (
    <Card
      elevation="low"
      className={isWide ? "rounded-4xl p-4 self-start" : "rounded-4xl p-4"}
      style={isWide ? { width: SIDE_LIST_WIDTH } : undefined}
    >
      <Text
        accessibilityRole="header"
        className="text-charcoal dark:text-neutral-100 mb-3"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL) }}
      >
        {s.reflectionJourneyLevels}
      </Text>
      {isWide ? (
        <View className="gap-2">{levels.map((level) => renderPill(level))}</View>
      ) : (
        <LevelStrip levels={levels} selectedId={selectedLevel?.id ?? null} isRTL={isRTL} renderPill={renderPill} />
      )}
    </Card>
  );

  const outlineClass = "border border-warm-200 dark:border-neutral-700";
  const startSelf = isRTL ? "self-end" : "self-start";

  const levelContent = selectedLevel ? (
    <>
      <Card elevation="low" className="rounded-4xl p-5">
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL) }}
        >
          {interpolate(s.journeyLevelLabel, { n: formatNumber(selectedIndex + 1, uiLanguage) })}
        </Text>
        <Text
          accessibilityRole="header"
          className="text-charcoal dark:text-neutral-100 mt-1"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22, ...textStartStyle(isRTL) }}
        >
          {localizeReflectionJourneyText(selectedLevel.title, uiLanguage)}
        </Text>
        <View className="mt-3 items-center gap-2" style={{ ...rowStyle, flexWrap: "wrap" }}>
          <StatusBadge status={selectedLevel.status} isNext={selectedLevel.id === nextMarkerId} />
          {selectedLevel.estimatedMinutes ? (
            <View className="items-center gap-1" style={rowStyle}>
              <Clock size={13} color={muted} />
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
              >
                {interpolate(s.reflectionJourneyMinutes, {
                  n: formatNumber(selectedLevel.estimatedMinutes, uiLanguage),
                })}
              </Text>
            </View>
          ) : null}
        </View>
        {selectedLevel.summary ? (
          <Text
            className="text-warm-500 dark:text-neutral-400 mt-3"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 24, ...textStartStyle(isRTL) }}
          >
            {localizeReflectionJourneyText(selectedLevel.summary, uiLanguage)}
          </Text>
        ) : null}
      </Card>

      {selectedLevel.blocks.map((block, index) =>
        block.type === "custom_text" ? (
          <Card key={`${selectedLevel.id}-${index}`} elevation="low" className="rounded-4xl p-5">
            {block.title ? (
              <Text
                className="text-charcoal dark:text-neutral-100 mb-2"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL) }}
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
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {localizeReflectionJourneyText(block.body, uiLanguage)}
            </Text>
          </Card>
        ) : (
          <JourneyAyahCard key={`${selectedLevel.id}-${index}`} block={block} />
        )
      )}

      <Card elevation="low" className="rounded-4xl p-5">
        <Text
          className="text-warm-500 dark:text-neutral-400 mb-3"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 22, ...textStartStyle(isRTL) }}
        >
          {localizeReflectionJourneyText(selectedLevel.responsePrompt, uiLanguage)}
        </Text>

        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL) }}
        >
          {s.reflectionJourneyResponseLabel}
        </Text>
        <View className="mt-1 mb-3 items-start gap-1.5" style={rowStyle}>
          <View style={{ marginTop: 3 }}>
            <Lock size={12} color={muted} />
          </View>
          <View className="flex-1">
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
            >
              {s.journeyPrivateLabel}
            </Text>
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
            >
              {s.journeyPrivateDetail}
            </Text>
          </View>
        </View>

        <TextInput
          value={responseText}
          onChangeText={(text) => {
            setEdit({ levelId: selectedLevel.id, text });
            if (visibleError) setError(null);
          }}
          onContentSizeChange={(event) => {
            const next = Math.max(RESPONSE_MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height) + 28);
            setInputHeight((current) => (current === next ? current : next));
          }}
          multiline
          maxLength={REFLECTION_JOURNEY_MAX_RESPONSE_CHARS}
          accessibilityLabel={s.reflectionJourneyResponseLabel}
          accessibilityHint={s.journeyPrivateLabel}
          placeholder={s.reflectionJourneyResponsePlaceholder}
          placeholderTextColor={isDark ? "#a3a3a3" : "#6e5a47"}
          textAlignVertical="top"
          className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-3.5 text-charcoal dark:text-neutral-100"
          style={{
            // Grows with the text up to 60% of the screen, so the buttons stay in reach on small phones.
            height: Math.min(inputHeight, Math.max(RESPONSE_MIN_HEIGHT, Math.round(height * 0.6))),
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 24,
            ...inputTextStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        />

        <View className="mt-3 gap-x-3 gap-y-1" style={{ ...rowStyle, flexWrap: "wrap" }}>
          <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
            {interpolate(s.reflectionJourneyResponseCount, { n: formatNumber(completion.length, uiLanguage) })}
          </Text>
          {!completion.ok ? (
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL) }}
            >
              {completion.reason === "short"
                ? interpolate(s.journeyMoreToComplete, { n: formatNumber(completion.remaining, uiLanguage) })
                : interpolate(s.journeyOverLimit, {
                    n: formatNumber(completion.excess, uiLanguage),
                    max: formatNumber(REFLECTION_JOURNEY_MAX_RESPONSE_CHARS, uiLanguage),
                  })}
            </Text>
          ) : null}
        </View>

        {visibleError ? (
          <View accessibilityRole="alert" className="mt-3 items-center gap-3" style={{ ...rowStyle, flexWrap: "wrap" }}>
            <Text
              style={{
                flexShrink: 1,
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
                color: errorColor,
                ...textStartStyle(isRTL),
              }}
            >
              {s.reflectionJourneySaveFailed}
            </Text>
            <Button
              variant="outline"
              onPress={() => void save(visibleError.kind)}
              disabled={pending !== null}
              className={outlineClass}
            >
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {s.reflectionJourneyRetry}
              </Text>
            </Button>
          </View>
        ) : null}

        {showCompletedCard ? (
          <View className="mt-4 rounded-3xl bg-primary-accent/10 dark:bg-primary-bright/10 px-4 py-4 gap-3">
            <View className="items-center gap-2" style={rowStyle}>
              <Check size={16} color={accent} />
              <Text
                accessibilityLiveRegion="polite"
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 14, ...textStartStyle(isRTL) }}
              >
                {s.reflectionJourneyCompletedToast}
              </Text>
            </View>
            {nextLevel ? (
              <Button variant="outline" onPress={() => selectLevel(nextLevel.id)} className={`${outlineClass} ${startSelf}`}>
                <View className="items-center gap-2" style={rowStyle}>
                  <Sparkles size={14} color={accent} />
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                    {s.reflectionJourneyOpenNext}
                  </Text>
                </View>
              </Button>
            ) : null}
          </View>
        ) : (
          <View className="mt-4 gap-3" style={isWide ? rowStyle : undefined}>
            {isCompleted ? (
              <Button
                onPress={() => void save("complete")}
                disabled={pending !== null || !dirty || !completion.ok}
                className={isWide ? "flex-1" : ""}
              >
                <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                  {pending === "complete" ? s.saving : s.journeySaveChanges}
                </Text>
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onPress={() => void save("draft")}
                  disabled={pending !== null}
                  className={`${outlineClass} ${isWide ? "flex-1" : ""}`}
                >
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                    {pending === "draft" ? s.saving : s.reflectionJourneySaveDraft}
                  </Text>
                </Button>
                <Button
                  onPress={() => void save("complete")}
                  disabled={pending !== null || !completion.ok}
                  className={isWide ? "flex-1" : ""}
                >
                  <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                    {pending === "complete" ? s.saving : s.reflectionJourneySaveComplete}
                  </Text>
                </Button>
              </>
            )}
          </View>
        )}
      </Card>

      {nextLevel === null ? (
        <Card elevation="low" className="rounded-4xl p-5 gap-3">
          {journeyComplete && showZayt ? (
            <View className="items-center">
              <ZaytAnimation tier="M" animation="A15" height={112} presentationId={journeyZaytEvent} />
            </View>
          ) : null}
          {journeyComplete ? (
            <View className="items-center gap-2" style={rowStyle}>
              <Sparkles size={16} color={accent} />
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 15, ...textStartStyle(isRTL) }}
              >
                {s.journeyFinished}
              </Text>
            </View>
          ) : (
            <>
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL) }}
              >
                {interpolate(s.journeyLevelsLeft, { n: formatNumber(levels.length - completedCount, uiLanguage) })}
              </Text>
              {firstUnfinished && firstUnfinished.id !== selectedLevel.id ? (
                <Button variant="outline" onPress={() => selectLevel(firstUnfinished.id)} className={`${outlineClass} ${startSelf}`}>
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                    {s.journeyOpenUnfinished}
                  </Text>
                </Button>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <View className="gap-3" style={rowStyle}>
        <LevelNavButton
          label={s.journeyPreviousLevel}
          direction="previous"
          disabled={!previousLevel}
          onPress={() => previousLevel && selectLevel(previousLevel.id)}
        />
        <LevelNavButton
          label={s.journeyNextLevel}
          direction="next"
          disabled={!nextLevel}
          onPress={() => nextLevel && selectLevel(nextLevel.id)}
        />
      </View>
    </>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 120 }}>
        <View
          style={{
            width: "100%",
            maxWidth: isWide ? SIDE_LIST_WIDTH + COLUMN_GAP + CONTENT_MAX_WIDTH : CONTENT_MAX_WIDTH,
            alignSelf: "center",
          }}
        >
          <View className="pt-8 pb-4">
            <View className="items-start justify-between gap-3" style={rowStyle}>
              <View className="flex-1">
                <Text
                  accessibilityRole="header"
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26, lineHeight: 36, ...textStartStyle(isRTL) }}
                >
                  {s.reflectionJourneyTitle}
                </Text>
                <Text
                  className="text-warm-500 dark:text-neutral-400 mt-1"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL) }}
                >
                  {currentCountLabel}
                </Text>
                <Text
                  className="text-warm-500 dark:text-neutral-400 mt-1"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 21, ...textStartStyle(isRTL) }}
                >
                  {s.reflectionJourneySubtitle}
                </Text>
              </View>
              <Button variant="ghost" onPress={leave}>
                <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                  {s.tabHome}
                </Text>
              </Button>
            </View>
          </View>

          {isWide ? (
            <View style={{ ...rowStyle, gap: COLUMN_GAP }}>
              {levelList}
              <View style={{ flex: 1, minWidth: 0, maxWidth: CONTENT_MAX_WIDTH, gap: 16 }}>{levelContent}</View>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {levelList}
              {levelContent}
            </View>
          )}
        </View>
      </ScrollView>
      <DiscardChangesDialog {...dialogProps} title={s.journeyDiscardTitle} />
    </SafeAreaView>
  );
}

/**
 * The horizontal level strip below 1024px. The selected pill scrolls to the center on open and on
 * every selection, and a fade on the trailing edge shows that more levels continue off screen.
 * Arabic lays the row out from the right while keeping level 1 first for keyboard and readers.
 */
function LevelStrip({
  levels,
  selectedId,
  isRTL,
  renderPill,
}: {
  levels: ReflectionJourneyLevelListItem[];
  selectedId: string | null;
  isRTL: boolean;
  renderPill: (level: ReflectionJourneyLevelListItem, onLayout: (event: LayoutChangeEvent) => void) => ReactNode;
}) {
  const { themeColors } = useSettings();
  const scrollRef = useRef<ScrollView>(null);
  const pillFrames = useRef(new Map<string, { x: number; width: number }>());
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  // Scrolling to the measured selection synchronizes the native scroll view.
  useEffect(() => {
    const frame = selectedId ? pillFrames.current.get(selectedId) : undefined;
    if (!frame || viewportWidth === 0) return;
    const maxOffset = Math.max(0, contentWidth - viewportWidth);
    const target = Math.min(maxOffset, Math.max(0, frame.x + frame.width / 2 - viewportWidth / 2));
    scrollRef.current?.scrollTo?.({ x: target, animated: false });
    setOffset(target);
  }, [contentWidth, layoutVersion, selectedId, viewportWidth]);

  const overflow = contentWidth > viewportWidth + 1;
  const atTrailingEnd = isRTL ? offset <= 1 : offset + viewportWidth >= contentWidth - 1;
  const fadeColor = themeColors.surfaceLow;

  return (
    <View style={{ position: "relative" }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onLayout={(event) => setViewportWidth(Math.round(event.nativeEvent.layout.width))}
        onContentSizeChange={(nextWidth) => setContentWidth(Math.round(nextWidth))}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => setOffset(event.nativeEvent.contentOffset.x)}
        style={{ direction: "ltr" }}
        contentContainerStyle={{ gap: 8, direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        {levels.map((level) =>
          renderPill(level, (event) => {
            const { x, width } = event.nativeEvent.layout;
            pillFrames.current.set(level.id, { x, width });
            if (level.id === selectedId) setLayoutVersion((value) => value + 1);
          })
        )}
      </ScrollView>
      {overflow && !atTrailingEnd ? (
        <View
          testID="journey-strip-fade"
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            bottom: 0,
            width: STRIP_FADE_WIDTH,
            ...(isRTL ? { left: 0 } : { right: 0 }),
          }}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="journeyStripFade" x1={isRTL ? "1" : "0"} y1="0" x2={isRTL ? "0" : "1"} y2="0">
                <Stop offset="0" stopColor={fadeColor} stopOpacity={0} />
                <Stop offset="1" stopColor={fadeColor} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#journeyStripFade)" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

function LevelPill({
  level,
  selected,
  isNext,
  statusLabel,
  onPress,
  onLayout,
  fixedWidth,
}: {
  level: ReflectionJourneyLevelListItem;
  selected: boolean;
  isNext: boolean;
  statusLabel: string;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  fixedWidth: boolean;
}) {
  const s = useStrings();
  const { isRTL, uiLanguage, effectiveTheme } = useSettings();
  const title = localizeReflectionJourneyText(level.title, uiLanguage);
  const accent = accentIconColor(effectiveTheme);
  const muted = mutedIconColor(effectiveTheme);
  const levelLabel = interpolate(s.journeyLevelLabel, { n: formatNumber(level.order, uiLanguage) });

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={[levelLabel, title, statusLabel].filter(Boolean).join(", ")}
      accessibilityHint={s.journeyLevelPillHint}
      accessibilityState={{ selected }}
      className={`rounded-3xl px-4 py-3 ${selected ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface dark:bg-surface-dark"}`}
      style={({ pressed }) => ({
        minHeight: 44,
        width: fixedWidth ? 200 : undefined,
        borderWidth: 1.5,
        borderColor: selected ? accent : "transparent",
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL) }}
        numberOfLines={2}
      >
        {title}
      </Text>
      <View
        className="mt-0.5 items-center gap-1.5"
        style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: muted }}>
          {formatNumber(level.order, uiLanguage)}
        </Text>
        {level.status === "completed" ? <Check size={13} color={accent} /> : null}
        {level.status === "draft" ? <PencilLine size={13} color={muted} /> : null}
        {isNext ? (
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accent }}>{s.journeyNextMarker}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Draft and Completed are the only status badges; Next is a separate recommendation marker. */
function StatusBadge({ status, isNext }: { status: ReflectionJourneyLevelListItem["status"]; isNext: boolean }) {
  const s = useStrings();
  if (status === "completed") {
    return (
      <View className="rounded-full px-3 py-1.5 bg-primary-accent/10 dark:bg-primary-bright/10">
        <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
          {s.reflectionJourneyStatusCompleted}
        </Text>
      </View>
    );
  }
  if (status === "draft") {
    return (
      <View className="rounded-full px-3 py-1.5 bg-gold/20">
        <Text className="text-gold-dark dark:text-gold" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
          {s.reflectionJourneyStatusDraft}
        </Text>
      </View>
    );
  }
  if (!isNext) return null;
  return (
    <View className="rounded-full px-3 py-1.5 border border-primary-accent dark:border-primary-bright">
      <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
        {s.journeyNextMarker}
      </Text>
    </View>
  );
}

function LevelNavButton({
  label,
  direction,
  disabled,
  onPress,
}: {
  label: string;
  direction: "previous" | "next";
  disabled: boolean;
  onPress: () => void;
}) {
  const { isRTL, effectiveTheme } = useSettings();
  const color = disabled ? mutedIconColor(effectiveTheme) : accentIconColor(effectiveTheme);
  // Previous points toward the reading start, Next toward the reading end.
  const Icon = (direction === "previous") === !isRTL ? ChevronLeft : ChevronRight;
  const iconFirst = direction === "previous";
  return (
    <Button
      variant="outline"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      className="border border-warm-200 dark:border-neutral-700 flex-1"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <View
        className="items-center gap-1.5"
        style={{ direction: "ltr", flexDirection: iconFirst === !isRTL ? "row" : "row-reverse" }}
      >
        <Icon size={16} color={color} />
        <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
          {label}
        </Text>
      </View>
    </Button>
  );
}
