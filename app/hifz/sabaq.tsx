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
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
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
import { formatNumber } from "@/lib/i18n/count";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";

/** 4.4.1 steps after the optional intention. "similar" appears only when MUT-01 applies. */
type Step = "intention" | "listen" | "meaning" | "similar" | "looking" | "ayah" | "chunk" | "link" | "check" | "done";
const BASE_STEPS: readonly Step[] = ["intention", "listen", "meaning", "looking", "ayah", "chunk", "link", "check"];

/** The shared outline Button has no border; here an outline action needs one to read as a button. */
const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

const NO_SECOND_LOOKS: SecondLooks = { due: [], nextAt: null };

/** A wall-clock time as the interface writes times, the same as Home's second-look line. */
function formatClockTime(at: Date, language: "en" | "ar"): string {
  return formatClockMinutesForDisplay(at.getHours() * 60 + at.getMinutes(), language);
}

/**
 * Sabaq, new memorization (4.4.1): intention, listening, meaning, reading while looking, ayah by
 * ayah from memory with chaining, the whole chunk three times cleanly, which turns the chunk into a
 * sabaq card (SBQ-02), linking to what came before, then a graded fluent check of that card.
 */
/**
 * `onRestart` opens the screen again from the start, for the second look the done step offers once
 * it is due (SBQ-03): a fresh load offers due looks before new lines.
 */
