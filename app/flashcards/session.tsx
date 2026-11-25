import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Animated as RNAnimated,
  BackHandler,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, EllipsisVertical, PauseCircle, NotebookPen, Pencil, RotateCcw, Star, Trash2, Trophy, X } from "lucide-react-native";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Rating, State } from "@/lib/fsrs/scheduler";
import type { Grade } from "@/lib/fsrs/scheduler";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { persistReviewTransition, readCurrentCard } from "@/lib/fsrs/persist-review";
import {
  MEANINGS_DECK_ID,
  MUTASHABIHAT_DECK_ID,
  loadReviewQueue,
  deleteStudyCard,
  getNextEligibleReviewDate,
  resetStudyCardProgress,
  setStudyCardBuried,
  setStudyCardDueDate,
  setStudyCardMarked,
  setStudyCardSuspended,
} from "@/lib/fsrs/queries";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { computeUniqueFront, type UniqueFrontContextAyah } from "@/lib/fsrs/uniqueness";
import { addStudyMore, DAILY_SESSION_DECK_ID, loadDailyReviewQueue, readDailySessionDeckIds } from "@/lib/study/daily-queue";
import { DAILY_SESSION_HREF, opensDailySession, type StudyState, type StudyStep } from "@/lib/study/resolve";
import { SessionNextStep, useNextStudyStep } from "@/components/habit/SessionNextStep";
import { useSessionLeaveState } from "@/lib/navigation/entry-route";
import { readMeaningsSettings } from "@/lib/meanings/settings";
import {
  acceptLevelOffer,
  declineLevelOffer,
  loadMeaningsReviewQueue,
  recordFirstReview,
  type LevelOffer,
} from "@/lib/meanings/session";
import type { MeaningLanguage } from "@/lib/meanings/lemma-index";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import type { DeckReviewSettings, StudyCardRow, TestMode, WordTestMode } from "@/lib/fsrs/types";
import { cardStateColor, reviewSideColor, type ReviewSideTone } from "@/lib/fsrs/review-colors";
import { formatLongCardDate, formatShortCardDate } from "@/lib/fsrs/card-dates";
import { TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { surahTransliteration } from "@/lib/search/surah-match";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { getPendingSyncCount } from "@/lib/database/sync-queue";
import { useAuthStore } from "@/lib/auth/store";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { fetchWordMeaningAr, fetchWordText, fetchWordTranslation } from "@/lib/word/queries";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import { DueDateSheet } from "@/components/flashcards/DueDateSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldMessage } from "@/components/ui/Field";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import {
  getSmartCardContent,
  SMART_DECK_IDS,
  type SmartCardKind,
  type SmartDeckRef,
} from "@/lib/fsrs/smart-decks";
import { parseQiraatText } from "@/lib/qiraat/parse";
import { QiraatBlocks } from "@/components/mushaf/QiraatBlocks";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { deleteUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";
import { endReviewSession, startReviewSession, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import { useActiveClock } from "@/lib/habit/use-active-clock";
import {
  SessionHabitCards,
  showsCommitment,
  useCommitmentLabel,
  strongerWirdEvent,
  type SessionHabitInput,
} from "@/components/habit/SessionHabitCards";
import { Toast } from "@/components/ui/Toast";
import { getGradeSchedulePreviews, GradingButtons } from "@/components/flashcards/GradingButtons";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { formatAyahs, formatDays, formatNumber } from "@/lib/i18n/count";
import { formatAyahRef } from "@/lib/arabic";

/** Focused controls keep Space/Enter for themselves; review shortcuts skip them. */
const FOCUSED_CONTROL_SELECTOR = ["button", "a", ...["button", "link", "menuitem", "switch", "checkbox", "radio", "tab"].map(
  (name) => `[role="${name}"]`,
)].join(", ");

// ─── Types ───────────────────────────────────────────────────

type SessionPhase = "loading" | "error" | "front" | "side" | "grading" | "summary";

type CardData = {
  kind: "ayah" | "word" | SmartCardKind;
  card: StudyCardRow;
  /** The review settings of the card's own deck, also in Review all. */
  settings: DeckReviewSettings;
  surah: number;
  ayah: number;
  wordPos?: number;
  isWordCard?: boolean;
  wordText?: string;
  wordMeaningAr?: string;
  wordMeaningEn?: string;
  customAnswers?: Partial<Record<ReviewMode, string>>;
  surahName: string;
  textUthmani: string;
  textQcf2?: string;
  v2Page?: number;
  uniqueFront: {
    text: string;
    context: UniqueFrontContextAyah[];
    surahName: string;
    contextCount: number;
    needsExplicitLabel: boolean;
  };
  translation: string;
  tafseer: string;
  prevAyahText: string | null;
  prevAyahQcf2?: string | null;
  prevV2Page?: number | null;
  nextAyahText: string | null;
  nextAyahQcf2?: string | null;
  nextV2Page?: number | null;
  smartDeckTitle?: string;
  smartTargetRef?: SmartDeckRef;
  smartCue?: string;
  smartRefs?: SmartDeckRef[];
  smartPromptContextQcf2?: string;
  smartPromptContextUthmani?: string;
  smartPromptContextV2Page?: number;
  smartPromptQcf2?: string;
  smartPromptUthmani?: string;
  smartHiddenAnswerQcf2?: string;
  smartHiddenAnswerUthmani?: string;
  smartNeedsExplicitRefLabel?: boolean;
  qiraatText?: string;
  qiraatGroup?: string[];
  asbabOccasions?: string[];
  asbabGroup?: string[];
  asbabSource?: string;
};

type SessionSummary = {
  /** The queue was empty when the session opened: there was nothing to review. */
  emptyQueue?: boolean;
  total: number;
  newCount: number;
  reviewCount: number;
  relearningCount: number;
  durationMs: number;
  nextReviewDate: string | null;
  habit: SessionHabitInput;
};

/** What follows a saved grade or card action. The change is committed by then, so neither part can report it unsaved. */
type SavedChange = {
  /** Bookkeeping for the saved change. It runs even when a held leave goes ahead. */
  record?: () => void;
  /** Show what follows: the next card, the updated card or the summary. A held leave skips it. */
  advance: () => Promise<void> | void;
};

const NO_HABIT_RESULT: SessionHabitInput = { event: null, overview: null, againCount: 0, total: 0, durationMs: 0 };

function emptySummary(): SessionSummary {
  return { total: 0, newCount: 0, reviewCount: 0, relearningCount: 0, durationMs: 0, nextReviewDate: null, habit: NO_HABIT_RESULT };
}

type SmartTestMode = "smartRefs" | "qiraatReading" | "asbabReading";
type ReviewMode = TestMode | WordTestMode | SmartTestMode;
/** Each side's semantic tone; the colors per theme come from review-colors. */
const REVIEW_MODE_TONES: Record<ReviewMode, ReviewSideTone> = {
  nextAyah: "blue",
  previousAyah: "violet",
  translation: "teal",
  tafseer: "amber",
  surahName: "rose",
  wordMeaningArabic: "teal",
  wordMeaningTranslation: "blue",
  smartRefs: "teal",
  qiraatReading: "violet",
  asbabReading: "amber",
};
const GRADE_KEYS: Record<string, Grade> = {
  "1": Rating.Again,
  "2": Rating.Hard,
  "3": Rating.Good,
  "4": Rating.Easy,
  "١": Rating.Again,
  "٢": Rating.Hard,
  "٣": Rating.Good,
  "٤": Rating.Easy,
};
const CARD_ANSWER_SETTING_PREFIX = "card_answer_";
/** The Arabic reading face on web; native keeps the system Arabic face rather than the Latin UI font. */
const ARABIC_READING_FONT = Platform.OS === "web" ? "IBMPlexSansArabic, NotoSansArabic, system-ui" : undefined;
const EDITABLE_ANSWER_MODES: ReviewMode[] = [
  "previousAyah",
  "nextAyah",
  "translation",
  "tafseer",
  "surahName",
  "wordMeaningArabic",
  "wordMeaningTranslation",
  "smartRefs",
  "qiraatReading",
  "asbabReading",
];

// ─── Main Component ──────────────────────────────────────────

/** Session cards are loaded as live rows, so an action must not recreate or revive a deleted one. */
const LIVE_CARD = { requireLive: true } as const;

export default function FlashcardSessionScreenWrapper() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();

  if (error) {
    return <DatabaseErrorState title={s.databaseError} message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return <FlashcardSessionScreen />;
}

function FlashcardSessionScreen() {
  const db = useDatabase();
  const { isDark, isRTL, fontSize, lineHeight, tafseerSource, themeSurface, uiLanguage, isLoaded: settingsLoaded } = useSettings();
  const s = useStrings();
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;
  const navigation = useNavigation();
  const openMushaf = useOpenMushaf();
  const reduceMotion = useReducedMotionPreference();
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  // SPEC 3.2: `scope=daily`, or no deck at all, is today's daily study; `deckId` is one deck from All decks.
  const { deckId, scope } = useLocalSearchParams<{ deckId?: string; scope?: string }>();
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width, 600);

  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [cards, setCards] = useState<CardData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCardTotal, setSessionCardTotal] = useState(0);
  const [currentSideIndex, setCurrentSideIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // W03 note entry point: the card back offers Add note for the ayah under review.
  const [noteOpen, setNoteOpen] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  // Read again once the session ends, so a finished review is reflected (STR-20, REMIND-07).
  const commitLabel = useCommitmentLabel(db, s, uiLanguage, summary?.habit ?? null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  /** The queue could not load: an error with Try again, never an empty completion. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** The grade whose save failed, repeated as is by Try again. */
  const [failedGrade, setFailedGrade] = useState<Grade | null>(null);
  /** A short confirmation such as "Card moved to 19 Nov". */
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  /** The rendered copy of mutationLockRef: grades, card actions and the card menu are disabled while it is held. */
  const [mutationBusy, setMutationBusy] = useState(false);
  /** A card action (not a grade) is saving: only then does the card menu dim, so it does not blink on every grade. */
  const [cardActionBusy, setCardActionBusy] = useState(false);
  // Session and card times count only while the session is on screen with the app active.
  const sessionClock = useActiveClock();
  // The review session row is written on the first grade, so an empty session leaves nothing behind.
  const sessionRef = useRef<ReviewSessionRef | null>(null);
  const cardClock = useActiveClock();
  const wirdEventRef = useRef<SessionHabitInput["event"]>(null);
  const againCountRef = useRef(0);
  const [wirdNotice, setWirdNotice] = useState<string | null>(null);
  /** SPEC 3.4: Retention opened alone under a plan that reviews by page does not count toward the streak. */
  const [retentionNotCounted, setRetentionNotCounted] = useState(false);
  /** SPEC 3.6: word cards answer in the meaning language while the deck keeps its default answer sides. */
  const [meaningLanguage, setMeaningLanguage] = useState<MeaningLanguage | null>(null);
  /** "I know this" was pressed for the card being graded, so its Easy grade counts as known. */
  const knownPressRef = useRef(false);
  /** A level offer earned by first reviews of new word cards, shown as a dialog. */
  const [levelOffer, setLevelOffer] = useState<LevelOffer | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const reviewedCountsRef = useRef({ total: 0, newCount: 0, reviewCount: 0, relearningCount: 0 });
  // A learning card can come back several times in one session; the summary counts each card once, by
  // the state it had when first graded, so "cards reviewed" is not the number of grades.
  const reviewedCardIdsRef = useRef(new Set<string>());
  /** The rendered copy of a non-empty reviewedCardIdsRef, so the remove guard below updates with it. */
  const [hasReviewed, setHasReviewed] = useState(false);
  /**
   * One lock for every change to the current card, a grade or a card action, taken synchronously on the
   * press. Two changes that each advance from the same card would otherwise skip a card or step past the list.
   */
  const mutationLockRef = useRef(false);
  /**
   * Close, a back press or a gesture came while a grade or card action was unresolved. The screen leaves
   * once it is saved, or stays on the card to show a failed save, which would otherwise reach a departed screen.
   */
  const leaveWhenSettledRef = useRef(false);
  /** Set once the screen leaves on purpose, so the remove guard below lets that navigation through. */
  const exitingRef = useRef(false);
  /** A back press or gesture held for the leave confirmation or a grade; leaving carries it out. */
  const pendingBackRef = useRef<NavigationAction | null>(null);
  /** The rendered copy of leaveWhenSettledRef, so Close shows that its press is waiting for the change. */
  const [leavePending, setLeavePending] = useState(false);
  const flipAnim = useRef(new RNAnimated.Value(0)).current;
  const normalizedDeckId = Array.isArray(deckId) ? deckId[0] : deckId;
  const normalizedScope = Array.isArray(scope) ? scope[0] : scope;
  const dailyScope = normalizedScope === "daily" || !normalizedDeckId;
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const [confirmCardAction, setConfirmCardAction] = useState<"delete" | "reset" | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateText, setDueDateText] = useState("");
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [answerEditOpen, setAnswerEditOpen] = useState(false);
  const [answerEditMode, setAnswerEditMode] = useState<ReviewMode | null>(null);
  const [answerEditText, setAnswerEditText] = useState("");

  const resetSessionProgress = useCallback(() => {
    mutationLockRef.current = false;
    setMutationBusy(false);
    setSessionError(null);
    setLoadError(null);
    setFailedGrade(null);
    wirdEventRef.current = null;
    againCountRef.current = 0;
    setWirdNotice(null);
    setExitConfirmOpen(false);
    reviewedCountsRef.current = { total: 0, newCount: 0, reviewCount: 0, relearningCount: 0 };
    reviewedCardIdsRef.current = new Set();
    setHasReviewed(false);
    setCards([]);
    setSessionCardTotal(0);
    setCurrentIndex(0);
    setCurrentSideIndex(0);
    setRevealed(false);
    setCardMenuOpen(false);
    setConfirmCardAction(null);
    setDueDateOpen(false);
    setDueDateError(null);
    setAnswerEditOpen(false);
    setAnswerEditMode(null);
    setAnswerEditText("");
  }, []);

  // Load due cards and pre-fetch all card data
  useEffect(() => {
    if (!settingsLoaded) return;

    let cancelled = false;

    async function load() {
      // A reload in place (Continue, Study more, or new params on this screen) is a new session that
      // the remove guard covers again.
      exitingRef.current = false;
      resetSessionProgress();
      setSummary(null);
      setPhase("loading");
      try {
        sessionRef.current = startReviewSession("cards", { deckId: dailyScope ? DAILY_SESSION_DECK_ID : normalizedDeckId ?? null });
        const queue = dailyScope
          ? await loadDailyReviewQueue(db)
          : normalizedDeckId === MEANINGS_DECK_ID
            ? await loadMeaningsReviewQueue(db)
            : await loadReviewQueue(db, normalizedDeckId);
        // A settings read that fails leaves word cards on their deck's answer sides.
        const language = await readMeaningsSettings(db).then(
          (settings) => settings.language,
          () => null,
        );
        if (cancelled) return;
        setMeaningLanguage(language);
        if (cancelled) return;
        if (queue.length === 0) {
          // Nothing to review: say when the next card is due instead of a summary of zeros.
          const sessionDecks = dailyScope ? await readDailySessionDeckIds(db).catch(() => undefined) : [normalizedDeckId!];
          const nextReviewDate = await getNextEligibleReviewDate(db, sessionDecks).catch(() => null);
          if (cancelled) return;
          resetSessionProgress();
          setSummary({ ...emptySummary(), emptyQueue: true, nextReviewDate });
          setPhase("summary");
          return;
        }

        const loaded: CardData[] = [];
        for (const { card: row, settings } of queue) {
          if (cancelled) return;
          const smartContent = await getSmartCardContent(db, row.id);
          if (smartContent?.targetRef) {
            const targetRef = smartContent.targetRef;
            loaded.push({
              kind: smartContent.kind,
              card: row,
              settings,
              surah: targetRef.surah,
              ayah: targetRef.ayah,
              surahName: targetRef.surahNameAr,
              textUthmani: targetRef.textUthmani,
              textQcf2: targetRef.textQcf2,
              v2Page: targetRef.v2Page,
              uniqueFront: {
                text: smartContent.promptUthmani ?? smartContent.cue,
                context: [],
                surahName: targetRef.surahNameAr,
                contextCount: 0,
                needsExplicitLabel: true,
              },
              translation: "",
              tafseer: "",
              prevAyahText: null,
              nextAyahText: null,
              smartDeckTitle: getSmartDeckTitleForKind(smartContent.kind, s),
              smartTargetRef: targetRef,
              smartCue: smartContent.cue,
              smartRefs: smartContent.refs,
              smartPromptContextQcf2: smartContent.promptContextQcf2,
              smartPromptContextUthmani: smartContent.promptContextUthmani,
              smartPromptContextV2Page: smartContent.promptContextV2Page,
              smartPromptQcf2: smartContent.promptQcf2,
              smartPromptUthmani: smartContent.promptUthmani,
              smartHiddenAnswerQcf2: smartContent.hiddenAnswerQcf2,
              smartHiddenAnswerUthmani: smartContent.hiddenAnswerUthmani,
              smartNeedsExplicitRefLabel: smartContent.needsExplicitRefLabel,
              qiraatText: smartContent.qiraatText,
              qiraatGroup: smartContent.qiraatGroup,
              asbabOccasions: smartContent.asbabOccasions,
              asbabGroup: smartContent.asbabGroup,
              asbabSource: smartContent.asbabSource,
            });
            continue;
          }

          const parts = row.id.split(":");
          const isWordCard = parts[0] === "word" && parts.length >= 4;
          const isMutashabihatCard = parts[0] === MUTASHABIHAT_DECK_ID && parts.length >= 3;
          const surah = parseInt(isWordCard || isMutashabihatCard ? parts[1] : parts[0], 10);
          const ayah = parseInt(isWordCard ? parts[2] : isMutashabihatCard ? parts[2] : parts[1], 10);
          const wordPos = isWordCard ? parseInt(parts[3]) : undefined;
          if (!Number.isFinite(surah) || !Number.isFinite(ayah)) continue;

          const [
            ayahRow,
            surahRow,
            translationRow,
            tafseerRow,
            prevRow,
            nextRow,
            uniqueFront,
            wordMeaningArRow,
            canonicalWordText,
            wordTranslation,
          ] = await Promise.all([
            db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
              "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
              [surah, ayah]
            ),
            db.getFirstAsync<{ name_arabic: string }>(
              "SELECT name_arabic FROM surahs WHERE number = ?",
              [surah]
            ),
            db.getFirstAsync<{ text_en: string }>(
              "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
              [surah, ayah]
            ),
            db.getFirstAsync<{ text: string }>(
              "SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = ?",
              [surah, ayah, tafseerSource]
            ),
            ayah > 1
              ? db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
                  "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
                  [surah, ayah - 1]
                )
              : null,
            db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
              "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
              [surah, ayah + 1]
            ),
            computeUniqueFront(db, surah, ayah),
            isWordCard && wordPos ? fetchWordMeaningAr(db, surah, ayah, wordPos) : Promise.resolve(null),
            isWordCard && wordPos ? fetchWordText(db, surah, ayah, wordPos) : Promise.resolve(null),
            isWordCard && wordPos ? fetchWordTranslation(db, surah, ayah, wordPos) : Promise.resolve(null),
          ]);
          if (cancelled) return;

          const wordMeaningAr = isWordCard && wordPos
            ? (wordMeaningArRow?.meaning?.trim() || s.noWordMeaningFallback)
            : null;
          const wordText = isWordCard && wordPos
            ? (canonicalWordText ?? wordTranslation?.word_arabic ?? null)
            : null;
          const wordMeaningEn = isWordCard ? (wordTranslation?.translation_en ?? null) : null;
          const frontText = isWordCard ? (wordText ?? uniqueFront.text) : uniqueFront.text;
          const customAnswers = await readCardAnswerOverrides(db, row.id);
          if (cancelled) return;

          loaded.push({
            kind: isWordCard ? "word" : "ayah",
            card: row,
            settings,
            surah,
            ayah,
            wordPos,
            isWordCard,
            wordText: wordText ?? undefined,
            wordMeaningAr: wordMeaningAr ?? undefined,
            wordMeaningEn: wordMeaningEn ?? undefined,
            customAnswers,
            surahName: surahRow?.name_arabic ?? "",
            textUthmani: ayahRow?.text_uthmani ?? "",
            textQcf2: ayahRow?.text_qcf2,
            v2Page: ayahRow?.v2_page,
            uniqueFront: { ...uniqueFront, text: frontText },
            translation: translationRow?.text_en ?? "",
            tafseer: tafseerRow?.text ?? "",
            prevAyahText: prevRow?.text_uthmani ?? null,
            prevAyahQcf2: prevRow?.text_qcf2 ?? null,
            prevV2Page: prevRow?.v2_page ?? null,
            nextAyahText: nextRow?.text_uthmani ?? null,
            nextAyahQcf2: nextRow?.text_qcf2 ?? null,
            nextV2Page: nextRow?.v2_page ?? null,
          });
        }
        if (cancelled) return;
        if (loaded.length === 0) {
          resetSessionProgress();
          setSummary(emptySummary());
          setPhase("summary");
          return;
        }

        // The note is a courtesy: a settings read that fails leaves it out rather than failing the session.
        const notCounted =
          !dailyScope &&
          normalizedDeckId === SMART_DECK_IDS.retention &&
          (await readHabitSettings(db).then(
            (settings) => !settings.retentionCounts,
            () => false,
          ));
        if (cancelled) return;
        setRetentionNotCounted(notCounted);
        sessionClock.reset();
        setCurrentIndex(0);
        setSessionCardTotal(loaded.length);
        setCurrentSideIndex(0);
        setRevealed(false);
        setCards(loaded);
        setPhase("front");
      } catch (e) {
        if (cancelled) return;
        console.warn("[FlashcardSession] Failed to load session:", e);
        resetSessionProgress();
        // A failed load is an error with Try again, never a completed session.
        setLoadError(s.sessionLoadFailed);
        setPhase("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [
    db,
    normalizedDeckId,
    dailyScope,
    tafseerSource,
    settingsLoaded,
    resetSessionProgress,
    sessionClock,
    s.smartDeckMutashabihatTitle,
    s.smartDeckSimilarTailsTitle,
    s.smartDeckQiraatTitle,
    s.smartDeckReasonsTitle,
    s.sessionLoadFailed,
    s.noWordMeaningFallback,
    loadAttempt,
  ]);

  const currentCard = cards[currentIndex] ?? null;
  // Time on a card runs from when its front is shown to its grade (study_log.duration_ms), counting
  // only while it is on screen. A card removed unrevealed (buried, suspended) leaves the index where
  // it was, so the next card's id starts its own time too.
  const currentCardId = currentCard?.card.id ?? null;
  useEffect(() => {
    if (phase === "front") cardClock.reset();
  }, [cardClock, phase, currentIndex, currentCardId]);
  const gradePreviews = useMemo(
    () => currentCard ? getGradeSchedulePreviews(currentCard.card, currentCard.settings, isRTL) : {},
    [currentCard, isRTL]
  );
  const activeModes = useMemo<ReviewMode[]>(() => {
    if (!currentCard) return [] as ReviewMode[];
    if (currentCard.kind === "mutashabihat" || currentCard.kind === "similarTail") {
      return ["smartRefs"];
    }
    if (currentCard.kind === "qiraat") {
      return currentCard.qiraatText ? ["qiraatReading"] : [];
    }
    if (currentCard.kind === "asbab") {
      return currentCard.asbabOccasions?.length ? ["asbabReading"] : [];
    }
    if (currentCard.isWordCard) {
      const available = (mode: WordTestMode) =>
        !!getCardAnswerOverride(currentCard, mode) ||
        (mode === "wordMeaningArabic" ? !!currentCard.wordMeaningAr : !!currentCard.wordMeaningEn);
      const deckModes = currentCard.settings.wordTestModes;
      // SPEC 3.6: with the deck's default answer sides (both), a word card answers in the meaning
      // language only, falling back to the other side when that meaning is missing. Sides the user
      // chose in the deck settings are kept.
      if (meaningLanguage && deckModes.length === 2) {
        const preferred: WordTestMode = meaningLanguage === "ar" ? "wordMeaningArabic" : "wordMeaningTranslation";
        if (available(preferred)) return [preferred];
      }
      return deckModes.filter(available);
    }
    return currentCard.settings.testModes.filter((mode) => {
      if (mode === "previousAyah" && (!currentCard.prevAyahText || currentCard.uniqueFront.contextCount > 0) && !getCardAnswerOverride(currentCard, mode)) return false;
      if (mode === "nextAyah" && !currentCard.nextAyahText && !getCardAnswerOverride(currentCard, mode)) return false;
      if (mode === "translation" && !currentCard.translation && !getCardAnswerOverride(currentCard, mode)) return false;
      if (mode === "tafseer" && !currentCard.tafseer && !getCardAnswerOverride(currentCard, mode)) return false;
      return true;
    });
  }, [currentCard, meaningLanguage]);

  const currentMode = activeModes[currentSideIndex] ?? null;
  const isLastSide = currentSideIndex >= activeModes.length - 1;

  const animateFlip = useCallback(() => {
    // With reduced motion the answer shows at once, without the spring.
    if (reduceMotion) {
      flipAnim.setValue(1);
      return;
    }
    flipAnim.setValue(0);
    RNAnimated.spring(flipAnim, {
      toValue: 1,
      damping: 15,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  }, [flipAnim, reduceMotion]);

  const revealFirstSide = () => {
    if (activeModes.length === 0) {
      setPhase("grading");
      return;
    }
    setCurrentSideIndex(0);
    setRevealed(true);
    setPhase("side");
    animateFlip();
  };

  const handleNext = () => {
    setCurrentSideIndex((i) => i + 1);
    setRevealed(true);
    animateFlip();
  };

  /**
   * The summary follows saved grades, so it must not fail: a part that cannot be loaded is left out.
   * A failure here once reported the last, already saved, grade as unsaved and offered it again.
   */
  const buildSummary = useCallback(async (): Promise<SessionSummary> => {
    const session = sessionRef.current;
    const [nextReviewDate, overview] = await Promise.all([
      (dailyScope ? readDailySessionDeckIds(db) : Promise.resolve([normalizedDeckId!]))
        .then((decks) => getNextEligibleReviewDate(db, decks))
        .catch((error) => {
          console.warn("[FlashcardSession] Next review date failed:", error);
          return null;
        }),
      loadHabitOverview(db).catch((error) => {
        console.warn("[FlashcardSession] Habit overview failed:", error);
        return null;
      }),
      session ? endReviewSession(db, { session }).catch((error) => console.warn("[FlashcardSession] Session end failed:", error)) : null,
    ]);
    const counts = reviewedCountsRef.current;
    const durationMs = sessionClock.elapsedMs();
    return {
      total: counts.total,
      newCount: counts.newCount,
      reviewCount: counts.reviewCount,
      relearningCount: counts.relearningCount,
      durationMs,
      nextReviewDate,
      habit: { event: wirdEventRef.current, overview, againCount: againCountRef.current, total: counts.total, durationMs },
    };
  }, [db, sessionClock, dailyScope, normalizedDeckId]);

  const finishSessionWithSummary = useCallback(async () => {
    setSummary(await buildSummary());
    setPhase("summary");
  }, [buildSummary]);

  const advanceAfterRemovingCurrentCard = useCallback(async () => {
    setSessionError(null);
    // Graded cards stay in the list before currentIndex, so removing the last card ends the session
    // instead of stepping back onto a card that was already reviewed. The card stays in the list
    // until the summary replaces it, so the index never points past the list meanwhile.
    if (currentIndex >= cards.length - 1) {
      await finishSessionWithSummary();
      return;
    }
    setCurrentSideIndex(0);
    setRevealed(false);
    setCards((prev) => prev.filter((_, index) => index !== currentIndex));
    setPhase("front");
  }, [cards.length, currentIndex, finishSessionWithSummary]);

  const updateCurrentCardRow = useCallback((updatedRow: StudyCardRow) => {
    setCards((prev) => prev.map((item, index) => (
      index === currentIndex ? { ...item, card: updatedRow } : item
    )));
  }, [currentIndex]);

  const recordReviewedCard = useCallback((cardId: string, state: number) => {
    if (reviewedCardIdsRef.current.has(cardId)) return;
    reviewedCardIdsRef.current.add(cardId);
    setHasReviewed(true);
    const next = { ...reviewedCountsRef.current, total: reviewedCountsRef.current.total + 1 };
    if (state === State.New) next.newCount += 1;
    else if (state === State.Relearning) next.relearningCount += 1;
    else next.reviewCount += 1;
    reviewedCountsRef.current = next;
  }, []);

  /** The current card was deleted elsewhere after the session loaded it: move past it and say so. */
  const skipDeletedCurrentCard = useCallback(async () => {
    setConfirmCardAction(null);
    setDueDateOpen(false);
    await advanceAfterRemovingCurrentCard();
    // Set after advancing, which clears the error; the summary also shows it when this was the last card.
    setSessionError(s.cardDeletedSkipped);
  }, [advanceAfterRemovingCurrentCard, s.cardDeletedSkipped]);

  /**
   * Run one change to the current card, a grade or a card action, under mutationLockRef. Only a failed
   * `save` is reported, and it keeps the card open for a retry. Once `save` resolves the change is
   * committed and the card consumed, so what follows (bookkeeping, the next card or the summary) can
   * neither present it as unsaved nor offer it again. Close or a back press during the change waits
   * for it: the screen leaves once it is saved, or stays to show its failure.
   */
  const runCardMutation = async (
    failureLog: string,
    failureMessage: string,
    save: () => Promise<SavedChange>,
    onFailure?: () => void,
  ) => {
    if (mutationLockRef.current || !currentCard) return;
    mutationLockRef.current = true;
    setMutationBusy(true);
    setSessionError(null);
    setFailedGrade(null);
    try {
      let change: SavedChange;
      try {
        change = await save();
      } catch (e) {
        console.warn(failureLog, e);
        // The held leave is dropped: the card stays open with its error, and a retry does not leave.
        leaveWhenSettledRef.current = false;
        pendingBackRef.current = null;
        setLeavePending(false);
        if (e instanceof StudyCardDeletedError) await skipDeletedCurrentCard();
        else {
          setSessionError(failureMessage);
          onFailure?.();
        }
        return;
      }
      try {
        change.record?.();
      } catch (e) {
        console.warn("[FlashcardSession] Failed to record a saved change:", e);
      }
      // A leave held for this change goes ahead now that it is saved, without showing the next card.
      if (!leaveWhenSettledRef.current) await change.advance();
      // Also covers a leave that came while the summary was being prepared.
      if (leaveWhenSettledRef.current) {
        leaveWhenSettledRef.current = false;
        leaveSession();
      }
    } finally {
      mutationLockRef.current = false;
      setMutationBusy(false);
    }
  };

  const runCardAction = async (save: () => Promise<SavedChange>) => {
    // A refused second press must not clear the dim of the action still saving.
    if (mutationLockRef.current) return;
    setCardActionBusy(true);
    try {
      await runCardMutation("[FlashcardSession] Card action failed:", s.cardActionFailed, save);
    } finally {
      setCardActionBusy(false);
    }
  };

  // Direct actions keep the sheet open until they are saved, so a failure shows above its rows.
  const handleSuspendCard = () => {
    if (!currentCard) return;
    const { card } = currentCard;
    void runCardAction(async () => {
      hapticMedium();
      await setStudyCardSuspended(db, card.deck_id, card.id, true, LIVE_CARD);
      return {
        advance: async () => {
          setCardMenuOpen(false);
          await advanceAfterRemovingCurrentCard();
        },
      };
    });
  };

  const handleBuryCard = () => {
    if (!currentCard) return;
    const { card } = currentCard;
    void runCardAction(async () => {
      hapticMedium();
      // Buried until the scheduler's next-day cutoff, as setStudyCardBuried defines it.
      await setStudyCardBuried(db, card.deck_id, card.id, true, LIVE_CARD);
      return {
        advance: async () => {
          setCardMenuOpen(false);
          await advanceAfterRemovingCurrentCard();
        },
      };
    });
  };

  const handleToggleMarkCard = () => {
    if (!currentCard) return;
    const { card } = currentCard;
    void runCardAction(async () => {
      hapticMedium();
      const updated = await setStudyCardMarked(db, card.deck_id, card.id, !card.marked_at, LIVE_CARD);
      return {
        advance: () => {
          setCardMenuOpen(false);
          updateCurrentCardRow(updated);
        },
      };
    });
  };

  /** Opens the Mushaf at this card's ayah. Every grade is already saved, so the session ends here. */
  const handleOpenInReader = () => {
    if (!currentCard || mutationLockRef.current) return;
    const target = { surah: currentCard.surah, ayah: currentCard.ayah, ...(currentCard.wordPos ? { wordPos: currentCard.wordPos } : {}) };
    setCardMenuOpen(false);
    exitingRef.current = true;
    const session = sessionRef.current;
    if (session && phase !== "summary") endReviewSession(db, { session }).catch(console.warn);
    openMushaf(target);
  };

  const handleConfirmCardAction = () => {
    if (!currentCard || !confirmCardAction) return;
    const { card } = currentCard;
    const action = confirmCardAction;
    void runCardAction(async () => {
      hapticMedium();
      if (action === "delete") {
        await deleteStudyCard(db, card.deck_id, card.id);
        return {
          advance: async () => {
            setConfirmCardAction(null);
            await advanceAfterRemovingCurrentCard();
          },
        };
      }
      const updated = await resetStudyCardProgress(db, card.deck_id, card.id, LIVE_CARD);
      return {
        advance: () => {
          updateCurrentCardRow(updated);
          setCurrentSideIndex(0);
          setRevealed(false);
          setPhase("front");
          setConfirmCardAction(null);
        },
      };
    });
  };

  const openDueDateSheet = useCallback(() => {
    if (!currentCard) return;
    setCardMenuOpen(false);
    setDueDateText(formatLocalDateInput(new Date(currentCard.card.due)));
    setDueDateError(null);
    setSessionError(null);
    setDueDateOpen(true);
  }, [currentCard]);

  const handleSaveDueDate = () => {
    if (!currentCard) return;
    const { card } = currentCard;
    const parsed = parseDueDateInput(dueDateText);
    if (!parsed.ok) {
      setDueDateError(parsed.reason === "past" ? s.cardDueDatePast : s.cardDueDateInvalid);
      return;
    }
    setDueDateError(null);
    void runCardAction(async () => {
      hapticMedium();
      await setStudyCardDueDate(db, card.deck_id, card.id, parsed.date, LIVE_CARD);
      return {
        record: () => setActionNotice(interpolate(s.sessionCardMoved, { date: formatShortCardDate(parsed.date, uiLanguage) })),
        advance: async () => {
          setDueDateOpen(false);
          setDueDateError(null);
          await advanceAfterRemovingCurrentCard();
        },
      };
    });
  };

  const openAnswerEditSheet = useCallback(() => {
    if (!currentCard) return;
    const mode = currentMode ?? activeModes[currentSideIndex] ?? activeModes[0] ?? null;
    if (!mode) return;
    setSessionError(null);
    setCardMenuOpen(false);
    setAnswerEditMode(mode);
    setAnswerEditText(getCardAnswerOverride(currentCard, mode) ?? getDefaultAnswerText(currentCard, mode, s));
    setAnswerEditOpen(true);
  }, [activeModes, currentCard, currentMode, currentSideIndex, s]);

  const handleSaveAnswerEdit = () => {
    if (!currentCard || !answerEditMode) return;
    const mode = answerEditMode;
    const value = answerEditText.trim();
    const key = cardAnswerSettingKey(currentCard.card.id, mode);
    void runCardAction(async () => {
      if (value.length > 0) {
        await writeUserSetting(db, key, value);
      } else {
        await deleteUserSetting(db, key);
      }
      return {
        advance: () => {
          setCards((prev) => prev.map((item, index) => {
            if (index !== currentIndex) return item;
            const customAnswers = { ...(item.customAnswers ?? {}) };
            if (value.length > 0) customAnswers[mode] = value;
            else delete customAnswers[mode];
            return { ...item, customAnswers };
          }));
          setAnswerEditOpen(false);
          setAnswerEditMode(null);
          setAnswerEditText("");
        },
      };
    });
  };

  const leaveSession = () => {
    exitingRef.current = true;
    const session = sessionRef.current;
    if (session && phase !== "summary") endReviewSession(db, { session }).catch(console.warn);
    // A held back press goes where it was going; Close returns to the tabs.
    const back = pendingBackRef.current;
    pendingBackRef.current = null;
    resetSessionProgress();
    setSummary(null);
    setPhase("loading");
    if (back) navigation.dispatch(back);
    else returnToTabs(navigation.getState(), "/(tabs)/home");
  };

  /** Leave now, or once the grade or card action being saved settles (see leaveWhenSettledRef). */
  const leave = () => {
    if (mutationLockRef.current) {
      leaveWhenSettledRef.current = true;
      setLeavePending(true);
    } else leaveSession();
  };

  /** A saved grade would be left behind mid-session. Read from the ref, which a saved grade updates at once. */
  const hasReviewedProgress = () => phase !== "summary" && reviewedCardIdsRef.current.size > 0;

  const handleGrade = (rating: Grade) => {
    const item = currentCard;
    if (!item) return;
    // "I know this" grades Easy; any other grade path is not a known word.
    const knownPressed = knownPressRef.current;
    knownPressRef.current = false;
    void runCardMutation("[FlashcardSession] Failed to grade card:", s.flashcardsReviewSaveFailed, async () => {
      hapticMedium();
      const firstGrade = !reviewedCardIdsRef.current.has(item.card.id);
      const reviewedAt = new Date();
      const saved = await persistReviewTransition({
        db,
        cardId: item.card.id,
        // The queued row can be older than the card: sync may have applied another device's review
        // since the queue loaded. Calculate from the card as it is inside the grade's transaction.
        transition: async (tx) =>
          calculateReviewTransition({
            card: (await readCurrentCard(tx, item.card.id)) ?? item.card,
            rating,
            reviewedAt,
            reviewPolicy: item.settings,
          }),
        context: {
          session: sessionRef.current,
          firstGradeInSession: !reviewedCardIdsRef.current.has(item.card.id),
          durationMs: cardClock.elapsedMs(reviewedAt.getTime()),
          supportLevel: null,
          proposedRating: null,
          grader: "self",
          errors: [],
        },
      });
      // The grade is saved. The same-day requeue carries the row that was saved, not one calculated
      // from the queued copy.
      const { transition } = saved;
      const requeuedCard = transition.shouldRequeueInSession ? { ...item, card: transition.updatedCard } : null;
      return {
        record: () => {
          recordReviewedCard(item.card.id, item.card.state);
          if (rating === Rating.Again) againCountRef.current += 1;
          wirdEventRef.current = strongerWirdEvent(wirdEventRef.current, saved.wird);
          if (saved.wird.kind === "minimum_met") setWirdNotice(s.habitMinimumMet);
          else if (saved.wird.kind === "made_up") {
            setWirdNotice(interpolate(s.habitMadeUp, { n: formatNumber(saved.wird.length, uiLanguage), days: formatDays(saved.wird.length, uiLanguage) }));
          } else if (saved.wird.kind === "earned_back") {
            setWirdNotice(interpolate(s.habitEarnedBack, { days: formatDays(saved.wird.length, uiLanguage) }));
          }
          // SPEC 3.6: a new word card's first review moves the runs that offer a level change.
          if (item.isWordCard && item.card.state === State.New && firstGrade) {
            const outcome = knownPressed && rating === Rating.Easy ? "known" : rating === Rating.Again ? "failed" : "other";
            recordFirstReview(db, outcome)
              .then((offer) => {
                if (offer) setLevelOffer(offer);
              })
              .catch((error: unknown) => console.warn("[FlashcardSession] Could not record a first word review:", error));
          }
          if (item.card.id.startsWith("mutashabihat:") || item.card.id.startsWith("similar-tail:")) {
            recordAchievementEvent(db, {
              type: "mutashabih_pair_reviewed",
              pairId: item.card.id,
              reviewedAt: transition.reviewRecord.reviewedAt,
            }).catch(console.warn);
          }
        },
        advance: async () => {
          if (requeuedCard) setCards((prev) => [...prev, requeuedCard]);
          if (currentIndex < cards.length - 1 || requeuedCard) {
            setCurrentIndex((i) => i + 1);
            setCurrentSideIndex(0);
            setRevealed(false);
            setPhase("front");
          } else {
            await finishSessionWithSummary();
            hapticSuccess();
          }
        },
      };
    }, () => setFailedGrade(rating));
  };

  // SPEC 3.1: the end screen asks the resolver what comes next.
  const nextStep = useNextStudyStep(db, phase === "summary");

  /** Continue: the daily session reloads in place; any other step replaces this screen, so Back lands on Home. */
  const continueTo = (step: Exclude<StudyStep, { kind: "home" }>) => {
    if (dailyScope && opensDailySession(step)) {
      setLoadAttempt((n) => n + 1);
      return;
    }
    exitingRef.current = true;
    router.replace(step.href);
  };

  /** Study more: one more budget for today, then the daily cards it opened. */
  const studyMore = async () => {
    await addStudyMore(db);
    if (dailyScope) setLoadAttempt((n) => n + 1);
    else {
      exitingRef.current = true;
      router.replace(DAILY_SESSION_HREF);
    }
  };

  // SES-02: leaving mid-session asks once. Every grade is already saved, so this only confirms.
  const handleEndSession = () => {
    if (hasReviewedProgress()) {
      setExitConfirmOpen(true);
      return;
    }
    leave();
  };

  // Leaving by any route that ends the screen without leaveSession still ends the session.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session) endReviewSession(db, { session }).catch(console.warn);
    },
    [db],
  );

  // Back presses, gestures and the iOS swipe behave like Close: with saved grades they ask first, and
  // during an unresolved grade or card action they wait for it. usePreventRemove, unlike a bare
  // beforeRemove listener, also tells native-stack to block the native dismissal. `mutationBusy` is the
  // rendered copy of the lock.
  // SPEC 3.9: a widget or notification tap keeps this screen while its guard holds, and may replace
  // it once the session has ended.
  useSessionLeaveState(
    mutationBusy || (phase !== "summary" && hasReviewed) ? "working" : phase === "summary" || phase === "error" ? "ended" : "fresh",
  );
  usePreventRemove(mutationBusy || (phase !== "summary" && hasReviewed), ({ data }) => {
    // The screen's own leave goes on, as does a back press this render has not caught up with; React
    // Navigation marks the action as already checked for this screen.
    if (exitingRef.current) navigation.dispatch(data.action);
    else if (hasReviewedProgress()) {
      pendingBackRef.current = data.action;
      setExitConfirmOpen(true);
    } else if (mutationLockRef.current) {
      pendingBackRef.current = data.action;
      leaveWhenSettledRef.current = true;
      setLeavePending(true);
    } else navigation.dispatch(data.action);
  });

  // No path should leave the index past the cards, but if one does the session finishes to the summary
  // instead of rendering nothing: a blank screen has no Close. Every card change is saved by then.
  const cardMissing = phase !== "loading" && phase !== "summary" && phase !== "error" && !currentCard;
  useEffect(() => {
    if (!cardMissing || mutationBusy) return;
    let cancelled = false;
    buildSummary().then((next) => {
      if (cancelled) return;
      setSummary(next);
      setPhase("summary");
    });
    return () => {
      cancelled = true;
    };
  }, [buildSummary, cardMissing, mutationBusy]);

  const overlayOpen =
    cardMenuOpen || !!confirmCardAction || dueDateOpen || answerEditOpen || exitConfirmOpen || noteOpen || !!levelOffer;
  const gradingVisible = (phase === "side" && revealed && isLastSide) || phase === "grading";
  // The latest handlers and state for the key and Back listeners, which are registered once.
  const inputRef = useRef({ phase, revealed, isLastSide, gradingVisible, overlayOpen, revealFirstSide, handleNext, handleGrade, handleEndSession });
  inputRef.current = { phase, revealed, isLastSide, gradingVisible, overlayOpen, revealFirstSide, handleNext, handleGrade, handleEndSession };

  // Keyboard on web: Space or Enter reveals and steps through sides; 1 to 4 grade Again, Hard, Good and
  // Easy by meaning, whatever the visual order. Only the topmost surface owns keys, so text entry, IME
  // composition, an open sheet or dialog, a held key and a focused control are left alone.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const state = inputRef.current;
      if (state.overlayOpen || mutationLockRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      const advanceKey = event.key === " " || event.key === "Enter";
      if (advanceKey) {
        // A focused control handles its own Space and Enter.
        if (target?.closest?.(FOCUSED_CONTROL_SELECTOR)) return;
        if (state.phase === "front") {
          event.preventDefault();
          state.revealFirstSide();
        } else if (state.phase === "side" && state.revealed && !state.isLastSide) {
          event.preventDefault();
          state.handleNext();
        }
        return;
      }
      const grade = GRADE_KEYS[event.key];
      if (grade !== undefined && state.gradingVisible) {
        event.preventDefault();
        state.handleGrade(grade);
      }
    };
    const doc = document;
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, []);

  // Android Back runs the same end-review path as the labeled X. An open sheet or dialog takes Back
  // first through its own modal, so this only sees presses on the review itself.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (inputRef.current.overlayOpen) return false;
      inputRef.current.handleEndSession();
      return true;
    });
    return () => subscription.remove();
  }, []);

  // ─── Render ────────────────────────────────────────────────

  if (phase === "summary") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <SessionSummaryView
          summary={summary!}
          onDone={handleEndSession}
          isDark={isDark}
          s={s}
          error={sessionError}
          db={db}
          language={uiLanguage}
          commitLabel={commitLabel}
          ownerId={authUserId}
          nextStep={nextStep}
          onContinue={continueTo}
          onStudyMore={studyMore}
        />
      </SafeAreaView>
    );
  }

  if (phase === "error") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-1 items-center justify-center px-6" style={{ gap: 16 }}>
          <Text
            accessibilityRole="alert"
            className="text-center text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, lineHeight: 24, writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {loadError ?? s.sessionLoadFailed}
          </Text>
          <Button onPress={() => setLoadAttempt((n) => n + 1)} className="w-full max-w-sm">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>{s.decksTryAgain}</Text>
          </Button>
          <Button variant="outline" onPress={handleEndSession} className="w-full max-w-sm">
            <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
              {s.sessionEndReview}
            </Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "loading" || !currentCard) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="px-6 pt-6" style={{ gap: 16 }}>
          <Skeleton isDark={isDark} width="100%" height={8} borderRadius={4} />
          <View style={{ height: 24 }} />
          <Skeleton isDark={isDark} width="40%" height={12} borderRadius={6} style={{ alignSelf: "center" }} />
          <Skeleton isDark={isDark} width="100%" height={200} borderRadius={24} />
          <View style={{ height: 8 }} />
          <SkeletonText isDark={isDark} width="80%" lineHeight={14} style={{ alignSelf: "center" }} />
          <SkeletonText isDark={isDark} width="60%" lineHeight={14} style={{ alignSelf: "center" }} />
        </View>
      </SafeAreaView>
    );
  }

  const sessionTotal = sessionCardTotal || cards.length;
  const currentProgress = Math.min(currentIndex + 1, sessionTotal);
  const progressPercent = sessionTotal > 0 ? (currentProgress / sessionTotal) * 100 : 0;
  const translateY = flipAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });
  const opacity = flipAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const showModeTags = (phase === "front" || phase === "side") && activeModes.length > 0;
  const editableAnswerMode = currentMode ?? activeModes[currentSideIndex] ?? activeModes[0] ?? null;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Header */}
      <View className="px-6 pt-3 pb-2 items-center">
        <View style={{ width: "100%", maxWidth }}>
          <View
            className="items-center justify-between"
            style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <Pressable
              onPress={handleEndSession}
              disabled={leavePending}
              accessibilityRole="button"
              accessibilityLabel={s.sessionEndReview}
              accessibilityState={{ disabled: leavePending }}
              // Dimmed while Close waits for the grade or card action it was pressed during.
              className={`w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center ${leavePending ? "opacity-50" : ""}`}
            >
              <X size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>

            <View className="min-w-0 flex-1 items-center px-2">
              {/* Review all mixes decks, so the current card's deck is named above the counter. */}
              {!normalizedDeckId ? (
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  numberOfLines={1}
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {deckTitleFor(currentCard.card.deck_id, s)}
                </Text>
              ) : null}
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, writingDirection: "ltr" }}
              >
                {formatNumber(currentProgress, uiLanguage)} / {formatNumber(sessionTotal, uiLanguage)}
              </Text>
            </View>

            <View
              className="items-center gap-2"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <CardStateBadge state={currentCard.card.state} isDark={isDark} s={s} />
              <Pressable
                onPress={() => setCardMenuOpen(true)}
                // Disabled while any change to the card saves; dimmed only for a card action, so it does
                // not blink on every grade.
                className={`w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center ${cardActionBusy ? "opacity-50" : ""}`}
                accessibilityRole="button"
                accessibilityLabel={s.cardActionsTitle}
                accessibilityState={{ disabled: mutationBusy }}
                disabled={mutationBusy}
              >
                <EllipsisVertical size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
              </Pressable>
            </View>
          </View>
          <View className="mt-2 h-[2px] rounded-full bg-surface-high dark:bg-surface-dark-high overflow-hidden">
            <View
              className="h-full rounded-full bg-primary-accent dark:bg-primary-bright"
              style={{ width: `${progressPercent}%` }}
            />
          </View>
          {retentionNotCounted ? (
            <Text
              className="mt-2 text-center text-warm-600 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {s.studyRetentionNotCounted}
            </Text>
          ) : null}
        </View>
      </View>

      {showModeTags && (
        <ModeTagsRow
          activeModes={activeModes}
          currentSideIndex={currentSideIndex}
          maxWidth={maxWidth}
          isDark={isDark}
          isRTL={isRTL}
          s={s}
        />
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 140 }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {/* Front of card */}
          {phase === "front" && (
            <Card elevation="low" className="p-6 mb-6 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              {isSmartReviewCard(currentCard) ? (
                <SmartCardFront card={currentCard} fontSize={fontSize} lineHeight={lineHeight} s={s} />
              ) : currentCard.isWordCard && currentCard.textQcf2 && currentCard.v2Page ? (
                <Qcf2AyahText
                  textQcf2={currentCard.textQcf2}
                  textUthmani={currentCard.textUthmani}
                  v2Page={currentCard.v2Page}
                  fontSize={fontSize * 0.85}
                  lineHeight={lineHeight * 0.85}
                  highlightWordPos={currentCard.wordPos}
                  surah={currentCard.surah}
                  ayah={currentCard.ayah}
                />
              ) : (
                <>
              {!currentCard.isWordCard && currentCard.uniqueFront.contextCount > 0 && (
                <Text
                  className="text-warm-400 dark:text-neutral-500 text-center mb-3"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
                >
                  {interpolate(s.sessionContextShown, {
                    ayahs: formatAyahs(currentCard.uniqueFront.contextCount, uiLanguage),
                  })}
                </Text>
              )}
              {/* A repeated ayah shows the ayahs before it, each in its own page font, dimmed like the
                  similar-verse context, then the card's own ayah. */}
              {!currentCard.isWordCard &&
              currentCard.textQcf2 &&
              currentCard.v2Page &&
              currentCard.uniqueFront.context.length === currentCard.uniqueFront.contextCount ? (
                <View>
                  {currentCard.uniqueFront.context.map((context) => (
                    <View key={`${context.surah}:${context.ayah}`} className="mb-2 opacity-80">
                      <Qcf2AyahText
                        textQcf2={context.textQcf2}
                        textUthmani={context.textUthmani}
                        v2Page={context.v2Page}
                        fontSize={fontSize * 0.82}
                        lineHeight={lineHeight * 0.82}
                        surah={context.surah}
                        ayah={context.ayah}
                      />
                    </View>
                  ))}
                  <Qcf2AyahText textQcf2={currentCard.textQcf2} textUthmani={currentCard.textUthmani} v2Page={currentCard.v2Page} fontSize={fontSize} lineHeight={lineHeight} ayah={currentCard.ayah} />
                </View>
              ) : (
                <Text
                  className="text-charcoal dark:text-neutral-100 text-center"
                  style={{ fontSize, lineHeight, writingDirection: "rtl" }}
                >
                  {currentCard.uniqueFront.text}
                </Text>
              )}
                </>
              )}
            </Card>
          )}

          {/* Side (test mode) */}
          {phase === "side" && currentMode && (
            <View>
              <Card elevation="low" className="p-5 mb-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
                <TestModePrompt mode={currentMode} card={currentCard} fontSize={fontSize * 0.85} lineHeight={lineHeight * 0.85} />
              </Card>

              {revealed && (
                <RNAnimated.View style={{ transform: [{ translateY }], opacity }}>
                  <Card elevation="mid" className="p-6 rounded-3xl bg-surface-bright dark:bg-surface-dark-mid">
                    <TestModeAnswer
                      mode={currentMode}
                      card={currentCard}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                      s={s}
                      isRTL={isRTL}
                      tafseerSourceLabel={tafseerSourceLabel(tafseerSource, s)}
                    />
                  </Card>
                </RNAnimated.View>
              )}
            </View>
          )}

          {/* Grading phase */}
          {phase === "grading" && (
            <Card elevation="low" className="p-6 mb-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              {currentCard.textQcf2 && currentCard.v2Page ? (
                <Qcf2AyahText
                  textQcf2={currentCard.textQcf2}
                  textUthmani={currentCard.textUthmani}
                  v2Page={currentCard.v2Page}
                  fontSize={fontSize * 0.8}
                  lineHeight={lineHeight * 0.8}
                  ayah={currentCard.ayah}
                />
              ) : (
                <Text
                  className="text-charcoal dark:text-neutral-100 text-center"
                  style={{ fontSize: fontSize * 0.8, lineHeight: lineHeight * 0.8, writingDirection: "rtl" }}
                >
                  {currentCard.textUthmani}
                </Text>
              )}
              {currentCard.surah > 0 && currentCard.ayah > 0 ? (
                <Pressable
                  onPress={() => setNoteOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={s.noteAdd}
                  className="mt-4 min-h-11 self-center flex-row items-center justify-center gap-2 rounded-full px-4"
                  style={{ direction: isRTL ? "rtl" : "ltr" }}
                >
                  <NotebookPen size={16} color={isDark ? "#5eead4" : "#0d9488"} />
                  <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                    {s.noteAdd}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          )}
        </View>
      </ScrollView>
      {currentCard.surah > 0 && currentCard.ayah > 0 ? (
        <PrivateNoteSheet
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          surah={currentCard.surah}
          ayahStart={currentCard.ayah}
          ayahEnd={currentCard.ayah}
        />
      ) : null}

      {/* Bottom action area */}
      <View
        className="px-6 pb-6 pt-4 items-center"
        style={{ backgroundColor: withThemeOpacity(themeSurface, 0.95) }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {sessionError && !overlayOpen && (
            <View className="mb-3 items-center" style={{ gap: 4 }} accessibilityRole="alert">
              <Text
                className="text-red-600 dark:text-red-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {sessionError}
              </Text>
              {/* The same grade again, through the same atomic save: one attempt, one review log. */}
              {failedGrade !== null ? (
                <Pressable
                  onPress={() => handleGrade(failedGrade)}
                  disabled={mutationBusy}
                  accessibilityRole="button"
                  className="min-h-11 justify-center px-4"
                >
                  <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                    {s.decksTryAgain}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {phase === "front" && (
            <Button onPress={revealFirstSide} className="w-full">
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                {s.flashcardsReveal}
              </Text>
            </Button>
          )}

          {/* SPEC 3.6: a word met for the first time can be marked known; it grades Easy. */}
          {currentCard.isWordCard &&
          currentCard.card.state === State.New &&
          (phase === "front" || (phase === "side" && revealed && isLastSide) || phase === "grading") ? (
            <Button
              variant="outline"
              className="w-full border border-warm-300 dark:border-neutral-700"
              label={s.meaningsKnowThis}
              disabled={mutationBusy}
              onPress={() => {
                knownPressRef.current = true;
                handleGrade(Rating.Easy);
              }}
            />
          ) : null}

          {phase === "side" && revealed && !isLastSide && (
            <Button onPress={handleNext} className="w-full">
              <View
                className="items-center gap-2"
                style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                  {interpolate(s.sessionNextSide, {
                    current: formatNumber(currentSideIndex + 2, uiLanguage),
                    total: formatNumber(activeModes.length, uiLanguage),
                  })}
                </Text>
                <NextIcon size={18} color="#fff" />
              </View>
            </Button>
          )}

          {/* Grading: show directly after last side is revealed, or in grading phase */}
          {((phase === "side" && revealed && isLastSide) || phase === "grading") && (
            <GradingButtons
              onGrade={handleGrade}
              previews={gradePreviews}
              isDark={isDark}
              s={s}
              disabled={mutationBusy}
              dir={isRTL ? "rtl" : "ltr"}
              mirrorInRTL
            />
          )}
        </View>
      </View>

      <CardActionsSheet
        visible={cardMenuOpen}
        card={currentCard}
        isDark={isDark}
        isRTL={isRTL}
        busy={mutationBusy}
        error={cardMenuOpen ? sessionError : null}
        s={s}
        onClose={() => {
          if (!mutationBusy) setCardMenuOpen(false);
        }}
        onOpenInReader={handleOpenInReader}
        onDelete={() => {
          setCardMenuOpen(false);
          setSessionError(null);
          setConfirmCardAction("delete");
        }}
        onSuspend={handleSuspendCard}
        onBury={handleBuryCard}
        onToggleMark={handleToggleMarkCard}
        onEditAnswer={openAnswerEditSheet}
        canEditAnswer={!!editableAnswerMode}
        onReset={() => {
          setCardMenuOpen(false);
          setSessionError(null);
          setConfirmCardAction("reset");
        }}
        onSetDueDate={openDueDateSheet}
      />
      <AnswerEditSheet
        visible={answerEditOpen}
        value={answerEditText}
        defaultValue={currentCard && answerEditMode ? getDefaultAnswerText(currentCard, answerEditMode, s) : ""}
        baseline={currentCard && answerEditMode ? (getCardAnswerOverride(currentCard, answerEditMode) ?? getDefaultAnswerText(currentCard, answerEditMode, s)) : ""}
        error={sessionError}
        busy={mutationBusy}
        isDark={isDark}
        isRTL={isRTL}
        s={s}
        onChange={setAnswerEditText}
        onClose={() => {
          if (!mutationBusy) setAnswerEditOpen(false);
        }}
        onSave={handleSaveAnswerEdit}
      />
      <DueDateSheet
        visible={dueDateOpen}
        value={dueDateText}
        error={dueDateError ?? sessionError}
        busy={mutationBusy}
        isDark={isDark}
        isRTL={isRTL}
        s={s}
        onChange={setDueDateText}
        onClose={() => {
          if (!mutationBusy) setDueDateOpen(false);
        }}
        onSave={handleSaveDueDate}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ConfirmDialog
        visible={!!confirmCardAction}
        title={interpolate(confirmCardAction === "delete" ? s.cardDeleteNamed : s.cardResetNamed, {
          card: sessionCardName(currentCard, uiLanguage),
        })}
        message={confirmCardAction === "delete" ? s.cardDeleteConfirm : s.cardResetConfirm}
        cancelLabel={s.flashcardsCancel}
        confirmLabel={confirmCardAction === "delete" ? s.flashcardsDelete : s.cardResetProgress}
        destructive
        itemName={currentCard ? `${currentCard.surahName} ${formatAyahRef(isRTL, currentCard.surah, currentCard.ayah)}` : undefined}
        confirmLoading={mutationBusy}
        error={sessionError}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          if (!mutationBusy) setConfirmCardAction(null);
        }}
        onConfirm={handleConfirmCardAction}
      />
      <ConfirmDialog
        visible={exitConfirmOpen}
        title={s.habitExitTitle}
        message={s.habitExitBody}
        tone="neutral"
        cancelLabel={s.habitExitStay}
        confirmLabel={s.habitExitLeave}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          setExitConfirmOpen(false);
          pendingBackRef.current = null;
        }}
        onConfirm={() => {
          setExitConfirmOpen(false);
          leave();
        }}
      />
      <ConfirmDialog
        visible={!!levelOffer}
        title={levelOffer === "lower" ? s.meaningsLowerTitle : s.meaningsRaiseTitle}
        message={levelOffer === "lower" ? s.meaningsLowerBody : s.meaningsRaiseBody}
        tone="neutral"
        cancelLabel={s.meaningsOfferNotNow}
        confirmLabel={levelOffer === "lower" ? s.meaningsLowerConfirm : s.meaningsRaiseConfirm}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          if (levelOffer) declineLevelOffer(db, levelOffer).catch(console.warn);
          setLevelOffer(null);
        }}
        onConfirm={() => {
          if (levelOffer) acceptLevelOffer(db, levelOffer).catch(console.warn);
          setLevelOffer(null);
        }}
      />
      {wirdNotice ? <Toast message={wirdNotice} onDismiss={() => setWirdNotice(null)} duration={3500} announce /> : null}
      {actionNotice && !wirdNotice ? <Toast message={actionNotice} onDismiss={() => setActionNotice(null)} announce /> : null}
    </SafeAreaView>
  );
}

