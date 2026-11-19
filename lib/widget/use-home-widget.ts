import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AppDatabase } from "@/lib/database/types";
import { widgetPlatform } from "@/lib/widget/platform";
import type { WidgetKind, WidgetPlacement } from "@/lib/widget/platform-types";
import { requestWidgetRefresh } from "@/lib/widget/publish";
import { readWidgetShowNumbers, writeWidgetShowNumbers } from "@/lib/widget/settings";

export type HomeWidgetState = Readonly<{
  supported: boolean;
  /** Whether Android's add-widget dialog is available; null while loading. */
  canPin: boolean | null;
  /** Placed instances; null while loading. */
  placement: WidgetPlacement | null;
  /** "Show numbers on the widget"; null while loading. */
  showNumbers: boolean | null;
  requestPin: (kind: WidgetKind) => void;
  setShowNumbers: (show: boolean) => void;
}>;

function warn(error: unknown) {
  console.warn("[Widget]", error);
}

/**
 * Spec 8.1: what Settings shows about the widget. Placement is read on mount, on return to the
 * foreground and when a widget is placed or removed. A pin request the launcher refuses switches the
 * row to the manual instructions for the rest of the screen's life.
 */
export function useHomeWidget(db: AppDatabase): HomeWidgetState {
  const { supported } = widgetPlatform;
  const [canPin, setCanPin] = useState<boolean | null>(null);
  const [pinRefused, setPinRefused] = useState(false);
  const [placement, setPlacement] = useState<WidgetPlacement | null>(null);
  const [showNumbers, setShowNumbersState] = useState<boolean | null>(null);
  const latestPlacement = useRef(0);

  useEffect(() => {
    if (!supported) return;
    let active = true;
    const readPlacement = () => {
      const read = ++latestPlacement.current;
      widgetPlatform
        .getPlacement()
        .then((next) => {
          if (active && read === latestPlacement.current) setPlacement(next);
        })
        .catch(warn);
    };
    widgetPlatform
      .canRequestPin()
      .then((value) => {
        if (active) setCanPin(value);
      })
      .catch((error: unknown) => {
        warn(error);
        if (active) setCanPin(false);
      });
    readWidgetShowNumbers(db).then((value) => {
      if (active) setShowNumbersState(value);
    });
    readPlacement();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") readPlacement();
    });
    const unsubscribe = widgetPlatform.subscribePlacement(readPlacement);
    return () => {
      active = false;
      appState.remove();
      unsubscribe();
    };
  }, [db, supported]);

  const requestPin = useCallback((kind: WidgetKind) => {
    widgetPlatform
      .requestPin(kind)
      .then((accepted) => {
        if (!accepted) setPinRefused(true);
      })
      .catch((error: unknown) => {
        warn(error);
        setPinRefused(true);
      });
  }, []);

  const setShowNumbers = useCallback(
    (show: boolean) => {
      setShowNumbersState(show);
      writeWidgetShowNumbers(db, show)
        .then(requestWidgetRefresh)
        .catch((error: unknown) => {
          warn(error);
          readWidgetShowNumbers(db).then(setShowNumbersState);
        });
    },
    [db],
  );

  return {
    supported,
    canPin: canPin === null ? null : canPin && !pinRefused,
    placement,
    showNumbers,
    requestPin,
    setShowNumbers,
  };
}
