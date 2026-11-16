import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import { BookOpenCheck, Pause, Play, RotateCcw, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import { Skeleton } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import {
  SessionHabitCards,
  showsCommitment,
  strongerWirdEvent,
  useCommitmentLabel,
  type SessionHabitInput,
} from "@/components/habit/SessionHabitCards";
import { ZaytMood } from "@/components/habit/ZaytMood";
import { HIDDEN, RecitationPage } from "@/components/hifz/RecitationPage";
import { SabaqSecondLook } from "@/components/hifz/SabaqSecondLook";
import { SimilarVerseComparison } from "@/components/hifz/SimilarVerseComparison";
import { loadPageWordsData } from "@/components/mushaf/MushafPage";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { endReviewSession, startReviewSession, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { Grade } from "@/lib/fsrs/scheduler";
import { loadHabitOverview } from "@/lib/habit/queries";
import { useActiveClock } from "@/lib/habit/use-active-clock";
import { readHabitSettings } from "@/lib/habit/settings";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import type { PageToken } from "@/lib/hifz/page-data";
import { loadTodayWird, newMemorizationOpen, readMemorizedPageNumbers } from "@/lib/hifz/pages";
import { similarGroupsForAyahs, withMemorizedSiblings, type SimilarGroup } from "@/lib/hifz/similar";
import type { HifzPlan } from "@/lib/hifz/plan";
import {
  addCoveredSabaqPages,
  completeSabaqChunk,
  loadSecondLooks,
  nextSabaqTarget,
  saveSabaqCleanRun,
  saveSecondLook,
  type SabaqTarget,
  type SecondLook,
  type SecondLooks,
} from "@/lib/hifz/sabaq";
import { formatAyahRef } from "@/lib/arabic";
import { useAuthStore } from "@/lib/auth/store";
import { loadMySabaqAssignment } from "@/lib/halaqa/sabaq-assignment";
import { useIsOffline } from "@/lib/social/use-social-query";
import { formatNumber } from "@/lib/i18n/count";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";

type Step = "intention" | "listen" | "meaning" | "similar" | "looking" | "ayah" | "chunk" | "link" | "check" | "done";
const BASE_STEPS: readonly Step[] = ["intention", "listen", "meaning", "looking", "ayah", "chunk", "link", "check"];

const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

const NO_SECOND_LOOKS: SecondLooks = { due: [], nextAt: null };

function formatClockTime(at: Date, language: "en" | "ar"): string {
  return formatClockMinutesForDisplay(at.getHours() * 60 + at.getMinutes(), language);
}

function SabaqScreen({ onRestart }: { onRestart: () => void }) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage, effectiveTheme } = useSettings();
  const commitLabel = useCommitmentLabel(db, s, uiLanguage);
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
  const doneWidth = Math.min(pageWidth, 384);
  const dir = isRTL ? "rtl" : "ltr";
  const { playRange, rangeState, stop, togglePause } = useAyahAudio();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const offline = useIsOffline();
  const assignmentSource = useRef({ userId, offline });
  assignmentSource.current = { userId, offline };

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<SabaqTarget | null>(null);
  const [plan, setPlan] = useState<HifzPlan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [looking, setLooking] = useState(0);
  const [ayahIndex, setAyahIndex] = useState(0);
  const [cleanRun, setCleanRun] = useState(0);
  const [shown, setShown] = useState(false);
  const [meanings, setMeanings] = useState<{ key: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [lessonSaved, setLessonSaved] = useState(false);
  const [chunkSaved, setChunkSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [habitResult, setHabitResult] = useState<SessionHabitInput | null>(null);
  const [showZayt, setShowZayt] = useState(false);
  const [surahNames, setSurahNames] = useState<Map<number, string>>(new Map());
  const [similar, setSimilar] = useState<SimilarGroup[]>([]);
  const [looks, setLooks] = useState<readonly SecondLook[]>([]);
  const [lookIndex, setLookIndex] = useState(0);
  const [looksSaved, setLooksSaved] = useState(0);
  const [looksDoneStep, setLooksDoneStep] = useState(false);
  const [nextLookAt, setNextLookAt] = useState<Date | null>(null);
  const [catchUpFirst, setCatchUpFirst] = useState(false);
  const [linesDoneToday, setLinesDoneToday] = useState(false);
  const [outcome, setOutcome] = useState<{
    passed: boolean;
    partial: boolean;
    pageAdded: boolean;
    secondLookAt: Date | null;
    secondLookNow: boolean;
  } | null>(null);
  const STEPS: readonly Step[] = useMemo(
    () => (similar.length > 0 ? ["intention", "listen", "meaning", "similar", "looking", "ayah", "chunk", "link", "check"] : BASE_STEPS),
    [similar.length],
  );
  const sessionRef = useRef<ReviewSessionRef | null>(null);
  const lessonClock = useActiveClock();
  const saveLock = useRef<"open" | "saving" | "saved">("open");
  const cleanRunEvent = useRef<SessionHabitInput["event"]>(null);
  const cleanRunMs = useRef(0);
  const cleanRunPageAdded = useRef(false);
  const targetQuery = useRef<Parameters<typeof nextSabaqTarget>[1] | null>(null);
  const [saving, setSaving] = useState(false);
  const leaveWhenSaved = useRef(false);
  const exiting = useRef(false);
  const pendingBack = useRef<NavigationAction | null>(null);
  const [leavePending, setLeavePending] = useState(false);
  const step: Step = habitResult ? "done" : STEPS[stepIndex];

  const strings = useRef(s);
  strings.current = s;

  const showTarget = useCallback(
    async (next: SabaqTarget | null) => {
      setTarget(next);
      if (!next) return;
      const [groups, memorizedPages] = await Promise.all([similarGroupsForAyahs(db, next.ayahs), readMemorizedPageNumbers(db)]);
      setSimilar(withMemorizedSiblings(groups, memorizedPages));
    },
    [db],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const assignment = loadMySabaqAssignment(assignmentSource.current.userId, assignmentSource.current.offline);
    try {
      const [wird, words, names] = await Promise.all([
        loadTodayWird(db),
        loadPageWordsData().catch(() => null),
        db.getAllAsync<{ number: number; name_arabic: string }>("SELECT number, name_arabic FROM surahs"),
      ]);
      setSurahNames(new Map(names.map((row) => [row.number, row.name_arabic])));
      readHabitSettings(db)
        .then((settings) => setShowZayt(settings.showZayt))
        .catch(() => setShowZayt(false));
      if (!wird) {
        setTarget(null);
        return;
      }
      setPlan(wird.plan);
      setCatchUpFirst(wird.daily.backlog);
      setLinesDoneToday(wird.sabaqDoneToday);
      const pageWords = (page: number) => words?.[page - 1] ?? null;
      await addCoveredSabaqPages(db, { plan: wird.plan, pageWords }).catch((healError: unknown) => {
        console.warn("[Sabaq] Could not add a page its merged chunks completed:", healError);
        return 0;
      });
      targetQuery.current = newMemorizationOpen(wird)
        ? {
            plan: wird.plan,
            wantLines: Math.max(3, wird.newLines - wird.sabaqLinesToday),
            pageWords,
            assigned: await assignment,
          }
        : null;
      const [next, secondLooks] = await Promise.all([
        targetQuery.current ? nextSabaqTarget(db, targetQuery.current) : Promise.resolve(null),
        loadSecondLooks(db, { pageWords }).catch((lookError) => {
          console.warn("[Sabaq] Failed to load second looks:", lookError);
          return NO_SECOND_LOOKS;
        }),
      ]);
      setLooks(secondLooks.due);
      setLookIndex(0);
      setNextLookAt(secondLooks.nextAt);
      await showTarget(next);
      sessionRef.current = startReviewSession("sabaq");
      lessonClock.reset();
    } catch (loadError) {
      console.warn("[Sabaq] Failed to load:", loadError);
      setError(strings.current.hifzLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [db, lessonClock, showTarget]);

  useEffect(() => {
    load();
    return () => stop();
  }, [load, stop]);

  useEffect(() => {
    if (!target) return;
    let current = true;
    Promise.all(
      target.ayahs.map(async (ayah) => {
        const row =
          uiLanguage === "ar"
            ? await db.getFirstAsync<{ text: string }>("SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = 'muyassar'", [ayah.surah, ayah.ayah])
            : await db.getFirstAsync<{ text: string }>("SELECT text_en AS text FROM translations WHERE surah = ? AND ayah = ?", [ayah.surah, ayah.ayah]);
        return { key: `${ayah.surah}:${ayah.ayah}`, text: row?.text ?? "" };
      }),
    )
      .then((rows) => {
        if (current) setMeanings(rows);
      })
      .catch((meaningError: unknown) => {
        console.warn("[Sabaq] Failed to load meanings:", meaningError);
        if (current) setError(strings.current.hifzLoadFailed);
      });
    return () => {
      current = false;
    };
  }, [db, target, uiLanguage]);

  const goNext = () => {
    setShown(false);
    setCleanRun(0);
    setStepIndex((value) => Math.min(STEPS.length - 1, value + 1));
  };

  const exit = () => {
    exiting.current = true;
    stop();
    const session = sessionRef.current;
    if (session && !habitResult) endReviewSession(db, { session }).catch(console.warn);
    const back = pendingBack.current;
    pendingBack.current = null;
    if (back) navigation.dispatch(back);
    else returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session) endReviewSession(db, { session }).catch(console.warn);
    },
    [db],
  );

  const lessonUnsaved = stepIndex > 0 && !habitResult && !saving && !lessonSaved && !chunkSaved;

  usePreventRemove(saving || lessonUnsaved, ({ data }) => {
    if (exiting.current || saveLock.current === "saved") navigation.dispatch(data.action);
    else if (saveLock.current === "saving") {
      pendingBack.current = data.action;
      leaveWhenSaved.current = true;
      setLeavePending(true);
    } else if (lessonUnsaved) {
      pendingBack.current = data.action;
      setExitOpen(true);
    } else navigation.dispatch(data.action);
  });

  const leave = () => {
    if (saveLock.current === "saving") {
      leaveWhenSaved.current = true;
      setLeavePending(true);
    } else exit();
  };

  const close = () => {
    if (lessonUnsaved) setExitOpen(true);
    else leave();
  };

  const nextLook = () => {
    lessonClock.reset();
    setLookIndex((value) => value + 1);
  };

  const skipLooks = () => {
    if (saveLock.current !== "open") return;
    setError(null);
    lessonClock.reset();
    setLookIndex(looks.length);
  };

  const chooseTargetAgain = async (): Promise<SabaqTarget | null> => {
    const query = targetQuery.current;
    if (!query) return target;
    try {
      const next = await nextSabaqTarget(db, query);
      const same =
        next !== null &&
        target !== null &&
        next.page === target.page &&
        next.fromLine === target.fromLine &&
        next.toLine === target.toLine &&
        next.completesPage === target.completesPage;
      if (same) return target;
      await showTarget(next);
      return next;
    } catch (targetError) {
      console.warn("[Sabaq] Could not choose the lesson's lines again:", targetError);
      return target;
    }
  };

  const gradeLook = async (rating: Grade) => {
    const look = looks[lookIndex];
    if (!look || !plan || saveLock.current !== "open") return;
    saveLock.current = "saving";
    setSaving(true);
    setBusy(true);
    setError(null);
    try {
      await saveSecondLook(db, {
        cardId: look.cardId,
        pageData: look.pageData,
        plan,
        rating,
        session: sessionRef.current,
        durationMs: lessonClock.elapsedMs(),
      });
      saveLock.current = "open";
      setSaving(false);
      emitHabitChanged();
      if (leaveWhenSaved.current) {
        exit();
        return;
      }
      setLooksSaved((value) => value + 1);
      const lesson = await chooseTargetAgain();
      if (lookIndex + 1 >= looks.length && lesson) setLooksDoneStep(true);
      nextLook();
    } catch (saveError) {
      leaveWhenSaved.current = false;
      pendingBack.current = null;
      setLeavePending(false);
      if (saveError instanceof StudyCardDeletedError) nextLook();
      else {
        console.warn("[Sabaq] Second look save failed:", saveError);
        setError(s.hifzSaveFailed);
      }
    } finally {
      if (saveLock.current === "saving") {
        saveLock.current = "open";
        setSaving(false);
      }
      setBusy(false);
    }
  };

  const saveCleanRun = async () => {
    if (!target || !plan || saveLock.current !== "open") return;
    saveLock.current = "saving";
    setSaving(true);
    setBusy(true);
    setError(null);
    try {
      const durationMs = lessonClock.elapsedMs();
      const result = await saveSabaqCleanRun(db, { target, plan, session: sessionRef.current, durationMs });
      saveLock.current = "open";
      setSaving(false);
      setChunkSaved(true);
      cleanRunEvent.current = strongerWirdEvent(null, result.wird);
      cleanRunMs.current = durationMs;
      cleanRunPageAdded.current = result.pageAdded;
      emitHabitChanged();
      if (leaveWhenSaved.current) {
        exit();
        return;
      }
      lessonClock.reset();
      goNext();
    } catch (saveError) {
      console.warn("[Sabaq] Clean run save failed:", saveError);
      leaveWhenSaved.current = false;
      pendingBack.current = null;
      setLeavePending(false);
      setError(s.hifzSabaqCleanRunSaveFailed);
    } finally {
      if (saveLock.current === "saving") {
        saveLock.current = "open";
        setSaving(false);
      }
      setBusy(false);
    }
  };

  const finish = async (rating: Grade) => {
    if (!target || !plan || saveLock.current !== "open") return;
    saveLock.current = "saving";
    setSaving(true);
    setBusy(true);
    setError(null);
    try {
      const result = await completeSabaqChunk(db, {
        target,
        plan,
        rating,
        session: sessionRef.current,
        durationMs: lessonClock.elapsedMs(),
      });
      saveLock.current = "saved";
      setSaving(false);
      setLessonSaved(true);
      const pageAdded = cleanRunPageAdded.current || result.pageAdded;
      setOutcome({
        passed: rating >= 3,
        partial: rating >= 3 && !pageAdded,
        pageAdded,
        secondLookAt: result.secondLookAt ?? null,
        secondLookNow: result.secondLookNow === true,
      });
      if (leaveWhenSaved.current) {
        emitHabitChanged();
        exit();
        return;
      }
      const session = sessionRef.current;
      const [overview] = await Promise.all([
        loadHabitOverview(db).catch(() => null),
        session ? endReviewSession(db, { session }).catch(console.warn) : null,
      ]);
      emitHabitChanged();
      setHabitResult({
        event: strongerWirdEvent(cleanRunEvent.current, result.wird),
        overview,
        againCount: rating === 1 ? 1 : 0,
        total: 1,
        durationMs: cleanRunMs.current + lessonClock.elapsedMs(),
      });
    } catch (saveError) {
      console.warn("[Sabaq] Save failed:", saveError);
      leaveWhenSaved.current = false;
      pendingBack.current = null;
      setLeavePending(false);
      setError(s.hifzSaveFailed);
    } finally {
      if (saveLock.current === "saving") {
        saveLock.current = "open";
        setSaving(false);
      }
      setBusy(false);
    }
  };

  const ayahLabel = useCallback((token: PageToken) => formatAyahRef(isRTL, token.surah, token.ayah), [isRTL]);
  const currentAyah = target?.ayahs[ayahIndex] ?? null;
  const chainedAyahs = useMemo(() => target?.ayahs.slice(0, ayahIndex + 1) ?? [], [ayahIndex, target]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="px-6 pt-6" style={{ gap: 16 }}>
          <Skeleton isDark={isDark} width="50%" height={14} borderRadius={7} />
          <Skeleton isDark={isDark} width="100%" height={320} borderRadius={24} />
        </View>
      </SafeAreaView>
    );
  }

  const look = looks[lookIndex];
  if (look && plan) {
    return (
      <SabaqSecondLook
        key={look.cardId}
        look={look}
        index={lookIndex}
        total={looks.length}
        busy={busy}
        error={error}
        closePending={leavePending}
        surahNames={surahNames}
        isDark={isDark}
        isRTL={isRTL}
        language={uiLanguage}
        s={s}
        onClose={close}
        onGrade={(rating) => gradeLook(rating)}
        onSkip={target ? skipLooks : leave}
        continuesToNewLines={target !== null}
      />
    );
  }

  if (looksDoneStep && target && plan) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={BookOpenCheck}
            tone="success"
            title={looksSaved > 1 ? s.hifzSecondLooksSaved : s.hifzSecondLookSaved}
            titleStyle="display"
            isDark={isDark}
          />
          <View className="w-full max-w-sm" style={{ gap: 10 }}>
            <Button label={linesDoneToday ? s.hifzSabaqMore : s.hifzSabaqStart} onPress={() => setLooksDoneStep(false)} />
            <Button variant="outline" className={OUTLINE_BORDER} label={s.flashcardsSummaryDone} onPress={leave} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!target || !plan) {
    const laterLook = !error && nextLookAt && nextLookAt.getTime() > Date.now() ? nextLookAt : null;
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={error ? RotateCcw : BookOpenCheck}
            tone={!error && looksSaved > 0 ? "success" : "neutral"}
            title={error ?? (looksSaved > 1 ? s.hifzSecondLooksSaved : looksSaved > 0 ? s.hifzSecondLookSaved : s.hifzSabaqNoNew)}
            titleStyle="display"
            subtitle={
              laterLook
                ? interpolate(s.hifzSecondLookOpensAt, { time: formatClockTime(laterLook, uiLanguage) })
                : !error && catchUpFirst
                  ? s.hifzCatchUpFirst
                  : undefined
            }
            isDark={isDark}
          />
          <View className="w-full max-w-sm" style={{ gap: 10 }}>
            {error ? <Button label={s.homeLoadRetry} onPress={load} /> : null}
            <Button
              variant={error ? "outline" : "default"}
              className={error ? OUTLINE_BORDER : undefined}
              label={s.flashcardsSummaryDone}
              onPress={leave}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const stepTitle: Record<Step, string> = {
    intention: s.hifzSabaqIntention,
    listen: s.hifzSabaqStepListen,
    meaning: s.hifzSabaqStepMeaning,
    looking: s.hifzSabaqStepLooking,
    ayah: s.hifzSabaqStepAyah,
    chunk: s.hifzSabaqStepChunk,
    link: s.hifzSabaqStepLink,
    check: s.hifzSabaqStepCheck,
    similar: s.hifzSimilarTitle,
    done: s.hifzSabaqDoneTitle,
  };
  const hidden = step === "ayah" || step === "chunk" || step === "link" || step === "check";
  const accent = isDark ? "#2dd4bf" : "#0f766e";
  const muted = mutedIconColor(effectiveTheme);
  const portion = `${interpolate(s.hifzPageN, { n: formatNumber(target.page, uiLanguage) })}${uiLanguage === "ar" ? "، " : " · "}${interpolate(s.hifzSabaqLines, {
    from: formatNumber(target.fromLine, uiLanguage),
    to: formatNumber(target.toLine, uiLanguage),
  })}`;
  const centered = step === "intention" || step === "done";
  const lookLine =
    step === "done" && outcome?.secondLookAt
      ? interpolate(s.hifzSabaqSecondLookAt, { time: formatClockTime(outcome.secondLookAt, uiLanguage) })
      : step === "done" && outcome?.secondLookNow
        ? s.hifzSabaqSecondLookNow
        : null;
  const doneCaption =
    outcome?.passed === false
      ? lookLine
        ? null
        : outcome.pageAdded
          ? s.hifzSabaqNotFluentReview
          : s.hifzSabaqNotFluent
      : outcome?.partial
        ? s.hifzSabaqDonePartial
        : s.hifzSabaqDone;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className={`items-center ${centered ? "px-5" : "px-2"}`}>
        <View style={{ width: "100%", maxWidth: pageWidth - 16 }}>
          <MirroredRow dir={dir} className="items-center justify-between pt-3 pb-2">
            <Pressable
              onPress={close}
              disabled={leavePending}
              accessibilityRole="button"
              accessibilityLabel={s.genericClose}
              accessibilityState={{ disabled: leavePending }}
              className={`w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center ${leavePending ? "opacity-50" : ""}`}
            >
              <X size={18} color={muted} />
            </Pressable>
            <View className="flex-shrink items-center" style={{ gap: 2 }}>
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-warm-700 dark:text-neutral-400">
                {portion}
              </Text>
              {target.assigned ? (
                <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: accent }}>
                  {s.hifzAssignedByTeacher}
                </Text>
              ) : null}
            </View>
            <View style={{ width: 44 }} />
          </MirroredRow>
          {step !== "done" ? (
            <View>
              <Progress value={((stepIndex + 1) / STEPS.length) * 100} dir={dir} className="h-1" />
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingVertical: 16,
          paddingHorizontal: centered ? 20 : 8,
          gap: 14,
          alignItems: "center",
          flexGrow: centered ? 1 : undefined,
          justifyContent: centered ? "center" : undefined,
        }}
      >
        <View style={{ width: "100%", maxWidth: step === "done" ? doneWidth : pageWidth - 16, gap: 6, alignItems: centered ? "center" : undefined }}>
          {step === "intention" && showZayt ? (
            <View className="mb-2">
              <ZaytMood mood="gentle_welcome" height={112} />
            </View>
          ) : null}
          <Text
            dir={dir}
            align={centered ? "center" : undefined}
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 21, lineHeight: 30 }}
            className="text-charcoal dark:text-neutral-100"
          >
            {step === "done" && outcome?.passed === false ? s.hifzSabaqNotFluentTitle : stepTitle[step]}
          </Text>
          {step !== "intention" && !(step === "done" && doneCaption === null) ? (
            <Text
              dir={dir}
              align={centered ? "center" : undefined}
              variant="muted"
              className="text-warm-700 dark:text-neutral-400"
              style={{ lineHeight: 20 }}
            >
              {step === "listen"
                ? interpolate(s.hifzSabaqListenHint, { n: formatNumber(plan.sabaqRepetitions.listen, uiLanguage) })
                : step === "looking"
                  ? s.hifzSabaqLookingHint
                  : step === "ayah"
                    ? s.hifzSabaqAyahHint
                    : step === "chunk"
                      ? s.hifzSabaqChunkHint
                      : step === "link"
                        ? s.hifzSabaqLinkHint
                        : step === "check"
                          ? s.hifzSabaqCheckHint
                          : step === "similar"
                            ? s.hifzSimilarHint
                            : step === "done"
                              ? doneCaption
                              : ""}
            </Text>
          ) : null}
          {lookLine ? (
            <Text
              dir={dir}
              align="center"
              className="mt-2 text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, lineHeight: 21 }}
            >
              {lookLine}
            </Text>
          ) : null}
          {step === "ayah" && currentAyah ? (
            <Text dir={dir} variant="caption" style={{ color: accent }}>
              {chainedAyahs.map((ayah) => formatAyahRef(isRTL, ayah.surah, ayah.ayah)).join(isRTL ? "، " : ", ")}
            </Text>
          ) : null}
          {step === "link" && target.linkAyahs.length > 0 ? (
            <Text dir={dir} variant="caption" style={{ color: accent }}>
              {target.linkAyahs.map((ayah) => formatAyahRef(isRTL, ayah.surah, ayah.ayah)).join(isRTL ? "، " : ", ")}
            </Text>
          ) : null}
        </View>

        {step === "meaning" ? (
          <Card elevation="low" className="p-5" style={{ width: pageWidth - 16, gap: 10 }}>
            {meanings.map((meaning) => (
              <Text key={meaning.key} dir={dir} style={{ lineHeight: 22 }} className="text-charcoal dark:text-neutral-200">
                {`${formatAyahRef(isRTL, Number(meaning.key.split(":")[0]), Number(meaning.key.split(":")[1]))}  ${meaning.text}`}
              </Text>
            ))}
          </Card>
        ) : null}

        {step === "similar" ? (
          <SimilarVerseComparison db={db} groups={similar} language={uiLanguage} isRTL={isRTL} accent={accent} s={s} width={pageWidth - 16} />
        ) : null}

        {step !== "intention" && step !== "meaning" && step !== "similar" && step !== "done" ? (
          <Card elevation="low" className="py-4 rounded-3xl" style={{ width: pageWidth - 16 }}>
            <RecitationPage
              page={target.pageData}
              level={hidden ? 4 : 0}
              reveal={hidden && !shown ? HIDDEN : { ...HIDDEN, all: true }}
              lineNumbers={target.lineNumbers}
              surahNames={surahNames}
              isDark={isDark}
              width={pageWidth - 16}
              wordLabel={ayahLabel}
            />
          </Card>
        ) : null}

        {step === "done" && habitResult ? (
          <View style={{ width: "100%", maxWidth: doneWidth, alignItems: "center", gap: 12 }}>
            <SessionHabitCards input={habitResult} db={db} language={uiLanguage} isDark={isDark} s={s} />
          </View>
        ) : null}

      </ScrollView>

      <View className={`${centered ? "px-5" : "px-2"} pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high items-center`}>
        <View style={{ width: "100%", maxWidth: step === "done" ? doneWidth : pageWidth - 16, gap: 10 }}>
          {error ? (
            <Text
              dir={dir}
              align="center"
              className="text-red-700 dark:text-red-400"
              accessibilityRole="alert"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
            >
              {error}
            </Text>
          ) : null}
          {step === "intention" ? <Button label={s.hifzSabaqNext} onPress={goNext} /> : null}

          {step === "listen" ? (
            <>
              <Button
                variant="outline"
                className={OUTLINE_BORDER}
                onPress={() =>
                  rangeState.active
                    ? togglePause()
                    : playRange({ ayahs: [...target.ayahs], repeatRange: plan.sabaqRepetitions.listen }).catch(console.warn)
                }
              >
                {rangeState.active && !rangeState.paused ? <Pause size={16} color={muted} /> : <Play size={16} color={muted} />}
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
                  {rangeState.active && !rangeState.paused ? s.hifzSabaqPause : s.hifzSabaqPlay}
                </Text>
              </Button>
              <Button
                label={s.hifzSabaqNext}
                onPress={() => {
                  stop();
                  goNext();
                }}
              />
            </>
          ) : null}

          {step === "meaning" || step === "similar" ? <Button label={s.hifzSabaqNext} onPress={goNext} /> : null}

          {step === "looking" ? (
            <>
              <Text dir={dir} align="center" variant="caption">
                {interpolate(s.hifzSabaqLookingCount, { done: formatNumber(looking, uiLanguage), target: formatNumber(plan.sabaqRepetitions.looking, uiLanguage) })}
              </Text>
              {looking < plan.sabaqRepetitions.looking ? (
                <Button label={s.hifzSabaqReadOnce} onPress={() => setLooking((value) => value + 1)} />
              ) : (
                <Button label={s.hifzSabaqNext} onPress={goNext} />
              )}
            </>
          ) : null}

          {(step === "ayah" || step === "chunk" || step === "link") && !shown ? (
            <Button label={s.hifzDrillShow} onPress={() => setShown(true)} />
          ) : null}

          {(step === "ayah" || step === "chunk" || step === "link") && shown ? (
            <MirroredRow dir={dir} className="gap-2">
              <Button
                className={`flex-1 ${OUTLINE_BORDER}`}
                variant="outline"
                label={s.hifzSabaqNotYet}
                disabled={busy || (step === "chunk" && cleanRun >= plan.sabaqRepetitions.cleanInARow)}
                onPress={() => {
                  setShown(false);
                  setCleanRun(0);
                }}
              />
              <Button
                className="flex-1"
                label={s.hifzSabaqClean}
                disabled={busy}
                onPress={() => {
                  if (step === "chunk" && cleanRun + 1 >= plan.sabaqRepetitions.cleanInARow) {
                    setCleanRun(plan.sabaqRepetitions.cleanInARow);
                    void saveCleanRun();
                    return;
                  }
                  setShown(false);
                  if (step === "ayah") {
                    if (ayahIndex + 1 < target.ayahs.length) setAyahIndex((value) => value + 1);
                    else goNext();
                    return;
                  }
                  if (step === "chunk") {
                    setCleanRun((value) => value + 1);
                    return;
                  }
                  goNext();
                }}
              />
            </MirroredRow>
          ) : null}

          {step === "chunk" ? (
            <Text dir={dir} align="center" variant="caption">
              {interpolate(s.hifzSabaqCleanCount, {
                n: formatNumber(cleanRun, uiLanguage),
                target: formatNumber(plan.sabaqRepetitions.cleanInARow, uiLanguage),
              })}
            </Text>
          ) : null}

          {step === "check" ? (
            shown ? (
              <GradingButtons onGrade={(rating) => finish(rating)} previews={{}} isDark={isDark} s={s} disabled={busy} />
            ) : (
              <Button label={s.hifzDrillShow} onPress={() => setShown(true)} />
            )
          ) : null}

          {step === "done" && habitResult ? (
            outcome?.secondLookNow ? (
              <>
                <Button label={s.hifzSecondLookStart} onPress={onRestart} />
                <Button variant="outline" className={OUTLINE_BORDER} label={s.flashcardsSummaryDone} onPress={leave} />
              </>
            ) : (
              <Button
                label={
                  !showsCommitment(habitResult)
                    ? s.flashcardsSummaryDone
                    : outcome?.secondLookAt
                      ?
                        interpolate(s.hifzSabaqBackAt, { time: formatClockTime(outcome.secondLookAt, uiLanguage) })
                      : commitLabel
                }
                onPress={leave}
              />
            )
          ) : null}
        </View>
      </View>
      <ConfirmDialog
        visible={exitOpen}
        title={s.hifzSabaqExitTitle}
        message={s.hifzSabaqExitBody}
        cancelLabel={s.hifzSabaqExitStay}
        confirmLabel={s.hifzSabaqExitLeave}
        tone="neutral"
        emphasis="cancel"
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          setExitOpen(false);
          pendingBack.current = null;
        }}
        onConfirm={() => {
          setExitOpen(false);
          leave();
        }}
      />
    </SafeAreaView>
  );
}

export default function SabaqScreenRoute() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();
  if (error) return <DatabaseErrorState title={s.databaseError} message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;
  return <SabaqVisit />;
}

function SabaqVisit() {
  const [visit, setVisit] = useState(0);
  return <SabaqScreen key={visit} onRestart={() => setVisit((value) => value + 1)} />;
}
