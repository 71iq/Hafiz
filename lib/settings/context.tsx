import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import type { SQLiteDatabase } from "expo-sqlite";
import { useDatabase } from "@/lib/database/provider";
import { DEFAULT_LANGUAGE } from "@/lib/translations/languages";
import { importTranslation } from "@/lib/translations/import";

export const FONT_SIZE_STEPS = [22, 26, 30, 34, 38, 42, 46] as const;
export const FONT_SIZE_LINE_HEIGHTS = [48, 56, 64, 72, 80, 88, 96] as const;
const DEFAULT_FONT_SIZE_INDEX = 2; // 30px

export type ThemeMode = "light" | "dark" | "system";
export type ViewMode = "verse" | "page";
export type UILanguage = "en" | "ar";
export type TafseerSource = "muyassar" | "zilal";

type SettingsContextType = {
  fontSizeIndex: number;
  fontSize: number;
  lineHeight: number;
  setFontSizeIndex: (index: number) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  showTranslation: boolean;
  setShowTranslation: (show: boolean) => void;
  showTafseer: boolean;
  setShowTafseer: (show: boolean) => void;
  translationLanguage: string;
  setTranslationLanguage: (code: string) => Promise<void>;
  isTranslationLoading: boolean;
  tafseerSource: TafseerSource;
  setTafseerSource: (source: TafseerSource) => void;
  uiLanguage: UILanguage;
  setUiLanguage: (lang: UILanguage) => void;
  isRTL: boolean;
  isDark: boolean;
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
  showTranslation: false,
  setShowTranslation: () => {},
  showTafseer: false,
  setShowTafseer: () => {},
  translationLanguage: DEFAULT_LANGUAGE,
  setTranslationLanguage: async () => {},
  isTranslationLoading: false,
  tafseerSource: "muyassar",
  setTafseerSource: () => {},
  uiLanguage: "en",
  setUiLanguage: () => {},
  isRTL: false,
  isDark: false,
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
  const { colorScheme: nwScheme, setColorScheme } = useNativeWindColorScheme();
  const [fontSizeIndex, setFontSizeIndexState] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [viewMode, setViewModeState] = useState<ViewMode>("verse");
  const [showTranslation, setShowTranslationState] = useState(false);
  const [showTafseer, setShowTafseerState] = useState(false);
  const [translationLanguage, setTranslationLanguageState] = useState(DEFAULT_LANGUAGE);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [tafseerSource, setTafseerSourceState] = useState<TafseerSource>("muyassar");
  const [uiLanguage, setUiLanguageState] = useState<UILanguage>("en");
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
          // Defer to avoid NativeWind observable firing before components mount
          requestAnimationFrame(() => setColorScheme(savedTheme));
        }

        const savedViewMode = await readSetting(db, "view_mode");
        if (savedViewMode === "verse" || savedViewMode === "page") {
          setViewModeState(savedViewMode);
        }

        const savedShowTranslation = await readSetting(db, "show_translation");
        if (savedShowTranslation === "true") setShowTranslationState(true);

        const savedShowTafseer = await readSetting(db, "show_tafseer");
        if (savedShowTafseer === "true") setShowTafseerState(true);

        const savedTafseerSource = await readSetting(db, "tafseer_source");
        if (savedTafseerSource === "muyassar" || savedTafseerSource === "zilal") {
          setTafseerSourceState(savedTafseerSource);
        }

        const savedUiLang = await readSetting(db, "ui_language");
        if (savedUiLang === "en" || savedUiLang === "ar") {
          setUiLanguageState(savedUiLang);
        }

        const savedLang = await readSetting(db, "translation_language");
        if (savedLang && savedLang !== DEFAULT_LANGUAGE) {
          setTranslationLanguageState(savedLang);
          // Re-import if translation_active has wrong language or is empty
          const activeLang = await readSetting(db, "translation_active_lang");
          if (activeLang !== savedLang) {
            setIsTranslationLoading(true);
            try {
              await importTranslation(db, savedLang);
              await writeSetting(db, "translation_active_lang", savedLang);
            } catch (e) {
              console.warn("[Settings] Failed to re-import translation:", e);
            } finally {
              setIsTranslationLoading(false);
            }
          }
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
      requestAnimationFrame(() => setColorScheme(newTheme));
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

  const setShowTranslation = useCallback(
    (show: boolean) => {
      setShowTranslationState(show);
      writeSetting(db, "show_translation", String(show)).catch(console.warn);
    },
    [db]
  );

  const setShowTafseer = useCallback(
    (show: boolean) => {
      setShowTafseerState(show);
      writeSetting(db, "show_tafseer", String(show)).catch(console.warn);
    },
    [db]
  );

  const setTranslationLanguage = useCallback(
    async (code: string) => {
      if (code === translationLanguage) return;
      setTranslationLanguageState(code);
      writeSetting(db, "translation_language", code).catch(console.warn);

      if (code !== DEFAULT_LANGUAGE) {
        setIsTranslationLoading(true);
        try {
          await importTranslation(db, code);
          await writeSetting(db, "translation_active_lang", code);
        } catch (e) {
          console.warn("[Settings] Failed to import translation:", e);
        } finally {
          setIsTranslationLoading(false);
        }
      }
    },
    [db, translationLanguage]
  );

  const setTafseerSource = useCallback(
    (source: TafseerSource) => {
      setTafseerSourceState(source);
      writeSetting(db, "tafseer_source", source).catch(console.warn);
    },
    [db]
  );

  const setUiLanguage = useCallback(
    (lang: UILanguage) => {
      setUiLanguageState(lang);
      writeSetting(db, "ui_language", lang).catch(console.warn);
    },
    [db]
  );

  const isDark = nwScheme === "dark";
  const isRTL = uiLanguage === "ar";

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
        showTranslation,
        setShowTranslation,
        showTafseer,
        setShowTafseer,
        translationLanguage,
        setTranslationLanguage,
        isTranslationLoading,
        tafseerSource,
        setTafseerSource,
        uiLanguage,
        setUiLanguage,
        isRTL,
        isDark,
        isLoaded,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
