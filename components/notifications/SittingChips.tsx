import { Pressable, View } from "react-native";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { PRAYERS, type Prayer } from "@/lib/hifz/plan";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import type { SittingChip } from "@/lib/notifications/review-sitting";

/** The clock chips name their times: "Morning, 8:00 AM". */
const CLOCK_CHIPS: readonly { chip: SittingChip; key: "hifzWhenMorning" | "hifzWhenEvening"; minutes: number }[] = [
  { chip: "morning", key: "hifzWhenMorning", minutes: 8 * 60 },
  { chip: "evening", key: "hifzWhenEvening", minutes: 20 * 60 },
];

const PRAYER_LABEL_KEYS: Readonly<Record<Prayer, keyof UIStrings>> = {
  fajr: "hifzPrayerFajr",
  dhuhr: "hifzPrayerDhuhr",
  asr: "hifzPrayerAsr",
  maghrib: "hifzPrayerMaghrib",
  isha: "hifzPrayerIsha",
};

function Chip({ label, accessibilityLabel, selected, disabled, onPress }: { label: string; accessibilityLabel?: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      // React Native Web ignores accessibilityState, so the web export reads the choice from aria-checked.
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[44px] justify-center rounded-full px-4 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
      style={disabled ? { opacity: 0.4 } : undefined}
    >
      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One sitting's time, as two small groups: after one of the five prayers, or at a set time with the
 * time shown. `allowed` leaves a chip out of reach, as the second sitting does for chips that are not
 * later than the main sitting today. Setup and Settings > Reminders pick sittings with it (REMIND-07).
 */
export function SittingChips({
  label,
  selected,
  onSelect,
  allowed = () => true,
  dir,
  language,
  s,
}: {
  label: string;
  selected: SittingChip | null;
  onSelect: (chip: SittingChip) => void;
  allowed?: (chip: SittingChip) => boolean;
  dir: "ltr" | "rtl";
  language: "en" | "ar";
  s: UIStrings;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      <Text dir={dir} variant="caption">
        {s.hifzWhenAfterPrayerGroup}
      </Text>
      <MirroredRow dir={dir} className="flex-wrap gap-2">
        {PRAYERS.map((prayer) => {
          const name = s[PRAYER_LABEL_KEYS[prayer]];
          return (
            <Chip
              key={prayer}
              label={name}
              accessibilityLabel={interpolate(s.hifzAfterPrayer, { prayer: name })}
              selected={selected === prayer}
              disabled={!allowed(prayer)}
              onPress={() => onSelect(prayer)}
            />
          );
        })}
      </MirroredRow>
      <Text dir={dir} variant="caption" className="mt-1">
        {s.hifzWhenSetTimeGroup}
      </Text>
      <MirroredRow dir={dir} className="flex-wrap gap-2">
        {CLOCK_CHIPS.map((option) => (
          <Chip
            key={option.chip}
            label={interpolate(s[option.key], { time: formatClockMinutesForDisplay(option.minutes, language) })}
            selected={selected === option.chip}
            disabled={!allowed(option.chip)}
            onPress={() => onSelect(option.chip)}
          />
        ))}
      </MirroredRow>
    </View>
  );
}
