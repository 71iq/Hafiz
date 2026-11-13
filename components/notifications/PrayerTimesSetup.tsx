import { Check, ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useDatabase } from "@/lib/database/provider";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { useStrings } from "@/lib/i18n/useStrings";
import { deviceClock, formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { rescheduleReminders } from "@/lib/notifications/schedule";
import { prayerLabel } from "@/lib/notifications/templates";
import { parseManualCoordinates, requestDeviceCoordinates, type Coordinates } from "@/lib/prayer/location";
import { readPrayerLocation, writePrayerLocation } from "@/lib/prayer/settings";
import {
  CALCULATION_METHODS,
  computePrayerTimes,
  DEFAULT_CALCULATION_METHOD,
  PRAYERS,
  type AsrMadhab,
  type CalculationMethodKey,
  type PrayerLocation,
} from "@/lib/prayer/times";
import { useSettings } from "@/lib/settings/context";
import type { UIStringKey } from "@/lib/i18n/strings";

export const CALCULATION_METHOD_LABEL_KEYS: Readonly<Record<CalculationMethodKey, UIStringKey>> = {
  MuslimWorldLeague: "notifMethodMuslimWorldLeague",
  Egyptian: "notifMethodEgyptian",
  Karachi: "notifMethodKarachi",
  UmmAlQura: "notifMethodUmmAlQura",
  Dubai: "notifMethodDubai",
  MoonsightingCommittee: "notifMethodMoonsightingCommittee",
  NorthAmerica: "notifMethodNorthAmerica",
  Kuwait: "notifMethodKuwait",
  Qatar: "notifMethodQatar",
  Singapore: "notifMethodSingapore",
  Tehran: "notifMethodTehran",
  Turkey: "notifMethodTurkey",
};

/** Outline buttons and the coordinate fields need a visible edge on the light card. */
const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

type Status = { kind: "idle" } | { kind: "locating" } | { kind: "message"; text: string; tone: "info" | "error" };

export type PrayerTimesSetupProps = {
  /** Called after the location is saved or removed. */
  onChange?: (location: PrayerLocation | null) => void;
  /** Shows "Not now". Onboarding step 7 passes it; settings leaves it out. */
  onSkip?: () => void;
  /** Shows "Done" once a location is saved. */
  onDone?: () => void;
};

/**
 * Prayer-time location and method (5.1 step 7, ETH-11). The device location is requested only when
 * the user taps "Use my location"; coordinates can also be typed. Everything stays on this device.
 */
export function PrayerTimesSetup({ onChange, onSkip, onDone }: PrayerTimesSetupProps) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, uiLanguage } = useSettings();
  const [location, setLocation] = useState<PrayerLocation | null>(null);
  const [method, setMethod] = useState<CalculationMethodKey>(DEFAULT_CALCULATION_METHOD);
  const [madhab, setMadhab] = useState<AsrMadhab>("shafi");
  const [latitudeText, setLatitudeText] = useState("");
  const [longitudeText, setLongitudeText] = useState("");
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const iconColor = isDark ? "#E5E5E5" : "#3F3F46";
  const placeholderColor = isDark ? "#737373" : "#8B8178";

  useEffect(() => {
    let active = true;
    readPrayerLocation(db)
      .then((saved) => {
        if (!active || !saved) return;
        setLocation(saved);
        setMethod(saved.method);
        setMadhab(saved.madhab);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [db]);

  const save = useCallback(
    async (next: PrayerLocation | null) => {
      try {
        await writePrayerLocation(db, next);
        setLocation(next);
        onChange?.(next);
        setStatus(next ? { kind: "message", text: s.notifLocationSaved, tone: "info" } : { kind: "idle" });
        // Dhuhr moves the make-up cutoff (STR-07), so open streak views reload too.
        emitHabitChanged();
        rescheduleReminders(db).catch(() => {});
      } catch {
        setStatus({ kind: "message", text: s.notifSaveFailed, tone: "error" });
      }
    },
    [db, onChange, s.notifLocationSaved, s.notifSaveFailed],
  );

  const saveCoordinates = (coordinates: Coordinates, source: PrayerLocation["source"]) =>
    save({ ...coordinates, method, madhab, source });

  const useDeviceLocation = async () => {
    setStatus({ kind: "locating" });
    try {
      const result = await requestDeviceCoordinates();
      if (result.kind === "ok") await saveCoordinates(result.coordinates, "device");
      else {
        // The message asks for coordinates, so the fields open with it.
        setCoordinatesOpen(true);
        setStatus({
          kind: "message",
          text: result.kind === "denied" ? s.notifLocationDenied : s.notifLocationUnavailable,
          tone: "error",
        });
      }
    } catch {
      setCoordinatesOpen(true);
      setStatus({ kind: "message", text: s.notifLocationUnavailable, tone: "error" });
    }
  };

  const saveManual = () => {
    const coordinates = parseManualCoordinates(latitudeText, longitudeText);
    if (!coordinates) {
      setStatus({ kind: "message", text: s.notifCoordinatesInvalid, tone: "error" });
      return;
    }
    void saveCoordinates(coordinates, "manual");
  };

  const chooseMethod = (next: CalculationMethodKey) => {
    setMethod(next);
    setMethodsOpen(false);
    if (location) void save({ ...location, method: next });
  };

  const chooseMadhab = (next: AsrMadhab) => {
    setMadhab(next);
    if (location) void save({ ...location, madhab: next });
  };

  const todayTimes = useMemo(() => {
    if (!location) return null;
    return computePrayerTimes(location, deviceClock.dateOf(new Date()));
  }, [location]);

  return (
    <View className="gap-4">
      <Text variant="body-sm">{s.notifPrayerTimesIntro}</Text>

      <Button
        variant="outline"
        className={OUTLINE_BORDER}
        onPress={useDeviceLocation}
        disabled={status.kind === "locating"}
        label={s.notifUseMyLocation}
      />

      <View className="gap-2">
        <DisclosureRow
          onPress={() => setCoordinatesOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: coordinatesOpen }}
          style={{ minHeight: 44 }}
          trailing={coordinatesOpen ? <ChevronUp size={18} color={iconColor} /> : <ChevronDown size={18} color={iconColor} />}
        >
          <Text variant="title-sm">{s.notifManualEntry}</Text>
        </DisclosureRow>
        {coordinatesOpen ? (
          <>
            <MirroredRow className="gap-2">
              <View className="gap-1" style={{ flex: 1 }}>
                <Text variant="label-lg" nativeID="prayer-latitude-label">
                  {s.notifLatitude}
                </Text>
                <Input
                  value={latitudeText}
                  onChangeText={setLatitudeText}
                  placeholder={s.notifLatitudeExample}
                  placeholderTextColor={placeholderColor}
                  className={OUTLINE_BORDER}
                  accessibilityLabel={s.notifLatitude}
                  accessibilityLabelledBy="prayer-latitude-label"
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                />
              </View>
              <View className="gap-1" style={{ flex: 1 }}>
                <Text variant="label-lg" nativeID="prayer-longitude-label">
                  {s.notifLongitude}
                </Text>
                <Input
                  value={longitudeText}
                  onChangeText={setLongitudeText}
                  placeholder={s.notifLongitudeExample}
                  placeholderTextColor={placeholderColor}
                  className={OUTLINE_BORDER}
                  accessibilityLabel={s.notifLongitude}
                  accessibilityLabelledBy="prayer-longitude-label"
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                />
              </View>
            </MirroredRow>
            <Button variant="outline" className={OUTLINE_BORDER} onPress={saveManual} label={s.notifSaveCoordinates} />
          </>
        ) : null}
      </View>

      {status.kind !== "idle" && (
        <Text
          variant="body-sm"
          accessibilityLiveRegion="polite"
          className={status.kind === "message" && status.tone === "error" ? "text-red-600 dark:text-red-400" : undefined}
        >
          {status.kind === "locating" ? s.notifLocating : status.text}
        </Text>
      )}

      <View className="gap-2">
        <Text variant="title-sm">{s.notifCalculationMethod}</Text>
        <Pressable
          onPress={() => setMethodsOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`${s.notifCalculationMethod}: ${s[CALCULATION_METHOD_LABEL_KEYS[method]]}`}
          accessibilityState={{ expanded: methodsOpen }}
          className="rounded-2xl bg-surface-high dark:bg-surface-dark-high px-4"
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <MirroredRow className="items-center justify-between gap-2">
            <Text variant="body" style={{ flex: 1 }}>
              {s[CALCULATION_METHOD_LABEL_KEYS[method]]}
            </Text>
            {methodsOpen ? <ChevronUp size={18} color={iconColor} /> : <ChevronDown size={18} color={iconColor} />}
          </MirroredRow>
        </Pressable>
        {methodsOpen && (
          <View accessibilityRole="radiogroup" className="gap-1">
            {CALCULATION_METHODS.map((key) => {
              const selected = key === method;
              return (
                <Pressable
                  key={key}
                  onPress={() => chooseMethod(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={s[CALCULATION_METHOD_LABEL_KEYS[key]]}
                  className="rounded-xl px-4"
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <MirroredRow className="items-center gap-2">
                    <View style={{ width: 18 }}>{selected ? <Check size={18} color={iconColor} /> : null}</View>
                    <Text variant="body" style={{ flex: 1 }}>
                      {s[CALCULATION_METHOD_LABEL_KEYS[key]]}
                    </Text>
                  </MirroredRow>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View className="gap-2">
        <Text variant="title-sm">{s.notifAsrMethod}</Text>
        <ToggleGroup<AsrMadhab>
          value={madhab}
          onValueChange={chooseMadhab}
          items={[
            { value: "shafi", label: s.notifAsrStandard },
            { value: "hanafi", label: s.notifAsrHanafi },
          ]}
        />
      </View>

      {location && todayTimes && (
        <View className="gap-1" accessibilityRole="summary">
          <Text variant="title-sm">{s.notifTodayTimes}</Text>
          {PRAYERS.map((prayer) => (
            <MirroredRow key={prayer} className="justify-between">
              <Text variant="body-sm">{prayerLabel(prayer, uiLanguage)}</Text>
              <Text variant="body-sm">{formatClockMinutesForDisplay(deviceClock.minutesOf(todayTimes[prayer]), uiLanguage)}</Text>
            </MirroredRow>
          ))}
        </View>
      )}

      <MirroredRow className="flex-wrap gap-2">
        {location && <Button variant="ghost" onPress={() => void save(null)} label={s.notifRemoveLocation} />}
        {onSkip && !location && <Button variant="ghost" onPress={onSkip} label={s.notifSkip} />}
        {onDone && location && <Button onPress={onDone} label={s.notifDone} />}
      </MirroredRow>
    </View>
  );
}
