import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { Pause, Play, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import { Skeleton } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import { SessionHabitCards, showsCommitment, strongerWirdEvent, type SessionHabitInput } from "@/components/habit/SessionHabitCards";
import { HIDDEN, RecitationPage } from "@/components/hifz/RecitationPage";
import { loadPageWordsData } from "@/components/mushaf/MushafPage";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { useDatabase } from "@/lib/database/provider";
import { endReviewSession, startReviewSession, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { Grade } from "@/lib/fsrs/scheduler";
import { loadHabitOverview } from "@/lib/habit/queries";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import type { PageToken } from "@/lib/hifz/page-data";
import { loadTodayWird } from "@/lib/hifz/pages";
import type { HifzPlan } from "@/lib/hifz/plan";
import { completeSabaqChunk, nextSabaqTarget, type SabaqTarget } from "@/lib/hifz/sabaq";
import { formatAyahRef } from "@/lib/arabic";
import { formatNumber } from "@/lib/i18n/count";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";

/** 4.4.1 steps after the optional intention. */
type Step = "intention" | "listen" | "meaning" | "looking" | "ayah" | "chunk" | "link" | "check" | "done";
const STEPS: readonly Step[] = ["intention", "listen", "meaning", "looking", "ayah", "chunk", "link", "check"];

/** SBQ-01: the "10 looking, then from memory" practice. */
const LOOKING_TARGET = 10;
const CLEAN_IN_A_ROW = 3;
const LISTEN_REPEATS = 3;

/**
 * Sabaq, new memorization (4.4.1): intention, listening, meaning, reading while looking, ayah by
 * ayah from memory with chaining, the whole chunk three times cleanly, linking to what came before,
 * then a graded fluent check that turns the chunk into a sabaq card (SBQ-02).
 */
export default function SabaqScreen() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
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
  const [error, setError] = useState<string | null>(null);
  const [habitResult, setHabitResult] = useState<SessionHabitInput | null>(null);
  const [pageAdded, setPageAdded] = useState(false);
  const [surahNames, setSurahNames] = useState<Map<number, string>>(new Map());
  const sessionRef = useRef<ReviewSessionRef | null>(null);
  const startedAt = useRef(Date.now());
  const step: Step = habitResult ? "done" : STEPS[stepIndex];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wird, words, names] = await Promise.all([
        loadTodayWird(db),
        loadPageWordsData().catch(() => null),
        db.getAllAsync<{ number: number; name_arabic: string }>("SELECT number, name_arabic FROM surahs"),
      ]);
      setSurahNames(new Map(names.map((row) => [row.number, row.name_arabic])));
      if (!wird) {
        setTarget(null);
        return;
      }
      setPlan(wird.plan);
      const next = await nextSabaqTarget(db, {
        plan: wird.plan,
        wantLines: Math.max(3, wird.newLines),
        pageWords: (page) => words?.[page - 1] ?? null,
      });
      setTarget(next);
      if (next) {
        const rows = await Promise.all(
          next.ayahs.map(async (ayah) => {
            const row =
              uiLanguage === "ar"
                ? await db.getFirstAsync<{ text: string }>("SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = 'muyassar'", [ayah.surah, ayah.ayah])
                : await db.getFirstAsync<{ text: string }>("SELECT text_en AS text FROM translations WHERE surah = ? AND ayah = ?", [ayah.surah, ayah.ayah]);
            return { key: `${ayah.surah}:${ayah.ayah}`, text: row?.text ?? "" };
          }),
        );
        setMeanings(rows);
      }
      sessionRef.current = startReviewSession("sabaq");
      startedAt.current = Date.now();
    } catch (loadError) {
      console.warn("[Sabaq] Failed to load:", loadError);
      setError(s.hifzLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [db, s.hifzLoadFailed, uiLanguage]);

  useEffect(() => {
    load();
    return () => stop();
  }, [load, stop]);

  const goNext = () => {
    setShown(false);
    setCleanRun(0);
    setStepIndex((value) => Math.min(STEPS.length - 1, value + 1));
  };

  const leave = () => {
    stop();
    const session = sessionRef.current;
    if (session && !habitResult) endReviewSession(db, { session }).catch(console.warn);
    returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  const finish = async (rating: Grade) => {
    if (!target || !plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeSabaqChunk(db, {
        target,
        plan,
        rating,
        session: sessionRef.current,
        durationMs: Date.now() - startedAt.current,
      });
      setPageAdded(result.pageAdded);
      const session = sessionRef.current;
      const [overview] = await Promise.all([
        loadHabitOverview(db).catch(() => null),
        session ? endReviewSession(db, { session }).catch(console.warn) : null,
      ]);
      emitHabitChanged();
      setHabitResult({
        event: strongerWirdEvent(null, result.wird),
        overview,
        againCount: rating === 1 ? 1 : 0,
        total: 1,
        durationMs: Date.now() - startedAt.current,
      });
    } catch (saveError) {
      console.warn("[Sabaq] Save failed:", saveError);
      setError(s.hifzSaveFailed);
    } finally {
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

  if (!target || !plan) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center px-8" style={{ gap: 16 }}>
        <Text dir={dir} align="center" variant="title-md">
          {error ?? s.hifzSabaqNoNew}
        </Text>
        <Button label={s.flashcardsSummaryDone} onPress={leave} />
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
    done: s.hifzSabaqDone,
  };
  const hidden = step === "ayah" || step === "chunk" || step === "link" || step === "check";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#d4d4d4" : "#6e5a47";

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <MirroredRow dir={dir} className="items-center justify-between px-5 pt-3 pb-2">
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel={s.genericClose} className="w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center">
          <X size={18} color={muted} />
        </Pressable>
        <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }} className="text-warm-500 dark:text-neutral-400">
          {`${interpolate(s.hifzPageN, { n: formatNumber(target.page, uiLanguage) })} · ${interpolate(s.hifzSabaqLines, {
            from: formatNumber(target.fromLine, uiLanguage),
            to: formatNumber(target.toLine, uiLanguage),
          })}`}
        </Text>
        <View style={{ width: 44 }} />
      </MirroredRow>
      {step !== "done" ? <Progress value={((stepIndex + 1) / STEPS.length) * 100} dir={dir} className="mx-5 h-1" /> : null}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: pageWidth, gap: 6 }}>
          <Text dir={dir} style={{ fontFamily: "NotoSerif_700Bold", fontSize: 21, lineHeight: 30 }} className="text-charcoal dark:text-neutral-100">
            {stepTitle[step]}
          </Text>
          <Text dir={dir} variant="muted" style={{ lineHeight: 20 }}>
            {step === "listen"
              ? s.hifzSabaqListenHint
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
                        : step === "done"
                          ? s.hifzSabaqSecondLook
                          : ""}
          </Text>
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

        {step !== "intention" && step !== "meaning" && step !== "done" ? (
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
          <View style={{ width: "100%", maxWidth: pageWidth, alignItems: "center", gap: 12 }}>
            {pageAdded ? (
              <Text dir={dir} align="center" variant="body">
                {s.hifzSabaqDone}
              </Text>
            ) : null}
            <SessionHabitCards input={habitResult} db={db} language={uiLanguage} isDark={isDark} s={s} />
          </View>
        ) : null}

        {error ? (
          <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View className="px-4 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high" style={{ gap: 10 }}>
        {step === "intention" ? <Button label={s.hifzSabaqNext} onPress={goNext} /> : null}

        {step === "listen" ? (
          <>
            <Button
              variant="outline"
              onPress={() =>
                rangeState.active
                  ? togglePause()
                  : playRange({ ayahs: [...target.ayahs], repeatRange: LISTEN_REPEATS }).catch(console.warn)
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

        {step === "meaning" ? <Button label={s.hifzSabaqNext} onPress={goNext} /> : null}

        {step === "looking" ? (
          <>
            <Text dir={dir} align="center" variant="caption">
              {interpolate(s.hifzSabaqLookingCount, { done: formatNumber(looking, uiLanguage), target: formatNumber(LOOKING_TARGET, uiLanguage) })}
            </Text>
            {looking < LOOKING_TARGET ? (
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
              className="flex-1"
              variant="outline"
              label={s.hifzSabaqNotYet}
              onPress={() => {
                setShown(false);
                setCleanRun(0);
              }}
            />
            <Button
              className="flex-1"
              label={s.hifzSabaqClean}
              onPress={() => {
                setShown(false);
                if (step === "ayah") {
                  if (ayahIndex + 1 < target.ayahs.length) setAyahIndex((value) => value + 1);
                  else goNext();
                  return;
                }
                if (step === "chunk") {
                  if (cleanRun + 1 >= CLEAN_IN_A_ROW) goNext();
                  else setCleanRun((value) => value + 1);
                  return;
                }
                goNext();
              }}
            />
          </MirroredRow>
        ) : null}

        {step === "chunk" ? (
          <Text dir={dir} align="center" variant="caption">
            {interpolate(s.hifzSabaqCleanCount, { n: formatNumber(cleanRun, uiLanguage) })}
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
          <Button label={showsCommitment(habitResult) ? s.habitCommitTomorrow : s.flashcardsSummaryDone} onPress={leave} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