function cardAnswerSettingKey(cardId: string, mode: ReviewMode): string {
  return `${CARD_ANSWER_SETTING_PREFIX}${cardId}:${mode}`;
}

async function readCardAnswerOverrides(db: DatabaseExecutor, cardId: string): Promise<Partial<Record<ReviewMode, string>>> {
  const result: Partial<Record<ReviewMode, string>> = {};
  await Promise.all(EDITABLE_ANSWER_MODES.map(async (mode) => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = ?",
      [cardAnswerSettingKey(cardId, mode)]
    );
    if (row?.value?.trim()) result[mode] = row.value;
  }));
  return result;
}

function getCardAnswerOverride(card: CardData, mode: ReviewMode): string | null {
  const value = card.customAnswers?.[mode]?.trim();
  return value ? value : null;
}

function getDefaultAnswerText(card: CardData, mode: ReviewMode, s: UIStrings): string {
  switch (mode) {
    case "nextAyah":
      return card.nextAyahText ?? "";
    case "previousAyah":
      return card.prevAyahText ?? "";
    case "translation":
      return card.translation;
    case "tafseer":
      return card.tafseer;
    case "surahName":
      return card.surahName;
    case "wordMeaningArabic":
      return card.wordMeaningAr ?? s.noWordMeaningFallback;
    case "wordMeaningTranslation":
      return card.wordMeaningEn ?? "";
    case "smartRefs":
      return card.smartRefs?.map((ref) => ref.textUthmani).join("\n\n") ?? "";
    case "qiraatReading":
      return card.qiraatText ?? card.qiraatGroup?.join("\n\n") ?? "";
    case "asbabReading":
      return card.asbabOccasions?.join("\n\n") ?? "";
    default:
      return "";
  }
}

