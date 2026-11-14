import React, { useMemo, useState } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useSettings } from "@/lib/settings/context";
import type { UIStrings } from "@/lib/i18n/strings";
import { textEndStyle, textStartStyle } from "@/lib/ui/direction";
import { toArabicNumber } from "@/lib/arabic";
import { formatNumber } from "@/lib/i18n/count";
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
  /**
   * STR-26: the owner's wird status per local date. Each status has its own style; excused days are
   * passed only on the owner's own Progress screen and never on a public profile.
   */
  dayStatuses?: ReadonlyMap<string, DayStatus>;
  /** First day of each column, 0 is Sunday. The owner's Progress screen passes the effective week start. */
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

/**
 * Calm, distinct styles: recited days stay teal, protected days take muted tones with a 1 px edge.
 * A protected day must not outshine a recited one, so in dark mode its fill stays darker than the
 * lowest teal step and the edge carries the hue.
 */
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
      // A dashed edge, since a plain grey fill would read as an empty day.
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
/** Month and weekday labels share one readable tone at 10 px: about 7:1 in dark and 6:1 in light. */
const LABEL_COLOR = (isDark: boolean) => (isDark ? "#a3a3a3" : "#6E5A47");
/** Space between the weekday labels and the grid. */
const DAY_LABEL_GAP = 6;
const TOTAL_WEEKS = 13;
const SUMMARY_BREAKPOINT = 560;

function getColor(count: number, isDark: boolean, emptyColor: string): string {
  if (count === 0) return emptyColor;
  if (count <= 10) return isDark ? "#0f766e" : "#99f6e4";
  if (count <= 25) return isDark ? "#14b8a6" : "#2dd4bf";
  return isDark ? "#2dd4bf" : "#0d9488";
}

function getMonthLabel(date: Date, isArabic: boolean): string {
  const months = isArabic
    ? ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[date.getMonth()];
}

/** Mon, Wed and Fri are labelled on whichever rows they fall; they are never on adjacent rows. */
function getDayLabel(dayOfWeek: number, isArabic: boolean): string | null {
  if (dayOfWeek === 1) return isArabic ? "الاثنين" : "Mon";
  if (dayOfWeek === 3) return isArabic ? "الأربعاء" : "Wed";
  if (dayOfWeek === 5) return isArabic ? "الجمعة" : "Fri";
  return null;
}

