import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type ViewStyle } from "react-native";
import { BookOpen, CalendarDays, Clock3, PauseCircle, RotateCcw, Search, Star, Trash2 } from "lucide-react-native";
import { DueDateSheet } from "@/components/flashcards/DueDateSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { formatCards, formatNumber } from "@/lib/i18n/count";
import {
  deleteStudyCard,
  getDeckCardsForList,
  resetStudyCardProgress,
  setStudyCardBuried,
  setStudyCardDueDate,
  setStudyCardMarked,
  setStudyCardSuspended,
} from "@/lib/fsrs/queries";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { formatCardDueDay } from "@/lib/fsrs/card-dates";
import { cardStateColor } from "@/lib/fsrs/review-colors";
import type { DeckCardListItem } from "@/lib/fsrs/types";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import { stripArabicDiacritics } from "@/lib/arabic";
import { useSettings } from "@/lib/settings/context";
import { State } from "@/lib/fsrs/scheduler";
import { VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import type { DeepLinkTarget } from "@/lib/deep-link";

export function deckCardMushafTarget(card: Pick<DeckCardListItem, "id" | "kind">): DeepLinkTarget | null {
  const match =
    card.kind === "ayah"
      ? /^(\d+):(\d+)$/.exec(card.id)
      : card.kind === "word"
        ? /^word:(\d+):(\d+):(\d+)$/.exec(card.id)
        : null;
  if (!match) return null;
  const target: DeepLinkTarget = { surah: Number(match[1]), ayah: Number(match[2]) };
  if (match[3]) target.wordPos = Number(match[3]);
  return target;
}

type Props = {
  visible: boolean;
  deckId: string | null;
  deckTitle: string;
  onClose: () => void;
  onChanged: () => void;
};

type Filter =
  | "all"
  | "due"
  | "scheduled"
  | "new"
  | "learning"
  | "review"
  | "relearning"
  | "marked"
  | "suspended"
  | "buried";

const DECK_CARDS_PAGE = 100;

const STATE_FILTERS: Filter[] = ["all", "due", "scheduled", "new", "learning", "review", "relearning"];
const FLAG_FILTERS: Filter[] = ["marked", "suspended", "buried"];

function liveIf(card: DeckCardListItem) {
  return { requireLive: !card.isVirtual };
}

function searchKey(text: string): string {
  return stripArabicDiacritics(text).toLowerCase();
}

export function deckCardName(card: DeckCardListItem, isRTL: boolean): string {
  if (card.kind === "word") return isRTL ? card.titleAr : card.title;
  if (card.kind === "smart") return isRTL ? `${card.subtitleAr} ${card.titleAr}`.trim() : card.title;
  const name = isRTL ? card.subtitleAr : card.subtitle;
  const reference = isRTL ? card.titleAr : card.title;
  return name ? `${name} ${reference}` : reference;
}

export function DeckCardsSheet({ visible, deckId, deckTitle, onClose, onChanged }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const openMushaf = useOpenMushaf();
  const language = isRTL ? "ar" : "en";
  const { width } = useWindowDimensions();
  const stacked = width <= VIEWPORT_BREAKPOINTS.phoneLarge;
  const [cards, setCards] = useState<DeckCardListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ cardId: string; retry: () => void } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "delete" | "reset"; card: DeckCardListItem } | null>(null);
  const [dueTarget, setDueTarget] = useState<DeckCardListItem | null>(null);
  const [dueDateText, setDueDateText] = useState("");
  const [dueDateError, setDueDateError] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    if (!visible || !deckId) return true;
    setLoading(true);
    setLoadError(null);
    try {
      setCards(await getDeckCardsForList(db, deckId));
      setLoaded(true);
      return true;
    } catch (e) {
      console.warn("[DeckCardsSheet] Failed to load cards:", e);
      setLoadError(s.deckCardsLoadFailed);
      return false;
    } finally {
      setLoading(false);
    }
  }, [db, deckId, s.deckCardsLoadFailed, visible]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setFilter("all");
      setConfirmAction(null);
      setDueTarget(null);
      setDueDateError(null);
      setError(null);
      setFailed(null);
      setLoaded(false);
    }
  }, [visible]);

  const filteredCards = useMemo(() => {
    const now = new Date().toISOString();
    const needle = searchKey(query.trim());
    return cards.filter((card) => {
      if (!matchesCardFilter(card, filter, now)) return false;
      if (!needle) return true;
      return searchKey(card.searchText).includes(needle);
    });
  }, [cards, filter, query]);

  const pageKey = `${deckId}|${filter}|${query}`;
  const [paging, setPaging] = useState({ key: pageKey, count: DECK_CARDS_PAGE });
  const shownCount = paging.key === pageKey ? paging.count : DECK_CARDS_PAGE;
  const shownCards = filteredCards.slice(0, shownCount);
  const hiddenCount = filteredCards.length - shownCards.length;

  const runAction = useCallback(
    async (card: DeckCardListItem, action: () => Promise<void>) => {
      if (!deckId || busyId) return;
      setBusyId(card.id);
      setError(null);
      setFailed(null);
      try {
        await action();
        await loadCards();
        onChanged();
      } catch (e) {
        console.warn("[DeckCardsSheet] Card action failed:", e);
        if (e instanceof StudyCardDeletedError) {
          setConfirmAction(null);
          setDueTarget(null);
          const reloaded = await loadCards();
          onChanged();
          if (reloaded) setError(s.cardDeletedElsewhere);
        } else {
          setError(s.cardActionFailed);
          setFailed({ cardId: card.id, retry: () => void runAction(card, action) });
        }
      } finally {
        setBusyId(null);
      }
    },
    [busyId, deckId, loadCards, onChanged, s.cardActionFailed, s.cardDeletedElsewhere],
  );

  const openDueDate = useCallback((card: DeckCardListItem) => {
    setDueTarget(card);
    setDueDateText(formatLocalDateInput(new Date(card.due)));
    setDueDateError(null);
    setError(null);
  }, []);

  const saveDueDate = useCallback(() => {
    if (!deckId || !dueTarget) return;
    const parsed = parseDueDateInput(dueDateText);
    if (!parsed.ok) {
      setDueDateError(parsed.reason === "past" ? s.cardDueDatePast : s.cardDueDateInvalid);
      return;
    }
    setDueDateError(null);
    runAction(dueTarget, async () => {
      await setStudyCardDueDate(db, deckId, dueTarget.id, parsed.date, liveIf(dueTarget));
      setDueTarget(null);
      setDueDateError(null);
    });
  }, [db, deckId, dueDateText, dueTarget, runAction, s.cardDueDateInvalid, s.cardDueDatePast]);
  const rowFlexStyle: ViewStyle = {
    direction: "ltr",
    flexDirection: isRTL ? "row-reverse" : "row",
  };
  const subtitle = loaded
    ? interpolate(s.deckCardsSubtitle, { deck: deckTitle, cards: formatCards(cards.length, language) })
    : deckTitle;

  const tableMessage = loading
    ? s.deckCardsLoading
    : loadError
      ? null
      : cards.length === 0
        ? s.deckCardsNoCardsYet
        : filteredCards.length === 0
          ? s.deckCardsNoMatch
          : null;

  const filterChip = (value: Filter) => {
    const selected = filter === value;
    return (
      <Pressable
        key={value}
        onPress={() => setFilter(value)}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        className="min-h-11 justify-center rounded-full px-3 py-2"
        style={{
          backgroundColor: selected ? (isDark ? "#0f766e" : "#0d9488") : isDark ? "#292524" : "#F5EDE3",
        }}
      >
        <Text
          style={{
            color: selected ? "#fff" : isDark ? "#d4d4d4" : "#6e5a47",
            fontFamily: "Manrope_600SemiBold",
            fontSize: 12,
          }}
        >
          {getFilterLabel(value, s)}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <ResponsiveSheet open={visible} onClose={onClose} maxWidth={900} maxHeight="92%" dir={isRTL ? "rtl" : "ltr"}>
        <OverlayHeader title={s.deckCardsTitle} subtitle={subtitle} onClose={onClose} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 pb-8">
          <View className="gap-3">
            <View className="items-center gap-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4" style={rowFlexStyle}>
              <Search size={17} color={isDark ? "#737373" : "#8B8178"} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                accessibilityLabel={s.deckCardsSearchPlaceholder}
                placeholder={s.deckCardsSearchPlaceholder}
                placeholderTextColor={isDark ? "#737373" : "#8B8178"}
                className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 14,
                  ...inputTextStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              />
            </View>

            <View className="gap-2" accessibilityRole="radiogroup">
              <View
                className="flex-row flex-wrap gap-2"
                accessibilityLabel={s.deckCardsStatesGroup}
                style={{ ...rowFlexStyle, flexWrap: "wrap" }}
              >
                {STATE_FILTERS.map(filterChip)}
              </View>
              <View
                className="flex-row flex-wrap gap-2"
                accessibilityLabel={s.deckCardsFlagsGroup}
                style={{ ...rowFlexStyle, flexWrap: "wrap" }}
              >
                {FLAG_FILTERS.map(filterChip)}
              </View>
            </View>

            {error && !confirmAction && !dueTarget ? (
              <Text
                accessibilityRole="alert"
                className="text-red-600 dark:text-red-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL) }}
              >
                {error}
              </Text>
            ) : null}

            {stacked ? (
              <View className="rounded-2xl border border-warm-200 dark:border-neutral-800 overflow-hidden">
                {renderBody(true)}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ width: "100%" }}
                contentContainerStyle={{ flexGrow: 1, minWidth: "100%" }}
              >
                <View
                  className="rounded-2xl border border-warm-200 dark:border-neutral-800 overflow-hidden"
                  style={{ minWidth: 320, width: "100%" }}
                >
                  <DeckCardsHeader isRTL={isRTL} s={s} rowFlexStyle={rowFlexStyle} />
                  {renderBody(false)}
                </View>
              </ScrollView>
            )}
            {!loading && !loadError && filteredCards.length > 0 ? (
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {interpolate(s.deckCardsShowing, {
                  shown: formatNumber(shownCards.length, language),
                  total: formatNumber(filteredCards.length, language),
                })}
              </Text>
            ) : null}
            {!loading && hiddenCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPaging({ key: pageKey, count: shownCount + DECK_CARDS_PAGE })}
                className="items-center rounded-2xl bg-surface-low dark:bg-surface-dark-low py-3"
              >
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                  {interpolate(s.deckCardsShowMore, { count: formatNumber(hiddenCount, language) })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </OverlayBody>
      </ResponsiveSheet>

      <ConfirmDialog
        visible={!!confirmAction}
        title={
          confirmAction
            ? interpolate(confirmAction.type === "delete" ? s.cardDeleteNamed : s.cardResetNamed, {
                card: deckCardName(confirmAction.card, isRTL),
              })
            : ""
        }
        message={confirmAction?.type === "delete" ? s.cardDeleteConfirm : s.cardResetConfirm}
        cancelLabel={s.flashcardsCancel}
        confirmLabel={confirmAction?.type === "delete" ? s.flashcardsDelete : s.cardResetProgress}
        destructive={confirmAction?.type === "delete"}
        confirmLoading={!!confirmAction && busyId === confirmAction.card.id}
        error={error}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          if (!busyId) setConfirmAction(null);
        }}
        onConfirm={() => {
          if (!confirmAction) return;
          const { card, type } = confirmAction;
          if (type === "delete" && card.isVirtual) {
            setConfirmAction(null);
            return;
          }
          runAction(card, async () => {
            if (type === "delete") await deleteStudyCard(db, card.deck_id, card.id);
            else await resetStudyCardProgress(db, card.deck_id, card.id, liveIf(card));
            setConfirmAction(null);
          });
        }}
      />

      <DueDateSheet
        visible={!!dueTarget}
        value={dueDateText}
        error={dueDateError ?? error}
        busy={!!dueTarget && busyId === dueTarget.id}
        isDark={isDark}
        isRTL={isRTL}
        s={s}
        onChange={setDueDateText}
        onClose={() => {
          if (!busyId) setDueTarget(null);
        }}
        onSave={saveDueDate}
      />
    </>
  );

  function renderBody(isStacked: boolean) {
    if (loadError) {
      return (
        <View className="items-center gap-2 border-t border-warm-200 px-4 py-8 dark:border-neutral-800" accessibilityRole="alert">
          <Text
            className="text-center text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {loadError}
          </Text>
          <Pressable onPress={() => void loadCards()} accessibilityRole="button" className="min-h-11 justify-center rounded-full px-4">
            <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {s.decksTryAgain}
            </Text>
          </Pressable>
        </View>
      );
    }
    if (tableMessage) return <TableMessage text={tableMessage} isRTL={isRTL} />;
    return shownCards.map((card) => (
      <DeckCardRow
        key={card.id}
        card={card}
        stacked={isStacked}
        busy={busyId === card.id}
        failed={failed?.cardId === card.id ? failed.retry : null}
        isRTL={isRTL}
        isDark={isDark}
        rowFlexStyle={rowFlexStyle}
        s={s}
        onDelete={() => {
          setError(null);
          setConfirmAction({ type: "delete", card });
        }}
        onReset={() => {
          setError(null);
          setConfirmAction({ type: "reset", card });
        }}
        onToggleMark={() =>
          runAction(card, async () => {
            await setStudyCardMarked(db, card.deck_id, card.id, !card.marked_at, liveIf(card));
          })
        }
        onToggleSuspend={() =>
          runAction(card, async () => {
            await setStudyCardSuspended(db, card.deck_id, card.id, !card.suspended_at, liveIf(card));
          })
        }
        onToggleBury={() => {
          const isBuried = !!card.buried_until && card.buried_until > new Date().toISOString();
          runAction(card, async () => {
            await setStudyCardBuried(db, card.deck_id, card.id, !isBuried, liveIf(card));
          });
        }}
        onSetDueDate={() => openDueDate(card)}
        onOpenInMushaf={
          deckCardMushafTarget(card)
            ? () => {
                const target = deckCardMushafTarget(card);
                if (!target) return;
                onClose();
                openMushaf(target);
              }
            : undefined
        }
      />
    ));
  }
}

