import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { addDays, atLocalTime, deviceZoneKey, localDateOf, type LocalDate } from "@/lib/habit/dates";

/** How often an open screen checks whether the device changed time zone. */
const ZONE_CHECK_MS = 60_000;

/** The next local midnight after `now`, when a new local day starts. */
export function nextLocalMidnight(now: Date): Date {
  return atLocalTime(addDays(localDateOf(now), 1), 0);
}

/**
 * Keeps a screen's day-scoped data current when nothing else would reload it: a screen left open
 * overnight, or the app resumed on another day without a focus change. Calls `reload` when the app
 * returns from the background and when the clock reaches `boundary` (epoch ms, null for none), the
 * next instant the data changes by time alone. Each load sets the next boundary, which re-arms the
 * timer. `reload` decides whether the screen is focused.
 *
 * The timer runs only while the app is in the foreground, so a resume after the boundary reloads once,
 * from the foreground event, rather than once for the event and again for the overdue timer. On the
 * web, AppState follows page visibility.
 *
 * A time zone change moves the local day and its boundary, so while in the foreground the zone is
 * checked once a minute, and a change reloads, which sets the boundary in the new zone.
 */
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
      // A load that finished after its own boundary reloads at once.
      timer = setTimeout(
        () => {
          timer = undefined;
          // A timer can fire a little early; a reload then would compute the same boundary and stop.
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
    // react-native-web returns nothing when the page has no visibility API; the timer still runs.
    const subscription: { remove: () => void } | undefined = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        away = true;
        disarm();
        unwatchZone();
      } else if (state === "active" && away) {
        away = false;
        // The resume reload below already covers a zone changed while away.
        zone = deviceZoneKey();
        watchZone();
        // A boundary that passed while away is covered by this reload, which sets the next one.
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

/**
 * Today's local date for a screen that keys its data by day, such as the Board's week (BRD-01) and a
 * halaqa's encouragements. It moves on at local midnight, on a return from the background and on a
 * time zone change (useDayBoundaryRefresh), so a screen left open overnight asks for the new day. The
 * next midnight is kept with the date, so a time zone change re-arms the timer for the new zone's.
 */
export function useLocalToday(): LocalDate {
  const [day, setDay] = useState(localDay);
  const update = useCallback(() => {
    const next = localDay();
    setDay((current) => (current.today === next.today && current.boundary === next.boundary ? current : next));
  }, []);
  useDayBoundaryRefresh(day.boundary, update);
  return day.today;
}