function containsArabic(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

/** Card-list order (Mark, Suspend, Bury, Set Due Date), then this session's extras, then Reset and Delete after a divider. */
function CardActionsSheet({
  visible,
  card,
  isDark,
  isRTL,
  busy,
  error,
  s,
  onClose,
  onOpenInReader,
  onDelete,
  onSuspend,
  onBury,
  onToggleMark,
  onEditAnswer,
  canEditAnswer,
  onReset,
  onSetDueDate,
}: {
  visible: boolean;
  card: CardData | null;
  isDark: boolean;
  isRTL: boolean;
  busy: boolean;
  /** A failed action keeps the sheet open with its error above the rows. */
  error: string | null;
  s: UIStrings;
  onClose: () => void;
  onOpenInReader: () => void;
  onDelete: () => void;
  onSuspend: () => void;
  onBury: () => void;
  onToggleMark: () => void;
  onEditAnswer: () => void;
  canEditAnswer: boolean;
  onReset: () => void;
  onSetDueDate: () => void;
}) {
  const marked = !!card?.card.marked_at;
  const mutedColor = isDark ? "#a3a3a3" : "#8B8178";
  return (
    <ResponsiveSheet open={visible} onClose={onClose} maxWidth={420} maxHeight="80%">
      <OverlayHeader title={s.cardActionsTitle} onClose={onClose} isRTL={isRTL} />
      <OverlayBody contentContainerClassName="px-4 py-3">
        {error ? (
          <FieldMessage
            dir={isRTL ? "rtl" : "ltr"}
            className="mb-3 w-full self-stretch text-red-600 dark:text-red-400"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </FieldMessage>
        ) : null}
        <View className="gap-2">
          <CardActionRow
            icon={<Star size={18} color={isDark ? "#facc15" : "#ca8a04"} fill={marked ? (isDark ? "#facc15" : "#ca8a04") : "transparent"} />}
            label={marked ? s.cardUnmark : s.cardMark}
            disabled={busy}
            isRTL={isRTL}
            onPress={onToggleMark}
          />
          <CardActionRow icon={<PauseCircle size={18} color={mutedColor} />} label={s.cardSuspend} disabled={busy} isRTL={isRTL} onPress={onSuspend} />
          <CardActionRow
            icon={<Clock3 size={18} color={isDark ? "#fbbf24" : "#d97706"} />}
            label={s.cardBury}
            disabled={busy}
            isRTL={isRTL}
            onPress={onBury}
          />
          <CardActionRow icon={<CalendarDays size={18} color={mutedColor} />} label={s.cardSetDueDate} disabled={busy} isRTL={isRTL} onPress={onSetDueDate} />
          <CardActionRow
            icon={<Pencil size={18} color={isDark ? "#5eead4" : "#0d9488"} />}
            label={s.cardEditAnswer}
            disabled={busy || !canEditAnswer}
            isRTL={isRTL}
            onPress={onEditAnswer}
          />
          <CardActionRow icon={<BookOpen size={18} color={mutedColor} />} label={s.cardOpenInReader} disabled={busy} isRTL={isRTL} onPress={onOpenInReader} />
          <View className="my-1 h-px bg-surface-high dark:bg-surface-dark-high" />
          <CardActionRow icon={<RotateCcw size={18} color={mutedColor} />} label={s.cardResetProgress} disabled={busy} isRTL={isRTL} onPress={onReset} />
          <CardActionRow
            icon={<Trash2 size={18} color={isDark ? "#f87171" : "#dc2626"} />}
            label={s.cardDelete}
            disabled={busy}
            destructive
            isRTL={isRTL}
            onPress={onDelete}
          />
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function CardActionRow({
  icon,
  label,
  disabled,
  destructive,
  isRTL,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  destructive?: boolean;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3"
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
      })}
    >
      <View className="items-center gap-3" style={{ flexDirection: isRTL ? "row-reverse" : "row" }}>
        <View className="h-9 w-9 items-center justify-center rounded-full bg-surface dark:bg-surface-dark-high">
          {icon}
        </View>
        <Text
          className={destructive ? "text-red-600 dark:text-red-400" : "text-charcoal dark:text-neutral-100"}
          style={{
            flex: 1,
            fontFamily: "Manrope_600SemiBold",
            fontSize: 14,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function AnswerEditSheet({
  visible,
  value,
  defaultValue,
  baseline,
  error,
  busy,
  isDark,
  isRTL,
  s,
  onChange,
  onClose,
  onSave,
}: {
  visible: boolean;
  value: string;
  /** The standard answer, shown for reference; a personal answer never replaces it in the data. */
  defaultValue: string;
  /** What the field held when it opened, for the discard check. */
  baseline: string;
  error: string | null;
  busy: boolean;
  isDark: boolean;
  isRTL: boolean;
  s: UIStrings;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const answerIsRTL = isRTL || containsArabic(value);
  const { guard, dialogProps } = useDiscardGuard(visible && isEditableTextDirty(value, baseline));
  // Close, Cancel, Back, Escape and the backdrop all ask before dropping an edit.
  const requestClose = () => {
    if (!busy) guard(onClose);
  };
  return (
    <>
      <ResponsiveSheet open={visible} onClose={requestClose} maxWidth={520} maxHeight="80%" avoidKeyboard>
        <OverlayHeader title={s.cardEditAnswerTitle} subtitle={s.cardEditAnswerHint} onClose={requestClose} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 py-5">
          <TextInput
            value={value}
            onChangeText={onChange}
            accessibilityLabel={s.cardEditAnswerTitle}
            placeholder={s.cardEditAnswerPlaceholder}
            placeholderTextColor={isDark ? "#737373" : "#8B8178"}
            multiline
            textAlignVertical="top"
            className="min-h-[160px] rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3 text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 16,
              lineHeight: 25,
              ...inputTextStartStyle(answerIsRTL),
              writingDirection: answerIsRTL ? "rtl" : "ltr",
            }}
          />
          <View className="mt-2 items-center" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
            <Pressable
              onPress={() => onChange("")}
              disabled={busy || value.length === 0}
              accessibilityRole="button"
              accessibilityLabel={s.cardAnswerUseDefault}
              className="min-h-11 justify-center"
              style={({ pressed }) => ({ opacity: busy || value.length === 0 ? 0.45 : pressed ? 0.7 : 1 })}
            >
              <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {s.cardAnswerUseDefault}
              </Text>
            </Pressable>
          </View>
          {defaultValue ? (
            <View className="mt-2" style={{ gap: 4 }}>
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.cardAnswerDefaultLabel}
              </Text>
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{
                  fontSize: 14,
                  lineHeight: 22,
                  ...textStartStyle(containsArabic(defaultValue)),
                  writingDirection: containsArabic(defaultValue) ? "rtl" : "ltr",
                }}
              >
                {defaultValue}
              </Text>
            </View>
          ) : null}
          {error ? (
            <FieldMessage
              dir={isRTL ? "rtl" : "ltr"}
              className="mt-3 w-full self-stretch text-red-600 dark:text-red-400"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </FieldMessage>
          ) : null}
        </OverlayBody>
        <OverlayFooter isRTL={isRTL}>
          <Button variant="outline" onPress={requestClose} disabled={busy} className="flex-1">
            <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.flashcardsCancel}
            </Text>
          </Button>
          <Button onPress={onSave} disabled={busy} className="flex-1">
            <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.cardSaveAnswer}
            </Text>
          </Button>
        </OverlayFooter>
      </ResponsiveSheet>
      <DiscardChangesDialog {...dialogProps} />
    </>
  );
}

