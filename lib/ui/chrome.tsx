import { createContext, useContext, useState, useCallback, type Dispatch, type SetStateAction } from "react";

type ChromeContextType = {
  visible: boolean;
  setVisible: Dispatch<SetStateAction<boolean>>;
  immersive: boolean;
  setImmersive: Dispatch<SetStateAction<boolean>>;
  markActivity: () => void;
};

const ChromeContext = createContext<ChromeContextType>({
  visible: true,
  setVisible: (_value) => {},
  immersive: false,
  setImmersive: (_value) => {},
  markActivity: () => {},
});

export function useChrome() {
  return useContext(ChromeContext);
}

/** Provider for in-app chrome (top header + bottom tab bar) visibility. */
export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [immersive, setImmersive] = useState(false);

  const markActivity = useCallback(() => {
    if (immersive) return;
    setVisible(true);
  }, [immersive]);

  return (
    <ChromeContext.Provider value={{ visible, setVisible, immersive, setImmersive, markActivity }}>
      {children}
    </ChromeContext.Provider>
  );
}
