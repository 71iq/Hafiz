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
import { GradingButtons, getGradeSchedulePreviews } from "@/components/flashcards/GradingButtons";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import { SessionHabitCards, showsCommitment, strongerWirdEvent, type SessionHabitInput } from "@/components/habit/SessionHabitCards";
import { MistakeTypeSheet, errorTypeLabel } from "@/components/hifz/MistakeTypeSheet";
import { HIDDEN, RecitationPage, orderedTokens, visibleLines, type RevealState } from "@/components/hifz/RecitationPage";
import { loadPageWordsData } from "@/components/mushaf/MushafPage";
import { useDatabase } from "@/lib/database/provider";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import { endReviewSession, startReviewSession, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readMistakeInbox, recordDrillResult, type InboxItem, type RecitationErrorType } from "@/lib/hifz/errors";
import { GRADE_CAP, defaultSupportLevel, isGradable, SUPPORT_LEVELS, type SupportLevel } from "@/lib/hifz/grading";
import { loadRecitationPage, type PageToken, type RecitationPage as PageData } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, type PageCard } from "@/lib/hifz/pages";
import type { HifzPlan } from "@/lib/hifz/plan";
import {
  emptyAttempt,
  endOfLineAt,
  nextHiddenWord,
  proposedRating,
  recordReviewPace,
  savePageGrade,
  type Attempt,
} from "@/lib/hifz/review";
import { pagePolicy, type Tier } from "@/lib/hifz/tiers";
import { HIFZ_PAGES_DECK_ID, juzOfPage } from "@/lib/hifz/units";
import { formatAyahRef } from "@/lib/arabic";
import { formatDays, formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";
import { hapticMedium } from "@/lib/haptics";

type QueueItem =
  | { kind: "page"; card: PageCard; retrievability: number | null }
  | { kind: "drill"; item: InboxItem; text: { qcf2: string; page: number } | null };

type Phase = "loading" | "recite" | "check" | "summary" | "empty" | "error";

type Totals = { pages: number; clean: number; marked: number };

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
  return [s.flashcardsAgain, s.flashcardsAgain, s.flashcardsHard, s.flashcardsGood, s.flashcardsEasy][rating] ?? s.flashcardsGood;
}

/**
 * The wird review (4.4.2): today's planned pages in order, sabqi then manzil, each recited at a
 * support level, checked word by word, and graded with the rubric's proposal (4.2), followed by up
 * to 6 drills from the mistake inbox (ERR-04). Progress saves after every page (REV-01).
 */