function DeckCardsHeader({ isRTL, s, rowFlexStyle }: { isRTL: boolean; s: UIStrings; rowFlexStyle: ViewStyle }) {
  return (
    <View className="items-center gap-3 bg-surface-low dark:bg-surface-dark-low px-3 py-2" style={rowFlexStyle}>
      <HeaderCell label={s.deckCardsCardColumn} flex={1.45} isRTL={isRTL} />
      <HeaderCell label={s.deckCardsDueColumn} flex={0.72} isRTL={isRTL} />
      <HeaderCell label={s.deckCardsStateColumn} flex={0.72} isRTL={isRTL} />
      <View style={{ width: 44 }} />
    </View>
  );
}

function HeaderCell({ label, flex, isRTL }: { label: string; flex: number; isRTL: boolean }) {
  return (
    <Text
      className="text-warm-500 dark:text-neutral-400"
      style={{ flex, fontFamily: "Manrope_700Bold", fontSize: 11, ...textStartStyle(isRTL) }}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
}

export function deckCardMenuItems(
  card: Pick<DeckCardListItem, "marked_at" | "suspended_at" | "buried_until" | "isVirtual">,
  s: UIStrings,
  handlers: {
    onOpenInMushaf?: () => void;
    onToggleMark: () => void;
    onToggleSuspend: () => void;
    onToggleBury: () => void;
    onSetDueDate: () => void;
    onReset: () => void;
    onDelete: () => void;
  },
): DropdownMenuItem[] {
  const isBuried = !!card.buried_until && card.buried_until > new Date().toISOString();
  return [
    ...(handlers.onOpenInMushaf
      ? [
          {
            key: "open",
            label: s.cardOpenInMushaf,
            icon: (color: string) => <BookOpen size={15} color={color} />,
            onPress: handlers.onOpenInMushaf,
          },
        ]
      : []),
    {
      key: "mark",
      label: card.marked_at ? s.cardUnmark : s.cardMark,
      icon: (color) => <Star size={15} color={color} fill={card.marked_at ? color : "transparent"} />,
      onPress: handlers.onToggleMark,
    },
    {
      key: "suspend",
      label: card.suspended_at ? s.cardUnsuspend : s.cardSuspend,
      icon: (color) => <PauseCircle size={15} color={color} />,
      onPress: handlers.onToggleSuspend,
    },
    {
      key: "bury",
      label: isBuried ? s.cardUnbury : s.cardBury,
      icon: (color) => <Clock3 size={15} color={color} />,
      onPress: handlers.onToggleBury,
    },
    {
      key: "due",
      label: s.cardSetDueDate,
      icon: (color) => <CalendarDays size={15} color={color} />,
      onPress: handlers.onSetDueDate,
    },
    {
      key: "reset",
      label: s.cardResetProgress,
      icon: (color) => <RotateCcw size={15} color={color} />,
      onPress: handlers.onReset,
      separatorBefore: true,
    },
    ...(card.isVirtual
      ? []
      : [
          {
            key: "delete",
            label: s.cardDelete,
            icon: (color: string) => <Trash2 size={15} color={color} />,
            onPress: handlers.onDelete,
            destructive: true,
          },
        ]),
  ];
}

function DeckCardRow({
  card,
  stacked,
  busy,
  failed,
  isRTL,
  isDark,
  rowFlexStyle,
  s,
  onDelete,
  onReset,
  onToggleMark,
  onToggleSuspend,
  onToggleBury,
  onSetDueDate,
  onOpenInMushaf,
}: {
  card: DeckCardListItem;
  stacked: boolean;
  busy: boolean;
  failed: (() => void) | null;
  isRTL: boolean;
  isDark: boolean;
  rowFlexStyle: ViewStyle;
  s: UIStrings;
  onDelete: () => void;
  onReset: () => void;
  onToggleMark: () => void;
  onToggleSuspend: () => void;
  onToggleBury: () => void;
  onSetDueDate: () => void;
  onOpenInMushaf?: () => void;
}) {
  const language = isRTL ? "ar" : "en";
  const menuItems = deckCardMenuItems(card, s, {
    onOpenInMushaf,
    onToggleMark,
    onToggleSuspend,
    onToggleBury,
    onSetDueDate,
    onReset,
    onDelete,
  });
  const due = formatCardDueDay(card.due, language, { today: s.cardDueToday, tomorrow: s.cardDueTomorrow });
  const failureStyle: ViewStyle = failed
    ? { [isRTL ? "borderRightWidth" : "borderLeftWidth"]: 3, [isRTL ? "borderRightColor" : "borderLeftColor"]: isDark ? "#f87171" : "#dc2626" }
    : {};
  const titleNode = (
    <View style={{ flex: stacked ? 1 : 1.45, minWidth: 0 }}>
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={stacked ? 2 : 1}
      >
        {isRTL ? card.titleAr : card.title}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 11, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={1}
      >
        {(isRTL ? card.subtitleAr : card.subtitle) || card.reference}
      </Text>
    </View>
  );
  const menu = (
    <View style={{ width: 44, alignItems: isRTL ? "flex-start" : "flex-end" }}>
      <DropdownMenu triggerLabel={s.cardActionsTitle} disabled={busy} items={menuItems} isRTL={isRTL} />
    </View>
  );
  const retry = failed ? (
    <Pressable onPress={failed} accessibilityRole="button" className="min-h-11 justify-center" style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}>
      <Text className="text-red-600 dark:text-red-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textDecorationLine: "underline" }}>
        {s.decksTryAgain}
      </Text>
    </Pressable>
  ) : null;

  if (stacked) {
    return (
      <View className="gap-1 border-t border-warm-200 dark:border-neutral-800 px-3 py-2" style={{ opacity: busy ? 0.55 : 1, ...failureStyle }}>
        <View className="items-center gap-3" style={rowFlexStyle}>
          {titleNode}
          {menu}
        </View>
        <View className="items-center gap-3" style={rowFlexStyle}>
          <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
            {due}
          </Text>
          <StatePill state={card.state} isDark={isDark} s={s} />
        </View>
        {retry}
      </View>
    );
  }

  return (
    <View className="border-t border-warm-200 dark:border-neutral-800 px-3 py-2" style={{ opacity: busy ? 0.55 : 1, ...failureStyle }}>
      <View className="items-center gap-3" style={rowFlexStyle}>
        {titleNode}
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ flex: 0.72, fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL) }}
          numberOfLines={1}
        >
          {due}
        </Text>
        <View style={{ flex: 0.72, alignItems: isRTL ? "flex-end" : "flex-start" }}>
          <StatePill state={card.state} isDark={isDark} s={s} />
        </View>
        {menu}
      </View>
      {retry}
    </View>
  );
}

