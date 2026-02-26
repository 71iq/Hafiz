import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useColorScheme } from "nativewind";

interface SettingsContextValue {
  fontSize: number;
  setFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  hideAyahs: boolean;
  toggleHideAyahs: () => void;
  colorScheme: "light" | "dark" | undefined;
  toggleDarkMode: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const MIN_FONT_SIZE = 18;
const MAX_FONT_SIZE = 48;
const FONT_STEP = 2;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeRaw] = useState(28);
  const [hideAyahs, setHideAyahs] = useState(false);
  const { colorScheme, toggleColorScheme } = useColorScheme();

  const setFontSize = useCallback((size: number) => {
    setFontSizeRaw(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size)));
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSizeRaw((prev) => Math.min(MAX_FONT_SIZE, prev + FONT_STEP));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSizeRaw((prev) => Math.max(MIN_FONT_SIZE, prev - FONT_STEP));
  }, []);

  const toggleHideAyahs = useCallback(() => {
    setHideAyahs((prev) => !prev);
  }, []);

  const toggleDarkMode = useCallback(() => {
    toggleColorScheme();
  }, [toggleColorScheme]);

  return (
    <SettingsContext.Provider
      value={{
        fontSize,
        setFontSize,
        increaseFontSize,
        decreaseFontSize,
        hideAyahs,
        toggleHideAyahs,
        colorScheme,
        toggleDarkMode,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
