import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Eye, EyeOff, Moon, Plus, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { Toast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { GradingButtons, getGradeSchedulePreviews } from "@/components/flashcards/GradingButtons";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import {
  SessionHabitCards,
  showsCommitment,
  strongerWirdEvent,
  type SessionHabitInput,
} from "@/components/habit/SessionHabitCards";
import { MistakeTypeSheet, errorTypeLabel } from "@/components/hifz/MistakeTypeSheet";
import {
  HIDDEN,
  RecitationPage,
  orderedTokens,
  visibleLines,
  type RevealState,
} from "@/components/hifz/RecitationPage";
import { loadPageWordsData } from "@/components/mushaf/MushafPage";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import { endReviewSession, startReviewSession, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { loadHabitOverview, type WirdProgressEvent } from "@/lib/habit/queries";
import { readMistakeInbox, recordDrillResult, type InboxItem, type RecitationErrorType } from "@/lib/hifz/errors";
import { GRADE_CAP, defaultSupportLevel, isGradable, SUPPORT_LEVELS, type SupportLevel } from "@/lib/hifz/grading";
import { loadRecitationPage, type PageToken, type RecitationPage as PageData } from "@/lib/hifz/page-data";
import { isMemorized, loadPageCards, loadTodayWird, toPlanPage, type PageCard } from "@/lib/hifz/pages";
import {
  halfLineNumbers,
  hasSeamAfter,
  loadDueRemediation,
  remediationPolicy,
  type Half,
} from "@/lib/hifz/remediation";
import { markMonthlyCheck, monthlyCheckCandidates, pickMonthlyCheck } from "@/lib/hifz/progress";
import type { HifzPlan } from "@/lib/hifz/plan";
import {
  emptyAttempt,
  endOfLineAt,
  nextHiddenWord,
  proposedRating,
  recordReviewPace,
  savePageGrade,
  saveRemediationGrade,
  type Attempt,
} from "@/lib/hifz/review";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { pagePolicy, type Tier } from "@/lib/hifz/tiers";
import { HIFZ_PAGES_DECK_ID, juzOfPage } from "@/lib/hifz/units";
import { formatAyahRef } from "@/lib/arabic";
import { formatDays, formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";
import { hapticMedium } from "@/lib/haptics";

type AyahText = { qcf2: string; page: number; surah: number; ayah: number };

type QueueItem =
  | { kind: "page"; card: PageCard; retrievability: number | null }
  | { kind: "half"; card: StudyCardRow; page: number; half: Half }
  | { kind: "seam"; card: StudyCardRow; page: number; prompt: AyahText | null; answer: AyahText | null }
  | { kind: "drill"; item: InboxItem; text: { qcf2: string; page: number } | null };

type Phase = "loading" | "recite" | "check" | "summary" | "empty" | "error";

/** `extra` counts half pages and seams reviewed on their own. */
type Totals = { pages: number; clean: number; marked: number; extra: number };

/** The first or last ayah that starts on a page, in the page font. */
async function ayahOnPage(
  db: ReturnType<typeof useDatabase>,
  page: number,
  which: "first" | "last",
): Promise<AyahText | null> {
  const order = which === "first" ? "surah ASC, ayah ASC" : "surah DESC, ayah DESC";
  const row = await db.getFirstAsync<{ surah: number; ayah: number; text_qcf2: string; v2_page: number }>(
    `SELECT surah, ayah, text_qcf2, v2_page FROM quran_text WHERE v2_page = ? ORDER BY ${order} LIMIT 1`,
    [page],
  );
  return row ? { qcf2: row.text_qcf2, page: row.v2_page, surah: row.surah, ayah: row.ayah } : null;
}

function tierLabel(tier: Tier, s: UIStrings): string {
  switch (tier) {
    case "sabaq":
      return s.hifzTierSabaq;
    case "sabqi":
      return s.hifzTierSabqi;
    case "manzil":
      return s.hifzTierManzil;
    case "manzil.needs_work":
      return s.hifzTierNeedsWork;
    case "manzil.unverified":
      return s.hifzTierUnverified;
  }
}

function levelLabel(level: SupportLevel, s: UIStrings): string {
  return [s.hifzLevelFull, s.hifzLevelFirstLetters, s.hifzLevelLines, s.hifzLevelSwipe, s.hifzLevelHidden][level];
}

function gradeLabel(rating: number, s: UIStrings): string {
  return (
    [s.flashcardsAgain, s.flashcardsAgain, s.flashcardsHard, s.flashcardsGood, s.flashcardsEasy][rating] ??
    s.flashcardsGood
  );
}

/**
 * The wird review (4.4.2): today's planned pages in order, sabqi then manzil, each recited at a
 * support level, checked word by word, and graded with the rubric's proposal (4.2), followed by up
 * to 6 drills from the mistake inbox (ERR-04). Progress saves after every page (REV-01).
 */
function HifzReviewScreen() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage, fontSize, lineHeight } = useSettings();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ mode?: string; level?: string }>();
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const drillsOnly = mode === "mistakes";
  // 6.4: a returning user starts with their strongest pages at the support level they chose.
  const welcomeBack = mode === "welcome_back";
  // MST-05: the monthly check reviews 5 random pages not seen in two weeks and reports honestly.
  const monthlyCheck = mode === "monthly_check";
  const welcomeLevel = ((): SupportLevel | null => {
    const raw = Number(Array.isArray(params.level) ? params.level[0] : params.level);
    return raw === 2 || raw === 3 || raw === 4 ? raw : null;
  })();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
  const dir = isRTL ? "rtl" : "ltr";

  const [phase, setPhase] = useState<Phase>("loading");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [plan, setPlan] = useState<HifzPlan | null>(null);
  const [baseSettings, setBaseSettings] = useState<DeckReviewSettings | null>(null);
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [surahNames, setSurahNames] = useState<Map<number, string>>(new Map());
  const [attempt, setAttempt] = useState<Attempt>(emptyAttempt(4));
  const [reveal, setReveal] = useState<RevealState>(HIDDEN);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [markingToken, setMarkingToken] = useState<PageToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [drillShown, setDrillShown] = useState(false);
  const [listener, setListener] = useState(false);
  const [totals, setTotals] = useState<Totals>({ pages: 0, clean: 0, marked: 0, extra: 0 });
  const [memorized, setMemorized] = useState<ReadonlySet<number>>(new Set());
  const [seamText, setSeamText] = useState<AyahText | null>(null);
  const [seamShown, setSeamShown] = useState(false);
  const [planProgress, setPlanProgress] = useState<{ done: number; total: number } | null>(null);
  const [habitResult, setHabitResult] = useState<SessionHabitInput | null>(null);
  const sessionRef = useRef<ReviewSessionRef | null>(null);
  const startedAt = useRef(Date.now());
  const shownAt = useRef(Date.now());
  const wirdEvent = useRef<SessionHabitInput["event"]>(null);
  const againCount = useRef(0);
  const minutesPerPage = useRef(3);

  const current = queue[index] ?? null;

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const now = new Date();
      const today = localDateOf(now);
      const [wird, inbox, names, base] = await Promise.all([
        loadTodayWird(db, now),
        readMistakeInbox(db, today, 6),
        db.getAllAsync<{ number: number; name_arabic: string }>("SELECT number, name_arabic FROM surahs"),
        readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID),
      ]);
      setSurahNames(new Map(names.map((row) => [row.number, row.name_arabic])));
      setBaseSettings(base);
      const items: QueueItem[] = [];
      if (wird && !drillsOnly) {
        setPlan(wird.plan);
        minutesPerPage.current = wird.minutesPerReviewPage;
        setPlanProgress({ done: wird.done.length, total: wird.done.length + wird.todo.length });
        const cards = await loadPageCards(db, { today, plan: wird.plan });
        const byId = new Map(cards.map((card) => [card.row.id, card]));
        setMemorized(new Set(cards.filter(isMemorized).map((card) => card.page)));
        let todo = monthlyCheck
          ? pickMonthlyCheck(monthlyCheckCandidates(cards, today)).map((card) => toPlanPage(card, today, now))
          : [...wird.todo];
        if (welcomeBack) {
          // Three warm-up pages with the highest recall first, then the weakest (6.4 step 3).
          const byRecall = [...todo].sort((a, b) => (b.retrievability ?? 0) - (a.retrievability ?? 0));
          const warmUp = byRecall.slice(0, 3);
          const rest = byRecall.slice(3).reverse();
          todo = [...warmUp, ...rest];
        }
        for (const page of todo) {
          const card = byId.get(page.cardId);
          if (card) items.push({ kind: "page", card, retrievability: page.retrievability });
        }
      } else if (wird) {
        setPlan(wird.plan);
      }
      // SCH-06, SCH-08: half pages and seams that are relearning come after the pages, before drills.
      if (!welcomeBack && !monthlyCheck) {
        for (const unit of await loadDueRemediation(db, now)) {
          if (unit.kind === "half") {
            items.push({ kind: "half", card: unit.row, page: unit.page, half: unit.half });
          } else {
            const [prompt, answer] = await Promise.all([
              ayahOnPage(db, unit.page, "last"),
              ayahOnPage(db, unit.page + 1, "first"),
            ]);
            items.push({ kind: "seam", card: unit.row, page: unit.page, prompt, answer });
          }
        }
      }
      for (const item of monthlyCheck ? [] : inbox) {
        if (item.ayah === null) continue;
        const row = await db.getFirstAsync<{ text_qcf2: string; v2_page: number }>(
          "SELECT text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
          [item.surah, item.ayah],
        );
        items.push({ kind: "drill", item, text: row ? { qcf2: row.text_qcf2, page: row.v2_page } : null });
      }
      sessionRef.current = startReviewSession(
        drillsOnly ? "mistakes" : welcomeBack ? "welcome_back" : monthlyCheck ? "portion_check" : "wird",
      );
      startedAt.current = Date.now();
      setQueue(items);
      setIndex(0);
      setPhase(items.length === 0 ? "empty" : "recite");
    } catch (loadError) {
      console.warn("[HifzReview] Failed to load:", loadError);
      setPhase("error");
    }
  }, [db, drillsOnly, monthlyCheck, welcomeBack]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the page for the current item and reset the attempt at its default support level (MOD-01).
  useEffect(() => {
    setSeamText(null);
    setSeamShown(false);
    if (!current || (current.kind !== "page" && current.kind !== "half")) {
      setPageData(null);
      if (current) {
        setAttempt(emptyAttempt(4));
        shownAt.current = Date.now();
      }
      return;
    }
    let cancelled = false;
    const level =
      current.kind === "half"
        ? 4
        : (welcomeLevel ??
          defaultSupportLevel(current.card.tier === "sabqi" ? "sabqi" : "manzil", current.retrievability));
    const pageNumber = current.kind === "half" ? current.page : current.card.page;
    setAttempt(emptyAttempt(level));
    setReveal(HIDDEN);
    setError(null);
    setPageData(null);
    shownAt.current = Date.now();
    loadPageWordsData()
      .catch(() => null)
      .then((words) => loadRecitationPage(db, pageNumber, words?.[pageNumber - 1] ?? null))
      .then((data) => {
        if (!cancelled) setPageData(data);
      })
      .catch((pageError) => {
        console.warn("[HifzReview] Page failed to load:", pageError);
        if (!cancelled) setError(s.hifzLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [current, db, s.hifzLoadFailed, welcomeLevel]);

  useEffect(() => {
    setDrillShown(false);
  }, [index]);

  const lineNumbers = useMemo(
    () => (pageData && current?.kind === "half" ? halfLineNumbers(pageData, current.half) : null),
    [current, pageData],
  );
  const lines = useMemo(() => (pageData ? visibleLines(pageData, lineNumbers) : []), [lineNumbers, pageData]);
  // SCH-06: after a page whose next page is also memorized, the check offers its seam.
  const seamPage =
    current?.kind === "page" && hasSeamAfter(current.card.page) && memorized.has(current.card.page + 1)
      ? current.card.page + 1
      : null;

  useEffect(() => {
    if (phase !== "check" || seamPage === null) return;
    let cancelled = false;
    ayahOnPage(db, seamPage, "first")
      .then((text) => {
        if (!cancelled) setSeamText(text);
      })
      .catch((seamError) => console.warn("[HifzReview] Seam text failed to load:", seamError));
    return () => {
      cancelled = true;
    };
  }, [db, phase, seamPage]);
  const tokens = useMemo(() => orderedTokens(lines), [lines]);

  const finish = useCallback(async () => {
    const session = sessionRef.current;
    const durationMs = Date.now() - startedAt.current;
    const [overview] = await Promise.all([
      loadHabitOverview(db).catch(() => null),
      session ? endReviewSession(db, { session }).catch(console.warn) : null,
      totals.pages > 0
        ? recordReviewPace(db, {
            minutes: durationMs / 60_000,
            pages: totals.pages,
            current: minutesPerPage.current,
          }).catch(console.warn)
        : null,
    ]);
    if (monthlyCheck && totals.pages > 0) await markMonthlyCheck(db).catch(console.warn);
    setHabitResult({
      event: wirdEvent.current,
      overview,
      againCount: againCount.current,
      total: totals.pages + totals.extra,
      durationMs,
    });
    setPhase("summary");
  }, [db, monthlyCheck, totals.extra, totals.pages]);

  const advance = useCallback(() => {
    setMarkingKey(null);
    if (index + 1 >= queue.length) {
      finish();
      return;
    }
    setIndex((value) => value + 1);
    setPhase("recite");
  }, [finish, index, queue.length]);

  const setLevel = (level: SupportLevel) => {
    setAttempt((value) => ({ ...value, level }));
    setReveal(HIDDEN);
  };

  const peek = () => {
    const target = nextHiddenWord(tokens, reveal.count);
    if (target < 0) return;
    hapticMedium();
    setReveal((value) => ({ ...value, count: target + 1 }));
    setAttempt((value) => ({ ...value, peeked: [...value.peeked, tokens[target]] }));
  };

  const showMe = () => {
    const target = nextHiddenWord(tokens, reveal.count);
    if (target < 0) return;
    hapticMedium();
    setReveal((value) => ({ ...value, count: endOfLineAt(lines, target) }));
    setAttempt((value) => ({ ...value, shown: [...value.shown, tokens[target]] }));
  };

  const nextLine = () => {
    const target = nextHiddenWord(tokens, reveal.count);
    if (target < 0) return;
    setReveal((value) => ({ ...value, count: endOfLineAt(lines, target) }));
  };

  const done = () => {
    setReveal((value) => ({ ...value, all: true }));
    setPhase("check");
  };

  const showWirdNotice = (wird: WirdProgressEvent): boolean => {
    wirdEvent.current = strongerWirdEvent(wirdEvent.current, wird);
    if (wird.kind === "minimum_met") setNotice(s.habitMinimumMet);
    else if (wird.kind === "made_up") {
      setNotice(
        interpolate(s.habitMadeUp, {
          n: formatNumber(wird.length, uiLanguage),
          days: formatDays(wird.length, uiLanguage),
        }),
      );
    } else if (wird.kind === "earned_back") {
      setNotice(interpolate(s.habitEarnedBack, { days: formatDays(wird.length, uiLanguage) }));
    } else return false;
    return true;
  };

  /** A half page or seam reviewed on its own (SCH-06, SCH-08). */
  const gradeRemediation = async (rating: Grade, seamAttempt?: Attempt) => {
    if (!current || (current.kind !== "half" && current.kind !== "seam") || busy) return;
    const usedAttempt = seamAttempt ?? attempt;
    const firstToken = current.kind === "half" ? (tokens.find((token) => !token.isMarker) ?? null) : null;
    if (current.kind === "half" && !firstToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRemediationGrade(db, {
        card: current.card,
        rating,
        attempt: usedAttempt,
        firstToken,
        session: sessionRef.current,
        durationMs: Date.now() - shownAt.current,
        grader: listener ? "teacher" : "self",
      });
      if (rating === Rating.Again) againCount.current += 1;
      setTotals((value) => ({ ...value, extra: value.extra + 1 }));
      showWirdNotice(result.wird);
      advance();
    } catch (saveError) {
      console.warn("[HifzReview] Grade failed:", saveError);
      setError(s.hifzSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  const seamResult = (clean: boolean) => {
    if (!current || current.kind !== "seam") return;
    const answer = current.answer;
    const seam = answer ? { clean, surah: answer.surah, ayah: answer.ayah } : null;
    gradeRemediation(clean ? Rating.Good : Rating.Again, { ...emptyAttempt(4), seam });
  };

  const grade = async (rating: Grade, source: "recited" | "salah" = "recited") => {
    if (current?.kind === "half" && source === "recited") {
      await gradeRemediation(rating);
      return;
    }
    const grader = source === "salah" ? "salah" : listener ? "teacher" : "self";
    if (!current || current.kind !== "page" || !plan || busy) return;
    const firstToken = tokens.find((token) => !token.isMarker) ?? tokens[0];
    if (!firstToken && grader !== "salah") return;
    setBusy(true);
    setError(null);
    try {
      const result = await savePageGrade(db, {
        card: current.card.row,
        history: current.card.history,
        plan,
        attempt: grader === "salah" ? emptyAttempt(4) : attempt,
        rating,
        firstToken: firstToken ?? { glyph: "", surah: 1, ayah: 1, wordPos: null, isMarker: true, firstLetter: null },
        session: sessionRef.current,
        durationMs: Date.now() - shownAt.current,
        grader,
        page: pageData,
      });
      if (rating === Rating.Again) againCount.current += 1;
      const markedCount = grader === "salah" ? 0 : attempt.marks.size + attempt.peeked.length + attempt.shown.length;
      setTotals((value) => ({
        ...value,
        pages: value.pages + 1,
        clean: value.clean + (rating >= Rating.Good && markedCount === 0 ? 1 : 0),
        marked: value.marked + markedCount,
      }));
      setPlanProgress((value) => (value ? { ...value, done: value.done + 1 } : value));
      // A wird milestone is the bigger news; the half page shows up in the queue either way.
      if (!showWirdNotice(result.wird) && result.remediation.half) {
        setNotice(result.remediation.half === "a" ? s.hifzHalfScheduledA : s.hifzHalfScheduledB);
      }
      advance();
    } catch (saveError) {
      console.warn("[HifzReview] Grade failed:", saveError);
      setError(s.hifzSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  const drillResult = async (clean: boolean) => {
    if (!current || current.kind !== "drill" || busy) return;
    setBusy(true);
    try {
      await recordDrillResult(db, { id: current.item.id, clean });
      advance();
    } catch (drillError) {
      console.warn("[HifzReview] Drill failed:", drillError);
      setError(s.hifzSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  const toggleMark = (token: PageToken, key: string) => {
    setMarkingToken(token);
    setMarkingKey(key);
  };

  const chooseMark = (type: RecitationErrorType) => {
    if (!markingKey || !markingToken) return;
    setAttempt((value) => {
      const marks = new Map(value.marks);
      marks.set(markingKey, { token: markingToken, type });
      return { ...value, marks };
    });
    setMarkingKey(null);
  };

  const removeMark = () => {
    if (!markingKey) return;
    setAttempt((value) => {
      const marks = new Map(value.marks);
      marks.delete(markingKey);
      return { ...value, marks };
    });
    setMarkingKey(null);
  };

  const leave = () => {
    const session = sessionRef.current;
    if (session && phase !== "summary") endReviewSession(db, { session }).catch(console.warn);
    returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  const close = () => {
    if (phase !== "summary" && totals.pages + totals.extra > 0) setExitOpen(true);
    else leave();
  };

  const proposal = proposedRating(attempt);
  const cap = GRADE_CAP[attempt.level];
  const policyPreviews = useMemo(() => {
    if (!current || !baseSettings) return {};
    if (current.kind === "half") return getGradeSchedulePreviews(current.card, remediationPolicy(baseSettings), isRTL);
    if (current.kind !== "page" || !plan) return {};
    return getGradeSchedulePreviews(current.card.row, pagePolicy(current.card.tier, plan, baseSettings), isRTL);
  }, [baseSettings, current, isRTL, plan]);
  const markedKeys = useMemo(() => new Set(attempt.marks.keys()), [attempt.marks]);
  const wordLabel = useCallback(
    (token: PageToken) =>
      token.wordPos
        ? formatAyahRef(isRTL, token.surah, token.ayah, token.wordPos)
        : formatAyahRef(isRTL, token.surah, token.ayah),
    [isRTL],
  );

  if (phase === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="px-6 pt-6" style={{ gap: 16 }}>
          <Skeleton isDark={isDark} width="40%" height={14} borderRadius={7} />
          <Skeleton isDark={isDark} width="100%" height={420} borderRadius={24} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "empty" || phase === "error") {
    return (
      <SafeAreaView
        className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center px-8"
        style={{ gap: 16 }}
      >
        <Text dir={dir} align="center" variant="title-md">
          {phase === "error" ? s.hifzLoadFailed : drillsOnly ? s.hifzInboxEmpty : s.hifzNothingDue}
        </Text>
        <Button
          label={phase === "error" ? s.homeLoadRetry : s.flashcardsSummaryDone}
          onPress={phase === "error" ? load : leave}
        />
      </SafeAreaView>
    );
  }

  if (phase === "summary") {
    const minutes = Math.max(1, Math.round((habitResult?.durationMs ?? 0) / 60_000));
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 14 }}
        >
          <Text
            dir={dir}
            align="center"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}
            className="text-charcoal dark:text-neutral-100"
          >
            {s.hifzSummaryTitle}
          </Text>
          <Card elevation="low" className="w-full max-w-sm px-5 py-4" style={{ gap: 10 }}>
            {[
              [s.hifzSummaryPages, totals.pages],
              [s.hifzSummaryClean, totals.clean],
              [s.hifzSummaryMarked, totals.marked],
              ...(totals.extra > 0 ? [[s.hifzSummaryStrengthened, totals.extra]] : []),
              [s.hifzSummaryMinutes, minutes],
            ].map(([label, value]) => (
              <MirroredRow key={String(label)} dir={dir} className="items-center justify-between">
                <Text dir={dir} variant="muted">
                  {label as string}
                </Text>
                <Text
                  dir={dir}
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 17 }}
                  className="text-charcoal dark:text-neutral-100"
                >
                  {formatNumber(value as number, uiLanguage)}
                </Text>
              </MirroredRow>
            ))}
            {monthlyCheck && totals.pages > 0 ? (
              <Text dir={dir} variant="body-sm">
                {interpolate(s.hifzMonthlyResult, {
                  clean: formatNumber(totals.clean, uiLanguage),
                  total: formatNumber(totals.pages, uiLanguage),
                })}
              </Text>
            ) : null}
            {!monthlyCheck && planProgress && planProgress.total > 0 ? (
              <Text dir={dir} variant="caption">
                {interpolate(s.hifzSummaryPlan, {
                  done: formatNumber(planProgress.done, uiLanguage),
                  total: formatNumber(planProgress.total, uiLanguage),
                })}
              </Text>
            ) : null}
          </Card>
          {habitResult && totals.pages + totals.extra > 0 ? (
            <SessionHabitCards input={habitResult} db={db} language={uiLanguage} isDark={isDark} s={s} />
          ) : null}
          <Button
            className="w-full max-w-sm"
            label={habitResult && showsCommitment(habitResult) ? s.habitCommitTomorrow : s.flashcardsSummaryDone}
            onPress={leave}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const progressLabel = `${formatNumber(index + 1, uiLanguage)} / ${formatNumber(queue.length, uiLanguage)}`;
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#d4d4d4" : "#6e5a47";

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <MirroredRow dir={dir} className="items-center justify-between px-5 pt-3 pb-2">
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={s.genericClose}
          className="w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        >
          <X size={18} color={muted} />
        </Pressable>
        <Text
          dir={dir}
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
          className="text-warm-500 dark:text-neutral-400"
        >
          {progressLabel}
        </Text>
        <View style={{ width: 44 }} />
      </MirroredRow>

      {current?.kind === "seam" ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
          <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accent }}>
              {s.hifzStrengthenChip}
            </Text>
          </View>
          <Text dir={dir} align="center" variant="title-md">
            {interpolate(s.hifzSeamDrillTitle, { n: formatNumber(current.page + 1, uiLanguage) })}
          </Text>
          <Text dir={dir} align="center" variant="body">
            {interpolate(s.hifzSeamDrillPrompt, {
              page: formatNumber(current.page, uiLanguage),
              next: formatNumber(current.page + 1, uiLanguage),
            })}
          </Text>
          {current.prompt ? (
            <Card elevation="low" className="w-full p-5">
              <Qcf2AyahText
                textQcf2={current.prompt.qcf2}
                v2Page={current.prompt.page}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            </Card>
          ) : null}
          {drillShown && current.answer ? (
            <Card elevation="low" className="w-full p-5 border border-primary-accent/30 dark:border-primary-bright/30">
              <Qcf2AyahText
                textQcf2={current.answer.qcf2}
                v2Page={current.answer.page}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            </Card>
          ) : null}
          {error ? (
            <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {!drillShown ? (
            <Button className="w-full max-w-sm" label={s.hifzSeamShow} onPress={() => setDrillShown(true)} />
          ) : (
            <View className="w-full max-w-sm" style={{ gap: 10 }}>
              <Button label={s.hifzSeamClean} onPress={() => seamResult(true)} disabled={busy} />
              <Button variant="outline" label={s.hifzSeamStumbled} onPress={() => seamResult(false)} disabled={busy} />
            </View>
          )}
        </ScrollView>
      ) : current?.kind === "drill" ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
          <Text dir={dir} variant="title-md">
            {s.hifzDrillTitle}
          </Text>
          <Text dir={dir} align="center" variant="body">
            {interpolate(s.hifzDrillPrompt, { ref: formatAyahRef(isRTL, current.item.surah, current.item.ayah ?? 1) })}
          </Text>
          <Text dir={dir} align="center" variant="caption">
            {errorTypeLabel(current.item.type, s)}
          </Text>
          {drillShown && current.text ? (
            <Card elevation="low" className="w-full p-5">
              <Qcf2AyahText
                textQcf2={current.text.qcf2}
                v2Page={current.text.page}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            </Card>
          ) : null}
          {error ? (
            <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {!drillShown ? (
            <Button className="w-full max-w-sm" label={s.hifzDrillShow} onPress={() => setDrillShown(true)} />
          ) : (
            <View className="w-full max-w-sm" style={{ gap: 10 }}>
              <Button label={s.hifzDrillClean} onPress={() => drillResult(true)} disabled={busy} />
              <Button variant="outline" label={s.hifzDrillAgain} onPress={() => drillResult(false)} disabled={busy} />
            </View>
          )}
        </ScrollView>
      ) : current?.kind === "page" || current?.kind === "half" ? (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: 24, alignItems: "center" }}>
            <View style={{ width: "100%", maxWidth: pageWidth, paddingHorizontal: 16, gap: 10 }}>
              <MirroredRow dir={dir} className="items-center justify-between gap-2">
                <Text
                  dir={dir}
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}
                  className="flex-1 text-charcoal dark:text-neutral-100"
                >
                  {current.kind === "half"
                    ? `${interpolate(s.hifzPageN, { n: formatNumber(current.page, uiLanguage) })} · ${current.half === "a" ? s.hifzHalfA : s.hifzHalfB}`
                    : `${interpolate(s.hifzPageN, { n: formatNumber(current.card.page, uiLanguage) })} · ${interpolate(s.hifzJuzN, { n: formatNumber(juzOfPage(current.card.page), uiLanguage) })}`}
                </Text>
                <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
                  <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accent }}>
                    {current.kind === "half" ? s.hifzStrengthenChip : tierLabel(current.card.tier, s)}
                  </Text>
                </View>
              </MirroredRow>

              {phase === "recite" ? (
                <View style={{ gap: 6 }}>
                  <Text dir={dir} variant="label-md">
                    {s.hifzLevelLabel}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, flexDirection: isRTL ? "row-reverse" : "row" }}
                  >
                    {SUPPORT_LEVELS.slice()
                      .reverse()
                      .map((level) => {
                        const selected = attempt.level === level;
                        return (
                          <Pressable
                            key={level}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            onPress={() => setLevel(level)}
                            className={`min-h-[36px] justify-center rounded-full px-3 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
                          >
                            <Text
                              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                              className={
                                selected
                                  ? "text-primary-accent dark:text-primary-bright"
                                  : "text-charcoal dark:text-neutral-300"
                              }
                            >
                              {levelLabel(level, s)}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </ScrollView>
                  <MirroredRow dir={dir} className="mt-1 items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text
                        dir={dir}
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                        className="text-charcoal dark:text-neutral-200"
                      >
                        {s.hifzListenerMode}
                      </Text>
                      {listener ? (
                        <Text dir={dir} variant="caption">
                          {s.hifzListenerModeHint}
                        </Text>
                      ) : null}
                    </View>
                    <Switch value={listener} onValueChange={setListener} />
                  </MirroredRow>
                  <Text dir={dir} variant="caption">
                    {!isGradable(attempt.level)
                      ? s.hifzLevelNotGraded
                      : attempt.level === 3
                        ? s.hifzSwipeHint
                        : cap < Rating.Easy
                          ? interpolate(s.hifzLevelCap, { grade: gradeLabel(cap, s) })
                          : s.hifzRecitePrompt}
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 2 }}>
                  <Text dir={dir} variant="title-sm">
                    {s.hifzCheckTitle}
                  </Text>
                  <Text dir={dir} variant="caption">
                    {s.hifzMarkMistakes}
                  </Text>
                </View>
              )}
            </View>

            <Card elevation="low" className="mt-3 py-4 rounded-3xl" style={{ width: pageWidth - 16 }}>
              {pageData ? (
                <RecitationPage
                  page={pageData}
                  level={attempt.level}
                  reveal={reveal}
                  lineNumbers={lineNumbers}
                  surahNames={surahNames}
                  marked={markedKeys}
                  onWordPress={toggleMark}
                  onTouchLine={(lineNumber) =>
                    setReveal((value) =>
                      value.touchedLines.has(lineNumber)
                        ? value
                        : { ...value, touchedLines: new Set([...value.touchedLines, lineNumber]) },
                    )
                  }
                  isDark={isDark}
                  width={pageWidth - 16}
                  wordLabel={wordLabel}
                />
              ) : (
                <Skeleton isDark={isDark} width="100%" height={420} borderRadius={16} />
              )}
            </Card>
            {phase === "check" && seamPage !== null ? (
              <Card elevation="low" className="mt-3 px-5 py-4 rounded-3xl" style={{ width: pageWidth - 16, gap: 10 }}>
                <View style={{ gap: 2 }}>
                  <Text dir={dir} variant="title-sm">
                    {interpolate(s.hifzSeamTitle, { n: formatNumber(seamPage, uiLanguage) })}
                  </Text>
                  <Text dir={dir} variant="caption">
                    {s.hifzSeamPrompt}
                  </Text>
                </View>
                {seamShown && seamText ? (
                  <Qcf2AyahText
                    textQcf2={seamText.qcf2}
                    v2Page={seamText.page}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                  />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    label={s.hifzSeamShow}
                    onPress={() => setSeamShown(true)}
                    disabled={!seamText}
                  />
                )}
                <MirroredRow dir={dir} className="gap-2">
                  {([true, false] as const).map((clean) => {
                    const selected = attempt.seam?.clean === clean;
                    return (
                      <Pressable
                        key={String(clean)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: !seamText }}
                        disabled={!seamText}
                        onPress={() =>
                          setAttempt((value) => ({
                            ...value,
                            seam: selected || !seamText ? null : { clean, surah: seamText.surah, ayah: seamText.ayah },
                          }))
                        }
                        className={`flex-1 min-h-[44px] items-center justify-center rounded-full px-3 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
                      >
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className={
                            selected
                              ? "text-primary-accent dark:text-primary-bright"
                              : "text-charcoal dark:text-neutral-300"
                          }
                        >
                          {clean ? s.hifzSeamClean : s.hifzSeamStumbled}
                        </Text>
                      </Pressable>
                    );
                  })}
                </MirroredRow>
              </Card>
            ) : null}
          </ScrollView>

          <View className="px-4 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high items-center">
            {/* The actions line up with the page on wide screens instead of spanning the window. */}
            <View style={{ width: "100%", maxWidth: pageWidth, gap: 10 }}>
              {error ? (
                <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              {phase === "recite" ? (
                <>
                  {isGradable(attempt.level) ? (
                    <MirroredRow dir={dir} className="gap-2">
                      {attempt.level === 2 ? (
                        <Button
                          className="flex-1"
                          variant="outline"
                          size="sm"
                          label={s.hifzNextLine}
                          onPress={nextLine}
                        />
                      ) : null}
                      <Button
                        className="flex-1"
                        variant="outline"
                        size="sm"
                        onPress={peek}
                        accessibilityHint={s.hifzPeekHint}
                      >
                        <Eye size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="text-charcoal dark:text-neutral-200"
                        >
                          {s.hifzPeek}
                        </Text>
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        size="sm"
                        onPress={showMe}
                        accessibilityHint={s.hifzShowMeHint}
                      >
                        <EyeOff size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="text-charcoal dark:text-neutral-200"
                        >
                          {s.hifzShowMe}
                        </Text>
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        size="sm"
                        onPress={() => setAttempt((value) => ({ ...value, slips: value.slips + 1 }))}
                        accessibilityLabel={`${s.hifzSlipHint}. ${interpolate(s.hifzSlipCount, { n: attempt.slips })}`}
                      >
                        <Plus size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="text-charcoal dark:text-neutral-200"
                          numberOfLines={1}
                        >
                          {attempt.slips > 0
                            ? `${s.hifzSlip} (${formatNumber(attempt.slips, uiLanguage)})`
                            : s.hifzSlip}
                        </Text>
                      </Button>
                    </MirroredRow>
                  ) : null}
                  {isGradable(attempt.level) ? (
                    <Button label={s.hifzDone} onPress={done} disabled={!pageData} />
                  ) : (
                    <Button label={s.hifzSabaqNext} onPress={advance} />
                  )}
                  {current.kind === "page" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityHint={s.hifzReciteInSalahHint}
                      onPress={() => grade(Rating.Good, "salah")}
                      disabled={busy}
                      className="min-h-[40px] items-center justify-center"
                    >
                      <MirroredRow dir={dir} className="items-center gap-1.5">
                        <Moon size={14} color={accent} />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: accent }}>
                          {s.hifzReciteInSalah}
                        </Text>
                      </MirroredRow>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <>
                  {attempt.marks.size > 0 ? (
                    <Text dir={dir} variant="caption">
                      {interpolate(s.hifzErrorsCount, { n: formatNumber(attempt.marks.size, uiLanguage) })}
                    </Text>
                  ) : null}
                  <GradingButtons
                    onGrade={(rating) => grade(rating)}
                    previews={policyPreviews}
                    isDark={isDark}
                    s={s}
                    disabled={busy}
                    proposed={proposal === 0 ? null : proposal}
                    maxRating={(cap === 0 ? Rating.Easy : cap) as Grade}
                  />
                </>
              )}
            </View>
          </View>
        </>
      ) : null}

      <MistakeTypeSheet
        open={markingKey !== null}
        current={markingKey ? (attempt.marks.get(markingKey)?.type ?? null) : null}
        dir={dir}
        s={s}
        onChoose={chooseMark}
        onRemove={removeMark}
        onClose={() => setMarkingKey(null)}
      />
      <ConfirmDialog
        visible={exitOpen}
        title={s.habitExitTitle}
        message={s.habitExitBody}
        cancelLabel={s.habitExitStay}
        confirmLabel={s.habitExitLeave}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => setExitOpen(false)}
        onConfirm={() => {
          setExitOpen(false);
          leave();
        }}
      />
      {notice ? <Toast message={notice} onDismiss={() => setNotice(null)} duration={3500} announce /> : null}
    </SafeAreaView>
  );
}

/** Opened from a deep link or a reminder, the route waits for the database like the other routes. */
export default function HifzReviewScreenRoute() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();
  if (error) return <DatabaseErrorState title={s.databaseError} message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;
  return <HifzReviewScreen />;
}
