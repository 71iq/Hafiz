import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Platform, useColorScheme as useSystemColorScheme, useWindowDimensions, View } from "react-native";
import { useColorScheme as useNativeWindColorScheme, vars } from "nativewind";
import type { SQLiteDatabase } from "expo-sqlite";
import { useDatabase } from "@/lib/database/provider";
import { writeUserSetting } from "@/lib/database/user-settings";
import { DEFAULT_LANGUAGE, DEFAULT_TRANSLATION_LANGUAGE } from "@/lib/translations/languages";
import { importTranslation } from "@/lib/translations/import";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { DEFAULT_RECITATION_ID, normalizeRecitationId } from "@/lib/quran-foundation/recitations";
import { DirectionProvider } from "@/lib/ui/direction";
import {
  DEFAULT_TAFSIR_SOURCE,
  isAvailableTafsirSourceId,
  type TafsirSourceId,
} from "@/lib/tafsir/sources";

// Desktop / large-viewport scale. Also the canonical length (10 levels) used
// by UI controls like the font size picker.
export const FONT_SIZE_STEPS = [22, 26, 30, 34, 38, 42, 46, 50, 54, 58] as const;
export const FONT_SIZE_LINE_HEIGHTS = [48, 56, 64, 72, 80, 88, 96, 104, 112, 120] as const;

// Mobile scale — roughly 65–70% of desktop at each step. Ten levels aligned
// 1-to-1 with FONT_SIZE_STEPS so the saved fontSizeIndex is portable.
export const FONT_SIZE_STEPS_MOBILE = [14, 17, 20, 23, 26, 29, 32, 35, 38, 41] as const;
export const FONT_SIZE_LINE_HEIGHTS_MOBILE = [32, 38, 44, 50, 56, 62, 68, 74, 80, 86] as const;

export const DEFAULT_FONT_SIZE_INDEX = 2; // desktop 30px / mobile 20px (verse view)
// Web viewports narrower than the shared sidebar breakpoint use the mobile
// scale; native is always mobile.

export const DEFAULT_DAILY_REVIEW_LIMIT = 30;
export const MIN_DAILY_REVIEW_LIMIT = 10;
export const MAX_DAILY_REVIEW_LIMIT = 30;
export const DAILY_REVIEW_LIMIT_STEP = 10;
export const FOCUS_SCROLL_SPEED_MIN = 0.2;
export const FOCUS_SCROLL_SPEED_MAX = 1.5;
export const FOCUS_SCROLL_SPEED_DEFAULT = 1;
export const DEFAULT_HIFZ_AUTO_DELAY_MS = 500;
export const MIN_HIFZ_AUTO_DELAY_MS = 250;
export const MAX_HIFZ_AUTO_DELAY_MS = 5000;
export const HIFZ_AUTO_DELAY_STEP_MS = 250;

export type ThemePalette = "beige" | "dark" | "white" | "amoled";
export type ThemeMode = ThemePalette | "system" | "scheduled";
export type ThemeScheduleRule = { id: string; theme: ThemePalette; time: string };
export type ThemeColors = {
  surface: string;
  surfaceLow: string;
  surfaceMid: string;
  surfaceHigh: string;
  surfaceDim: string;
  surfaceBright: string;
};
export type ViewMode = "verse" | "page";
export type PageScroll = "vertical" | "horizontal";
export type QuranFontStyle = "qcf2" | "v4" | "v4-tajweed";
export type UILanguage = "en" | "ar";
export type TafseerSource = TafsirSourceId;
const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";
const THEME_CACHE_KEY = "hafiz_theme";
const SCHEDULED_THEME_CACHE_KEY = "hafiz_scheduled_theme";
const SCHEDULED_SWITCH_TIME_CACHE_KEY = "hafiz_scheduled_switch_time";
const SCHEDULED_RULES_CACHE_KEY = "hafiz_scheduled_rules";

export const THEME_COLORS: Record<ThemePalette, ThemeColors> = {
  beige: {
    surface: "#FFF8F1",
    surfaceLow: "#F9F3EB",
    surfaceMid: "#F0EBE3",
    surfaceHigh: "#E8E1DA",
    surfaceDim: "#DFD9D1",
    surfaceBright: "#FFFFFF",
  },
  white: {
    surface: "#FFFFFF",
    surfaceLow: "#F8FAFC",
    surfaceMid: "#F4F4F5",
    surfaceHigh: "#E5E7EB",
    surfaceDim: "#D1D5DB",
    surfaceBright: "#FFFFFF",
  },
  dark: {
    surface: "#0A0A0A",
    surfaceLow: "#141414",
    surfaceMid: "#1A1A1A",
    surfaceHigh: "#262626",
    surfaceDim: "#0F0F0F",
    surfaceBright: "#2D2D2D",
  },
  amoled: {
    surface: "#000000",
    surfaceLow: "#030303",
    surfaceMid: "#080808",
    surfaceHigh: "#0F0F0F",
    surfaceDim: "#000000",
    surfaceBright: "#181818",
  },
};