/** The tooltip date in the interface's digits: Arabic uses Arabic-Indic digits throughout. */
function formatTooltipDate(dateKey: string, isArabic: boolean): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(isArabic ? "ar-u-nu-arab" : "en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
  const [tooltip, setTooltip] = useState<{ date: string; count: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const { width } = useWindowDimensions();
  const isArabic = !!isRTL;
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
  // The Arabic day names are about 26 px at 10 px; their column sits close to the grid, with the 6 px
  // gap the labels keep from it (DAY_LABEL_GAP) inside the width.
  const DAY_LABEL_WIDTH = isArabic ? (showSummary ? 50 : 44) : (showSummary ? 40 : 34);
  const reservedSummaryWidth = showSummary ? (isSidebarWidth ? 200 : 150) : 0;
  const reservedSummaryGap = showSummary ? (isSidebarWidth ? 32 : 20) : 0;
  const availableWidth = Math.max(220, layoutWidth);
  const maxHeatmapWidth = Math.max(150, availableWidth - DAY_LABEL_WIDTH - reservedSummaryWidth - reservedSummaryGap);
  const CELL_SIZE = Math.max(8, Math.min(maxCellSize, Math.floor((maxHeatmapWidth - CELL_GAP * (TOTAL_WEEKS - 1)) / TOTAL_WEEKS)));

  // Build date lookup
  const countMap = new Map<string, number>();
  for (const d of data) countMap.set(d.date, d.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatDateKey(today);

  const startRaw = new Date(today);
  startRaw.setDate(startRaw.getDate() - (TOTAL_WEEKS - 1) * 7);
  // Back up to the week start, so each column is one of the user's weeks and today sits in the last.
  startRaw.setDate(startRaw.getDate() - ((startRaw.getDay() - weekStart + 7) % 7));

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

  // Month labels: find first visual occurrence of each month.
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < renderedWeeks.length; w++) {
    const firstDay = renderedWeeks[w][0];
    const month = firstDay.date.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ label: getMonthLabel(firstDay.date, isArabic), weekIndex: w });
      lastMonth = month;
    }
  }

  const spacedMonthLabels = useMemo(() => {
    const result: { label: string; left: number }[] = [];
    const candidates = monthLabels
      .map((m) => {
        return { label: m.label, left: m.weekIndex * (CELL_SIZE + CELL_GAP) };
      })
      .sort((a, b) => a.left - b.left);
    let lastLeft = -1000;
    for (const candidate of candidates) {
      if (candidate.left - lastLeft < 22) continue;
      result.push(candidate);
      lastLeft = candidate.left;
    }
    return result;
  }, [monthLabels, CELL_SIZE]);
  const heatmapWidth = TOTAL_WEEKS * CELL_SIZE + (TOTAL_WEEKS - 1) * CELL_GAP;
  const contentWidth = heatmapWidth + DAY_LABEL_WIDTH;
  const reviewActiveDays = activeDays ?? data.filter((d) => d.count > 0).length;
  const reviewTotal = totalReviews ?? data.reduce((sum, d) => sum + d.count, 0);
  const formatCount = (value: number) => value > 0 ? formatNumber(value, isArabic ? "ar" : "en") : "—";
  const summaryItems = [
    { value: reviewActiveDays, label: s.heatmapActiveDays },
    { value: reviewTotal, label: s.heatmapTotalReviews },
  ];

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setContainerWidth((current) => current === nextWidth ? current : nextWidth);
      }}
      style={{ direction: "ltr", alignItems: showSummary ? "stretch" : "center", width: "100%" }}
    >
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
        {/* Month labels row */}
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
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 10,
                color: LABEL_COLOR(isDark),
                position: "absolute",
                left: m.left,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {m.label}
            </Text>
          ))}
        </View>

        <View style={{ height: 14 }} />

        {/* Grid */}
        <View style={{ flexDirection: isRTL ? "row-reverse" : "row", width: contentWidth, direction: "ltr" }}>
          {/* Day labels */}
          <View style={{ width: DAY_LABEL_WIDTH, justifyContent: "flex-start", alignItems: isRTL ? "flex-start" : "flex-end" }}>
            {Array.from({ length: 7 }, (_, i) => {
              const label = getDayLabel((weekStart + i) % 7, isArabic);
              return (
                <View
                  key={i}
                  style={{
                    height: CELL_SIZE,
                    marginBottom: i === 6 ? 0 : CELL_GAP,
                    justifyContent: "center",
                  }}
                >
                  {label && (
                    <Text
                      style={{
                        // The rows follow the chosen week start, so these labels must be easy to read.
                        fontFamily: "Manrope_500Medium",
                        fontSize: 10,
                        color: LABEL_COLOR(isDark),
                        // Toward the grid: the end of the label column. The grid row is laid out
                        // left to right in both languages, so the gap is a physical side.
                        ...textEndStyle(isRTL),
                        ...(isRTL ? { paddingLeft: DAY_LABEL_GAP } : { paddingRight: DAY_LABEL_GAP }),
                        writingDirection: isRTL ? "rtl" : "ltr",
                        width: DAY_LABEL_WIDTH,
                      }}
                    >
                      {label}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Week columns */}
          <View style={{ flexDirection: "row", gap: CELL_GAP, width: heatmapWidth }}>
            {renderedWeeks.map((week, wi) => (
              <View key={wi} style={{ gap: CELL_GAP }}>
                {week.map((day) => {
                  if (day.count === -1) {
                    return <View key={day.dateStr} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;
                  }
                  const isToday = day.dateStr === todayKey;
                  const status = dayStatuses?.get(day.dateStr);
                  const statusStyle = status ? statusCellStyle(status, day.count, isDark) : null;
                  return (
                    <Pressable
                      key={day.dateStr}
                      onPress={() => setTooltip(tooltip?.date === day.dateStr ? null : { date: day.dateStr, count: day.count })}
                      accessibilityLabel={status ? `${day.dateStr}: ${statusLabel(status, s)}` : undefined}
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
                      {/* Today: a ring outside the cell with a 1 px gap, so the cell keeps its own status border. */}
                      {isToday ? (
                        <View
                          style={{
                            pointerEvents: "none",
                            position: "absolute",
                            inset: -3 - (statusStyle?.borderWidth ?? 0),
                            borderRadius: 5,
                            borderWidth: 2,
                            borderColor: isDark ? "#ffffff" : "#2D2D2D",
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

        {/* Tooltip */}
        {tooltip && (
          <View
            className="rounded-xl px-3 py-2 mt-3"
            style={{ backgroundColor: themeColors.surfaceMid, alignSelf: "center" }}
          >
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: isDark ? "#d4d4d4" : "#6e5a47" }}>
              {isArabic ? toArabicNumber(tooltip.count) : tooltip.count} {s.heatmapReviews} — {formatTooltipDate(tooltip.date, isArabic)}
              {dayStatuses?.get(tooltip.date) ? ` — ${statusLabel(dayStatuses.get(tooltip.date)!, s)}` : ""}
            </Text>
          </View>
        )}

        {/* Legend */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 12,
            marginLeft: isRTL ? 0 : DAY_LABEL_WIDTH,
            marginRight: isRTL ? DAY_LABEL_WIDTH : 0,
            width: heatmapWidth,
          }}
        >
          {dayStatuses ? (
            // flex: 1 bounds the legend to the grid width, so it wraps instead of clipping its last items.
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
          ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {[0, 1, 2, 3].map((l) => (
              <View
                key={l}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: getColor(l === 0 ? 0 : l === 1 ? 5 : l === 2 ? 18 : 28, isDark, themeColors.surfaceHigh),
                }}
              />
            ))}
          </View>
          )}
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
                className="text-warm-400 dark:text-neutral-500 mt-1"
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
