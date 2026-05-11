import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type ChromeContextType = {
  visible: boolean;
  setVisible: (v: boolean) => void;
  markActivity: () => void;
  setAutoHideEnabled: (enabled: boolean) => void;
};

const ChromeContext = createContext<ChromeContextType>({
  visible: true,
  setVisible: () => {},
  markActivity: () => {},
  setAutoHideEnabled: () => {},
});

const INACTIVITY_HIDE_DELAY_MS = 2500;

export function useChrome() {
  return useContext(ChromeContext);
}

/** Provider for in-app chrome (top header + bottom tab bar) visibility. */
export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);
  const autoHideEnabledRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInactivityTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleInactivityHide = useCallback(() => {
    if (!autoHideEnabledRef.current) return;
    clearInactivityTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (autoHideEnabledRef.current) setVisible(false);
    }, INACTIVITY_HIDE_DELAY_MS);
  }, [clearInactivityTimer]);

  const markActivity = useCallback(() => {
    setVisible(true);
    scheduleInactivityHide();
  }, [scheduleInactivityHide]);

  const setAutoHideEnabled = useCallback(
    (enabled: boolean) => {
      autoHideEnabledRef.current = enabled;
      clearInactivityTimer();
      if (enabled) {
        setVisible(true);
        scheduleInactivityHide();
      } else {
        setVisible(true);
      }
    },
    [clearInactivityTimer, scheduleInactivityHide]
  );

  useEffect(() => clearInactivityTimer, [clearInactivityTimer]);

  return (
    <ChromeContext.Provider value={{ visible, setVisible, markActivity, setAutoHideEnabled }}>
      {children}
    </ChromeContext.Provider>
  );
}

/** Enables reader-style inactivity hiding while the current screen is mounted. */
export function useChromeInactivity() {
  const { markActivity, setAutoHideEnabled } = useChrome();

  useEffect(() => {
    setAutoHideEnabled(true);
    markActivity();
    return () => setAutoHideEnabled(false);
  }, [markActivity, setAutoHideEnabled]);

  return markActivity;
}

export function useHideChromeOnScroll() {
  const markActivity = useChromeInactivity();
  return useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>) => {
      markActivity();
    },
    [markActivity]
  );
}