export function withThemeOpacity(color: string, opacity: number): string {
  const hex = color.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((char) => `${char}${char}`).join("")
    : hex;
  if (normalized.length !== 6) return color;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(1, opacity));
  return `rgba(${red},${green},${blue},${alpha})`;
}

type SettingsContextType = {
  fontSizeIndex: number;
  fontSize: number;
  lineHeight: number;
  setFontSizeIndex: (index: number) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  effectiveTheme: ThemePalette;
  scheduledTheme: ThemePalette;
  setScheduledTheme: (theme: ThemePalette) => void;
  scheduledSwitchTime: string;
  setScheduledSwitchTime: (time: string) => void;
  scheduledRules: ThemeScheduleRule[];
  setScheduledRules: (rules: ThemeScheduleRule[]) => void;
  themeSurface: string;
  themeColors: ThemeColors;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  quranFontStyle: QuranFontStyle;
  setQuranFontStyle: (style: QuranFontStyle) => void;
  pageScroll: PageScroll;
  setPageScroll: (scroll: PageScroll) => void;
  showTranslation: boolean;
  setShowTranslation: (show: boolean) => void;
  showTafseer: boolean;
  setShowTafseer: (show: boolean) => void;
  translationLanguage: string;
  setTranslationLanguage: (code: string) => Promise<void>;
  isTranslationLoading: boolean;
  tafseerSource: TafseerSource;
  setTafseerSource: (source: TafseerSource) => void;
  recitationId: number;
  setRecitationId: (id: number) => void;
  uiLanguage: UILanguage;
  setUiLanguage: (lang: UILanguage) => void;
  dailyReviewLimit: number;
  setDailyReviewLimit: (limit: number) => void;
  focusScrollSpeed: number;
  setFocusScrollSpeed: (speed: number) => void;
  hifzAutoDelayMs: number;
  setHifzAutoDelayMs: (delayMs: number) => void;
  hifzAutoAdvancePage: boolean;
  setHifzAutoAdvancePage: (enabled: boolean) => void;
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
  effectiveTheme: "beige",
  scheduledTheme: "dark",
  setScheduledTheme: () => {},
  scheduledSwitchTime: "21:00",
  setScheduledSwitchTime: () => {},
  scheduledRules: [],
  setScheduledRules: () => {},
  themeSurface: "#FFF8F1",
  themeColors: THEME_COLORS.beige,
  viewMode: "verse",
  setViewMode: () => {},
  quranFontStyle: "qcf2",
  setQuranFontStyle: () => {},
  pageScroll: "vertical",
  setPageScroll: () => {},
  showTranslation: false,
  setShowTranslation: () => {},
  showTafseer: false,
  setShowTafseer: () => {},
  translationLanguage: DEFAULT_TRANSLATION_LANGUAGE,
  setTranslationLanguage: async () => {},
  isTranslationLoading: false,
  tafseerSource: DEFAULT_TAFSIR_SOURCE,
  setTafseerSource: () => {},
  recitationId: DEFAULT_RECITATION_ID,
  setRecitationId: () => {},
  uiLanguage: "en",
  setUiLanguage: () => {},
  dailyReviewLimit: DEFAULT_DAILY_REVIEW_LIMIT,
  setDailyReviewLimit: () => {},
  focusScrollSpeed: FOCUS_SCROLL_SPEED_DEFAULT,
  setFocusScrollSpeed: () => {},
  hifzAutoDelayMs: DEFAULT_HIFZ_AUTO_DELAY_MS,
  setHifzAutoDelayMs: () => {},
  hifzAutoAdvancePage: false,
  setHifzAutoAdvancePage: () => {},
  isRTL: false,
  isDark: false,
  isLoaded: false,
});

const DEFAULT_SCHEDULED_THEME: ThemePalette = "dark";
const DEFAULT_SCHEDULED_SWITCH_TIME = "21:00";
const DEFAULT_SCHEDULED_RULES: ThemeScheduleRule[] = [
  { id: "default", theme: DEFAULT_SCHEDULED_THEME, time: DEFAULT_SCHEDULED_SWITCH_TIME },
];

const THEME_PALETTES: Record<
  ThemePalette,
  {
    surface: string;
    variables: Record<`--${string}`, string>;
  }
