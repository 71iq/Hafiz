import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { BookOpenCheck, Eye, Moon, PenLine, Plus, RotateCcw, ScanText, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
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
import { dismissInboxItem, INBOX_ITEMS_PER_REVIEW, readMistakeInbox, recordDrillResult, type InboxItem, type RecitationErrorType } from "@/lib/hifz/errors";
import { GRADE_CAP, defaultSupportLevel, isGradable, SUPPORT_LEVELS, type SupportLevel } from "@/lib/hifz/grading";
import { loadRecitationPage, type PageToken, type RecitationPage as PageData } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, toPlanPage, type PageCard } from "@/lib/hifz/pages";
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
import { refreshWeakSpots } from "@/lib/hifz/use-weak-spots";
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
  | { kind: "cloze"; card: StudyCardRow; surah: number; ayah: number; word: number; page: number }
  | { kind: "drill"; item: InboxItem; text: { qcf2: string; page: number } | null };

type Phase = "loading" | "recite" | "check" | "summary" | "empty" | "error";

/** The shared outline Button has no border; on this screen an outline action needs one to read as a button. */
const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";
/** Helper actions sit on a tinted fill so they read as buttons, at the full touch height. */
const HELPER_BUTTON = "flex-1 h-11 px-2 bg-surface-low dark:bg-surface-dark-low";

