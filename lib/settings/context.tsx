import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import type { SQLiteDatabase } from "expo-sqlite";
import { useDatabase } from "@/lib/database/provider";

export const FONT_SIZE_STEPS = [22, 26, 30, 34, 38, 42, 46] as const;
export const FONT_SIZE_LINE_HEIGHTS = [48, 56, 64, 72, 80, 88, 96] as const;
const DEFAULT_FONT_SIZE_INDEX = 2; // 30px

export type ThemeMode = "light" | "dark" | "system";
export type ViewMode = "verse" | "page";

type SettingsContextType = {
  fontSizeIndex: number;
  fontSize: number;
  lineHeight: number;
  setFontSizeIndex: (index: number) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isLoaded: boolean;
};

const SettingsContext = createContext<SettingsContextType>({
  fontSizeIndex: DEFAULT_FONT_SIZE_INDEX,
  fontSize: FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_INDEX],
  lineHeight: FONT_SIZE_LINE_HEIGHTS[DEFAULT_FONT_SIZE_INDEX],
  setFontSizeIndex: () => {},
  theme: "system",
  setTheme: () => {},
  viewMode: "verse",
  setViewMode: () => {},
  isLoaded: false,
});

export function useSettings() {
  return useContext(SettingsContext);
}

async function readSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

async function writeSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
    [key, value]
  );
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const { setColorScheme } = useNativeWindColorScheme();
  const [fontSizeIndex, setFontSizeIndexState] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [viewMode, setViewModeState] = useState<ViewMode>("verse");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from SQLite on mount
  useEffect(() => {
    async function load() {
      try {
        const savedFontSize = await readSetting(db, "font_size_index");
        if (savedFontSize !== null) {
          const idx = parseInt(savedFontSize, 10);
          if (idx >= 0 && idx < FONT_SIZE_STEPS.length) {
            setFontSizeIndexState(idx);
          }
        }

        const savedTheme = await readSetting(db, "theme");
        if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
          setThemeState(savedTheme);
          setColorScheme(savedTheme);
        }

        const savedViewMode = await readSetting(db, "view_mode");
        if (savedViewMode === "verse" || savedViewMode === "page") {
          setViewModeState(savedViewMode);
        }
      } catch (err) {
        console.warn("[Settings] Failed to load settings:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, [db]);

  const setFontSizeIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= FONT_SIZE_STEPS.length) return;
      setFontSizeIndexState(index);
      writeSetting(db, "font_size_index", String(index)).catch(console.warn);
    },
    [db]
  );

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      setThemeState(newTheme);
      setColorScheme(newTheme);
      writeSetting(db, "theme", newTheme).catch(console.warn);
    },
    [db]
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      writeSetting(db, "view_mode", mode).catch(console.warn);
    },
    [db]
  );

  return (
    <SettingsContext.Provider
      value={{
        fontSizeIndex,
        fontSize: FONT_SIZE_STEPS[fontSizeIndex],
        lineHeight: FONT_SIZE_LINE_HEIGHTS[fontSizeIndex],
        setFontSizeIndex,
        theme,
        setTheme,
        viewMode,
        setViewMode,
        isLoaded,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
