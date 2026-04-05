import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Card } from "@/components/ui/Card";

type DayData = { date: string; count: number };

type Props = {
  data: DayData[];
  isDark: boolean;
  s: Record<string, string>;
  isRTL?: boolean;
};

const CELL_SIZE = 13;
const CELL_GAP = 3;
const TOTAL_DAYS = 91; // 13 weeks

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

export function ActivityHeatmap({ data, isDark, s, isRTL }: Props) {
  const [tooltip, setTooltip] = useState<{ date: string; count: number } | null>(null);
  const isArabic = !!isRTL;

  // Build date lookup
  const countMap = new Map<string, number>();
  for (const d of data) countMap.set(d.date, d.count);

  // Build grid: 13 weeks x 7 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the start: go back TOTAL_DAYS - 1 days, then back to that week's Sunday
  const startRaw = new Date(today);
  startRaw.setDate(startRaw.getDate() - (TOTAL_DAYS - 1));
  const startDay = startRaw.getDay(); // 0=Sun
  startRaw.setDate(startRaw.getDate() - startDay);

  const weeks: { date: Date; dateStr: string; count: number }[][] = [];
  const cursor = new Date(startRaw);

  while (cursor <= today || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) {
      weeks.push([]);
    }
    const dateStr = cursor.toISOString().slice(0, 10);
    const isFuture = cursor > today;
    weeks[weeks.length - 1].push({
      date: new Date(cursor),
      dateStr,
      count: isFuture ? -1 : (countMap.get(dateStr) ?? 0),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Month labels: find first occurrence of each month in weeks
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks.length; w++) {
    // Use the first day of the week to determine month
    const firstDay = weeks[w][0];
    const month = firstDay.date.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ label: getMonthLabel(firstDay.date, isArabic), weekIndex: w });
      lastMonth = month;
    }
  }

  // Stats
  const activeDays = data.filter((d) => d.count > 0).length;
  const totalReviews = data.reduce((sum, d) => sum + d.count, 0);

  const DAY_LABEL_WIDTH = 28;

  return (
    <View>
      {/* Month labels row */}
      <View style={{ flexDirection: "row", marginLeft: DAY_LABEL_WIDTH, marginBottom: 4 }}>
        {monthLabels.map((m, i) => (
          <Text
            key={i}
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 10,
              color: isDark ? "#737373" : "#8B8178",
              position: "absolute",
              left: m.weekIndex * (CELL_SIZE + CELL_GAP),
            }}
          >
            {m.label}
          </Text>
        ))}
      </View>

      <View style={{ height: 14 }} />

      {/* Grid */}
      <View style={{ flexDirection: "row" }}>
        {/* Day labels */}
        <View style={{ width: DAY_LABEL_WIDTH, justifyContent: "flex-start" }}>
          {Array.from({ length: 7 }, (_, i) => {
            const label = getDayLabel(i, isArabic);
            return (
              <View key={i} style={{ height: CELL_SIZE + CELL_GAP, justifyContent: "center" }}>
                {label && (
                  <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 9, color: isDark ? "#525252" : "#b9a085" }}>
                    {label}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Week columns */}
        <View style={{ flexDirection: "row", gap: CELL_GAP }}>
          {weeks.map((week, wi) => (
            <View key={wi} style={{ gap: CELL_GAP }}>
              {week.map((day) => {
                if (day.count === -1) {
                  // Future day — invisible
                  return <View key={day.dateStr} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;
                }
                return (
                  <Pressable
                    key={day.dateStr}
                    onPress={() => setTooltip(tooltip?.date === day.dateStr ? null : { date: day.dateStr, count: day.count })}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      borderRadius: 3,
                      backgroundColor: getColor(day.count, isDark),
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

      {/* Summary stats */}
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 24, marginTop: 12 }}>
        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: isDark ? "#737373" : "#8B8178" }}>
          {activeDays} {s.heatmapActiveDays}
        </Text>
        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: isDark ? "#737373" : "#8B8178" }}>
          {totalReviews} {s.heatmapTotalReviews}
        </Text>
      </View>
    </View>
  );
}
