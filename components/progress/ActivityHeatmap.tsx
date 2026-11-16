import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useSettings } from "@/lib/settings/context";
import type { UIStrings } from "@/lib/i18n/strings";
import { textEndStyle, textStartStyle } from "@/lib/ui/direction";
import { formatNumber, formatReviews } from "@/lib/i18n/count";
import type { DayStatus } from "@/lib/habit/types";

type DayData = { date: string; count: number };

type Props = {
  data: DayData[];
  isDark: boolean;
  s: UIStrings;
  isRTL?: boolean;
  activeDays?: number;
  totalReviews?: number;
  showSummaryStats?: boolean;
  size?: "compact" | "expanded";
  dayStatuses?: ReadonlyMap<string, DayStatus>;
  weekStart?: number;
};

const STATUS_ORDER: readonly DayStatus[] = ["done", "made_up", "earned_back", "excused", "paused", "grace"];

function statusLabel(status: DayStatus, s: UIStrings): string {
  switch (status) {
    case "done":
      return s.habitLegendDone;
    case "made_up":
      return s.habitLegendMadeUp;
    case "earned_back":
      return s.habitLegendEarnedBack;
    case "excused":
      return s.habitLegendExcused;
    case "paused":
      return s.habitLegendPaused;
    case "grace":
      return s.habitLegendGrace;
  }
}

function statusCellStyle(status: DayStatus, count: number, isDark: boolean) {
  const recitedFill = count > 0 ? undefined : isDark ? "#0f766e" : "#99f6e4";
  switch (status) {
    case "done":
      return { backgroundColor: recitedFill };
    case "made_up":
      return { backgroundColor: recitedFill, borderWidth: 2, borderColor: isDark ? "#FDDC91" : "#b7791f" };
    case "earned_back":
      return { backgroundColor: recitedFill, borderWidth: 2, borderColor: isDark ? "#5eead4" : "#0f766e", borderStyle: "dashed" as const };
    case "excused":
      return isDark
        ? { backgroundColor: "#713f12", borderWidth: 1, borderColor: "#a16207" }
        : { backgroundColor: "#fcd34d", borderWidth: 1, borderColor: "#d97706" };
    case "paused":
      return isDark
        ? { backgroundColor: "#3f3f46", borderWidth: 1, borderColor: "#71717a", borderStyle: "dashed" as const }
        : { backgroundColor: "#d4d4d8", borderWidth: 1, borderColor: "#a1a1aa", borderStyle: "dashed" as const };
    case "grace":
      return isDark
        ? { backgroundColor: "#1e3a8a", borderWidth: 1, borderColor: "#3b82f6" }
        : { backgroundColor: "#93c5fd", borderWidth: 1, borderColor: "#3b82f6" };
  }
}

const BASE_CELL_SIZE = 13;
const LABEL_COLOR = (isDark: boolean) => (isDark ? "#a3a3a3" : "#6E5A47");
const TODAY_RING = (isDark: boolean) => (isDark ? "#FDDC91" : "#785F22");
const DAY_LABEL_GAP = 6;
const TOTAL_WEEKS = 13;
const SUMMARY_BREAKPOINT = 560;
const INTENSITY_STEPS = [
  { sample: 0, from: 0, to: 0 },
  { sample: 5, from: 1, to: 10 },
  { sample: 18, from: 11, to: 25 },
  { sample: 28, from: 26, to: null },
] as const;

function getColor(count: number, isDark: boolean, emptyColor: string): string {
  if (count === 0) return emptyColor;
  if (count <= 10) return isDark ? "#0f766e" : "#99f6e4";
  if (count <= 25) return isDark ? "#14b8a6" : "#2dd4bf";
  return isDark ? "#2dd4bf" : "#0d9488";
}

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};
const WEEKDAYS = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
};