> = {
  beige: {
    surface: "#FFF8F1",
    variables: {
      "--color-surface": "255 248 241",
      "--color-surface-low": "249 243 235",
      "--color-surface-mid": "240 235 227",
      "--color-surface-high": "232 225 218",
      "--color-surface-dim": "223 217 209",
      "--color-surface-bright": "255 255 255",
      "--color-surface-dark": "255 248 241",
      "--color-surface-dark-low": "249 243 235",
      "--color-surface-dark-mid": "240 235 227",
      "--color-surface-dark-high": "232 225 218",
      "--color-surface-dark-dim": "223 217 209",
      "--color-surface-dark-bright": "255 255 255",
      "--color-warm-50": "255 248 241",
      "--color-warm-100": "249 243 235",
      "--color-warm-200": "232 225 218",
      "--color-warm-300": "223 217 209",
      "--color-warm-400": "185 160 133",
      "--color-warm-500": "165 138 108",
      "--color-warm-600": "138 112 88",
      "--color-warm-700": "110 90 71",
      "--color-warm-800": "90 74 60",
      "--color-warm-900": "74 62 51",
    },
  },
  white: {
    surface: "#FFFFFF",
    variables: {
      "--color-surface": "255 255 255",
      "--color-surface-low": "248 250 252",
      "--color-surface-mid": "244 244 245",
      "--color-surface-high": "229 231 235",
      "--color-surface-dim": "209 213 219",
      "--color-surface-bright": "255 255 255",
      "--color-surface-dark": "255 255 255",
      "--color-surface-dark-low": "248 250 252",
      "--color-surface-dark-mid": "244 244 245",
      "--color-surface-dark-high": "229 231 235",
      "--color-surface-dark-dim": "209 213 219",
      "--color-surface-dark-bright": "255 255 255",
      "--color-warm-50": "255 255 255",
      "--color-warm-100": "248 250 252",
      "--color-warm-200": "229 231 235",
      "--color-warm-300": "209 213 219",
      "--color-warm-400": "113 113 122",
      "--color-warm-500": "82 82 91",
      "--color-warm-600": "63 63 70",
      "--color-warm-700": "39 39 42",
      "--color-warm-800": "24 24 27",
      "--color-warm-900": "9 9 11",
    },
  },
  dark: {
    surface: "#0A0A0A",
    variables: {
      "--color-surface": "10 10 10",
      "--color-surface-low": "20 20 20",
      "--color-surface-mid": "26 26 26",
      "--color-surface-high": "38 38 38",
      "--color-surface-dim": "15 15 15",
      "--color-surface-bright": "45 45 45",
      "--color-surface-dark": "10 10 10",
      "--color-surface-dark-low": "20 20 20",
      "--color-surface-dark-mid": "26 26 26",
      "--color-surface-dark-high": "38 38 38",
      "--color-surface-dark-dim": "15 15 15",
      "--color-surface-dark-bright": "45 45 45",
      "--color-warm-50": "10 10 10",
      "--color-warm-100": "20 20 20",
      "--color-warm-200": "38 38 38",
      "--color-warm-300": "64 64 64",
      "--color-warm-400": "115 115 115",
      "--color-warm-500": "163 163 163",
      "--color-warm-600": "212 212 212",
      "--color-warm-700": "229 229 229",
      "--color-warm-800": "245 245 245",
      "--color-warm-900": "250 250 250",
    },
  },
  amoled: {
    surface: "#000000",
    variables: {
      "--color-surface": "0 0 0",
      "--color-surface-low": "3 3 3",
      "--color-surface-mid": "8 8 8",
      "--color-surface-high": "15 15 15",
      "--color-surface-dim": "0 0 0",
      "--color-surface-bright": "24 24 24",
      "--color-surface-dark": "0 0 0",
      "--color-surface-dark-low": "3 3 3",
      "--color-surface-dark-mid": "8 8 8",
      "--color-surface-dark-high": "15 15 15",
      "--color-surface-dark-dim": "0 0 0",
      "--color-surface-dark-bright": "24 24 24",
      "--color-warm-50": "0 0 0",
      "--color-warm-100": "3 3 3",
      "--color-warm-200": "15 15 15",
      "--color-warm-300": "38 38 38",
      "--color-warm-400": "115 115 115",
      "--color-warm-500": "163 163 163",
      "--color-warm-600": "212 212 212",
      "--color-warm-700": "229 229 229",
      "--color-warm-800": "245 245 245",
      "--color-warm-900": "250 250 250",
    },
  },
};

function isThemePalette(value: string | null | undefined): value is ThemePalette {
  return value === "beige" || value === "dark" || value === "white" || value === "amoled";
}