function StatePill({ state, isDark, s }: { state: number; isDark: boolean; s: UIStrings }) {
  const labels: Record<number, string> = {
    [State.New]: s.flashcardsSummaryNew,
    [State.Learning]: s.flashcardsSummaryLearning,
    [State.Review]: s.flashcardsSummaryReview,
    [State.Relearning]: s.flashcardsSummaryRelearning,
  };
  const token = cardStateColor(state, isDark);
  return (
    <View className="rounded-full px-2 py-1" style={{ backgroundColor: token.fill }}>
      <Text style={{ color: token.onFill, fontFamily: "Manrope_700Bold", fontSize: 10 }} numberOfLines={1}>
        {labels[state] ?? labels[State.New]}
      </Text>
    </View>
  );
}

function TableMessage({ text, isRTL }: { text: string; isRTL: boolean }) {
  return (
    <Text
      className="border-t border-warm-200 px-4 py-8 text-center text-warm-500 dark:border-neutral-800 dark:text-neutral-400"
      style={{ fontFamily: "Manrope_500Medium", fontSize: 14, writingDirection: isRTL ? "rtl" : "ltr" }}
    >
      {text}
    </Text>
  );
}

function getFilterLabel(filter: Filter, s: UIStrings): string {
  if (filter === "due") return s.deckCardsFilterDue;
  if (filter === "scheduled") return s.deckCardsFilterScheduled;
  if (filter === "new") return s.deckCardsFilterNew;
  if (filter === "learning") return s.deckCardsFilterLearning;
  if (filter === "review") return s.deckCardsFilterReview;
  if (filter === "relearning") return s.deckCardsFilterRelearning;
  if (filter === "marked") return s.deckCardsFilterMarked;
  if (filter === "suspended") return s.deckCardsFilterSuspended;
  if (filter === "buried") return s.deckCardsFilterBuried;
  return s.deckCardsFilterAll;
}

function matchesCardFilter(card: DeckCardListItem, filter: Filter, now: string): boolean {
  const isBuried = !!card.buried_until && card.buried_until > now;
  const isReviewable = !card.suspended_at && !isBuried;
  if (filter === "due") return isReviewable && card.due <= now;
  if (filter === "scheduled") return isReviewable && card.due > now;
  if (filter === "new") return card.state === State.New;
  if (filter === "learning") return card.state === State.Learning;
  if (filter === "review") return card.state === State.Review;
  if (filter === "relearning") return card.state === State.Relearning;
  if (filter === "marked") return !!card.marked_at;
  if (filter === "suspended") return !!card.suspended_at;
  if (filter === "buried") return isBuried;
  return true;
}