// ─── Test Mode Components ────────────────────────────────────

function ModeTagsRow({
  activeModes,
  currentSideIndex,
  maxWidth,
  isDark,
  isRTL,
  s,
}: {
  activeModes: ReviewMode[];
  currentSideIndex: number;
  maxWidth: number;
  isDark: boolean;
  isRTL: boolean;
  s: UIStrings;
}) {
  return (
    <View className="items-center px-6 pb-3">
      <View className="flex-row flex-wrap gap-2" style={{ width: "100%", maxWidth, flexDirection: isRTL ? "row-reverse" : "row" }}>
        {activeModes.map((mode, i) => {
          const color = reviewSideColor(REVIEW_MODE_TONES[mode], isDark);
          const isActive = i === currentSideIndex;
          const isDone = i < currentSideIndex;
          return (
            <View
              key={mode}
              className="items-center gap-1 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: isActive ? color.fill : "transparent",
                borderWidth: 1.5,
                borderColor: isActive ? color.fill : color.text,
                direction: "ltr",
                flexDirection: isRTL ? "row-reverse" : "row",
              }}
            >
              {/* A finished side keeps full contrast and gains a check instead of fading. */}
              {isDone ? <Check size={12} color={color.text} /> : null}
              <Text
                style={{
                  fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                  fontSize: 11,
                  color: isActive ? color.onFill : color.text,
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {getModeName(mode, s)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TestModePrompt({
  mode, card, fontSize, lineHeight,
}: {
  mode: ReviewMode; card: CardData; fontSize: number; lineHeight: number;
}) {
  const wordMode = isWordTestMode(mode);

  return (
    <View>
      {mode === "smartRefs" ? (
        <SmartCueText card={card} fontSize={fontSize} lineHeight={lineHeight} />
      ) : card.textQcf2 && card.v2Page ? (
        <Qcf2AyahText
          textQcf2={card.textQcf2}
          textUthmani={card.textUthmani}
          v2Page={card.v2Page}
          fontSize={fontSize}
          lineHeight={lineHeight}
          highlightWordPos={wordMode ? card.wordPos : undefined}
          surah={card.surah}
          ayah={card.ayah}
        />
      ) : (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {card.textUthmani}
        </Text>
      )}
    </View>
  );
}

function TestModeAnswer({
  mode, card, fontSize, lineHeight, s, isRTL, tafseerSourceLabel,
}: {
  mode: ReviewMode; card: CardData; fontSize: number; lineHeight: number; s: UIStrings; isRTL: boolean;
  tafseerSourceLabel: string | null;
}) {
  const customAnswer = getCardAnswerOverride(card, mode);
  if (customAnswer) {
    return <CustomAnswerText text={customAnswer} fontSize={Math.max(15, fontSize * 0.55)} label={s.sessionPersonalAnswer} isRTL={isRTL} />;
  }

  switch (mode) {
    case "nextAyah":
      return card.nextAyahQcf2 && card.nextAyahText && card.nextV2Page ? (
        <Qcf2AyahText textQcf2={card.nextAyahQcf2} textUthmani={card.nextAyahText} v2Page={card.nextV2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.nextAyahText ?? "—"}
        </Text>
      );
    case "previousAyah":
      return card.prevAyahQcf2 && card.prevAyahText && card.prevV2Page ? (
        <Qcf2AyahText textQcf2={card.prevAyahQcf2} textUthmani={card.prevAyahText} v2Page={card.prevV2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.prevAyahText ?? "—"}
        </Text>
      );
    case "translation":
      return (
        <View>
          <Text
            className="text-charcoal dark:text-neutral-200"
            // English translation stays LTR in either interface language.
            style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24, ...textStartStyle(false), writingDirection: "ltr" }}
          >
            {card.translation}
          </Text>
          <SourceLine text={interpolate(s.sessionSourceLabel, { source: s.sessionTranslationSource })} isRTL={isRTL} />
        </View>
      );
    case "tafseer":
      return (
        <View>
          <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, textAlign: "right", writingDirection: "rtl" }}
            >
              {card.tafseer}
            </Text>
          </ScrollView>
          {tafseerSourceLabel ? <SourceLine text={interpolate(s.sessionSourceLabel, { source: tafseerSourceLabel })} isRTL={isRTL} /> : null}
        </View>
      );
    case "surahName":
      return (
        <Text
          className="text-primary-accent dark:text-primary-bright text-center"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 22, writingDirection: "rtl" }}
        >
          {card.surahName}
        </Text>
      );
    case "wordMeaningArabic":
      // A meaning is prose about the word, so it takes the tafsir answer's face, a little larger
      // because it is short, not the Quran text size.
      return (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 17, lineHeight: 28, writingDirection: "rtl" }}
        >
          {card.wordMeaningAr ?? "—"}
        </Text>
      );
    case "wordMeaningTranslation":
      return (
        <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24 }}>
          {card.wordMeaningEn ?? "—"}
        </Text>
      );
    case "smartRefs":
      return <SmartRefsAnswer card={card} fontSize={fontSize * 0.82} lineHeight={lineHeight * 0.82} s={s} isRTL={isRTL} />;
    case "qiraatReading":
      return <QiraatAnswer card={card} s={s} isRTL={isRTL} />;
    case "asbabReading":
      return <AsbabAnswer card={card} s={s} isRTL={isRTL} />;
    default:
      return null;
  }
}