function normalizeThemeMode(value: string | null | undefined): ThemeMode | null {
  if (value === "light") return "beige";
  if (isThemePalette(value) || value === "system" || value === "scheduled") return value;
  return null;
}

function normalizeQuranFontStyle(value: string | null | undefined): QuranFontStyle | null {
  return value === "qcf2" || value === "v4" || value === "v4-tajweed" ? value : null;
}

function normalizeThemeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeThemeScheduleRules(value: string | null | undefined): ThemeScheduleRule[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const rules = parsed.flatMap((rule, index): ThemeScheduleRule[] => {
      const theme = isThemePalette(rule?.theme) ? rule.theme : null;
      const time = normalizeThemeTime(rule?.time);
      if (!theme || !time) return [];
      return [{
        id: typeof rule?.id === "string" && rule.id.trim() ? rule.id : `rule-${index}`,
        theme,
        time,
      }];
    });
    return rules.length > 0 ? sortThemeScheduleRules(rules) : null;
  } catch {
    return null;
  }
}

function sortThemeScheduleRules(rules: ThemeScheduleRule[]): ThemeScheduleRule[] {
  return [...rules].sort((a, b) => getThemeTimeMinuteOfDay(a.time) - getThemeTimeMinuteOfDay(b.time));
}

function normalizeThemeScheduleRulesList(rules: ThemeScheduleRule[]): ThemeScheduleRule[] {
  const normalized = rules.flatMap((rule, index): ThemeScheduleRule[] => {
    const theme = isThemePalette(rule.theme) ? rule.theme : null;
    const time = normalizeThemeTime(rule.time);
    if (!theme || !time) return [];
    return [{
      id: rule.id.trim() || `rule-${index}`,
      theme,
      time,
    }];
  });
  return sortThemeScheduleRules(normalized.length > 0 ? normalized : DEFAULT_SCHEDULED_RULES);
}

function getCurrentMinuteOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getThemeTimeMinuteOfDay(time: string) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function isThemeScheduleActive(time: string, currentMinute: number) {
  return currentMinute >= getThemeTimeMinuteOfDay(time);
}

function resolveScheduledTheme(rules: ThemeScheduleRule[], currentMinute: number, systemTheme: ThemePalette): ThemePalette {
  const normalized = normalizeThemeScheduleRulesList(rules);
  if (normalized.length === 1) {
    return isThemeScheduleActive(normalized[0].time, currentMinute) ? normalized[0].theme : systemTheme;
  }

  let activeRule = normalized[normalized.length - 1];
  for (const rule of normalized) {
    if (getThemeTimeMinuteOfDay(rule.time) <= currentMinute) activeRule = rule;
    else break;
  }
  return activeRule.theme;
}

function scheduledUsesSystemFallback(rules: ThemeScheduleRule[], currentMinute: number): boolean {
  const normalized = normalizeThemeScheduleRulesList(rules);
  return normalized.length === 1 && !isThemeScheduleActive(normalized[0].time, currentMinute);
}

function readCachedUiLanguage(): UILanguage {
  if (Platform.OS !== "web" || typeof window === "undefined") return "en";
  const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
  return cached === "ar" ? "ar" : "en";
}

function cacheUiLanguage(lang: UILanguage) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(UI_LANGUAGE_CACHE_KEY, lang);
  }
}

function readCachedThemeMode(): ThemeMode {
  if (Platform.OS !== "web" || typeof window === "undefined") return "system";
  return normalizeThemeMode(window.localStorage.getItem(THEME_CACHE_KEY)) ?? "system";
}

function cacheThemeMode(theme: ThemeMode) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(THEME_CACHE_KEY, theme);
  }
}

function readCachedScheduledTheme(): ThemePalette {
  if (Platform.OS !== "web" || typeof window === "undefined") return DEFAULT_SCHEDULED_THEME;
  const cached = window.localStorage.getItem(SCHEDULED_THEME_CACHE_KEY);
  return isThemePalette(cached) ? cached : DEFAULT_SCHEDULED_THEME;
}

function cacheScheduledTheme(theme: ThemePalette) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(SCHEDULED_THEME_CACHE_KEY, theme);
  }
}

function readCachedScheduledSwitchTime(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return DEFAULT_SCHEDULED_SWITCH_TIME;
  return normalizeThemeTime(window.localStorage.getItem(SCHEDULED_SWITCH_TIME_CACHE_KEY)) ?? DEFAULT_SCHEDULED_SWITCH_TIME;
}

function cacheScheduledSwitchTime(time: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(SCHEDULED_SWITCH_TIME_CACHE_KEY, time);
  }
}

