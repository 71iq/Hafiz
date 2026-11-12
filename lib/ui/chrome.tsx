import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type ChromeState = {
  visible: boolean;
  immersive: boolean;
};

type ChromeActions = {
  setVisible: Dispatch<SetStateAction<boolean>>;
  setImmersive: Dispatch<SetStateAction<boolean>>;
  markActivity: () => void;
};

type ChromeContextType = ChromeState & ChromeActions;

const noop = () => {};
const ChromeStateContext = createContext<ChromeState>({ visible: true, immersive: false });
const ChromeActionsContext = createContext<ChromeActions>({
  setVisible: noop,
  setImmersive: noop,
  markActivity: noop,
});

/** Chrome state and actions. Re-renders whenever the bar shows or hides. */
export function useChrome(): ChromeContextType {
  const state = useContext(ChromeStateContext);
  const actions = useContext(ChromeActionsContext);
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

/**
 * Stable chrome actions only. Word tokens use this: the bar hides and shows on every change of
 * scroll direction, and subscribing hundreds of tokens to that state re-rendered a whole page.
 */
export function useChromeActions(): ChromeActions {
  return useContext(ChromeActionsContext);
}

/** Provider for in-app chrome (top header + bottom tab bar) visibility. */
export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;

  const markActivity = useCallback(() => {
    if (immersiveRef.current) return;
    setVisible(true);
  }, []);

  const state = useMemo(() => ({ visible, immersive }), [visible, immersive]);
  const actions = useMemo(() => ({ setVisible, setImmersive, markActivity }), [markActivity]);

  return (
    <ChromeActionsContext.Provider value={actions}>
      <ChromeStateContext.Provider value={state}>{children}</ChromeStateContext.Provider>
    </ChromeActionsContext.Provider>
  );
}
