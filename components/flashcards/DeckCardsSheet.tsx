import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import { CalendarDays, Clock3, PauseCircle, RotateCcw, Search, Star, Trash2 } from "lucide-react-native";
import { DueDateSheet } from "@/components/flashcards/DueDateSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
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
import type { DeckCardListItem } from "@/lib/fsrs/types";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import { useSettings } from "@/lib/settings/context";
import { State } from "@/lib/fsrs/scheduler";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";

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

const CARD_FILTERS: Filter[] = [
  "all",
  "due",
  "scheduled",
  "new",
  "learning",
  "review",
  "relearning",
  "marked",
  "suspended",
  "buried",
];

/** A listed row was live when loaded, so acting on it must not revive it; a virtual card may be created. */
function liveIf(card: DeckCardListItem) {
  return { requireLive: !card.isVirtual };
}

export function DeckCardsSheet({ visible, deckId, deckTitle, onClose, onChanged }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const [cards, setCards] = useState<DeckCardListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "delete" | "reset"; card: DeckCardListItem } | null>(null);
  const [dueTarget, setDueTarget] = useState<DeckCardListItem | null>(null);
  const [dueDateText, setDueDateText] = useState("");
  const [dueDateError, setDueDateError] = useState<string | null>(null);

  /** Reload the list; false when it failed and its own error is showing. */
  const loadCards = useCallback(async () => {
    if (!visible || !deckId) return true;
    setLoading(true);
    setError(null);
    try {
      setCards(await getDeckCardsForList(db, deckId));
      return true;
    } catch (e) {
      console.warn("[DeckCardsSheet] Failed to load cards:", e);
      setError(s.deckCardsLoadFailed);
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
    }
  }, [visible]);

  const filteredCards = useMemo(() => {
    const now = new Date().toISOString();
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (!matchesCardFilter(card, filter, now)) return false;
      if (!needle) return true;
      return card.searchText.toLowerCase().includes(needle);
    });
  }, [cards, filter, query]);

  // A deck can hold 6,236 cards; rendering every row at once stalled the sheet on phones. Rows are
  // shown a page at a time, and a new deck, search or filter starts again from the first page.
  const pageKey = `${deckId}|${filter}|${query}`;
  const [paging, setPaging] = useState({ key: pageKey, count: DECK_CARDS_PAGE });
  const shownCount = paging.key === pageKey ? paging.count : DECK_CARDS_PAGE;
  const shownCards = filteredCards.slice(0, shownCount);
  const hiddenCount = filteredCards.length - shownCards.length;

  const runAction = useCallback(async (card: DeckCardListItem, action: () => Promise<void>) => {
    if (!deckId || busyId) return;
    setBusyId(card.id);
    setError(null);
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
      } else setError(s.cardActionFailed);
    } finally {
      setBusyId(null);
    }
  }, [busyId, deckId, loadCards, onChanged, s.cardActionFailed, s.cardDeletedElsewhere]);

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

  return (
    <>
      <ResponsiveSheet
        open={visible}
        onClose={onClose}
        maxWidth={900}
        maxHeight="92%"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <OverlayHeader title={s.deckCardsTitle} subtitle={deckTitle} onClose={onClose} isRTL={isRTL} showHandle />
        <OverlayBody contentContainerClassName="px-5 pb-8">
          <View className="gap-3">
            <View
              className="items-center gap-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4"
              style={rowFlexStyle}
            >
              <Search size={17} color={isDark ? "#737373" : "#8B8178"} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={s.deckCardsSearchPlaceholder}
                placeholderTextColor={isDark ? "#737373" : "#b9a085"}
                className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 14,
                  ...inputTextStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              />
            </View>

            <View className="flex-row flex-wrap gap-2" style={{ ...rowFlexStyle, flexWrap: "wrap" }}>
              {CARD_FILTERS.map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setFilter(value)}
                  className="rounded-full px-3 py-2"
                  style={{
                    backgroundColor: filter === value ? (isDark ? "#0f766e" : "#0d9488") : (isDark ? "#292524" : "#F5EDE3"),
                  }}
                >
                  <Text
                    style={{
                      color: filter === value ? "#fff" : (isDark ? "#d4d4d4" : "#6e5a47"),
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 12,
                    }}
                  >
                    {getFilterLabel(value, s)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? (
              <Text
                className="text-red-600 dark:text-red-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL)}}
              >
                {error}
              </Text>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ width: "100%" }}
              contentContainerStyle={{ flexGrow: 1, minWidth: "100%" }}
            >
              <View
                className="rounded-2xl border border-warm-200 dark:border-neutral-800 overflow-hidden"
                // Columns flex to fit a phone; the minimum only scrolls on screens narrower than the four columns.
                style={{ minWidth: 320, width: "100%" }}
              >
                <DeckCardsHeader isRTL={isRTL} s={s} rowFlexStyle={rowFlexStyle} />
                {loading ? (
                  <TableMessage text={s.deckCardsLoading} isRTL={isRTL} />
                ) : filteredCards.length === 0 ? (
                  <TableMessage text={s.deckCardsEmpty} isRTL={isRTL} />
                ) : (
                  shownCards.map((card) => (
                    <DeckCardRow
                      key={card.id}
                      card={card}
                      busy={busyId === card.id}
                      isRTL={isRTL}
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
                      onToggleMark={() => runAction(card, async () => {
                        await setStudyCardMarked(db, card.deck_id, card.id, !card.marked_at, liveIf(card));
                      })}
                      onToggleSuspend={() => runAction(card, async () => {
                        await setStudyCardSuspended(db, card.deck_id, card.id, !card.suspended_at, liveIf(card));
                      })}
                      onToggleBury={() => {
                        const isBuried = !!card.buried_until && card.buried_until > new Date().toISOString();
                        runAction(card, async () => {
                          await setStudyCardBuried(db, card.deck_id, card.id, !isBuried, liveIf(card));
                        });
                      }}
                      onSetDueDate={() => openDueDate(card)}
                    />
                  ))
                )}
              </View>
            </ScrollView>
            {!loading && hiddenCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPaging({ key: pageKey, count: shownCount + DECK_CARDS_PAGE })}
                className="items-center rounded-2xl bg-surface-low dark:bg-surface-dark-low py-3"
              >
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                >
                  {interpolate(s.deckCardsShowMore, { count: hiddenCount })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </OverlayBody>
      </ResponsiveSheet>

      <ConfirmDialog
        visible={!!confirmAction}
        title={confirmAction?.type === "delete" ? s.cardDeleteTitle : s.cardResetTitle}
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
}

function DeckCardsHeader({ isRTL, s, rowFlexStyle }: { isRTL: boolean; s: UIStrings; rowFlexStyle: ViewStyle }) {
  return (
    <View
      className="items-center gap-3 bg-surface-low dark:bg-surface-dark-low px-3 py-2"
      style={rowFlexStyle}
    >
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
      style={{ flex, fontFamily: "Manrope_700Bold", fontSize: 11, ...textStartStyle(isRTL)}}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
}

function DeckCardRow({
  card,
  busy,
  isRTL,
  rowFlexStyle,
  s,
  onDelete,
  onReset,
  onToggleMark,
  onToggleSuspend,
  onToggleBury,
  onSetDueDate,
}: {
  card: DeckCardListItem;
  busy: boolean;
  isRTL: boolean;
  rowFlexStyle: ViewStyle;
  s: UIStrings;
  onDelete: () => void;
  onReset: () => void;
  onToggleMark: () => void;
  onToggleSuspend: () => void;
  onToggleBury: () => void;
  onSetDueDate: () => void;
}) {
  const now = new Date().toISOString();
  const isBuried = !!card.buried_until && card.buried_until > now;
  const menuItems: DropdownMenuItem[] = [
    {
      key: "mark",
      label: card.marked_at ? s.cardUnmark : s.cardMark,
      icon: (color) => <Star size={15} color={color} fill={card.marked_at ? color : "transparent"} />,
      onPress: onToggleMark,
    },
    {
      key: "suspend",
      label: card.suspended_at ? s.cardUnsuspend : s.cardSuspend,
      icon: (color) => <PauseCircle size={15} color={color} />,
      onPress: onToggleSuspend,
    },
    {
      key: "bury",
      label: isBuried ? s.cardUnbury : s.cardBury,
      icon: (color) => <Clock3 size={15} color={color} />,
      onPress: onToggleBury,
    },
    {
      key: "due",
      label: s.cardSetDueDate,
      icon: (color) => <CalendarDays size={15} color={color} />,
      onPress: onSetDueDate,
    },
    {
      key: "reset",
      label: s.cardResetProgress,
      icon: (color) => <RotateCcw size={15} color={color} />,
      onPress: onReset,
    },
    {
      key: "delete",
      label: s.cardDelete,
      icon: (color) => <Trash2 size={15} color={color} />,
      onPress: onDelete,
      disabled: card.isVirtual,
      destructive: true,
    },
  ];

  return (
    <View
      className="items-center gap-3 border-t border-warm-200 dark:border-neutral-800 px-3 py-2"
      style={{ ...rowFlexStyle, opacity: busy ? 0.55 : 1 }}
    >
      <View style={{ flex: 1.45, minWidth: 0 }}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          numberOfLines={1}
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
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{ flex: 0.72, fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL)}}
        numberOfLines={1}
      >
        {formatShortDate(card.due)}
      </Text>
      <View style={{ flex: 0.72, alignItems: isRTL ? "flex-end" : "flex-start" }}>
        <StatePill state={card.state} s={s} />
      </View>
      <View className="items-center" style={{ width: 44, alignItems: isRTL ? "flex-start" : "flex-end" }}>
        <DropdownMenu
          triggerLabel={s.cardActionsTitle}
          disabled={busy}
          items={menuItems}
          isRTL={isRTL}
        />
      </View>
    </View>
  );
}

function StatePill({ state, s }: { state: number; s: UIStrings }) {
  const map: Record<number, { label: string; color: string }> = {
    [State.New]: { label: s.flashcardsSummaryNew, color: "#3b82f6" },
    [State.Learning]: { label: s.flashcardsSummaryLearning, color: "#f97316" },
    [State.Review]: { label: s.flashcardsSummaryReview, color: "#22c55e" },
    [State.Relearning]: { label: s.flashcardsSummaryRelearning, color: "#ef4444" },
  };
  const item = map[state] ?? map[State.New];
  return (
    <View className="rounded-full px-2 py-1" style={{ backgroundColor: item.color }}>
      <Text style={{ color: "#fff", fontFamily: "Manrope_700Bold", fontSize: 10 }} numberOfLines={1}>
        {item.label}
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

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDateInput(date);
}
