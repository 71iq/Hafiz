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

export function useChrome(): ChromeContextType {
  const state = useContext(ChromeStateContext);
  const actions = useContext(ChromeActionsContext);
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

export function useChromeActions(): ChromeActions {
  return useContext(ChromeActionsContext);
}

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
