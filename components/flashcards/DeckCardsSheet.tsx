import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CalendarDays, Clock3, PauseCircle, RotateCcw, Search, Star, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  deleteStudyCard,
  getDeckCardsForList,
  resetStudyCardProgress,
  setStudyCardBuried,
  setStudyCardDueDate,
  setStudyCardMarked,
  setStudyCardSuspended,
} from "@/lib/fsrs/queries";
import type { DeckCardListItem } from "@/lib/fsrs/types";
import { useSettings } from "@/lib/settings/context";
import { State } from "@/lib/fsrs/scheduler";

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

  const loadCards = useCallback(async () => {
    if (!visible || !deckId) return;
    setLoading(true);
    setError(null);
    try {
      setCards(await getDeckCardsForList(db, deckId));
    } catch (e) {
      console.warn("[DeckCardsSheet] Failed to load cards:", e);
      setError(s.deckCardsLoadFailed);
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
      setError(s.cardActionFailed);
    } finally {
      setBusyId(null);
    }
  }, [busyId, deckId, loadCards, onChanged, s.cardActionFailed]);

  const openDueDate = useCallback((card: DeckCardListItem) => {
    setDueTarget(card);
    setDueDateText(formatLocalDateInput(new Date(card.due)));
    setDueDateError(null);
  }, []);

  const saveDueDate = useCallback(() => {
    if (!deckId || !dueTarget) return;
    const parsed = parseDueDateInput(dueDateText);
    if (!parsed.ok) {
      setDueDateError(parsed.reason === "past" ? s.cardDueDatePast : s.cardDueDateInvalid);
      return;
    }
    runAction(dueTarget, async () => {
      await setStudyCardDueDate(db, deckId, dueTarget.id, parsed.date);
      setDueTarget(null);
      setDueDateError(null);
    });
  }, [db, deckId, dueDateText, dueTarget, runAction, s.cardDueDateInvalid, s.cardDueDatePast]);
  const rowDirection = isRTL ? "row-reverse" : "row";

  return (
    <>
      <ResponsiveSheet
        open={visible}
        onClose={onClose}
        maxWidth={900}
        maxHeight="92%"
      >
        <OverlayHeader title={s.deckCardsTitle} subtitle={deckTitle} onClose={onClose} isRTL={isRTL} showHandle />
        <OverlayBody contentContainerClassName="px-5 pb-8">
          <View className="gap-3">
            <View
              className="items-center gap-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4"
              style={{ flexDirection: rowDirection }}
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
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              />
            </View>

            <View className="flex-row flex-wrap gap-2" style={{ flexDirection: rowDirection }}>
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
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
              >
                {error}
              </Text>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="rounded-2xl border border-warm-200 dark:border-neutral-800 overflow-hidden" style={{ minWidth: 760, flex: 1 }}>
                <DeckCardsHeader isDark={isDark} isRTL={isRTL} s={s} />
                {loading ? (
                  <TableMessage text={s.deckCardsLoading} isRTL={isRTL} />
                ) : filteredCards.length === 0 ? (
                  <TableMessage text={s.deckCardsEmpty} isRTL={isRTL} />
                ) : (
                  filteredCards.map((card) => (
                    <DeckCardRow
                      key={card.id}
                      card={card}
                      busy={busyId === card.id}
                      isDark={isDark}
                      isRTL={isRTL}
                      s={s}
                      onDelete={() => setConfirmAction({ type: "delete", card })}
                      onReset={() => setConfirmAction({ type: "reset", card })}
                      onToggleMark={() => runAction(card, async () => {
                        await setStudyCardMarked(db, card.deck_id, card.id, !card.marked_at);
                      })}
                      onToggleSuspend={() => runAction(card, async () => {
                        await setStudyCardSuspended(db, card.deck_id, card.id, !card.suspended_at);
                      })}
                      onToggleBury={() => {
                        const isBuried = !!card.buried_until && card.buried_until > new Date().toISOString();
                        runAction(card, async () => {
                          await setStudyCardBuried(db, card.deck_id, card.id, !isBuried);
                        });
                      }}
                      onSetDueDate={() => openDueDate(card)}
                    />
                  ))
                )}
              </View>
            </ScrollView>
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
            else await resetStudyCardProgress(db, card.deck_id, card.id);
            setConfirmAction(null);
          });
        }}
      />

      <DueDateEditor
        visible={!!dueTarget}
        value={dueDateText}
        error={dueDateError}
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

function DeckCardsHeader({ isDark, isRTL, s }: { isDark: boolean; isRTL: boolean; s: any }) {
  return (
    <View
      className="items-center gap-3 bg-surface-low dark:bg-surface-dark-low px-3 py-2"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <HeaderCell label={s.deckCardsCardColumn} flex={1.45} isRTL={isRTL} />
      <HeaderCell label={s.deckCardsDueColumn} flex={0.72} isRTL={isRTL} />
      <HeaderCell label={s.deckCardsStateColumn} flex={0.72} isRTL={isRTL} />
      <HeaderCell label={s.deckCardsStatusColumn} flex={0.86} isRTL={isRTL} />
      <View style={{ width: 180 }} />
    </View>
  );
}