/** `extra` counts half pages and seams reviewed on their own. */
type Totals = { pages: number; clean: number; marked: number; extra: number };
const NO_TOTALS: Totals = { pages: 0, clean: 0, marked: 0, extra: 0 };

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
  const [totals, setTotals] = useState<Totals>(NO_TOTALS);
  /** The totals including every finished save, updated in the same tick so finalization never reads a stale render. */
  const totalsRef = useRef<Totals>(NO_TOTALS);
  /**
   * One action at a time. Taken synchronously on the tap, before React renders `busy`, and held through
   * the save, the advance and any finalization, so a second tap cannot save the same item twice.
   */
  const actionLock = useRef(false);
  /** The queue index actions may act on. It moves past an item once its save succeeds, so a stale handler for that item does nothing. */
  const actionIndex = useRef(0);
  /**
   * Close was pressed while an action held the lock. The screen leaves once the action succeeds, or
   * stays with the item open to show a failed save, which would otherwise reach a departed screen.
   */
  const leaveWhenSettled = useRef(false);
  /** Set once the screen leaves on purpose, so the back guard below lets that navigation through. */
  const exiting = useRef(false);
  // Pages the user holds, declared or reviewed: a seam leads only into one of them.
  const [heldPages, setHeldPages] = useState<ReadonlySet<number>>(new Set());
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
  const pageScrollRef = useRef<ScrollView>(null);
  /** The queue index whose seam check was already scrolled into view. */
  const seamScrolledFor = useRef<number | null>(null);

  const current = queue[index] ?? null;

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const now = new Date();
      const today = localDateOf(now);
      const [wird, inbox, names, base] = await Promise.all([
        loadTodayWird(db, now),
        readMistakeInbox(db, today, INBOX_ITEMS_PER_REVIEW),
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
        setHeldPages(new Set(cards.filter((card) => card.tier !== "sabaq").map((card) => card.page)));
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
      // SCH-06, SCH-08, ERR-06: relearning half pages and seams, and due weak-spot cloze cards, come
      // after the pages and before drills.
      if (!welcomeBack && !monthlyCheck) {
        for (const unit of await loadDueRemediation(db, now)) {
          if (unit.kind === "half") {
            items.push({ kind: "half", card: unit.row, page: unit.page, half: unit.half });
          } else if (unit.kind === "cloze") {
            const row = await db.getFirstAsync<{ v2_page: number }>(
              "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
              [unit.surah, unit.ayah],
            );
            if (row) items.push({ kind: "cloze", card: unit.row, surah: unit.surah, ayah: unit.ayah, word: unit.word, page: row.v2_page });
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
      actionIndex.current = 0;
      totalsRef.current = NO_TOTALS;
      setTotals(NO_TOTALS);
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
    if (!current || (current.kind !== "page" && current.kind !== "half" && current.kind !== "cloze")) {
      setPageData(null);
      if (current) {
        setAttempt(emptyAttempt(4));
        shownAt.current = Date.now();
      }
      return;
    }
    let cancelled = false;
    const level =
      current.kind === "half" || current.kind === "cloze"
        ? 4
        : (welcomeLevel ??
          defaultSupportLevel(current.card.tier === "sabqi" ? "sabqi" : "manzil", current.retrievability));
    const pageNumber = current.kind === "page" ? current.card.page : current.page;
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

  const lineNumbers = useMemo(() => {
    if (!pageData) return null;
    if (current?.kind === "half") return halfLineNumbers(pageData, current.half);
    // A cloze shows only the lines that hold its ayah.
    if (current?.kind === "cloze") {
      return new Set(
        pageData.lines
          .filter((line) => line.tokens.some((token) => token.surah === current.surah && token.ayah === current.ayah))
          .map((line) => line.lineNumber),
      );
    }
    return null;
  }, [current, pageData]);
  const clozeWord = useMemo(
    () => (current?.kind === "cloze" ? { surah: current.surah, ayah: current.ayah, wordPos: current.word } : null),
    [current],
  );
  const lines = useMemo(() => (pageData ? visibleLines(pageData, lineNumbers) : []), [lineNumbers, pageData]);
  // SCH-06: after a page whose next page the user also holds, the check offers its seam.
  const seamPage =
    current?.kind === "page" && hasSeamAfter(current.card.page) && heldPages.has(current.card.page + 1)
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

  /** End the session with the totals that include the last save, passed in rather than read from a render. */
  const finish = useCallback(
    async (final: Totals) => {
      const session = sessionRef.current;
      const durationMs = Date.now() - startedAt.current;
      const [overview] = await Promise.all([
        loadHabitOverview(db).catch(() => null),
        session ? endReviewSession(db, { session }).catch(console.warn) : null,
        final.pages > 0
          ? recordReviewPace(db, {
              minutes: durationMs / 60_000,
              pages: final.pages,
              current: minutesPerPage.current,
            }).catch(console.warn)
          : null,
      ]);
      if (monthlyCheck && final.pages > 0) await markMonthlyCheck(db).catch(console.warn);
      setHabitResult({
        event: wirdEvent.current,
        overview,
        againCount: againCount.current,
        total: final.pages + final.extra,
        durationMs,
      });
      setPhase("summary");
    },
    [db, monthlyCheck],
  );

  /** Move past the item at `from`, or finish after the last one. Resolves once the summary is ready. */
  const advance = useCallback(
    async (from: number, final: Totals) => {
      setMarkingKey(null);
      actionIndex.current = from + 1;
      if (from + 1 >= queue.length) {
        await finish(final);
        return;
      }
      setIndex(from + 1);
      setPhase("recite");
    },
    [finish, queue.length],
  );

  /** Record a finished save in the totals now, so the advance and finalization see it. */
  const addTotals = (delta: Partial<Totals>): Totals => {
    const value = totalsRef.current;
    const next: Totals = {
      pages: value.pages + (delta.pages ?? 0),
      clean: value.clean + (delta.clean ?? 0),
      marked: value.marked + (delta.marked ?? 0),
      extra: value.extra + (delta.extra ?? 0),
    };
    totalsRef.current = next;
    setTotals(next);
    return next;
  };

  /**
   * Run one action on the current item under the action lock: the save, then the advance and, after
   * the last item, the finalization. A failed save releases the lock and keeps the item open.
   */
  const runItemAction = async (label: string, save: () => Promise<Totals>) => {
    const from = index;
    if (actionLock.current || actionIndex.current !== from) return;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    try {
      let final: Totals;
      try {
        final = await save();
      } catch (saveError) {
        console.warn(`[HifzReview] ${label} failed:`, saveError);
        leaveWhenSettled.current = false;
        setError(s.hifzSaveFailed);
        return;
      }
      if (!leaveWhenSettled.current) await advance(from, final);
      if (leaveWhenSettled.current) {
        leaveWhenSettled.current = false;
        exit();
      }
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  /** Next at an ungraded support level: nothing is saved, but it still advances only once. */
  const skip = () => runItemAction("Skip", async () => totalsRef.current);

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

  /** A half page, seam or weak-spot cloze reviewed on its own (SCH-06, SCH-08, ERR-06). */
  const gradeRemediation = async (rating: Grade, attemptOverride?: Attempt) => {
    if (!current || (current.kind !== "half" && current.kind !== "seam" && current.kind !== "cloze")) return;
    const card = current.card;
    const usedAttempt = attemptOverride ?? attempt;
    const firstToken = current.kind === "half" ? (tokens.find((token) => !token.isMarker) ?? null) : null;
    if (current.kind === "half" && !firstToken) return;
    await runItemAction("Grade", async () => {
      const result = await saveRemediationGrade(db, {
        card,
        rating,
        attempt: usedAttempt,
        firstToken,
        session: sessionRef.current,
        durationMs: Date.now() - shownAt.current,
        grader: listener ? "teacher" : "self",
      });
      if (rating === Rating.Again) againCount.current += 1;
      showWirdNotice(result.wird);
      return addTotals({ extra: 1 });
    });
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
    if (!current || current.kind !== "page" || !plan) return;
    const card = current.card;
    const firstToken = tokens.find((token) => !token.isMarker) ?? tokens[0];
    if (!firstToken && grader !== "salah") return;
    const usedAttempt = grader === "salah" ? emptyAttempt(4) : attempt;
    await runItemAction("Grade", async () => {
      const result = await savePageGrade(db, {
        card: card.row,
        history: card.history,
        plan,
        attempt: usedAttempt,
        rating,
        firstToken: firstToken ?? { glyph: "", surah: 1, ayah: 1, wordPos: null, isMarker: true, firstLetter: null },
        session: sessionRef.current,
        durationMs: Date.now() - shownAt.current,
        grader,
        page: pageData,
      });
      if (rating === Rating.Again) againCount.current += 1;
      const markedCount = grader === "salah" ? 0 : usedAttempt.marks.size + usedAttempt.peeked.length + usedAttempt.shown.length;
      setPlanProgress((value) => (value ? { ...value, done: value.done + 1 } : value));
      // A wird milestone is the bigger news; the half page shows up in the queue either way.
      if (!showWirdNotice(result.wird) && result.remediation.half) {
        setNotice(result.remediation.half === "a" ? s.hifzHalfScheduledA : s.hifzHalfScheduledB);
      }
      return addTotals({ pages: 1, clean: rating >= Rating.Good && markedCount === 0 ? 1 : 0, marked: markedCount });
    });
  };

  const drillResult = async (result: "clean" | "again" | "not_a_mistake") => {
    if (!current || current.kind !== "drill") return;
    const { id } = current.item;
    await runItemAction("Drill", async () => {
      // An error logged by mistake leaves the inbox instead of waiting for two clean days.
      if (result === "not_a_mistake") {
        await dismissInboxItem(db, { id });
        // ERR-06: the dismissal can end a weak spot, so the reader's markers reload.
        refreshWeakSpots(db).catch((refreshError) => console.warn("[HifzReview] Weak spots failed to refresh:", refreshError));
      } else {
        await recordDrillResult(db, { id, clean: result === "clean" });
      }
      return totalsRef.current;
    });
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

  const exit = () => {
    exiting.current = true;
    const session = sessionRef.current;
    if (session && phase !== "summary") endReviewSession(db, { session }).catch(console.warn);
    returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  // Hardware back or a back gesture during an unresolved save waits for it, the same as Close.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (exiting.current || !actionLock.current) return;
        event.preventDefault();
        leaveWhenSettled.current = true;
      }),
    [navigation],
  );

  /** Leave now, or once the action holding the lock settles (see leaveWhenSettled). */
  const leave = () => {
    if (actionLock.current) leaveWhenSettled.current = true;
    else exit();
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
  // While the mistake sheet is open, the tapped word stays highlighted so the user sees which one it is.
  const markedKeys = useMemo(() => {
    const keys = new Set(attempt.marks.keys());
    if (markingKey) keys.add(markingKey);
    return keys;
  }, [attempt.marks, markingKey]);
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
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center px-6">
        <EmptyState
          icon={phase === "error" ? RotateCcw : drillsOnly ? PenLine : BookOpenCheck}
          title={phase === "error" ? s.hifzLoadFailed : drillsOnly ? s.hifzInboxEmpty : s.hifzNothingDue}
          isDark={isDark}
        />
        <View className="w-full max-w-sm" style={{ gap: 10 }}>
          {phase === "error" ? <Button label={s.homeLoadRetry} onPress={load} /> : null}
          <Button
            variant={phase === "error" ? "outline" : "default"}
            className={phase === "error" ? OUTLINE_BORDER : undefined}
            label={s.flashcardsSummaryDone}
            onPress={leave}
          />
        </View>
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
                  // A zero is not news, so it stays in regular weight beside the counts that are.
                  style={{ fontFamily: value === 0 ? "Manrope_400Regular" : "Manrope_700Bold", fontSize: 17 }}
                  className={value === 0 ? "text-warm-600 dark:text-neutral-400" : "text-charcoal dark:text-neutral-100"}
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
  // Teal text under 14 px uses the darker token in light mode to stay readable on tinted chips.
  const accentText = isDark ? "#2dd4bf" : "#0f766e";
  const muted = isDark ? "#d4d4d4" : "#6e5a47";
  const marking = markingToken && markingKey !== null ? markingToken : null;
  const markingSubtitle = marking
    ? marking.wordPos
      ? interpolate(s.hifzMistakeWordRef, {
          ref: formatAyahRef(isRTL, marking.surah, marking.ayah),
          n: formatNumber(marking.wordPos, uiLanguage),
        })
      : interpolate(s.hifzMistakeAyahRef, { ref: formatAyahRef(isRTL, marking.surah, marking.ayah) })
    : undefined;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* The header shares the page column, so the close button sits beside the page on wide screens. */}
      <View className="items-center">
        <MirroredRow
          dir={dir}
          className="items-center justify-between px-2 pt-3 pb-2"
          style={{ width: "100%", maxWidth: pageWidth }}
        >
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
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
            className="text-warm-600 dark:text-neutral-400"
          >
            {progressLabel}
          </Text>
          <View style={{ width: 44 }} />
        </MirroredRow>
      </View>

      {current?.kind === "seam" ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
          <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accentText }}>
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
              <Button variant="outline" className={OUTLINE_BORDER} label={s.hifzSeamStumbled} onPress={() => seamResult(false)} disabled={busy} />
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
              <Button label={s.hifzDrillClean} onPress={() => drillResult("clean")} disabled={busy} />
              <Button variant="outline" className={OUTLINE_BORDER} label={s.hifzDrillAgain} onPress={() => drillResult("again")} disabled={busy} />
              <Button variant="ghost" label={s.hifzDrillDismiss} onPress={() => drillResult("not_a_mistake")} disabled={busy} />
            </View>
          )}
        </ScrollView>
      ) : current?.kind === "cloze" ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
          <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accentText }}>{s.hifzStrengthenChip}</Text>
          </View>
          <Text dir={dir} align="center" variant="title-md">
            {s.hifzClozeTitle}
          </Text>
          <Text dir={dir} align="center" variant="body">
            {interpolate(s.hifzClozePrompt, { ref: formatAyahRef(isRTL, current.surah, current.ayah) })}
          </Text>
          <Card elevation="low" className="py-4 rounded-3xl" style={{ width: pageWidth - 16 }}>
            {pageData ? (
              <RecitationPage
                page={pageData}
                level={0}
                reveal={reveal}
                lineNumbers={lineNumbers}
                cloze={clozeWord}
                surahNames={surahNames}
                isDark={isDark}
                width={pageWidth - 16}
                wordLabel={wordLabel}
              />
            ) : (
              <Skeleton isDark={isDark} width="100%" height={120} borderRadius={16} />
            )}
          </Card>
          {error ? (
            <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {!reveal.all ? (
            <Button className="w-full max-w-sm" label={s.hifzDrillShow} onPress={() => setReveal((value) => ({ ...value, all: true }))} disabled={!pageData} />
          ) : (
            <View className="w-full max-w-sm" style={{ gap: 10 }}>
              <Button label={s.hifzDrillClean} onPress={() => gradeRemediation(Rating.Good, emptyAttempt(4))} disabled={busy} />
              <Button variant="outline" className={OUTLINE_BORDER} label={s.hifzDrillAgain} onPress={() => gradeRemediation(Rating.Again, emptyAttempt(4))} disabled={busy} />
            </View>
          )}
        </ScrollView>
      ) : current?.kind === "page" || current?.kind === "half" ? (
        <>
          <ScrollView ref={pageScrollRef} contentContainerStyle={{ paddingBottom: 24, alignItems: "center" }}>
            <View style={{ width: "100%", maxWidth: pageWidth, paddingHorizontal: 8, gap: 10 }}>
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
                  <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accentText }}>
                    {current.kind === "half" ? s.hifzStrengthenChip : tierLabel(current.card.tier, s)}
                  </Text>
                </View>
              </MirroredRow>

              {phase === "recite" ? (
                <View style={{ gap: 6 }}>
                  <Text dir={dir} variant="label-md">
                    {s.hifzLevelLabel}
                  </Text>
                  {/* Wraps instead of scrolling, so all five levels stay visible in both directions. */}
                  <MirroredRow dir={dir} className="flex-wrap gap-1.5" accessibilityRole="radiogroup">
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
                            className={`min-h-[44px] justify-center rounded-full px-3.5 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
                          >
                            <Text
                              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                              className={
                                selected
                                  ? "text-primary-muted dark:text-primary-bright"
                                  : "text-charcoal dark:text-neutral-300"
                              }
                            >
                              {levelLabel(level, s)}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </MirroredRow>
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
              <Card
                elevation="low"
                className="mt-3 px-5 py-4 rounded-3xl"
                style={{ width: pageWidth - 16, gap: 10 }}
                // The seam check sits below the page; bring it into view once so it is not graded unseen.
                onLayout={() => {
                  if (seamScrolledFor.current === index) return;
                  seamScrolledFor.current = index;
                  requestAnimationFrame(() => pageScrollRef.current?.scrollToEnd({ animated: true }));
                }}
              >
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
                    className="h-11 bg-surface-high dark:bg-surface-dark-high"
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
                        className={`flex-1 min-h-[44px] items-center justify-center rounded-full px-3 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-high dark:bg-surface-dark-high"}`}
                      >
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className={
                            selected
                              ? "text-primary-muted dark:text-primary-bright"
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

          <View className="px-2 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high items-center">
            {/* The actions line up with the page on wide screens instead of spanning the window. */}
            {/* Header, title, page card and actions all start 8 px inside the page column. */}
            <View style={{ width: "100%", maxWidth: pageWidth - 16, gap: 10 }}>
              {error ? (
                <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              {phase === "recite" ? (
                <>
                  {isGradable(attempt.level) ? (
                    <MirroredRow dir={dir} className="gap-2">
                      <Button
                        className={HELPER_BUTTON}
                        variant="outline"
                        size="sm"
                        onPress={peek}
                        accessibilityHint={s.hifzPeekHint}
                      >
                        <Eye size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="flex-shrink text-charcoal dark:text-neutral-200"
                          numberOfLines={1}
                        >
                          {s.hifzPeek}
                        </Text>
                      </Button>
                      <Button
                        className={HELPER_BUTTON}
                        variant="outline"
                        size="sm"
                        onPress={showMe}
                        accessibilityHint={s.hifzShowMeHint}
                      >
                        <ScanText size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="flex-shrink text-charcoal dark:text-neutral-200"
                          numberOfLines={1}
                        >
                          {s.hifzShowMe}
                        </Text>
                      </Button>
                      <Button
                        className={HELPER_BUTTON}
                        variant="outline"
                        size="sm"
                        onPress={() => setAttempt((value) => ({ ...value, slips: value.slips + 1 }))}
                        accessibilityLabel={`${s.hifzSlipHint}. ${interpolate(s.hifzSlipCount, { n: attempt.slips })}`}
                      >
                        <Plus size={15} color={muted} />
                        <Text
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                          className="flex-shrink text-charcoal dark:text-neutral-200"
                          numberOfLines={1}
                        >
                          {attempt.slips > 0
                            ? `${s.hifzSlip} (${formatNumber(attempt.slips, uiLanguage)})`
                            : s.hifzSlip}
                        </Text>
                      </Button>
                    </MirroredRow>
                  ) : null}
                  {/* Line by line is driven by Next line, so it leads and Done steps back to outline. */}
                  {isGradable(attempt.level) && attempt.level === 2 ? (
                    <>
                      <Button label={s.hifzNextLine} onPress={nextLine} disabled={!pageData} />
                      <Button
                        variant="outline"
                        className={OUTLINE_BORDER}
                        label={s.hifzDone}
                        onPress={done}
                        disabled={!pageData}
                      />
                    </>
                  ) : isGradable(attempt.level) ? (
                    <Button label={s.hifzDone} onPress={done} disabled={!pageData} />
                  ) : (
                    <Button label={s.hifzSabaqNext} onPress={skip} disabled={busy} />
                  )}
                  {current.kind === "page" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityHint={s.hifzReciteInSalahHint}
                      onPress={() => grade(Rating.Good, "salah")}
                      disabled={busy}
                      className="min-h-[44px] items-center justify-center"
                    >
                      <MirroredRow dir={dir} className="items-center gap-1.5">
                        <Moon size={14} color={accent} />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: accentText }}>
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
                    dir={dir}
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
        subtitle={markingSubtitle}
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