function shortName(name: string, language: "en" | "ar"): string {
  return language === "en" ? name.slice(0, 3) : name;
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatHeatmapDayShort(dateKey: string, language: "en" | "ar"): string {
  const date = parseDateKey(dateKey);
  const weekday = shortName(WEEKDAYS[language][date.getDay()], language);
  const month = shortName(MONTHS[language][date.getMonth()], language);
  const day = formatNumber(date.getDate(), language);
  return language === "en" ? `${weekday}, ${day} ${month}` : `${weekday} ${day} ${month}`;
}

export function formatHeatmapDayFull(dateKey: string, language: "en" | "ar"): string {
  const date = parseDateKey(dateKey);
  const weekday = WEEKDAYS[language][date.getDay()];
  const month = MONTHS[language][date.getMonth()];
  const day = formatNumber(date.getDate(), language);
  const year = language === "ar" ? formatNumber(date.getFullYear(), "ar") : String(date.getFullYear());
  return language === "en" ? `${weekday}, ${day} ${month} ${year}` : `${weekday} ${day} ${month} ${year}`;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

type FocusableCell = { focus?: () => void };

export function ActivityHeatmap({
  data,
  isDark,
  s,
  isRTL,
  activeDays,
  totalReviews,
  showSummaryStats = true,
  size = "compact",
  dayStatuses,
  weekStart = 0,
}: Props) {
  const { themeColors } = useSettings();
  const [containerWidth, setContainerWidth] = useState(0);
  const [measuredLabelWidth, setMeasuredLabelWidth] = useState(0);
  const { width } = useWindowDimensions();
  const isArabic = !!isRTL;
  const language = isArabic ? "ar" : "en";
  const layoutWidth = containerWidth || width;
  const showSummary = showSummaryStats && layoutWidth >= SUMMARY_BREAKPOINT;
  const isSidebarWidth = width >= SIDEBAR_BREAKPOINT;
  const isDesktopWidth = width >= 1024;
  const CELL_GAP = isDesktopWidth ? 5 : isSidebarWidth ? 4 : 3;
  const maxCellSize = size === "expanded"
    ? isDesktopWidth
      ? 42
      : isSidebarWidth
        ? 32
        : showSummary
          ? 16
          : 18
    : isDesktopWidth
      ? 24
      : isSidebarWidth
        ? 18
        : showSummary
          ? 15
          : BASE_CELL_SIZE;
  const estimatedLabelWidth = isArabic ? (showSummary ? 50 : 44) : (showSummary ? 40 : 34);
  const DAY_LABEL_WIDTH = Math.max(estimatedLabelWidth, measuredLabelWidth ? measuredLabelWidth + DAY_LABEL_GAP : 0);
  const reservedSummaryWidth = showSummary ? (isSidebarWidth ? 200 : 150) : 0;
  const reservedSummaryGap = showSummary ? (isSidebarWidth ? 32 : 20) : 0;
  const availableWidth = Math.max(220, layoutWidth);
  const maxHeatmapWidth = Math.max(150, availableWidth - DAY_LABEL_WIDTH - reservedSummaryWidth - reservedSummaryGap);
  const CELL_SIZE = Math.max(8, Math.min(maxCellSize, Math.floor((maxHeatmapWidth - CELL_GAP * (TOTAL_WEEKS - 1)) / TOTAL_WEEKS)));

  const countMap = new Map<string, number>();
  for (const d of data) countMap.set(d.date, d.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatDateKey(today);

  const startRaw = new Date(today);
  startRaw.setDate(startRaw.getDate() - (TOTAL_WEEKS - 1) * 7);
  startRaw.setDate(startRaw.getDate() - ((startRaw.getDay() - weekStart + 7) % 7));
  const firstKey = formatDateKey(startRaw);

  const weeks: { date: Date; dateStr: string; count: number }[][] = [];
  const cursor = new Date(startRaw);

  for (let w = 0; w < TOTAL_WEEKS; w++) {
    const week: { date: Date; dateStr: string; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = formatDateKey(cursor);
      const isFuture = cursor > today;
      week.push({
        date: new Date(cursor),
        dateStr,
        count: isFuture ? -1 : (countMap.get(dateStr) ?? 0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  const renderedWeeks = isRTL ? [...weeks].reverse() : weeks;

  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selected = selectedDate < firstKey || selectedDate > todayKey ? todayKey : selectedDate;
  const cellRefs = useRef(new Map<string, FocusableCell | null>());
  const focusAfterMove = useRef(false);

  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    cellRefs.current.get(selected)?.focus?.();
  }, [selected]);

  const clampKey = (key: string) => (key < firstKey ? firstKey : key > todayKey ? todayKey : key);
  const moveSelection = (days: number) => setSelectedDate(clampKey(addDaysToKey(selected, days)));

  const onGridKeyDown = (event: { key: string; preventDefault?: () => void }) => {
    const later = isRTL ? "ArrowLeft" : "ArrowRight";
    const earlier = isRTL ? "ArrowRight" : "ArrowLeft";
    let next: string | null = null;
    if (event.key === "ArrowUp") next = addDaysToKey(selected, -1);
    else if (event.key === "ArrowDown") next = addDaysToKey(selected, 1);
    else if (event.key === later) next = addDaysToKey(selected, 7);
    else if (event.key === earlier) next = addDaysToKey(selected, -7);
    else if (event.key === "Home") next = firstKey;
    else if (event.key === "End") next = todayKey;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault?.();
      setDetailsOpen((open) => !open);
      return;
    }
    if (next === null) return;
    event.preventDefault?.();
    focusAfterMove.current = true;
    setSelectedDate(clampKey(next));
  };

  const monthLabels: { label: string; full: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (let step = 0; step < renderedWeeks.length; step++) {
    const w = isRTL ? renderedWeeks.length - 1 - step : step;
    const firstDay = renderedWeeks[w][0];
    const month = firstDay.date.getMonth();
    if (month !== lastMonth) {
      const full = MONTHS[language][month];
      monthLabels.push({ label: shortName(full, language), full, weekIndex: w });
      lastMonth = month;
    }
  }

  const spacedMonthLabels = useMemo(() => {
    const result: { label: string; full: string; offset: number }[] = [];
    const candidates = monthLabels
      .map((m) => {
        const fromStart = isRTL ? renderedWeeks.length - 1 - m.weekIndex : m.weekIndex;
        return { label: m.label, full: m.full, offset: fromStart * (CELL_SIZE + CELL_GAP) };
      })
      .sort((a, b) => a.offset - b.offset);
    const minGap = isArabic ? 44 : 22;
    for (const candidate of candidates) {
      const last = result[result.length - 1];
      if (last && candidate.offset - last.offset < minGap) {
        if (result.length === 1) result[0] = candidate;
        continue;
      }
      result.push(candidate);
    }
    return result;
  }, [monthLabels, CELL_SIZE, CELL_GAP, isRTL, isArabic, renderedWeeks.length]);
  const heatmapWidth = TOTAL_WEEKS * CELL_SIZE + (TOTAL_WEEKS - 1) * CELL_GAP;
  const contentWidth = heatmapWidth + DAY_LABEL_WIDTH;
  const reviewActiveDays = activeDays ?? data.filter((d) => d.count > 0).length;
  const reviewTotal = totalReviews ?? data.reduce((sum, d) => sum + d.count, 0);
  const formatCount = (value: number) => value > 0 ? formatNumber(value, language) : "—";
  const summaryItems = [
    { value: reviewActiveDays, label: s.heatmapActiveDays },
    { value: reviewTotal, label: s.heatmapTotalReviews },
  ];
  const labelColor = LABEL_COLOR(isDark);
  const strongText = isDark ? "#e5e5e5" : "#2D2D2D";
  const rowDirection = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };

  const dayDescription = (dateKey: string) => {
    const count = countMap.get(dateKey) ?? 0;
    const status = dayStatuses?.get(dateKey);
    return [
      `${formatHeatmapDayFull(dateKey, language)}: ${formatReviews(count, language)}`,
      status ? statusLabel(status, s) : null,
      dateKey === todayKey ? s.heatmapToday : null,
    ]
      .filter(Boolean)
      .join(", ");
  };
  const selectedCount = countMap.get(selected) ?? 0;
  const selectedStatus = dayStatuses?.get(selected);
  const selectorLabel = `${formatHeatmapDayShort(selected, language)}: ${formatReviews(selectedCount, language)}`;
  const PreviousIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;
  const weekdayKeys = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const labelledDays = new Set([1, 3, 5]);
  const webKeyProps = Platform.OS === "web" ? ({ onKeyDown: onGridKeyDown } as object) : {};

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setContainerWidth((current) => current === nextWidth ? current : nextWidth);
      }}
      style={{ direction: "ltr", alignItems: showSummary ? "stretch" : "center", width: "100%" }}
    >
      <View style={{ position: "absolute", opacity: 0, pointerEvents: "none", flexDirection: "row" }} aria-hidden>
        {[1, 3, 5].map((day) => (
          <Text
            key={day}
            onLayout={(event) => {
              const measured = Math.ceil(event.nativeEvent.layout.width);
              setMeasuredLabelWidth((current) => (measured > current ? measured : current));
            }}
            style={{ fontFamily: "Manrope_500Medium", fontSize: 10 }}
          >
            {shortName(WEEKDAYS[language][day], language)}
          </Text>
        ))}
      </View>
      <View
        style={{
          flexDirection: showSummary ? (isRTL ? "row-reverse" : "row") : "column",
          alignItems: "center",
          justifyContent: "space-between",
          gap: showSummary ? reservedSummaryGap : 0,
          width: "100%",
        }}
      >
      <View style={{ width: contentWidth }}>
        <View
          style={{
            width: heatmapWidth,
            height: 14,
            marginLeft: isRTL ? 0 : DAY_LABEL_WIDTH,
            marginRight: isRTL ? DAY_LABEL_WIDTH : 0,
            marginBottom: 4,
            position: "relative",
          }}
        >
          {spacedMonthLabels.map((m, i) => (
            <Text
              key={i}
              accessibilityLabel={m.full}
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 10,
                color: labelColor,
                position: "absolute",
                ...(isRTL ? { right: m.offset } : { left: m.offset }),
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {m.label}
            </Text>
          ))}
        </View>

        <View style={{ height: 14 }} />

        <View style={{ flexDirection: isRTL ? "row-reverse" : "row", width: contentWidth, direction: "ltr" }}>
          <View style={{ width: DAY_LABEL_WIDTH, justifyContent: "flex-start", alignItems: isRTL ? "flex-start" : "flex-end" }}>
            {weekdayKeys.map((day, i) => {
              const full = WEEKDAYS[language][day];
              return (
                <View
                  key={i}
                  style={{
                    height: CELL_SIZE,
                    marginBottom: i === 6 ? 0 : CELL_GAP,
                    justifyContent: "center",
                  }}
                >
                  {labelledDays.has(day) && (
                    <Text
                      accessibilityLabel={full}
                      numberOfLines={1}
                      style={{
                        fontFamily: "Manrope_500Medium",
                        fontSize: 10,
                        color: labelColor,
                        ...textEndStyle(isRTL),
                        ...(isRTL ? { paddingLeft: DAY_LABEL_GAP } : { paddingRight: DAY_LABEL_GAP }),
                        writingDirection: isRTL ? "rtl" : "ltr",
                        width: DAY_LABEL_WIDTH,
                      }}
                    >
                      {shortName(full, language)}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          <View
            accessibilityLabel={s.heatmapCalendarLabel}
            style={{ flexDirection: "row", gap: CELL_GAP, width: heatmapWidth }}
            {...webKeyProps}
          >
            {renderedWeeks.map((week, wi) => (
              <View key={wi} style={{ gap: CELL_GAP }}>
                {week.map((day) => {
                  if (day.count === -1) {
                    return <View key={day.dateStr} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;
                  }
                  const isToday = day.dateStr === todayKey;
                  const isSelected = day.dateStr === selected;
                  const status = dayStatuses?.get(day.dateStr);
                  const statusStyle = status ? statusCellStyle(status, day.count, isDark) : null;
                  const ringColor = isToday ? TODAY_RING(isDark) : isSelected ? strongText : null;
                  return (
                    <Pressable
                      key={day.dateStr}
                      ref={(node) => {
                        cellRefs.current.set(day.dateStr, node as unknown as FocusableCell | null);
                      }}
                      testID={`heatmap-day-${day.dateStr}`}
                      focusable={isSelected}
                      onPress={() => {
                        if (isSelected) setDetailsOpen((open) => !open);
                        else {
                          setSelectedDate(day.dateStr);
                          setDetailsOpen(true);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={dayDescription(day.dateStr)}
                      accessibilityState={{ selected: isSelected }}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        borderRadius: 3,
                        backgroundColor: statusStyle?.backgroundColor ?? getColor(day.count, isDark, themeColors.surfaceHigh),
                        borderWidth: statusStyle?.borderWidth ?? 0,
                        borderColor: statusStyle?.borderColor ?? "transparent",
                        borderStyle: statusStyle?.borderStyle ?? "solid",
                      }}
                    >
                      {ringColor ? (
                        <View
                          style={{
                            pointerEvents: "none",
                            position: "absolute",
                            inset: -3 - (statusStyle?.borderWidth ?? 0),
                            borderRadius: 5,
                            borderWidth: 2,
                            borderColor: ringColor,
                            borderStyle: isToday && !isSelected ? "dashed" : "solid",
                          }}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        <View className="mt-3 items-center gap-1" style={{ ...rowDirection, width: contentWidth }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.heatmapPreviousDay}
            disabled={selected <= firstKey}
            onPress={() => moveSelection(-1)}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              opacity: selected <= firstKey ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <PreviousIcon size={18} color={strongText} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${dayDescription(selected)}. ${detailsOpen ? s.heatmapHideDetails : s.heatmapDayDetails}`}
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((open) => !open)}
            className="rounded-full px-3"
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              justifyContent: "center",
              backgroundColor: themeColors.surfaceMid,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                fontSize: 12,
                color: strongText,
                textAlign: "center",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {selected === todayKey ? `${s.heatmapToday} · ${selectorLabel}` : selectorLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.heatmapNextDay}
            disabled={selected >= todayKey}
            onPress={() => moveSelection(1)}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              opacity: selected >= todayKey ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <NextIcon size={18} color={strongText} />
          </Pressable>
        </View>

        {detailsOpen && (
          <View
            accessibilityLiveRegion="polite"
            className="rounded-xl px-3 py-2 mt-2"
            style={{ backgroundColor: themeColors.surfaceMid, alignSelf: "stretch" }}
          >
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: strongText, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}>
              {formatHeatmapDayFull(selected, language)}
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: labelColor, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}>
              {[
                formatReviews(selectedCount, language),
                selectedStatus ? statusLabel(selectedStatus, s) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        )}

        <View
          style={{
            marginTop: 12,
            marginLeft: isRTL ? 0 : DAY_LABEL_WIDTH,
            marginRight: isRTL ? DAY_LABEL_WIDTH : 0,
            width: heatmapWidth,
            gap: 8,
          }}
        >
          <View style={{ ...rowDirection, flexWrap: "wrap", alignItems: "center", gap: 6, rowGap: 4 }}>
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 10, color: labelColor }}>{s.heatmapLess}</Text>
            {INTENSITY_STEPS.map((step) => (
              <View key={step.from} style={{ ...rowDirection, alignItems: "center", gap: 3 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: getColor(step.sample, isDark, themeColors.surfaceHigh),
                  }}
                />
                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 10, color: labelColor, writingDirection: "ltr" }}>
                  {step.to === null
                    ? `${formatNumber(step.from, language)}+`
                    : step.from === step.to
                      ? formatNumber(step.from, language)
                      : `${formatNumber(step.from, language)}–${formatNumber(step.to, language)}`}
                </Text>
              </View>
            ))}
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 10, color: labelColor }}>{s.heatmapMore}</Text>
          </View>
          {dayStatuses ? (
            <View style={{ flex: 1, minWidth: 0, flexDirection: isRTL ? "row-reverse" : "row", flexWrap: "wrap", alignItems: "center", gap: 10, rowGap: 6 }}>
              {STATUS_ORDER.map((status) => {
                const style = statusCellStyle(status, 0, isDark);
                return (
                  <View key={status} style={{ flexDirection: isRTL ? "row-reverse" : "row", alignItems: "center", gap: 4 }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor: style.backgroundColor,
                        borderWidth: style.borderWidth ? 1.5 : 0,
                        borderColor: style.borderColor,
                        borderStyle: style.borderStyle ?? "solid",
                      }}
                    />
                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 10, color: isDark ? "#d4d4d4" : "#6e5a47" }}>
                      {statusLabel(status, s)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>
      {showSummary && (
        <View
          style={{
            flex: 1,
            minWidth: reservedSummaryWidth,
            justifyContent: "center",
            flexDirection: isDesktopWidth ? (isRTL ? "row-reverse" : "row") : "column",
            alignItems: isDesktopWidth ? "center" : "stretch",
            gap: 18,
            alignSelf: "stretch",
          }}
        >
          {summaryItems.map((item) => (
            <View
              key={item.label}
              style={{
                flex: isDesktopWidth ? 1 : undefined,
                alignItems: isDesktopWidth ? "center" : isRTL ? "flex-end" : "flex-start",
              }}
            >
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "NotoSerif_700Bold",
                  fontSize: isSidebarWidth ? 24 : 20,
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {formatCount(item.value)}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-400 mt-1"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 11,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      )}
      </View>
    </View>
  );
}