function HeaderCell({ label, flex, isRTL }: { label: string; flex: number; isRTL: boolean }) {
  return (
    <Text
      className="text-warm-500 dark:text-neutral-400"
      style={{ flex, fontFamily: "Manrope_700Bold", fontSize: 11, textAlign: isRTL ? "right" : "left" }}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
}

function DeckCardRow({
  card,
  busy,
  isDark,
  isRTL,
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
  isDark: boolean;
  isRTL: boolean;
  s: any;
  onDelete: () => void;
  onReset: () => void;
  onToggleMark: () => void;
  onToggleSuspend: () => void;
  onToggleBury: () => void;
  onSetDueDate: () => void;
}) {
  const now = new Date().toISOString();
  const isBuried = !!card.buried_until && card.buried_until > now;
  const mutedColor = isDark ? "#a3a3a3" : "#8B8178";
  return (
    <View
      className="items-center gap-3 border-t border-warm-200 dark:border-neutral-800 px-3 py-2"
      style={{ flexDirection: isRTL ? "row-reverse" : "row", opacity: busy ? 0.55 : 1 }}
    >
      <View style={{ flex: 1.45, minWidth: 0 }}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          numberOfLines={1}
        >
          {card.title}
        </Text>
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 11, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          numberOfLines={1}
        >
          {card.subtitle || card.reference}
        </Text>
      </View>
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{ flex: 0.72, fontFamily: "Manrope_500Medium", fontSize: 11, textAlign: isRTL ? "right" : "left" }}
        numberOfLines={1}
      >
        {formatShortDate(card.due)}
      </Text>
      <View style={{ flex: 0.72 }}>
        <StatePill state={card.state} s={s} />
      </View>
      <View className="items-center gap-1" style={{ flex: 0.86, flexDirection: isRTL ? "row-reverse" : "row" }}>
        {card.marked_at ? <Star size={14} color={isDark ? "#facc15" : "#ca8a04"} fill={isDark ? "#facc15" : "#ca8a04"} /> : null}
        {card.suspended_at ? <PauseCircle size={14} color={mutedColor} /> : null}
        {isBuried ? <Clock3 size={14} color={isDark ? "#fbbf24" : "#d97706"} /> : null}
      </View>
      <View className="items-center gap-1" style={{ width: 180, flexDirection: isRTL ? "row-reverse" : "row" }}>
        <IconButton label={card.marked_at ? s.cardUnmark : s.cardMark} disabled={busy} onPress={onToggleMark} icon={<Star size={13} color={isDark ? "#facc15" : "#ca8a04"} fill={card.marked_at ? (isDark ? "#facc15" : "#ca8a04") : "transparent"} />} />
        <IconButton label={card.suspended_at ? s.cardUnsuspend : s.cardSuspend} disabled={busy} onPress={onToggleSuspend} icon={<PauseCircle size={13} color={mutedColor} />} />
        <IconButton label={isBuried ? s.cardUnbury : s.cardBury} disabled={busy} onPress={onToggleBury} icon={<Clock3 size={13} color={isDark ? "#fbbf24" : "#d97706"} />} />
        <IconButton label={s.cardSetDueDate} disabled={busy} onPress={onSetDueDate} icon={<CalendarDays size={13} color={mutedColor} />} />
        <IconButton label={s.cardResetProgress} disabled={busy} onPress={onReset} icon={<RotateCcw size={13} color={mutedColor} />} />
        <IconButton label={s.cardDelete} disabled={busy || card.isVirtual} onPress={onDelete} icon={<Trash2 size={13} color={isDark ? "#f87171" : "#dc2626"} />} />
      </View>
    </View>
  );
}

function IconButton({ icon, label, disabled, onPress }: { icon: ReactNode; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-7 w-7 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.7 : 1 })}
    >
      {icon}
    </Pressable>
  );
}

function StatePill({ state, s }: { state: number; s: any }) {
  const map: Record<number, { label: string; color: string }> = {
    [State.New]: { label: s.flashcardsSummaryNew, color: "#3b82f6" },
    [State.Learning]: { label: s.flashcardsSummaryLearning, color: "#f97316" },
    [State.Review]: { label: s.flashcardsSummaryReview, color: "#22c55e" },
    [State.Relearning]: { label: s.flashcardsSummaryRelearning, color: "#ef4444" },
  };
  const item = map[state] ?? map[State.New];
  return (
    <View className="self-start rounded-full px-2 py-1" style={{ backgroundColor: item.color }}>
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

function DueDateEditor({
  visible,
  value,
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
  error: string | null;
  busy: boolean;
  isDark: boolean;
  isRTL: boolean;
  s: any;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={420}
      maxHeight={360}
      avoidKeyboard
    >
      <OverlayHeader title={s.cardSetDueDate} subtitle={s.cardDueDateHint} onClose={onClose} isRTL={isRTL} showHandle />
      <OverlayBody scrollEnabled={false} contentContainerClassName="px-5 py-5">
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={s.cardDueDatePlaceholder}
          placeholderTextColor={isDark ? "#737373" : "#b9a085"}
          keyboardType="numbers-and-punctuation"
          className="min-h-12 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: "ltr" }}
        />
        {error ? (
          <Text
            className="mt-3 text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {error}
          </Text>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button variant="outline" onPress={onClose} disabled={busy} className="flex-1">
          <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {s.flashcardsCancel}
          </Text>
        </Button>
        <Button onPress={onSave} disabled={busy} className="flex-1">
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {s.cardSaveDueDate}
          </Text>
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

function getFilterLabel(filter: Filter, s: any): string {
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

function normalizeDateDigits(value: string): string {
  const western = "0123456789";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex >= 0) return western[arabicIndex];
    return western[eastern.indexOf(digit)];
  });
}

function formatLocalDateInput(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDueDateInput(value: string): { ok: true; date: Date } | { ok: false; reason: "invalid" | "past" } {
  const normalized = normalizeDateDigits(value.trim());
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, reason: "invalid" };
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { ok: false, reason: "invalid" };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return { ok: false, reason: "past" };
  return { ok: true, date };
}