export default function HifzReviewScreen() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage, fontSize, lineHeight } = useSettings();
  const navigation = useNavigation();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const drillsOnly = (Array.isArray(mode) ? mode[0] : mode) === "mistakes";
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
  const [totals, setTotals] = useState<Totals>({ pages: 0, clean: 0, marked: 0 });
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
        for (const page of wird.todo) {
          const card = byId.get(page.cardId);
          if (card) items.push({ kind: "page", card, retrievability: page.retrievability });
        }
      } else if (wird) {
        setPlan(wird.plan);
      }
      for (const item of inbox) {
        if (item.ayah === null) continue;
        const row = await db.getFirstAsync<{ text_qcf2: string; v2_page: number }>(
          "SELECT text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
          [item.surah, item.ayah],
        );
        items.push({ kind: "drill", item, text: row ? { qcf2: row.text_qcf2, page: row.v2_page } : null });
      }
      sessionRef.current = startReviewSession(drillsOnly ? "mistakes" : "wird");
      startedAt.current = Date.now();
      setQueue(items);
      setIndex(0);
      setPhase(items.length === 0 ? "empty" : "recite");
    } catch (loadError) {
      console.warn("[HifzReview] Failed to load:", loadError);
      setPhase("error");
    }
  }, [db, drillsOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the page for the current item and reset the attempt at its default support level (MOD-01).
  useEffect(() => {
    if (!current || current.kind !== "page") {
      setPageData(null);
      return;
    }
    let cancelled = false;
    const level = defaultSupportLevel(current.card.tier === "sabqi" ? "sabqi" : "manzil", current.retrievability);
    setAttempt(emptyAttempt(level));
    setReveal(HIDDEN);
    setError(null);
    shownAt.current = Date.now();
    loadPageWordsData()
      .catch(() => null)
      .then((words) => loadRecitationPage(db, current.card.page, words?.[current.card.page - 1] ?? null))
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
  }, [current, db, s.hifzLoadFailed]);

  useEffect(() => {
    setDrillShown(false);
  }, [index]);

  const lines = useMemo(() => (pageData ? visibleLines(pageData, null) : []), [pageData]);
  const tokens = useMemo(() => orderedTokens(lines), [lines]);

  const finish = useCallback(async () => {
    const session = sessionRef.current;
    const durationMs = Date.now() - startedAt.current;
    const [overview] = await Promise.all([
      loadHabitOverview(db).catch(() => null),
      session ? endReviewSession(db, { session }).catch(console.warn) : null,
      totals.pages > 0
        ? recordReviewPace(db, { minutes: durationMs / 60_000, pages: totals.pages, current: minutesPerPage.current }).catch(console.warn)
        : null,
    ]);
    setHabitResult({ event: wirdEvent.current, overview, againCount: againCount.current, total: totals.pages, durationMs });
    setPhase("summary");
  }, [db, totals.pages]);

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

  const grade = async (rating: Grade, grader: "self" | "salah" = "self") => {
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
      });
      if (rating === Rating.Again) againCount.current += 1;
      const markedCount = grader === "salah" ? 0 : attempt.marks.size + attempt.peeked.length + attempt.shown.length;
      setTotals((value) => ({
        pages: value.pages + 1,
        clean: value.clean + (rating >= Rating.Good && markedCount === 0 ? 1 : 0),
        marked: value.marked + markedCount,
      }));
      setPlanProgress((value) => (value ? { ...value, done: value.done + 1 } : value));
      wirdEvent.current = strongerWirdEvent(wirdEvent.current, result.wird);
      if (result.wird.kind === "minimum_met") setNotice(s.habitMinimumMet);
      else if (result.wird.kind === "made_up") {
        setNotice(interpolate(s.habitMadeUp, { n: formatNumber(result.wird.length, uiLanguage), days: formatDays(result.wird.length, uiLanguage) }));
      } else if (result.wird.kind === "earned_back") {
        setNotice(interpolate(s.habitEarnedBack, { days: formatDays(result.wird.length, uiLanguage) }));
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
    if (phase !== "summary" && totals.pages > 0) setExitOpen(true);
    else leave();
  };

  const proposal = proposedRating(attempt);
  const cap = GRADE_CAP[attempt.level];
  const policyPreviews = useMemo(() => {
    if (!current || current.kind !== "page" || !plan || !baseSettings) return {};
    return getGradeSchedulePreviews(current.card.row, pagePolicy(current.card.tier, plan, baseSettings), isRTL);
  }, [baseSettings, current, isRTL, plan]);
  const markedKeys = useMemo(() => new Set(attempt.marks.keys()), [attempt.marks]);
  const wordLabel = useCallback(
    (token: PageToken) => (token.wordPos ? formatAyahRef(isRTL, token.surah, token.ayah, token.wordPos) : formatAyahRef(isRTL, token.surah, token.ayah)),
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
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center px-8" style={{ gap: 16 }}>
        <Text dir={dir} align="center" variant="title-md">
          {phase === "error" ? s.hifzLoadFailed : drillsOnly ? s.hifzInboxEmpty : s.hifzNothingDue}
        </Text>
        <Button label={phase === "error" ? s.homeLoadRetry : s.flashcardsSummaryDone} onPress={phase === "error" ? load : leave} />
      </SafeAreaView>
    );
  }

  if (phase === "summary") {
    const minutes = Math.max(1, Math.round((habitResult?.durationMs ?? 0) / 60_000));
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 14 }}>
          <Text dir={dir} align="center" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }} className="text-charcoal dark:text-neutral-100">
            {s.hifzSummaryTitle}
          </Text>
          <Card elevation="low" className="w-full max-w-sm px-5 py-4" style={{ gap: 10 }}>
            {[
              [s.hifzSummaryPages, totals.pages],
              [s.hifzSummaryClean, totals.clean],
              [s.hifzSummaryMarked, totals.marked],
              [s.hifzSummaryMinutes, minutes],
            ].map(([label, value]) => (
              <MirroredRow key={String(label)} dir={dir} className="items-center justify-between">
                <Text dir={dir} variant="muted">
                  {label as string}
                </Text>
                <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 17 }} className="text-charcoal dark:text-neutral-100">
                  {formatNumber(value as number, uiLanguage)}
                </Text>
              </MirroredRow>
            ))}
            {planProgress && planProgress.total > 0 ? (
              <Text dir={dir} variant="caption">
                {interpolate(s.hifzSummaryPlan, { done: formatNumber(planProgress.done, uiLanguage), total: formatNumber(planProgress.total, uiLanguage) })}
              </Text>
            ) : null}
          </Card>
          {habitResult && totals.pages > 0 ? <SessionHabitCards input={habitResult} db={db} language={uiLanguage} isDark={isDark} s={s} /> : null}
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
        <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }} className="text-warm-500 dark:text-neutral-400">
          {progressLabel}
        </Text>
        <View style={{ width: 44 }} />
      </MirroredRow>

      {current?.kind === "drill" ? (
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
              <Qcf2AyahText textQcf2={current.text.qcf2} v2Page={current.text.page} fontSize={fontSize} lineHeight={lineHeight} />
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
      ) : current?.kind === "page" ? (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: 24, alignItems: "center" }}>
            <View style={{ width: "100%", maxWidth: pageWidth, paddingHorizontal: 16, gap: 10 }}>
              <MirroredRow dir={dir} className="items-center justify-between gap-2">
                <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }} className="text-charcoal dark:text-neutral-100">
                  {`${interpolate(s.hifzPageN, { n: formatNumber(current.card.page, uiLanguage) })} · ${interpolate(s.hifzJuzN, { n: formatNumber(juzOfPage(current.card.page), uiLanguage) })}`}
                </Text>
                <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
                  <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accent }}>{tierLabel(current.card.tier, s)}</Text>
                </View>
              </MirroredRow>

              {phase === "recite" ? (
                <View style={{ gap: 6 }}>
                  <Text dir={dir} variant="label-md">
                    {s.hifzLevelLabel}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: isRTL ? "row-reverse" : "row" }}>
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
                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }} className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}>
                              {levelLabel(level, s)}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </ScrollView>
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
                  surahNames={surahNames}
                  marked={markedKeys}
                  onWordPress={toggleMark}
                  onTouchLine={(lineNumber) =>
                    setReveal((value) => (value.touchedLines.has(lineNumber) ? value : { ...value, touchedLines: new Set([...value.touchedLines, lineNumber]) }))
                  }
                  isDark={isDark}
                  width={pageWidth - 16}
                  wordLabel={wordLabel}
                />
              ) : (
                <Skeleton isDark={isDark} width="100%" height={420} borderRadius={16} />
              )}
            </Card>
          </ScrollView>

          <View className="px-4 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high" style={{ gap: 10 }}>
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
                      <Button className="flex-1" variant="outline" size="sm" label={s.hifzNextLine} onPress={nextLine} />
                    ) : null}
                    <Button className="flex-1" variant="outline" size="sm" onPress={peek} accessibilityHint={s.hifzPeekHint}>
                      <Eye size={15} color={muted} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-charcoal dark:text-neutral-200">
                        {s.hifzPeek}
                      </Text>
                    </Button>
                    <Button className="flex-1" variant="outline" size="sm" onPress={showMe} accessibilityHint={s.hifzShowMeHint}>
                      <EyeOff size={15} color={muted} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-charcoal dark:text-neutral-200">
                        {s.hifzShowMe}
                      </Text>
                    </Button>
                    <Button
                      className="flex-1"
                      variant="outline"
                      size="sm"
                      onPress={() => setAttempt((value) => ({ ...value, slips: value.slips + 1 }))}
                      accessibilityLabel={`${s.hifzSlip}. ${interpolate(s.hifzSlipCount, { n: attempt.slips })}`}
                    >
                      <Plus size={15} color={muted} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-charcoal dark:text-neutral-200" numberOfLines={1}>
                        {attempt.slips > 0 ? `${s.hifzSlip} (${formatNumber(attempt.slips, uiLanguage)})` : s.hifzSlip}
                      </Text>
                    </Button>
                  </MirroredRow>
                ) : null}
                {isGradable(attempt.level) ? (
                  <Button label={s.hifzDone} onPress={done} disabled={!pageData} />
                ) : (
                  <Button label={s.hifzSabaqNext} onPress={advance} />
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={s.hifzReciteInSalahHint}
                  onPress={() => grade(Rating.Good, "salah")}
                  disabled={busy}
                  className="min-h-[40px] items-center justify-center"
                >
                  <MirroredRow dir={dir} className="items-center gap-1.5">
                    <Moon size={14} color={accent} />
                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: accent }}>{s.hifzReciteInSalah}</Text>
                  </MirroredRow>
                </Pressable>
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
        </>
      ) : null}

      <MistakeTypeSheet
        open={markingKey !== null}
        current={markingKey ? attempt.marks.get(markingKey)?.type ?? null : null}
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