function SabaqScreen({ onRestart }: { onRestart: () => void }) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage, effectiveTheme } = useSettings();
  const commitLabel = useCommitmentLabel(db, s, uiLanguage);
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
  // The done step's text, cards and button share the habit cards' width (max-w-sm, as on the other
  // end screens), so a wide window does not show three widths at once.
  const doneWidth = Math.min(pageWidth, 384);
  const dir = isRTL ? "rtl" : "ltr";
  const { playRange, rangeState, stop, togglePause } = useAyahAudio();

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
  /** The rendered copy of `saveLock === "saved"`: the lesson is saved, so leaving asks nothing. */
  const [lessonSaved, setLessonSaved] = useState(false);
  /** Step 6's clean run saved the chunk (SBQ-02), so leaving before the check asks nothing either. */
  const [chunkSaved, setChunkSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [habitResult, setHabitResult] = useState<SessionHabitInput | null>(null);
  const [showZayt, setShowZayt] = useState(false);
  const [surahNames, setSurahNames] = useState<Map<number, string>>(new Map());
  const [similar, setSimilar] = useState<SimilarGroup[]>([]);
  /** SBQ-03: today's due second looks, offered one by one before new lines; an index past the end means done or skipped. */
  const [looks, setLooks] = useState<readonly SecondLook[]>([]);
  const [lookIndex, setLookIndex] = useState(0);
  const [looksSaved, setLooksSaved] = useState(0);
  /** The last look was graded and a lesson can follow: a short end state, not straight into new lines. */
  const [looksDoneStep, setLooksDoneStep] = useState(false);
  /** When the next of today's second looks comes due, as loaded, for the screen with no new lines. */
  const [nextLookAt, setNextLookAt] = useState<Date | null>(null);
  /** New memorization waits for review to catch up (PLN-02); a second look is still offered. */
  const [catchUpFirst, setCatchUpFirst] = useState(false);
  /** What the saved fluent check means for the done step's copy. */
  const [outcome, setOutcome] = useState<{
    passed: boolean;
    partial: boolean;
    /** This lesson added the page to review, at step 6 or the check. */
    pageAdded: boolean;
    secondLookAt: Date | null;
    secondLookNow: boolean;
  } | null>(null);
  const STEPS: readonly Step[] = useMemo(
    () => (similar.length > 0 ? ["intention", "listen", "meaning", "similar", "looking", "ayah", "chunk", "link", "check"] : BASE_STEPS),
    [similar.length],
  );
  const sessionRef = useRef<ReviewSessionRef | null>(null);
  // The lesson's time counts only while it is on screen with the app active.
  const lessonClock = useActiveClock();
  /**
   * The fluent check's grade: "open" until it is graded, "saving" while the save is unresolved, then
   * "saved" for good, since the check is over. Taken before React renders `busy`, so a second tap
   * cannot grade the chunk again; a failed save opens it again so the user can retry. Step 6's save
   * and a second look's take it too, and open it again once saved, since the check is still ahead.
   */
  const saveLock = useRef<"open" | "saving" | "saved">("open");
  /** What step 6's save meant for the wird and how long the lesson had taken, for the summary. */
  const cleanRunEvent = useRef<SessionHabitInput["event"]>(null);
  const cleanRunMs = useRef(0);
  /** Step 6's save added the chunk's page to review (SBQ-02). */
  const cleanRunPageAdded = useRef(false);
  /**
   * How load chose the lesson's lines, so a graded second look can choose them again. Null when the
   * screen offers no new lines.
   */
  const targetQuery = useRef<Parameters<typeof nextSabaqTarget>[1] | null>(null);
  /**
   * The rendered copy of `saveLock === "saving"`, for the remove guard below. Unlike `busy` it ends as
   * soon as the grade is saved, so leaving while the summary loads is not held.
   */
  const [saving, setSaving] = useState(false);
  /**
   * Close was pressed while the grade was saving. The screen leaves once it is saved, or stays on the
   * check to show a failed save, which would otherwise reach a departed screen.
   */
  const leaveWhenSaved = useRef(false);
  /** Set once the screen leaves on purpose, so the remove guard below lets that navigation through. */
  const exiting = useRef(false);
  /** A back press or gesture held for the unresolved grade; leaving carries it out. */
  const pendingBack = useRef<NavigationAction | null>(null);
  /** The rendered copy of leaveWhenSaved, so Close shows that its press is waiting for the save. */
  const [leavePending, setLeavePending] = useState(false);
  const step: Step = habitResult ? "done" : STEPS[stepIndex];

  /** The current strings, for load's error text, so a language change does not reload the lesson. */
  const strings = useRef(s);
  strings.current = s;

  /**
   * Load the lesson once: its target, second looks and review session. It does not depend on the
   * language, since loading again mid-lesson would choose the next chunk once step 6 has saved this
   * one, and the check would grade lines the person never memorized. The meanings follow the language
   * in their own effect below.
   */
  /** Show the lesson's lines, with the similar verses the user already knows (MUT-01). */
  const showTarget = useCallback(
    async (next: SabaqTarget | null) => {
      setTarget(next);
      if (!next) return;
      // MUT-01: before memorizing, show siblings the user already knows, with the difference marked.
      const [groups, memorizedPages] = await Promise.all([similarGroupsForAyahs(db, next.ayahs), readMemorizedPageNumbers(db)]);
      setSimilar(withMemorizedSiblings(groups, memorizedPages));
    },
    [db],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wird, words, names] = await Promise.all([
        loadTodayWird(db),
        loadPageWordsData().catch(() => null),
        db.getAllAsync<{ number: number; name_arabic: string }>("SELECT number, name_arabic FROM surahs"),
      ]);
      setSurahNames(new Map(names.map((row) => [row.number, row.name_arabic])));
      // Zayt follows the same setting as the session-end cards; a failed read leaves him hidden.
      readHabitSettings(db)
        .then((settings) => setShowZayt(settings.showZayt))
        .catch(() => setShowZayt(false));
      if (!wird) {
        setTarget(null);
        return;
      }
      setPlan(wird.plan);
      setCatchUpFirst(wird.daily.backlog);
      const pageWords = (page: number) => words?.[page - 1] ?? null;
      // SBQ-02: a page completed only by chunks merged from another device joins review now, so the
      // lesson goes on to the next page. A failure here leaves the lines as they are.
      await addCoveredSabaqPages(db, { plan: wird.plan, pageWords }).catch((healError: unknown) => {
        console.warn("[Sabaq] Could not add a page its merged chunks completed:", healError);
        return 0;
      });
      // Opened for a second look on a day new memorization is paused, the screen offers no new lines.
      targetQuery.current = newMemorizationOpen(wird)
        ? {
            plan: wird.plan,
            // Only the lines still left of today's allocation; at least 3 so a chunk is worth memorizing.
            wantLines: Math.max(3, wird.newLines - wird.sabaqLinesToday),
            pageWords,
          }
        : null;
      const [next, secondLooks] = await Promise.all([
        targetQuery.current ? nextSabaqTarget(db, targetQuery.current) : Promise.resolve(null),
        // A second look that cannot be read is left for the next visit; new lines still load.
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

  // The meaning step's text, in the interface language: the Muyassar tafsir in Arabic, the
  // translation in English. A language change reloads only this.
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
    // A held back press goes where it was going; Close returns to the tabs.
    const back = pendingBack.current;
    pendingBack.current = null;
    if (back) navigation.dispatch(back);
    else returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  // Leaving by any route that ends the screen without exit() still ends the session.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session) endReviewSession(db, { session }).catch(console.warn);
    },
    [db],
  );

  /**
   * The lesson is under way and nothing of it is saved yet: its lines are saved once step 6's clean
   * run is met, so leaving before that asks first, as the hifz review does with graded pages.
   */
  const lessonUnsaved = stepIndex > 0 && !habitResult && !saving && !lessonSaved && !chunkSaved;

  // Close, hardware back, a back gesture and the iOS swipe behave alike: during an unresolved grade
  // they wait for it, and in an unsaved lesson they ask first. usePreventRemove, unlike a bare
  // beforeRemove listener, also tells native-stack to block the native dismissal.
  usePreventRemove(saving || lessonUnsaved, ({ data }) => {
    // The screen's own exit goes on, as does a back press this render has not caught up with (the
    // grade saved, the summary still loading); React Navigation marks the action as already checked.
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

  /** Leave now, or once the check's unresolved grade settles (see leaveWhenSaved). */
  const leave = () => {
    if (saveLock.current === "saving") {
      leaveWhenSaved.current = true;
      setLeavePending(true);
    } else exit();
  };

  /** Close: an unsaved lesson asks first. */
  const close = () => {
    if (lessonUnsaved) setExitOpen(true);
    else leave();
  };

  /** Past the current second look. The lesson's own time starts once the looks are over. */
  const nextLook = () => {
    lessonClock.reset();
    setLookIndex((value) => value + 1);
  };

  /** Go on to new lines. Nothing is written, so the skipped looks stay due for the rest of the day. */
  const skipLooks = () => {
    if (saveLock.current !== "open") return;
    setError(null);
    lessonClock.reset();
    setLookIndex(looks.length);
  };

  /**
   * SBQ-02: a graded look can change which lines count as memorized: a failed one offers its lines
   * again, a passed one after a failed check covers them again. So the lesson's lines are chosen
   * again before it starts. The same lines keep the loaded lesson; a failed read keeps it too, since
   * the save checks the page in its own transaction.
   */
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

  /**
   * SBQ-03: save the current second look as a review of its chunk card. It shares the check's save
   * lock and leave handling: a second tap is ignored, leaving waits for the save, and a failed save
   * stays on the look to retry. The lock opens again afterwards, since the lesson's check is still ahead.
   */
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
      // A chunk deleted since the screen loaded, such as by sync, has nothing left to review.
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

  /**
   * SBQ-02: step 6's clean run is met, so the chunk is saved now, Good, with the lesson's time so far,
   * and the check's time starts after it. It shares the check's save lock and leave handling: a second
   * tap is ignored, leaving waits for the save, and a failed save stays on step 6 to retry.
   */
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
      // No grade was given here: the lines were not saved, and Clean saves them again.
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
      // SBQ-02: a lower grade than Good offers the lines again, unless step 6 completed their page.
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
      // The summary covers the whole lesson: step 6's save and the check after it.
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
        // With no lesson after it, skipping leaves: Close already leaves without saving too.
        onSkip={target ? skipLooks : leave}
        continuesToNewLines={target !== null}
      />
    );
  }

  // Opened for a 2-minute look, the person sees it saved and chooses whether to start new lines.
  if (looksDoneStep && target && plan) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        {/* The padding is on a plain View: the web SafeAreaView's inline padding replaces a className one. */}
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={BookOpenCheck}
            tone="success"
            title={looksSaved > 1 ? s.hifzSecondLooksSaved : s.hifzSecondLookSaved}
            titleStyle="display"
            isDark={isDark}
          />
          <View className="w-full max-w-sm" style={{ gap: 10 }}>
            <Button label={s.hifzSabaqStart} onPress={() => setLooksDoneStep(false)} />
            <Button variant="outline" className={OUTLINE_BORDER} label={s.flashcardsSummaryDone} onPress={leave} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!target || !plan) {
    // Opened early for a second look, the screen says when it comes due rather than nothing.
    const laterLook = !error && nextLookAt && nextLookAt.getTime() > Date.now() ? nextLookAt : null;
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={error ? RotateCcw : BookOpenCheck}
            tone={!error && looksSaved > 0 ? "success" : "neutral"}
            title={error ?? (looksSaved > 1 ? s.hifzSecondLooksSaved : looksSaved > 0 ? s.hifzSecondLookSaved : s.hifzSabaqNoNew)}
            // The serif title of the sabaq's other ends, as on its done step.
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
  // Teal text under 14 px uses the darker token in light mode.
  const accent = isDark ? "#2dd4bf" : "#0f766e";
  const muted = mutedIconColor(effectiveTheme);
  // An Arabic comma in Arabic: beside Arabic-Indic digits a middle dot reads as a zero.
  const portion = `${interpolate(s.hifzPageN, { n: formatNumber(target.page, uiLanguage) })}${uiLanguage === "ar" ? "، " : " · "}${interpolate(s.hifzSabaqLines, {
    from: formatNumber(target.fromLine, uiLanguage),
    to: formatNumber(target.toLine, uiLanguage),
  })}`;
  // The intention and the end are moments, not instructions, so they sit centred.
  const centered = step === "intention" || step === "done";
  // SBQ-03: the second look the done step promises, with its time later today, or ready now, as after
  // a check graded Again, whose relearning step is a few minutes away.
  const lookLine =
    step === "done" && outcome?.secondLookAt
      ? interpolate(s.hifzSabaqSecondLookAt, { time: formatClockTime(outcome.secondLookAt, uiLanguage) })
      : step === "done" && outcome?.secondLookNow
        ? s.hifzSabaqSecondLookNow
        : null;
  // After a failed check, the look says when the lines come back. Without one they come back as new
  // lines, or in tomorrow's review once step 6 has completed their page.
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
      {/* Header, progress and footer share the page column instead of spanning a wide window. */}
      <View className="items-center">
        <View style={{ width: "100%", maxWidth: pageWidth }}>
          {/* 8 px in, like the title, page card and buttons below and the hifz review header. */}
          <MirroredRow dir={dir} className="items-center justify-between px-2 pt-3 pb-2">
            {/* Dimmed while Close waits for the grade it was pressed during. */}
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
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-warm-700 dark:text-neutral-400">
              {portion}
            </Text>
            <View style={{ width: 44 }} />
          </MirroredRow>
          {step !== "done" ? (
            // Padding on a wrapper: the track is full width, so a margin on it would only move its start.
            <View className="px-2">
              <Progress value={((stepIndex + 1) / STEPS.length) * 100} dir={dir} className="h-1" />
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        // Title, page card and actions all start 8 px inside the page column, as in the hifz review.
        contentContainerStyle={{
          paddingVertical: 16,
          // The centred steps, the intention and the end, keep the wider gutter of the other end screens.
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
          {/* The header already names the page and lines, so the intention has no caption. */}
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
          {/* SBQ-03: only a second look that will be offered today is promised. */}
          {/* The one thing to act on later, so it reads at body size. */}
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
          <View style={{ width: pageWidth - 16, gap: 10 }}>
            {similar.map((group) => (
              <Card key={`${group.groupId}-${group.self.surah}:${group.self.ayah}`} elevation="low" className="p-4" style={{ gap: 10 }}>
                <SimilarVerseLine reference={group.self} isRTL={isRTL} accent={accent} />
                {group.siblings.map((sibling) => (
                  <SimilarVerseLine key={`${sibling.surah}:${sibling.ayah}`} reference={sibling} isRTL={isRTL} accent={accent} muted />
                ))}
              </Card>
            ))}
          </View>
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
          {/* Beside the buttons that retry, so a long chunk does not push it below the fold. */}
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
                // Once the clean run is met, it is saved or retried, not started over.
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
                    // The clean run is met. The lines stay shown until it is saved, so a failed save
                    // is retried with the same button.
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
              // SBQ-03: after a check graded Again the look is due already, so it is offered here.
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
                      ? // The look later today is the next return, not tomorrow (STR-20).
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

/** Opened from a deep link or a reminder, the route waits for the database like the other routes. */
export default function SabaqScreenRoute() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();
  if (error) return <DatabaseErrorState title={s.databaseError} message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;
  return <SabaqVisit />;
}

/** One visit of the sabaq screen; "Start second look" on the done step begins another. */
function SabaqVisit() {
  const [visit, setVisit] = useState(0);
  return <SabaqScreen key={visit} onRestart={() => setVisit((value) => value + 1)} />;
}
