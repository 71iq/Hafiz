import React, { useMemo, useState } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";

type DayData = { date: string; count: number };

type Props = {
  data: DayData[];
  isDark: boolean;
  s: Record<string, string>;
  isRTL?: boolean;
};

const BASE_CELL_SIZE = 13;
const CELL_GAP = 3;
const TOTAL_WEEKS = 13;

function getColor(count: number, isDark: boolean): string {
  if (count === 0) return isDark ? "#262626" : "#E8E1DA";
  if (count <= 10) return isDark ? "#134e4a" : "#99f6e4";
  if (count <= 25) return isDark ? "#0f766e" : "#2dd4bf";
  return isDark ? "#14b8a6" : "#0d9488";
}

function getMonthLabel(date: Date, isArabic: boolean): string {
  const months = isArabic
    ? ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[date.getMonth()];
}

function getDayLabel(dayIndex: number, isArabic: boolean): string | null {
  // Show Mon, Wed, Fri (indices 1, 3, 5 in 0=Sun grid)
  if (dayIndex === 1) return isArabic ? "ن" : "Mon";
  if (dayIndex === 3) return isArabic ? "ر" : "Wed";
  if (dayIndex === 5) return isArabic ? "ج" : "Fri";
  return null;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ActivityHeatmap({ data, isDark, s, isRTL }: Props) {
  const [tooltip, setTooltip] = useState<{ date: string; count: number } | null>(null);
  const { width } = useWindowDimensions();
  const isArabic = !!isRTL;
  const DAY_LABEL_WIDTH = 28;
  const gridWidth = Math.max(260, width - 90 - DAY_LABEL_WIDTH);
  const CELL_SIZE = Math.max(10, Math.min(BASE_CELL_SIZE, Math.floor((gridWidth - CELL_GAP * (TOTAL_WEEKS - 1)) / TOTAL_WEEKS)));

  // Build date lookup
  const countMap = new Map<string, number>();
  for (const d of data) countMap.set(d.date, d.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatDateKey(today);

  const startRaw = new Date(today);
  startRaw.setDate(startRaw.getDate() - (TOTAL_WEEKS - 1) * 7);
  startRaw.setDate(startRaw.getDate() - startRaw.getDay());

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

  return (
    <View style={{ direction: "ltr" }}>
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
              color: isDark ? "#737373" : "#8B8178",
              position: "absolute",
              left: m.left,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {m.label}
          </Text>
        ))}
      </View>

      <View style={{ height: 14 }} />

      {/* Grid */}
      <View style={{ flexDirection: isRTL ? "row-reverse" : "row", width: "100%", direction: "ltr" }}>
          {/* Day labels */}
          <View style={{ width: DAY_LABEL_WIDTH, justifyContent: "flex-start", alignItems: isRTL ? "flex-end" : "flex-start" }}>
            {Array.from({ length: 7 }, (_, i) => {
              const label = getDayLabel(i, isArabic);
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
                        fontFamily: "Manrope_500Medium",
                        fontSize: 9,
                        color: isDark ? "#525252" : "#b9a085",
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
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
                  return (
                    <Pressable
                      key={day.dateStr}
                      onPress={() => setTooltip(tooltip?.date === day.dateStr ? null : { date: day.dateStr, count: day.count })}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        borderRadius: 3,
                        backgroundColor: getColor(day.count, isDark),
                        borderWidth: isToday ? 1 : 0,
                        borderColor: isToday ? (isDark ? "#FDDC91" : "#785F22") : "transparent",
                      }}
                    />
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
          style={{ backgroundColor: isDark ? "#1a1a1a" : "#F5EDE4", alignSelf: "center" }}
        >
          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: isDark ? "#d4d4d4" : "#6e5a47" }}>
            {tooltip.count} {s.heatmapReviews} — {tooltip.date}
          </Text>
        </View>
      )}

      {/* Legend */}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {[0, 1, 2, 3].map((l) => (
            <View
              key={l}
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: getColor(l === 0 ? 0 : l === 1 ? 5 : l === 2 ? 18 : 28, isDark),
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
