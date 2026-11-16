import { useEffect, useState } from "react";

export const LOCAL_LOADING_DELAY_MS = 200;

export function useDelayedLoading(loading: boolean, delayMs = LOCAL_LOADING_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, loading]);
  return loading && visible;
}