function readCachedScheduledRules(): ThemeScheduleRule[] {
  if (Platform.OS !== "web" || typeof window === "undefined") return DEFAULT_SCHEDULED_RULES;
  return normalizeThemeScheduleRules(window.localStorage.getItem(SCHEDULED_RULES_CACHE_KEY)) ??
    [{
      id: "default",
      theme: readCachedScheduledTheme(),
      time: readCachedScheduledSwitchTime(),
    }];
}

function cacheScheduledRules(rules: ThemeScheduleRule[]) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(SCHEDULED_RULES_CACHE_KEY, JSON.stringify(normalizeThemeScheduleRulesList(rules)));
  }
}

function applyWebThemePalette(effectiveTheme: ThemePalette) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const palette = THEME_PALETTES[effectiveTheme];
  const root = document.documentElement;
  Object.entries(palette.variables).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  root.style.backgroundColor = palette.surface;
  document.body.style.backgroundColor = palette.surface;

  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = palette.surface;

  const statusBarMeta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBarMeta) {
    statusBarMeta.content = effectiveTheme === "dark" || effectiveTheme === "amoled" ? "black-translucent" : "default";
  }
}

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

async function readSettings(db: SQLiteDatabase, keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${placeholders})`,
    keys
  );
  const values = Object.fromEntries(keys.map((key) => [key, null])) as Record<string, string | null>;
  for (const row of rows) {
    values[row.key] = row.value;
  }
  return values;
}

async function writeSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await writeUserSetting(db, key, value);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const { setColorScheme } = useNativeWindColorScheme();
  const systemScheme = useSystemColorScheme();
  const { width } = useWindowDimensions();
  const isCompact = Platform.OS !== "web" || width < SIDEBAR_BREAKPOINT;
  const activeSteps = isCompact ? FONT_SIZE_STEPS_MOBILE : FONT_SIZE_STEPS;
  const activeLineHeights = isCompact ? FONT_SIZE_LINE_HEIGHTS_MOBILE : FONT_SIZE_LINE_HEIGHTS;
  const [fontSizeIndex, setFontSizeIndexState] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [theme, setThemeState] = useState<ThemeMode>(readCachedThemeMode);
  const [scheduledTheme, setScheduledThemeState] = useState<ThemePalette>(readCachedScheduledTheme);
  const [scheduledSwitchTime, setScheduledSwitchTimeState] = useState(readCachedScheduledSwitchTime);
  const [scheduledRules, setScheduledRulesState] = useState<ThemeScheduleRule[]>(readCachedScheduledRules);
  const [nowMinute, setNowMinute] = useState(getCurrentMinuteOfDay);
  const [viewMode, setViewModeState] = useState<ViewMode>("verse");
  const [quranFontStyle, setQuranFontStyleState] = useState<QuranFontStyle>("qcf2");
  const effectiveFontIndex = fontSizeIndex;
  const [pageScroll, setPageScrollState] = useState<PageScroll>("vertical");
  const [showTranslation, setShowTranslationState] = useState(false);
  const [showTafseer, setShowTafseerState] = useState(false);
  const [translationLanguage, setTranslationLanguageState] = useState(DEFAULT_TRANSLATION_LANGUAGE);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [tafseerSource, setTafseerSourceState] = useState<TafseerSource>(DEFAULT_TAFSIR_SOURCE);
  const [recitationId, setRecitationIdState] = useState(DEFAULT_RECITATION_ID);
  const [uiLanguage, setUiLanguageState] = useState<UILanguage>(readCachedUiLanguage);
  const [dailyReviewLimit, setDailyReviewLimitState] = useState(DEFAULT_DAILY_REVIEW_LIMIT);
  const [focusScrollSpeed, setFocusScrollSpeedState] = useState(FOCUS_SCROLL_SPEED_DEFAULT);
  const [hifzAutoDelayMs, setHifzAutoDelayMsState] = useState(DEFAULT_HIFZ_AUTO_DELAY_MS);
  const [hifzAutoAdvancePage, setHifzAutoAdvancePageState] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from SQLite on mount
  useEffect(() => {
    async function load() {
      try {
        const saved = await readSettings(db, [
          "font_size_index",
          "theme",
          "scheduled_rules",
          "scheduled_theme",
          "scheduled_switch_time",
          "view_mode",
          "quran_font_style",
          "page_scroll",
          "show_translation",
          "show_tafseer",
          "tafseer_source",
          "recitation_id",
          "ui_language",
          "daily_review_limit",
          "focus_scroll_speed",
          "hifz_auto_delay_ms",
          "hifz_auto_advance_page",
          "translation_language",
          "translation_active_lang",
        ]);

        const savedFontSize = saved.font_size_index;
        if (savedFontSize !== null) {
          const idx = parseInt(savedFontSize, 10);
          if (idx >= 0 && idx < FONT_SIZE_STEPS.length) {
            setFontSizeIndexState(idx);
          }
        }

        const savedTheme = saved.theme;
        const normalizedTheme = normalizeThemeMode(savedTheme);
        if (normalizedTheme) {
          setThemeState(normalizedTheme);
          cacheThemeMode(normalizedTheme);
        }

        const savedScheduledTheme = saved.scheduled_theme;
        if (isThemePalette(savedScheduledTheme)) {
          setScheduledThemeState(savedScheduledTheme);
          cacheScheduledTheme(savedScheduledTheme);
        }

        const normalizedScheduledTime = normalizeThemeTime(saved.scheduled_switch_time);
        if (normalizedScheduledTime) {
          setScheduledSwitchTimeState(normalizedScheduledTime);
          cacheScheduledSwitchTime(normalizedScheduledTime);
        }

        const savedScheduledRules = normalizeThemeScheduleRules(saved.scheduled_rules);
        if (savedScheduledRules) {
          setScheduledRulesState(savedScheduledRules);
          cacheScheduledRules(savedScheduledRules);
        } else if (isThemePalette(savedScheduledTheme) || normalizedScheduledTime) {
          const fallbackRules = normalizeThemeScheduleRulesList([{
            id: "default",
            theme: isThemePalette(savedScheduledTheme) ? savedScheduledTheme : DEFAULT_SCHEDULED_THEME,
            time: normalizedScheduledTime ?? DEFAULT_SCHEDULED_SWITCH_TIME,
          }]);
          setScheduledRulesState(fallbackRules);
          cacheScheduledRules(fallbackRules);
        }

        const savedViewMode = saved.view_mode;
        if (savedViewMode === "verse" || savedViewMode === "page") {
          setViewModeState(savedViewMode);
        }

        const savedQuranFontStyle = normalizeQuranFontStyle(saved.quran_font_style);
        if (savedQuranFontStyle) {
          setQuranFontStyleState(savedQuranFontStyle);
        }

        const savedPageScroll = saved.page_scroll;
        if (savedPageScroll === "vertical" || savedPageScroll === "horizontal") {
          setPageScrollState(savedPageScroll);
        }

        const savedShowTranslation = saved.show_translation;
        if (savedShowTranslation === "true") setShowTranslationState(true);

        const savedShowTafseer = saved.show_tafseer;
        if (savedShowTafseer === "true") setShowTafseerState(true);

        const savedTafseerSource = saved.tafseer_source;
        if (isAvailableTafsirSourceId(savedTafseerSource)) {
          setTafseerSourceState(savedTafseerSource);
        }

        const savedRecitationId = saved.recitation_id;
        if (savedRecitationId !== null) {
          setRecitationIdState(normalizeRecitationId(savedRecitationId));
        }

        const savedUiLang = saved.ui_language;
        if (savedUiLang === "en" || savedUiLang === "ar") {
          setUiLanguageState(savedUiLang);
          cacheUiLanguage(savedUiLang);
        }

        const savedLimit = saved.daily_review_limit;
        if (savedLimit !== null) {
          const n = parseInt(savedLimit, 10);
          if (n >= MIN_DAILY_REVIEW_LIMIT && n <= MAX_DAILY_REVIEW_LIMIT) {
            setDailyReviewLimitState(n);
          }
        }

        const savedFocusSpeed = saved.focus_scroll_speed;
        if (savedFocusSpeed !== null) {
          const n = Number(savedFocusSpeed);
          if (Number.isFinite(n)) {
            setFocusScrollSpeedState(
              Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, n))
            );
          }
        }

        const savedHifzDelay = saved.hifz_auto_delay_ms;
        if (savedHifzDelay !== null) {
          const n = parseInt(savedHifzDelay, 10);
          if (n >= MIN_HIFZ_AUTO_DELAY_MS && n <= MAX_HIFZ_AUTO_DELAY_MS) {
            setHifzAutoDelayMsState(n);
          }
        }

        const savedHifzAutoAdvance = saved.hifz_auto_advance_page;
        if (savedHifzAutoAdvance === "true") setHifzAutoAdvancePageState(true);

        const savedLang = saved.translation_language;
        const nextTranslationLanguage = savedLang ?? DEFAULT_TRANSLATION_LANGUAGE;
        setTranslationLanguageState(nextTranslationLanguage);
        if (!savedLang) {
          await writeSetting(db, "translation_language", nextTranslationLanguage);
        }
        if (nextTranslationLanguage !== DEFAULT_LANGUAGE) {
          const activeLang = saved.translation_active_lang;
          if (activeLang !== nextTranslationLanguage) {
            setIsTranslationLoading(true);
            try {
              await importTranslation(db, nextTranslationLanguage);
              await writeSetting(db, "translation_active_lang", nextTranslationLanguage);
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

  useEffect(() => {
    const intervalId = setInterval(() => setNowMinute(getCurrentMinuteOfDay()), 30_000);
    return () => clearInterval(intervalId);
  }, []);

  const systemTheme = systemScheme === "dark" ? "dark" : "beige";
  const effectiveTheme: ThemePalette =
    theme === "system" ? systemTheme : theme === "scheduled" ? resolveScheduledTheme(scheduledRules, nowMinute, systemTheme) : theme;
  const isDark = effectiveTheme === "dark" || effectiveTheme === "amoled";
  const themeColors = THEME_COLORS[effectiveTheme];
  const themeSurface = themeColors.surface;
  const themeVars = useMemo(
    () =>
      Platform.OS === "web" && typeof window === "undefined"
        ? undefined
        : vars(THEME_PALETTES[effectiveTheme].variables),
    [effectiveTheme]
  );
  const nativeWindScheme = theme === "system" || (theme === "scheduled" && scheduledUsesSystemFallback(scheduledRules, nowMinute))
    ? "system"
    : isDark
      ? "dark"
      : "light";

  useEffect(() => {
    requestAnimationFrame(() => setColorScheme(nativeWindScheme));
  }, [nativeWindScheme, setColorScheme]);

  useEffect(() => {
    applyWebThemePalette(effectiveTheme);
  }, [effectiveTheme]);

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
      cacheThemeMode(newTheme);
      writeSetting(db, "theme", newTheme).catch(console.warn);
    },
    [db]
  );

  const setScheduledTheme = useCallback(
    (newTheme: ThemePalette) => {
      const nextRules = normalizeThemeScheduleRulesList([
        { ...(scheduledRules[0] ?? DEFAULT_SCHEDULED_RULES[0]), theme: newTheme },
        ...scheduledRules.slice(1),
      ]);
      setScheduledRulesState(nextRules);
      setScheduledThemeState(nextRules[0].theme);
      setScheduledSwitchTimeState(nextRules[0].time);
      cacheScheduledRules(nextRules);
      cacheScheduledTheme(nextRules[0].theme);
      cacheScheduledSwitchTime(nextRules[0].time);
      setNowMinute(getCurrentMinuteOfDay());
      writeSetting(db, "scheduled_rules", JSON.stringify(nextRules)).catch(console.warn);
      writeSetting(db, "scheduled_theme", nextRules[0].theme).catch(console.warn);
      writeSetting(db, "scheduled_switch_time", nextRules[0].time).catch(console.warn);
    },
    [db, scheduledRules]
  );

  const setScheduledSwitchTime = useCallback(
    (time: string) => {
      const normalized = normalizeThemeTime(time);
      if (!normalized) return;
      const nextRules = normalizeThemeScheduleRulesList([
        { ...(scheduledRules[0] ?? DEFAULT_SCHEDULED_RULES[0]), time: normalized },
        ...scheduledRules.slice(1),
      ]);
      setScheduledRulesState(nextRules);
      setScheduledThemeState(nextRules[0].theme);
      setScheduledSwitchTimeState(nextRules[0].time);
      cacheScheduledRules(nextRules);
      cacheScheduledTheme(nextRules[0].theme);
      cacheScheduledSwitchTime(nextRules[0].time);
      setNowMinute(getCurrentMinuteOfDay());
      writeSetting(db, "scheduled_rules", JSON.stringify(nextRules)).catch(console.warn);
      writeSetting(db, "scheduled_theme", nextRules[0].theme).catch(console.warn);
      writeSetting(db, "scheduled_switch_time", nextRules[0].time).catch(console.warn);
    },
    [db, scheduledRules]
  );

  const setScheduledRules = useCallback(
    (rules: ThemeScheduleRule[]) => {
      const nextRules = normalizeThemeScheduleRulesList(rules);
      setScheduledRulesState(nextRules);
      setScheduledThemeState(nextRules[0].theme);
      setScheduledSwitchTimeState(nextRules[0].time);
      cacheScheduledRules(nextRules);
      cacheScheduledTheme(nextRules[0].theme);
      cacheScheduledSwitchTime(nextRules[0].time);
      setNowMinute(getCurrentMinuteOfDay());
      writeSetting(db, "scheduled_rules", JSON.stringify(nextRules)).catch(console.warn);
      writeSetting(db, "scheduled_theme", nextRules[0].theme).catch(console.warn);
      writeSetting(db, "scheduled_switch_time", nextRules[0].time).catch(console.warn);
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

  const setQuranFontStyle = useCallback(
    (style: QuranFontStyle) => {
      setQuranFontStyleState(style);
      writeSetting(db, "quran_font_style", style).catch(console.warn);
    },
    [db]
  );

  const setPageScroll = useCallback(
    (scroll: PageScroll) => {
      setPageScrollState(scroll);
      writeSetting(db, "page_scroll", scroll).catch(console.warn);
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
      if (code === DEFAULT_LANGUAGE) {
        setTranslationLanguageState(code);
        await writeSetting(db, "translation_language", code);
        return;
      }
      if (code !== DEFAULT_LANGUAGE) {
        setIsTranslationLoading(true);
        try {
          await importTranslation(db, code);
          await writeSetting(db, "translation_active_lang", code);
          setTranslationLanguageState(code);
          await writeSetting(db, "translation_language", code);
        } catch (e) {
          console.warn("[Settings] Failed to import translation:", e);
          setTranslationLanguageState(DEFAULT_LANGUAGE);
          writeSetting(db, "translation_language", DEFAULT_LANGUAGE).catch(console.warn);
          throw e;
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

  const setRecitationId = useCallback(
    (id: number) => {
      const next = normalizeRecitationId(id);
      setRecitationIdState(next);
      writeSetting(db, "recitation_id", String(next)).catch(console.warn);
    },
    [db]
  );

  const setDailyReviewLimit = useCallback(
    (limit: number) => {
      const clamped = Math.max(MIN_DAILY_REVIEW_LIMIT, Math.min(MAX_DAILY_REVIEW_LIMIT, limit));
      setDailyReviewLimitState(clamped);
      writeSetting(db, "daily_review_limit", String(clamped)).catch(console.warn);
    },
    [db]
  );

  const setFocusScrollSpeed = useCallback(
    (speed: number) => {
      const value = Number.isFinite(speed) ? speed : FOCUS_SCROLL_SPEED_DEFAULT;
      const clamped = Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, value));
      const rounded = Math.round(clamped * 100) / 100;
      setFocusScrollSpeedState(rounded);
      writeSetting(db, "focus_scroll_speed", String(rounded)).catch(console.warn);
    },
    [db]
  );

  const setHifzAutoDelayMs = useCallback(
    (delayMs: number) => {
      const clamped = Math.max(MIN_HIFZ_AUTO_DELAY_MS, Math.min(MAX_HIFZ_AUTO_DELAY_MS, delayMs));
      setHifzAutoDelayMsState(clamped);
      writeSetting(db, "hifz_auto_delay_ms", String(clamped)).catch(console.warn);
    },
    [db]
  );

  const setHifzAutoAdvancePage = useCallback(
    (enabled: boolean) => {
      setHifzAutoAdvancePageState(enabled);
      writeSetting(db, "hifz_auto_advance_page", String(enabled)).catch(console.warn);
    },
    [db]
  );

  const setUiLanguage = useCallback(
    (lang: UILanguage) => {
      setUiLanguageState(lang);
      cacheUiLanguage(lang);
      writeSetting(db, "ui_language", lang).catch(console.warn);
    },
    [db]
  );

  const isRTL = uiLanguage === "ar";

  return (
    <SettingsContext.Provider
      value={{
        fontSizeIndex,
        fontSize: activeSteps[effectiveFontIndex],
        lineHeight: activeLineHeights[effectiveFontIndex],
        setFontSizeIndex,
        theme,
        setTheme,
        effectiveTheme,
        scheduledTheme,
        setScheduledTheme,
        scheduledSwitchTime,
        setScheduledSwitchTime,
        scheduledRules,
        setScheduledRules,
        themeSurface,
        themeColors,
        viewMode,
        setViewMode,
        quranFontStyle,
        setQuranFontStyle,
        pageScroll,
        setPageScroll,
        showTranslation,
        setShowTranslation,
        showTafseer,
        setShowTafseer,
        translationLanguage,
        setTranslationLanguage,
        isTranslationLoading,
        tafseerSource,
        setTafseerSource,
        recitationId,
        setRecitationId,
        uiLanguage,
        setUiLanguage,
        dailyReviewLimit,
        setDailyReviewLimit,
        focusScrollSpeed,
        setFocusScrollSpeed,
        hifzAutoDelayMs,
        setHifzAutoDelayMs,
        hifzAutoAdvancePage,
        setHifzAutoAdvancePage,
        isRTL,
        isDark,
        isLoaded,
      }}
    >
      <View className="flex-1" style={themeVars}>
        <DirectionProvider dir={isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </View>
    </SettingsContext.Provider>
  );
}
