import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type ChromeContextType = {
  visible: boolean;
  setVisible: (v: boolean) => void;
};

const ChromeContext = createContext<ChromeContextType>({
  visible: true,
  setVisible: () => {},
});

const HIDE_IDLE_DELAY_MS = 260;

export function useChrome() {
  return useContext(ChromeContext);
}

/** Provider for in-app chrome (top header + bottom tab bar) visibility.
 *  Screens that want hide-on-scroll call setVisible based on scroll direction. */
export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <ChromeContext.Provider value={{ visible, setVisible }}>
      {children}
    </ChromeContext.Provider>
  );
}

/** Scroll handler that flips chrome visibility based on vertical scroll direction.
 *  Shows when near the top, hides when scrolling down, shows when scrolling up. */
export function useHideChromeOnScroll() {
  const { setVisible } = useChrome();
  const lastY = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingHide, [clearPendingHide]);

  return useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      if (y < 16) {
        clearPendingHide();
        setVisible(true);
      } else if (dy > 1) {
        clearPendingHide();
        setVisible(true);
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          setVisible(false);
        }, HIDE_IDLE_DELAY_MS);
      } else if (dy < -1) {
        clearPendingHide();
        setVisible(true);
      }
      lastY.current = y;
    },
    [clearPendingHide, setVisible]
  );
}
