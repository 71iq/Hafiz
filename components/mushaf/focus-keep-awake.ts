import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const FOCUS_KEEP_AWAKE_TAG = "hafiz-focus-scroll";

export function useFocusKeepAwake(playing: boolean) {
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  const wanted = playing && appActive;
  useEffect(() => {
    if (!wanted) return;
    let held = false;
    let released = false;
    activateKeepAwakeAsync(FOCUS_KEEP_AWAKE_TAG)
      .then(() => {
        if (released) deactivateKeepAwake(FOCUS_KEEP_AWAKE_TAG).catch(() => undefined);
        else held = true;
      })
      .catch(() => undefined);
    return () => {
      released = true;
      if (held) deactivateKeepAwake(FOCUS_KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [wanted]);
}
