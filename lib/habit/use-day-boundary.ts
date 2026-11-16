import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { addDays, atLocalTime, deviceZoneKey, localDateOf, type LocalDate } from "@/lib/habit/dates";

const ZONE_CHECK_MS = 60_000;

export function nextLocalMidnight(now: Date): Date {
  return atLocalTime(addDays(localDateOf(now), 1), 0);
}

export function useDayBoundaryRefresh(boundary: number | null, reload: () => void): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const arm = () => {
      disarm();
      if (boundary === null) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          if (Date.now() < boundary) arm();
          else reload();
        },
        Math.max(0, boundary - Date.now()),
      );
    };

    let zone = deviceZoneKey();
    let zoneTimer: ReturnType<typeof setInterval> | undefined;
    const watchZone = () => {
      if (zoneTimer !== undefined) return;
      zoneTimer = setInterval(() => {
        const next = deviceZoneKey();
        if (next === zone) return;
        zone = next;
        reload();
      }, ZONE_CHECK_MS);
    };
    const unwatchZone = () => {
      if (zoneTimer !== undefined) clearInterval(zoneTimer);
      zoneTimer = undefined;
    };

    let away = AppState.currentState === "background";
    if (!away) {
      arm();
      watchZone();
    }
    const subscription: { remove: () => void } | undefined = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        away = true;
        disarm();
        unwatchZone();
      } else if (state === "active" && away) {
        away = false;
        zone = deviceZoneKey();
        watchZone();
        if (boundary !== null && boundary > Date.now()) arm();
        reload();
      }
    });
    return () => {
      disarm();
      unwatchZone();
      subscription?.remove();
    };
  }, [boundary, reload]);
}

function localDay(): { today: LocalDate; boundary: number } {
  const now = new Date();
  return { today: localDateOf(now), boundary: nextLocalMidnight(now).getTime() };
}

export function useLocalToday(): LocalDate {
  const [day, setDay] = useState(localDay);
  const update = useCallback(() => {
    const next = localDay();
    setDay((current) => (current.today === next.today && current.boundary === next.boundary ? current : next));
  }, []);
  useDayBoundaryRefresh(day.boundary, update);
  return day.today;
}