/** The answer's source, small and muted under translation and tafsir answers. */
function SourceLine({ text, isRTL }: { text: string; isRTL: boolean }) {
  return (
    <Text
      className="mt-3 text-warm-500 dark:text-neutral-400"
      style={{ fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
    >
      {text}
    </Text>
  );
}

/**
 * A personal answer, labeled as the user's own so it is never read as the standard text. Line
 * breaks are kept; Arabic uses the reader's Arabic face instead of the Latin UI font.
 */
function CustomAnswerText({ text, fontSize, label, isRTL }: { text: string; fontSize: number; label: string; isRTL: boolean }) {
  const answerIsRTL = containsArabic(text);
  return (
    <View style={{ gap: 6 }}>
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          ...(answerIsRTL ? (ARABIC_READING_FONT ? { fontFamily: ARABIC_READING_FONT } : null) : { fontFamily: "Manrope_400Regular" }),
          fontSize,
          lineHeight: Math.round(fontSize * 1.62),
          ...textStartStyle(answerIsRTL),
          writingDirection: answerIsRTL ? "rtl" : "ltr",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function SmartCardFront({
  card,
  fontSize,
  lineHeight,
  s,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: UIStrings;
}) {
  const prompt = getSmartPrompt(card, s);
  return (
    <View className="items-center">
      <Text
        className="text-primary-accent dark:text-primary-bright text-center mb-2"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
      >
        {card.smartDeckTitle}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-400 text-center mb-5"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
      >
        {prompt}
      </Text>
      {(card.kind === "qiraat" || card.kind === "asbab") && card.textQcf2 && card.v2Page ? (
        <Qcf2AyahText textQcf2={card.textQcf2} textUthmani={card.textUthmani} v2Page={card.v2Page} fontSize={fontSize} lineHeight={lineHeight} ayah={card.ayah} />
      ) : (
        <SmartCueText card={card} fontSize={fontSize} lineHeight={lineHeight} />
      )}
    </View>
  );
}

function SmartCueText({
  card,
  fontSize,
  lineHeight,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
}) {
  const promptText = card.smartPromptUthmani ?? card.uniqueFront.text;
  return (
    <View className="items-center">
      {card.kind === "mutashabihat" && card.smartNeedsExplicitRefLabel && (
        <Text
          className="text-warm-500 dark:text-neutral-400 text-center mb-3"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 12, writingDirection: "rtl" }}
        >
          {card.surahName} {card.surah}:{card.ayah}
        </Text>
      )}
      {card.kind === "mutashabihat" && card.smartPromptContextQcf2 && card.smartPromptContextUthmani && card.smartPromptContextV2Page ? (
        <View className="mb-2 opacity-80">
          <Qcf2AyahText
            textQcf2={card.smartPromptContextQcf2}
            textUthmani={card.smartPromptContextUthmani}
            v2Page={card.smartPromptContextV2Page}
            fontSize={fontSize * 0.82}
            lineHeight={lineHeight * 0.82}
          />
        </View>
      ) : null}
      {card.smartPromptQcf2 && card.smartPromptUthmani && card.v2Page ? (
        <Qcf2AyahText
          textQcf2={card.smartPromptQcf2}
          textUthmani={card.smartPromptUthmani}
          v2Page={card.v2Page}
          fontSize={fontSize}
          lineHeight={lineHeight}
          hasAyahMarker={false}
          ayah={card.ayah}
        />
      ) : (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {promptText}
        </Text>
      )}
    </View>
  );
}

function SmartRefsAnswer({
  card,
  fontSize,
  lineHeight,
  s,
  isRTL,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: UIStrings;
  isRTL: boolean;
}) {
  const refs = card.smartRefs ?? [];
  const target = card.smartTargetRef ?? refs[0] ?? null;
  const related = target
    ? refs.filter((ref) => ref.groupId !== target.groupId || ref.sortOrder !== target.sortOrder)
    : refs;
  const title = card.kind === "similarTail" ? s.smartDeckCorrectTail : s.smartDeckTargetAyah;
  return (
    <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
      <Text
        className="text-warm-400 dark:text-neutral-500 uppercase mb-3"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {title}
      </Text>
      <View className="gap-3">
        {card.kind === "similarTail" && card.smartHiddenAnswerUthmani && target && (
          <View className="rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/10 p-4">
            {card.smartHiddenAnswerQcf2 && target.v2Page ? (
              <Qcf2AyahText
                textQcf2={card.smartHiddenAnswerQcf2}
                textUthmani={card.smartHiddenAnswerUthmani}
                v2Page={target.v2Page}
                fontSize={fontSize * 1.08}
                lineHeight={lineHeight * 1.08}
                colorClassName="text-primary-accent dark:text-primary-bright"
                ayah={target.ayah}
              />
            ) : (
              <Text
                className="text-primary-accent dark:text-primary-bright text-center"
                style={{ fontSize: fontSize * 1.08, lineHeight: lineHeight * 1.08, writingDirection: "rtl" }}
              >
                {card.smartHiddenAnswerUthmani}
              </Text>
            )}
          </View>
        )}

        {card.kind !== "similarTail" && target && (
          <SmartRefCard refData={target} fontSize={fontSize} lineHeight={lineHeight} />
        )}

        {card.kind === "mutashabihat" && card.smartCue && (
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 20, textAlign: "right", writingDirection: "rtl" }}
          >
            {s.smartDeckComparisonCue}: {card.smartCue}
          </Text>
        )}

        {card.kind !== "similarTail" && related.length > 0 && (
          <>
            <Text
              className="text-warm-400 dark:text-neutral-500 uppercase mt-2"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {s.smartDeckRelatedAyahs}
            </Text>
            {related.map((ref, index) => (
              <SmartRefCard
                key={`${ref.groupId}:${ref.sortOrder}:${ref.surah}:${ref.ayah}:${index}`}
                refData={ref}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SmartRefCard({
  refData,
  fontSize,
  lineHeight,
}: {
  refData: SmartDeckRef;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <View className="rounded-2xl bg-surface-low dark:bg-surface-dark-low p-4">
      <View className="flex-row-reverse items-center justify-between mb-3">
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, writingDirection: "rtl" }}
        >
          {refData.surah}:{refData.ayah}
        </Text>
        <Text
          className="text-warm-500 dark:text-neutral-400 flex-1 mr-3"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: "right", writingDirection: "rtl" }}
          numberOfLines={1}
        >
          {refData.surahNameAr}
        </Text>
      </View>
      <Qcf2AyahText textQcf2={refData.textQcf2} textUthmani={refData.textUthmani} v2Page={refData.v2Page} fontSize={fontSize} lineHeight={lineHeight} ayah={refData.ayah} />
    </View>
  );
}

function QiraatAnswer({ card, s, isRTL }: { card: CardData; s: UIStrings; isRTL: boolean }) {
  const blocks = parseQiraatText(card.qiraatText ?? "");
  if (blocks.length === 0) {
    return (
      <Text className="text-warm-500 dark:text-neutral-400 text-center" style={{ writingDirection: "rtl" }}>
        {s.noQiraatData}
      </Text>
    );
  }

  const group = card.qiraatGroup ?? [];
  const coversLabel = group.length > 1
    ? `${s.qiraatCoversAyahs}: ${group.map(formatAyahKeyArabic).join("، ")}`
    : null;

  return (
    <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
      <Text
        className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-3"
        style={{ ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {s.qiraatHeader}
      </Text>

      {coversLabel && (
        <View className="mb-3 px-3 py-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 self-start">
          <Text
            className="text-xs text-primary-accent dark:text-primary-bright"
            style={{ writingDirection: "rtl" }}
          >
            {coversLabel}
          </Text>
        </View>
      )}

      <QiraatBlocks blocks={blocks} />
    </ScrollView>
  );
}

function AsbabAnswer({ card, s, isRTL }: { card: CardData; s: UIStrings; isRTL: boolean }) {
  const occasions = card.asbabOccasions ?? [];
  if (occasions.length === 0) {
    return (
      <Text className="text-warm-500 dark:text-neutral-400 text-center" style={{ writingDirection: "rtl" }}>
        {s.noAsbabData}
      </Text>
    );
  }

  const group = card.asbabGroup ?? [];
  const coversLabel = group.length > 1
    ? `${s.asbabCoversAyahs}: ${group.map(formatAyahKeyArabic).join("، ")}`
    : null;

  return (
    <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
      <Text
        className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-3"
        style={{ ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {s.asbabHeader}
      </Text>

      {coversLabel && (
        <View className="mb-3 px-3 py-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 self-start">
          <Text
            className="text-xs text-primary-accent dark:text-primary-bright"
            style={{ writingDirection: "rtl" }}
          >
            {coversLabel}
          </Text>
        </View>
      )}

      <View className="gap-3">
        {occasions.map((occasion, index) => (
          <View key={`${card.surah}:${card.ayah}:${index}`} className="rounded-2xl bg-surface-low dark:bg-surface-dark-low p-4">
            {occasions.length > 1 && (
              <Text
                className="mb-2 text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 12, textAlign: "right", writingDirection: "rtl" }}
              >
                {`${s.smartDeckReasonLabel} ${index + 1}`}
              </Text>
            )}
            <Text
              className="text-base text-charcoal dark:text-neutral-200 leading-8"
              style={{ writingDirection: "rtl", textAlign: "right" }}
            >
              {occasion}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Grading ─────────────────────────────────────────────────

// ─── Card State Badge ────────────────────────────────────────

function CardStateBadge({ state, isDark, s }: { state: number; isDark: boolean; s: UIStrings }) {
  const labels: Record<number, string> = {
    [State.New]: s.flashcardsSummaryNew,
    [State.Learning]: s.flashcardsSummaryLearning,
    [State.Review]: s.flashcardsSummaryReview,
    [State.Relearning]: s.flashcardsSummaryRelearning,
  };
  const token = cardStateColor(state, isDark);
  return (
    <View className="px-3 py-1 rounded-full" style={{ backgroundColor: token.fill }}>
      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: token.onFill }}>{labels[state] ?? labels[State.New]}</Text>
    </View>
  );
}

// ─── Session Summary ─────────────────────────────────────────

function SessionSummaryView({
  summary,
  onDone,
  isDark,
  s,
  error,
  db,
  language,
  commitLabel,
  ownerId,
  nextStep,
  onContinue,
  onStudyMore,
}: {
  summary: SessionSummary;
  onDone: () => void;
  isDark: boolean;
  s: UIStrings;
  error?: string | null;
  db: AppDatabase;
  language: "en" | "ar";
  /** STR-20's commitment, read when the session opened (useCommitmentLabel). */
  commitLabel: string;
  /** The signed-in account, if any: only its confirmed sync may say Synced. */
  ownerId: string | null;
  /** What the resolver says comes next (SPEC 3.1), null while it loads. */
  nextStep: StudyState | null;
  onContinue: (step: Exclude<StudyStep, { kind: "home" }>) => void;
  onStudyMore: () => Promise<void>;
}) {
  const { width, height } = useWindowDimensions();
  const compact = width < 430 || height < 760;
  const synced = useConfirmedSync(db, ownerId, summary.total > 0);
  const n = (value: number) => formatNumber(value, language);
  const seconds = Math.round(summary.durationMs / 1000);
  // Under a minute reads in seconds instead of rounding up to 1 min.
  const duration =
    seconds < 60
      ? interpolate(s.sessionSeconds, { n: n(Math.max(seconds, summary.total > 0 ? 1 : 0)) })
      : interpolate(s.flashcardsSummaryMinutes, { n: n(Math.round(summary.durationMs / 60000)) });
  const nextReview = formatNextReviewDate(summary.nextReviewDate, s, language);

  if (summary.emptyQueue) {
    return (
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32 }}
      >
        <Text
          className="text-center text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: compact ? 21 : 24, marginBottom: 12 }}
        >
          {/* Cards exist but none were due: say so with the next due time. No cards at all: nothing to review. */}
          {nextReview ? s.sessionNothingWasDue : s.sessionNothingToReview}
        </Text>
        {nextReview ? (
          <Text
            className="text-center text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, lineHeight: 21, writingDirection: language === "ar" ? "rtl" : "ltr" }}
          >
            {interpolate(s.sessionNextDue, { when: nextReview })}
          </Text>
        ) : null}
        <View className="w-full max-w-sm" style={{ marginTop: 28 }}>
          <SessionNextStep
            state={nextStep}
            commitment={null}
            onContinue={onContinue}
            onStudyMore={onStudyMore}
            onDone={onDone}
            language={language}
            s={s}
          />
        </View>
      </ScrollView>
    );
  }

  const states = { new: cardStateColor(State.New, isDark), review: cardStateColor(State.Review, isDark), relearning: cardStateColor(State.Relearning, isDark) };

  // Scrolls so the habit cards never push the Done button off a small screen.
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingTop: compact ? 12 : 32,
        paddingBottom: compact ? 16 : 40,
      }}
    >
      {error && (
        <Text
          className="text-center text-red-600 dark:text-red-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: compact ? 12 : 13, marginBottom: compact ? 8 : 14 }}
        >
          {error}
        </Text>
      )}
      <View
        className="rounded-full items-center justify-center"
        style={{
          width: compact ? 58 : 72,
          height: compact ? 58 : 72,
          marginBottom: compact ? 14 : 20,
          backgroundColor: isDark ? "#1B4D4F" : "#f0fdfa",
        }}
      >
        <Trophy size={compact ? 28 : 34} color={isDark ? "#FDDC91" : "#0d9488"} />
      </View>

      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "NotoSerif_700Bold", fontSize: compact ? 21 : 24, marginBottom: compact ? 18 : 26 }}
      >
        {s.flashcardsSummaryTitle}
      </Text>

      <View className="w-full max-w-sm" style={{ gap: compact ? 10 : 14 }}>
        <SummaryRow label={s.flashcardsSummaryReviewed} value={n(summary.total)} compact={compact} />
        <View className="flex-row" style={{ gap: compact ? 8 : 12 }}>
          <SummaryCard label={s.flashcardsSummaryNew} value={n(summary.newCount)} color={states.new.text} compact={compact} />
          <SummaryCard label={s.flashcardsSummaryReview} value={n(summary.reviewCount)} color={states.review.text} compact={compact} />
          <SummaryCard label={s.flashcardsSummaryRelearning} value={n(summary.relearningCount)} color={states.relearning.text} compact={compact} />
        </View>
        <SummaryRow label={s.flashcardsSummaryDuration} value={duration} compact={compact} />
        {/* No date (none scheduled, or it could not load) leaves the row out rather than a lone dash. */}
        {nextReview ? <SummaryRow label={s.flashcardsSummaryNextReview} value={nextReview} compact={compact} /> : null}
      </View>

      {summary.total > 0 ? (
        <View className="w-full items-center" style={{ marginTop: compact ? 10 : 14 }}>
          <SessionHabitCards input={summary.habit} db={db} language={language} isDark={isDark} s={s} />
        </View>
      ) : null}

      {/* Done never waits for the network or the resolver: grades are already saved here. */}
      <View className="w-full max-w-sm" style={{ marginTop: compact ? 18 : 28 }}>
        <SessionNextStep
          state={nextStep}
          commitment={showsCommitment(summary.habit) ? commitLabel : null}
          onContinue={onContinue}
          onStudyMore={onStudyMore}
          onDone={onDone}
          language={language}
          s={s}
        />
      </View>
      {summary.total > 0 ? (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 text-center text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
        >
          {synced ? s.sessionSynced : s.sessionSavedOnDevice}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * True once a sync for the current account has finished with nothing left to upload. It never
 * blocks Done, and an account change or a pending upload keeps it at "Saved on this device".
 */
function useConfirmedSync(db: AppDatabase, ownerId: string | null, enabled: boolean): boolean {
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    setSynced(false);
    if (!ownerId || !enabled) return;
    let active = true;
    const check = () => {
      getPendingSyncCount(db)
        .then((pending) => {
          if (active && pending === 0 && useAuthStore.getState().user?.id === ownerId) setSynced(true);
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeSyncCompleted(check);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [db, enabled, ownerId]);
  return synced;
}

function SummaryRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <Card
      elevation="low"
      className="flex-row items-center justify-between"
      style={{ minHeight: compact ? 48 : 62, paddingHorizontal: compact ? 16 : 20, paddingVertical: compact ? 12 : 16 }}
    >
      <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: compact ? 12 : 14 }}>{label}</Text>
      <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: compact ? 16 : 18 }}>{value}</Text>
    </Card>
  );
}

function SummaryCard({ label, value, color, compact = false }: { label: string; value: string; color: string; compact?: boolean }) {
  return (
    <Card
      elevation="low"
      className="flex-1 items-center"
      style={{ minHeight: compact ? 78 : 96, paddingHorizontal: compact ? 8 : 12, paddingVertical: compact ? 12 : 16 }}
    >
      <View className="w-2 h-2 rounded-full" style={{ marginBottom: compact ? 8 : 10, backgroundColor: color }} />
      <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: compact ? 18 : 20 }}>{value}</Text>
      <Text className="text-warm-400 dark:text-neutral-500 text-center" style={{ fontFamily: "Manrope_500Medium", fontSize: compact ? 10 : 11, marginTop: 2 }}>{label}</Text>
    </Card>
  );
}

function localEndOfTodayIso(base = new Date()): string {
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function formatNextReviewDate(value: string | null, s: UIStrings, language: "en" | "ar"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date <= new Date(localEndOfTodayIso()) ? s.flashcardsToday : formatLongCardDate(date, language);
}

// ─── Helpers ─────────────────────────────────────────────────

function getModeName(mode: ReviewMode, s: UIStrings): string {
  const map: Record<ReviewMode, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: s.flashcardsModeTafseer,
    surahName: s.flashcardsModeSurahName,
    wordMeaningArabic: s.flashcardsModeWordMeaningArabic,
    wordMeaningTranslation: s.flashcardsModeWordMeaningTranslation,
    smartRefs: s.smartDeckTargetAyah,
    qiraatReading: s.smartDeckQiraatAnswerTitle,
    asbabReading: s.smartDeckReasonsAnswerTitle,
  };
  return map[mode] ?? mode;
}

/** The deck a card belongs to, named during Review all. */
function deckTitleFor(deckId: string, s: UIStrings): string {
  if (deckId === MEANINGS_DECK_ID) return s.vocabDeckTitle;
  if (deckId === SMART_DECK_IDS.retention) return s.smartDeckRetentionTitle;
  if (deckId === SMART_DECK_IDS.mutashabihat) return s.smartDeckMutashabihatTitle;
  if (deckId === SMART_DECK_IDS.similarTails) return s.smartDeckSimilarTailsTitle;
  if (deckId === SMART_DECK_IDS.qiraat) return s.smartDeckQiraatTitle;
  if (deckId === SMART_DECK_IDS.reasonsOfRevelation) return s.smartDeckReasonsTitle;
  return "";
}

function tafseerSourceLabel(sourceId: string, s: UIStrings): string | null {
  const source = TAFSIR_SOURCES.find((item) => item.id === sourceId);
  const label = source ? (s as unknown as Record<string, string | undefined>)[source.labelKey] : undefined;
  return label ?? null;
}

/** "Al-Baqara 2:255" / "البقرة ٢:٢٥٥", or the saved word, for a confirmation title. */
function sessionCardName(card: CardData | null, language: "en" | "ar"): string {
  if (!card) return "";
  if (card.isWordCard && card.wordText) return card.wordText;
  const name = language === "ar" ? card.surahName : (surahTransliteration(card.surah) ?? "");
  const reference = language === "ar" ? `${toArabicNumeral(card.surah)}:${toArabicNumeral(card.ayah)}` : `${card.surah}:${card.ayah}`;
  return name ? `${name} ${reference}` : reference;
}

function isWordTestMode(mode: ReviewMode): mode is WordTestMode {
  return mode === "wordMeaningArabic" || mode === "wordMeaningTranslation";
}

function isSmartReviewCard(card: CardData): boolean {
  return card.kind === "mutashabihat" || card.kind === "similarTail" || card.kind === "qiraat" || card.kind === "asbab";
}

function getSmartDeckTitleForKind(kind: SmartCardKind, s: UIStrings): string {
  if (kind === "mutashabihat") return s.smartDeckMutashabihatTitle;
  if (kind === "similarTail") return s.smartDeckSimilarTailsTitle;
  if (kind === "qiraat") return s.smartDeckQiraatTitle;
  return s.smartDeckReasonsTitle;
}

function getSmartPrompt(card: CardData, s: UIStrings): string {
  if (card.kind === "similarTail") return s.smartDeckTailCompletePrompt;
  if (card.kind === "qiraat") return s.smartDeckQiraatPrompt;
  if (card.kind === "asbab") return s.smartDeckReasonsPrompt;
  return s.smartDeckMutashabihatPrefixPrompt;
}

function formatAyahKeyArabic(key: string): string {
  const [surah, ayah] = key.split(":").map((part) => parseInt(part, 10));
  if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return key;
  return `${toArabicNumeral(surah)}:${toArabicNumeral(ayah)}`;
}

function toArabicNumeral(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d, 10)]);
}
