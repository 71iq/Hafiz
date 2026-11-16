import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { Platform, useColorScheme as useSystemColorScheme, useWindowDimensions, View } from "react-native";
import { useColorScheme as useNativeWindColorScheme, vars } from "nativewind";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { useDatabaseStatus } from "@/lib/database/provider";
import { writeUserSetting } from "@/lib/database/user-settings";
import { DEFAULT_LANGUAGE, DEFAULT_TRANSLATION_LANGUAGE } from "@/lib/translations/languages";
import { importTranslation, TranslationImportCancelled } from "@/lib/translations/import";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { DEFAULT_RECITATION_ID, normalizeRecitationId } from "@/lib/quran-foundation/recitations";
import { DirectionProvider } from "@/lib/ui/direction";
import type { QuranMarkerStyle as QuranMarkerStylePreference } from "@/lib/fonts/loader";
import { DEFAULT_TAFSIR_SOURCE, isAvailableTafsirSourceId, type TafsirSourceId } from "@/lib/tafsir/sources";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { setHapticsEnabled } from "@/lib/haptics";
import { getResolvedUiBootstrap, writeUiBootstrap } from "@/lib/settings/ui-bootstrap";
import { emitSettingSaveFailed } from "@/lib/settings/save-feedback";

export const FONT_SIZE_STEPS = [22, 26, 30, 34, 38, 42, 46, 50, 54, 58] as const;
export const FONT_SIZE_LINE_HEIGHTS = [48, 56, 64, 72, 80, 88, 96, 104, 112, 120] as const;

export const FONT_SIZE_STEPS_MOBILE = [14, 17, 20, 23, 26, 29, 32, 35, 38, 41] as const;
export const FONT_SIZE_LINE_HEIGHTS_MOBILE = [32, 38, 44, 50, 56, 62, 68, 74, 80, 86] as const;

export const DEFAULT_FONT_SIZE_INDEX = 2;

export const DEFAULT_DAILY_REVIEW_LIMIT = 20;
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

export const DEVICE_SETTING_KEYS = {
  accountPromoDismissedAt: "device_account_promo_dismissed_at",
  bookmarksOrder: "device_bookmarks_order",
  audioFollow: "device_audio_follow",
  audioRepeatRange: "device_audio_repeat_range",
  audioRepeatEach: "device_audio_repeat_each",
  audioDelaySeconds: "device_audio_delay_seconds",
  hapticsEnabled: "device_haptics_enabled",
} as const;
export const AUDIO_REPEAT_MIN = 1;
export const AUDIO_REPEAT_MAX = 99;
export const AUDIO_DELAY_MIN_SECONDS = 0;
export const AUDIO_DELAY_MAX_SECONDS = 30;
export const DEFAULT_AUDIO_REPEAT = 1;
export const DEFAULT_AUDIO_DELAY_SECONDS = 1;
export const ACCOUNT_PROMO_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
export type BookmarksOrder = "recent" | "quran";

export function decodeBoundedInt(raw: string | null | undefined, min: number, max: number): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function decodeBoolean(raw: string | null | undefined): boolean | null {
  return raw === "true" ? true : raw === "false" ? false : null;
}

export function decodeBookmarksOrder(raw: string | null | undefined): BookmarksOrder | null {
  return raw === "recent" || raw === "quran" ? raw : null;
}

export function isAccountPromoDismissed(raw: string | null | undefined, now = Date.now()): boolean {
  if (!raw) return false;
  const dismissedAt = Date.parse(raw);
  if (!Number.isFinite(dismissedAt) || dismissedAt > now) return false;
  return now - dismissedAt < ACCOUNT_PROMO_DISMISS_MS;
}

export type ThemePalette = "beige" | "dark" | "white" | "amoled";
export type ThemeMode = ThemePalette | "system";
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
export type QuranMarkerStyle = QuranMarkerStylePreference;
export type UILanguage = "en" | "ar";
export type TafseerSource = TafsirSourceId;
const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";
const THEME_CACHE_KEY = "hafiz_theme";

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

const THEME_CHOICE_FOREGROUNDS: Record<ThemePalette, string> = {
  beige: "#6E5A47",
  white: "#27272A",
  dark: "#F5F5F5",
  amoled: "#FFFFFF",
};

const THEME_CHOICE_BORDERS: Record<ThemePalette, string> = {
  beige: "#E8E1DA",
  white: "#D1D5DB",
  dark: "#3F3F46",
  amoled: "#27272A",
};

export function getThemeChoiceVisual(theme: ThemeMode, systemTheme: "dark" | "white", isActive: boolean) {
  const palette = theme === "system" ? systemTheme : theme;
  const isDarkPalette = palette === "dark" || palette === "amoled";

  return {
    backgroundColor: THEME_COLORS[palette].surface,
    borderColor: isActive ? (isDarkPalette ? "#2DD4BF" : "#0D9488") : THEME_CHOICE_BORDERS[palette],
    textColor: THEME_CHOICE_FOREGROUNDS[palette],
  };
}

export function withThemeOpacity(color: string, opacity: number): string {
  const hex = color.replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
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
  systemTheme: "dark" | "white";
  themeSurface: string;
  themeColors: ThemeColors;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  quranFontStyle: QuranFontStyle;
  quranRenderFontStyle: QuranFontStyle;
  setQuranFontStyle: (style: QuranFontStyle) => void;
  quranMarkerStyle: QuranMarkerStyle;
  setQuranMarkerStyle: (style: QuranMarkerStyle) => void;
  showAyahMarkers: boolean;
  setShowAyahMarkers: (show: boolean) => void;
  markSimilarVerses: boolean;
  setMarkSimilarVerses: (mark: boolean) => void;
  pageScroll: PageScroll;
  setPageScroll: (scroll: PageScroll) => void;
  showTranslation: boolean;
  setShowTranslation: (show: boolean) => void;
  showTafseer: boolean;
  setShowTafseer: (show: boolean) => void;
  translationLanguage: string;
  setTranslationLanguage: (code: string, options?: { isCurrent?: () => boolean }) => Promise<void>;
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
  accountPromoDismissed: boolean;
  dismissAccountPromo: () => void;
  bookmarksOrder: BookmarksOrder;
  setBookmarksOrder: (order: BookmarksOrder) => void;
  audioFollow: boolean;
  setAudioFollow: (follow: boolean) => void;
  audioRepeatRange: number;
  setAudioRepeatRange: (count: number) => void;
  audioRepeatEach: number;
  setAudioRepeatEach: (count: number) => void;
  audioDelaySeconds: number;
  setAudioDelaySeconds: (seconds: number) => void;
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
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
  effectiveTheme: "white",
  systemTheme: "white",
  themeSurface: "#FFFFFF",
  themeColors: THEME_COLORS.white,
  viewMode: "verse",
  setViewMode: () => {},
  quranFontStyle: "qcf2",
  quranRenderFontStyle: "qcf2",
  setQuranFontStyle: () => {},
  quranMarkerStyle: "auto",
  setQuranMarkerStyle: () => {},
  showAyahMarkers: true,
  setShowAyahMarkers: () => {},
  markSimilarVerses: true,
  setMarkSimilarVerses: () => {},
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
  accountPromoDismissed: false,
  dismissAccountPromo: () => {},
  bookmarksOrder: "recent",
  setBookmarksOrder: () => {},
  audioFollow: true,
  setAudioFollow: () => {},
  audioRepeatRange: DEFAULT_AUDIO_REPEAT,
  setAudioRepeatRange: () => {},
  audioRepeatEach: DEFAULT_AUDIO_REPEAT,
  setAudioRepeatEach: () => {},
  audioDelaySeconds: DEFAULT_AUDIO_DELAY_SECONDS,
  setAudioDelaySeconds: () => {},
  hapticsEnabled: true,
  setHapticsEnabled: () => {},
  isRTL: false,
  isDark: false,
  isLoaded: false,
});

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
      "--color-warm-400": "133 105 79",
      "--color-warm-500": "122 99 77",
      "--color-warm-600": "110 90 71",
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
  if (isThemePalette(value) || value === "system") return value;
  return null;
}

function normalizeQuranFontStyle(value: string | null | undefined): QuranFontStyle | null {
  return value === "qcf2" || value === "v4" || value === "v4-tajweed" ? value : null;
}

function normalizeQuranMarkerStyle(value: string | null | undefined): QuranMarkerStyle | null {
  return value === "auto" || value === "light" || value === "dark" || value === "sepia" ? value : null;
}

function readCachedUiLanguage(): UILanguage {
  try {
    return getStartupLanguage();
  } catch {
    return "en";
  }
}

function cacheUiLanguage(lang: UILanguage) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(UI_LANGUAGE_CACHE_KEY, lang);
  }
}

function readCachedThemeMode(): ThemeMode {
  if (Platform.OS !== "web") return getResolvedUiBootstrap()?.theme ?? "system";
  if (typeof window === "undefined") return "system";
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_CACHE_KEY)) ?? "system";
  } catch {
    return "system";
  }
}

function warnInvalidSetting(key: string) {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[Settings] Ignoring invalid saved value for ${key}`);
}

function cacheThemeMode(theme: ThemeMode) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(THEME_CACHE_KEY, theme);
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

async function readSettings(db: DatabaseExecutor, keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${placeholders})`,
    keys,
  );
  const values = Object.fromEntries(keys.map((key) => [key, null])) as Record<string, string | null>;
  for (const row of rows) {
    values[row.key] = row.value;
  }
  return values;
}

async function writeSetting(db: AppDatabase | null, key: string, value: string): Promise<void> {
  if (!db) throw new Error("Database not initialized");
  await writeUserSetting(db, key, value);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { db: connectedDb, isReady } = useDatabaseStatus();
  const db = isReady ? connectedDb : null;
  const { setColorScheme } = useNativeWindColorScheme();
  const systemScheme = useSystemColorScheme();
  const { width } = useWindowDimensions();
  const isCompact = width < SIDEBAR_BREAKPOINT;
  const activeSteps = isCompact ? FONT_SIZE_STEPS_MOBILE : FONT_SIZE_STEPS;
  const activeLineHeights = isCompact ? FONT_SIZE_LINE_HEIGHTS_MOBILE : FONT_SIZE_LINE_HEIGHTS;
  const [fontSizeIndex, setFontSizeIndexState] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [theme, setThemeState] = useState<ThemeMode>(readCachedThemeMode);
  const [viewMode, setViewModeState] = useState<ViewMode>("verse");
  const [quranFontStyle, setQuranFontStyleState] = useState<QuranFontStyle>("qcf2");
  const [quranMarkerStyle, setQuranMarkerStyleState] = useState<QuranMarkerStyle>("auto");
  const [showAyahMarkers, setShowAyahMarkersState] = useState(true);
  const [markSimilarVerses, setMarkSimilarVersesState] = useState(true);
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
  const [accountPromoDismissedAt, setAccountPromoDismissedAt] = useState<string | null>(null);
  const [bookmarksOrder, setBookmarksOrderState] = useState<BookmarksOrder>("recent");
  const [audioFollow, setAudioFollowState] = useState(true);
  const [audioRepeatRange, setAudioRepeatRangeState] = useState(DEFAULT_AUDIO_REPEAT);
  const [audioRepeatEach, setAudioRepeatEachState] = useState(DEFAULT_AUDIO_REPEAT);
  const [audioDelaySeconds, setAudioDelaySecondsState] = useState(DEFAULT_AUDIO_DELAY_SECONDS);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [loadedDb, setLoadedDb] = useState<AppDatabase | null>(null);
  const writeGenerations = useRef(new Map<string, number>());
  const writesInFlight = useRef(new Map<string, number>());
  const committedRestore = useRef(new Map<string, () => void>());
  const committedLanguage = useRef<UILanguage>(uiLanguage);
  const committedTheme = useRef<ThemeMode>(theme);
  const isLoaded = db !== null && loadedDb === db;

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    async function load(db: AppDatabase) {
      try {
        const saved = await readSettings(db, [
          "font_size_index",
          "theme",
          "view_mode",
          "quran_font_style",
          "quran_marker_style",
          "show_ayah_markers",
          "mark_similar_verses",
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
          ...Object.values(DEVICE_SETTING_KEYS),
        ]);
        if (cancelled) return;
        const invalidIfSet = (key: string, valid: boolean) => {
          if (!valid && saved[key] != null) warnInvalidSetting(key);
        };

        const savedFontSize = decodeBoundedInt(saved.font_size_index, 0, FONT_SIZE_STEPS.length - 1);
        invalidIfSet("font_size_index", savedFontSize !== null);
        if (savedFontSize !== null) setFontSizeIndexState(savedFontSize);

        const savedTheme = saved.theme;
        const normalizedTheme = normalizeThemeMode(savedTheme);
        invalidIfSet("theme", normalizedTheme !== null);
        if (normalizedTheme) {
          setThemeState(normalizedTheme);
          cacheThemeMode(normalizedTheme);
          committedTheme.current = normalizedTheme;
        }

        const savedViewMode = saved.view_mode;
        invalidIfSet("view_mode", savedViewMode === "verse" || savedViewMode === "page");
        if (savedViewMode === "verse" || savedViewMode === "page") {
          setViewModeState(savedViewMode);
        }

        const savedQuranFontStyle = normalizeQuranFontStyle(saved.quran_font_style);
        invalidIfSet("quran_font_style", savedQuranFontStyle !== null);
        if (savedQuranFontStyle) {
          setQuranFontStyleState(savedQuranFontStyle);
        }

        const savedQuranMarkerStyle = normalizeQuranMarkerStyle(saved.quran_marker_style);
        invalidIfSet("quran_marker_style", savedQuranMarkerStyle !== null);
        if (savedQuranMarkerStyle) {
          setQuranMarkerStyleState(savedQuranMarkerStyle);
        }

        const savedShowAyahMarkers = saved.show_ayah_markers;
        invalidIfSet("show_ayah_markers", decodeBoolean(savedShowAyahMarkers) !== null);
        if (savedShowAyahMarkers === "true") setShowAyahMarkersState(true);
        if (savedShowAyahMarkers === "false") setShowAyahMarkersState(false);

        const savedMarkSimilarVerses = saved.mark_similar_verses;
        invalidIfSet("mark_similar_verses", decodeBoolean(savedMarkSimilarVerses) !== null);
        if (savedMarkSimilarVerses === "true") setMarkSimilarVersesState(true);
        if (savedMarkSimilarVerses === "false") setMarkSimilarVersesState(false);

        const savedPageScroll = saved.page_scroll;
        invalidIfSet("page_scroll", savedPageScroll === "vertical" || savedPageScroll === "horizontal");
        if (savedPageScroll === "vertical" || savedPageScroll === "horizontal") {
          setPageScrollState(savedPageScroll);
        }

        const savedShowTranslation = saved.show_translation;
        invalidIfSet("show_translation", decodeBoolean(savedShowTranslation) !== null);
        if (savedShowTranslation === "true") setShowTranslationState(true);

        const savedShowTafseer = saved.show_tafseer;
        invalidIfSet("show_tafseer", decodeBoolean(savedShowTafseer) !== null);
        if (savedShowTafseer === "true") setShowTafseerState(true);

        const savedTafseerSource = saved.tafseer_source;
        invalidIfSet("tafseer_source", isAvailableTafsirSourceId(savedTafseerSource));
        if (isAvailableTafsirSourceId(savedTafseerSource)) {
          setTafseerSourceState(savedTafseerSource);
        }

        const savedRecitationId = saved.recitation_id;
        if (savedRecitationId !== null) {
          setRecitationIdState(normalizeRecitationId(savedRecitationId));
        }

        const savedUiLang = saved.ui_language;
        invalidIfSet("ui_language", savedUiLang === "en" || savedUiLang === "ar");
        if (savedUiLang === "en" || savedUiLang === "ar") {
          setUiLanguageState(savedUiLang);
          cacheUiLanguage(savedUiLang);
          committedLanguage.current = savedUiLang;
          const mirror = getResolvedUiBootstrap();
          const nextTheme = normalizedTheme ?? committedTheme.current;
          if (Platform.OS !== "web" && (mirror?.language !== savedUiLang || mirror?.theme !== nextTheme)) {
            void writeUiBootstrap(savedUiLang, nextTheme);
          }
        }

        const promoDismissedAt = saved[DEVICE_SETTING_KEYS.accountPromoDismissedAt];
        setAccountPromoDismissedAt(promoDismissedAt);
        const savedBookmarksOrder = decodeBookmarksOrder(saved[DEVICE_SETTING_KEYS.bookmarksOrder]);
        invalidIfSet(DEVICE_SETTING_KEYS.bookmarksOrder, savedBookmarksOrder !== null);
        if (savedBookmarksOrder) setBookmarksOrderState(savedBookmarksOrder);
        const savedFollow = decodeBoolean(saved[DEVICE_SETTING_KEYS.audioFollow]);
        invalidIfSet(DEVICE_SETTING_KEYS.audioFollow, savedFollow !== null);
        if (savedFollow !== null) setAudioFollowState(savedFollow);
        const savedRepeatRange = decodeBoundedInt(
          saved[DEVICE_SETTING_KEYS.audioRepeatRange],
          AUDIO_REPEAT_MIN,
          AUDIO_REPEAT_MAX,
        );
        invalidIfSet(DEVICE_SETTING_KEYS.audioRepeatRange, savedRepeatRange !== null);
        if (savedRepeatRange !== null) setAudioRepeatRangeState(savedRepeatRange);
        const savedRepeatEach = decodeBoundedInt(
          saved[DEVICE_SETTING_KEYS.audioRepeatEach],
          AUDIO_REPEAT_MIN,
          AUDIO_REPEAT_MAX,
        );
        invalidIfSet(DEVICE_SETTING_KEYS.audioRepeatEach, savedRepeatEach !== null);
        if (savedRepeatEach !== null) setAudioRepeatEachState(savedRepeatEach);
        const savedDelay = decodeBoundedInt(
          saved[DEVICE_SETTING_KEYS.audioDelaySeconds],
          AUDIO_DELAY_MIN_SECONDS,
          AUDIO_DELAY_MAX_SECONDS,
        );
        invalidIfSet(DEVICE_SETTING_KEYS.audioDelaySeconds, savedDelay !== null);
        if (savedDelay !== null) setAudioDelaySecondsState(savedDelay);
        const savedHaptics = decodeBoolean(saved[DEVICE_SETTING_KEYS.hapticsEnabled]);
        invalidIfSet(DEVICE_SETTING_KEYS.hapticsEnabled, savedHaptics !== null);
        if (savedHaptics !== null) setHapticsEnabledState(savedHaptics);

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
            setFocusScrollSpeedState(Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, n)));
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
        if (!cancelled) setLoadedDb(db);
      }
    }
    load(db);
    return () => {
      cancelled = true;
    };
  }, [db]);

  const systemTheme = systemScheme === "dark" ? "dark" : "white";
  const effectiveTheme: ThemePalette = theme === "system" ? systemTheme : theme;
  const isDark = effectiveTheme === "dark" || effectiveTheme === "amoled";
  const themeColors = THEME_COLORS[effectiveTheme];
  const themeSurface = themeColors.surface;
  const themeVars = useMemo(
    () =>
      Platform.OS === "web" && typeof window === "undefined"
        ? undefined
        : vars(THEME_PALETTES[effectiveTheme].variables),
    [effectiveTheme],
  );
  const nativeWindScheme = isDark ? "dark" : "light";

  useEffect(() => {
    requestAnimationFrame(() => setColorScheme(nativeWindScheme));
  }, [nativeWindScheme, setColorScheme]);

  useEffect(() => {
    applyWebThemePalette(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    setHapticsEnabled(hapticsEnabled);
  }, [hapticsEnabled]);

  const latestValues = useRef({
    fontSizeIndex,
    viewMode,
    quranFontStyle,
    quranMarkerStyle,
    markSimilarVerses,
    pageScroll,
    tafseerSource,
    recitationId,
  });
  useLayoutEffect(() => {
    latestValues.current = {
      fontSizeIndex,
      viewMode,
      quranFontStyle,
      quranMarkerStyle,
      markSimilarVerses,
      pageScroll,
      tafseerSource,
      recitationId,
    };
  });

  const persist = useCallback(
    (
      key: string,
      value: string,
      onFailure?: () => void,
      onSuccess?: () => void,
      restore?: () => void,
      onCommitted?: () => void,
    ) => {
      const generation = (writeGenerations.current.get(key) ?? 0) + 1;
      writeGenerations.current.set(key, generation);
      if (!db) return;
      const inFlight = writesInFlight.current.get(key) ?? 0;
      if (inFlight === 0 && onFailure) committedRestore.current.set(key, onFailure);
      writesInFlight.current.set(key, inFlight + 1);
      const settle = () => writesInFlight.current.set(key, Math.max(0, (writesInFlight.current.get(key) ?? 1) - 1));
      writeSetting(db, key, value).then(
        () => {
          settle();
          if (restore) committedRestore.current.set(key, restore);
          onCommitted?.();
          if (writeGenerations.current.get(key) === generation) onSuccess?.();
        },
        () => {
          settle();
          console.warn(`[Settings] Failed to save ${key}`);
          if (writeGenerations.current.get(key) !== generation) return;
          (committedRestore.current.get(key) ?? onFailure)?.();
          emitSettingSaveFailed(key);
        },
      );
    },
    [db],
  );

  const setFontSizeIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= FONT_SIZE_STEPS.length) return;
      const previous = latestValues.current.fontSizeIndex;
      setFontSizeIndexState(index);
      persist(
        "font_size_index",
        String(index),
        () => setFontSizeIndexState(previous),
        undefined,
        () => setFontSizeIndexState(index),
      );
    },
    [persist],
  );

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      setThemeState(newTheme);
      cacheThemeMode(newTheme);
      persist(
        "theme",
        newTheme,
        () => {
          setThemeState(committedTheme.current);
          cacheThemeMode(committedTheme.current);
        },
        () => void writeUiBootstrap(committedLanguage.current, newTheme),
        () => {
          setThemeState(newTheme);
          cacheThemeMode(newTheme);
        },
        () => {
          committedTheme.current = newTheme;
        },
      );
    },
    [persist],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      const previous = latestValues.current.viewMode;
      setViewModeState(mode);
      persist(
        "view_mode",
        mode,
        () => setViewModeState(previous),
        undefined,
        () => setViewModeState(mode),
      );
    },
    [persist],
  );

  const setQuranFontStyle = useCallback(
    (style: QuranFontStyle) => {
      const previous = latestValues.current.quranFontStyle;
      setQuranFontStyleState(style);
      persist(
        "quran_font_style",
        style,
        () => setQuranFontStyleState(previous),
        undefined,
        () => setQuranFontStyleState(style),
      );
    },
    [persist],
  );

  const setQuranMarkerStyle = useCallback(
    (style: QuranMarkerStyle) => {
      const previous = latestValues.current.quranMarkerStyle;
      setQuranMarkerStyleState(style);
      persist(
        "quran_marker_style",
        style,
        () => setQuranMarkerStyleState(previous),
        undefined,
        () => setQuranMarkerStyleState(style),
      );
    },
    [persist],
  );

  const setShowAyahMarkers = useCallback(
    (show: boolean) => {
      setShowAyahMarkersState(show);
      writeSetting(db, "show_ayah_markers", String(show)).catch(console.warn);
    },
    [db],
  );

  const setMarkSimilarVerses = useCallback(
    (mark: boolean) => {
      const previous = latestValues.current.markSimilarVerses;
      setMarkSimilarVersesState(mark);
      persist(
        "mark_similar_verses",
        String(mark),
        () => setMarkSimilarVersesState(previous),
        undefined,
        () => setMarkSimilarVersesState(mark),
      );
    },
    [persist],
  );

  const setPageScroll = useCallback(
    (scroll: PageScroll) => {
      const previous = latestValues.current.pageScroll;
      setPageScrollState(scroll);
      persist(
        "page_scroll",
        scroll,
        () => setPageScrollState(previous),
        undefined,
        () => setPageScrollState(scroll),
      );
    },
    [persist],
  );

  const setShowTranslation = useCallback(
    (show: boolean) => {
      setShowTranslationState(show);
      writeSetting(db, "show_translation", String(show)).catch(console.warn);
    },
    [db],
  );

  const setShowTafseer = useCallback(
    (show: boolean) => {
      setShowTafseerState(show);
      writeSetting(db, "show_tafseer", String(show)).catch(console.warn);
    },
    [db],
  );

  const translationRequest = useRef(0);
  const setTranslationLanguage = useCallback(
    async (code: string, options: { isCurrent?: () => boolean } = {}) => {
      if (code === translationLanguage) return;
      if (!db) throw new Error("Database not initialized");
      const request = ++translationRequest.current;
      if (code === DEFAULT_LANGUAGE) {
        setIsTranslationLoading(false);
        setTranslationLanguageState(code);
        await writeSetting(db, "translation_language", code);
        return;
      }
      const isLatest = () => translationRequest.current === request;
      setIsTranslationLoading(true);
      try {
        await importTranslation(db, code, {
          shouldContinue: () => isLatest() && (options.isCurrent?.() ?? true),
        });
        await writeSetting(db, "translation_active_lang", code);
        if (!isLatest()) return;
        setTranslationLanguageState(code);
        await writeSetting(db, "translation_language", code);
      } catch (e) {
        if (!(e instanceof TranslationImportCancelled)) console.warn("[Settings] Failed to import translation:", e);
        throw e;
      } finally {
        if (isLatest()) setIsTranslationLoading(false);
      }
    },
    [db, translationLanguage],
  );

  const setTafseerSource = useCallback(
    (source: TafseerSource) => {
      const previous = latestValues.current.tafseerSource;
      setTafseerSourceState(source);
      persist(
        "tafseer_source",
        source,
        () => setTafseerSourceState(previous),
        undefined,
        () => setTafseerSourceState(source),
      );
    },
    [persist],
  );

  const setRecitationId = useCallback(
    (id: number) => {
      const next = normalizeRecitationId(id);
      const previous = latestValues.current.recitationId;
      setRecitationIdState(next);
      persist(
        "recitation_id",
        String(next),
        () => setRecitationIdState(previous),
        undefined,
        () => setRecitationIdState(next),
      );
    },
    [persist],
  );

  const setDailyReviewLimit = useCallback(
    (limit: number) => {
      const clamped = Math.max(MIN_DAILY_REVIEW_LIMIT, Math.min(MAX_DAILY_REVIEW_LIMIT, limit));
      setDailyReviewLimitState(clamped);
      writeSetting(db, "daily_review_limit", String(clamped)).catch(console.warn);
    },
    [db],
  );

  const setFocusScrollSpeed = useCallback(
    (speed: number) => {
      const value = Number.isFinite(speed) ? speed : FOCUS_SCROLL_SPEED_DEFAULT;
      const clamped = Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, value));
      const rounded = Math.round(clamped * 100) / 100;
      setFocusScrollSpeedState(rounded);
      writeSetting(db, "focus_scroll_speed", String(rounded)).catch(console.warn);
    },
    [db],
  );

  const setHifzAutoDelayMs = useCallback(
    (delayMs: number) => {
      const clamped = Math.max(MIN_HIFZ_AUTO_DELAY_MS, Math.min(MAX_HIFZ_AUTO_DELAY_MS, delayMs));
      setHifzAutoDelayMsState(clamped);
      writeSetting(db, "hifz_auto_delay_ms", String(clamped)).catch(console.warn);
    },
    [db],
  );

  const setHifzAutoAdvancePage = useCallback(
    (enabled: boolean) => {
      setHifzAutoAdvancePageState(enabled);
      writeSetting(db, "hifz_auto_advance_page", String(enabled)).catch(console.warn);
    },
    [db],
  );

  const setUiLanguage = useCallback(
    (lang: UILanguage) => {
      setUiLanguageState(lang);
      cacheUiLanguage(lang);
      persist(
        "ui_language",
        lang,
        () => {
          setUiLanguageState(committedLanguage.current);
          cacheUiLanguage(committedLanguage.current);
        },
        () => void writeUiBootstrap(lang, committedTheme.current),
        () => {
          setUiLanguageState(lang);
          cacheUiLanguage(lang);
        },
        () => {
          committedLanguage.current = lang;
        },
      );
    },
    [persist],
  );

  const dismissAccountPromo = useCallback(() => {
    const previous = accountPromoDismissedAt;
    const now = new Date().toISOString();
    setAccountPromoDismissedAt(now);
    persist(
      DEVICE_SETTING_KEYS.accountPromoDismissedAt,
      now,
      () => setAccountPromoDismissedAt(previous),
      undefined,
      () => setAccountPromoDismissedAt(now),
    );
  }, [accountPromoDismissedAt, persist]);

  const setBookmarksOrder = useCallback(
    (order: BookmarksOrder) => {
      const previous = bookmarksOrder;
      setBookmarksOrderState(order);
      persist(
        DEVICE_SETTING_KEYS.bookmarksOrder,
        order,
        () => setBookmarksOrderState(previous),
        undefined,
        () => setBookmarksOrderState(order),
      );
    },
    [bookmarksOrder, persist],
  );

  const setAudioFollow = useCallback(
    (follow: boolean) => {
      const previous = audioFollow;
      setAudioFollowState(follow);
      persist(
        DEVICE_SETTING_KEYS.audioFollow,
        String(follow),
        () => setAudioFollowState(previous),
        undefined,
        () => setAudioFollowState(follow),
      );
    },
    [audioFollow, persist],
  );

  const setAudioRepeatRange = useCallback(
    (count: number) => {
      if (!Number.isInteger(count) || count < AUDIO_REPEAT_MIN || count > AUDIO_REPEAT_MAX) return;
      const previous = audioRepeatRange;
      setAudioRepeatRangeState(count);
      persist(
        DEVICE_SETTING_KEYS.audioRepeatRange,
        String(count),
        () => setAudioRepeatRangeState(previous),
        undefined,
        () => setAudioRepeatRangeState(count),
      );
    },
    [audioRepeatRange, persist],
  );

  const setAudioRepeatEach = useCallback(
    (count: number) => {
      if (!Number.isInteger(count) || count < AUDIO_REPEAT_MIN || count > AUDIO_REPEAT_MAX) return;
      const previous = audioRepeatEach;
      setAudioRepeatEachState(count);
      persist(
        DEVICE_SETTING_KEYS.audioRepeatEach,
        String(count),
        () => setAudioRepeatEachState(previous),
        undefined,
        () => setAudioRepeatEachState(count),
      );
    },
    [audioRepeatEach, persist],
  );

  const setAudioDelaySeconds = useCallback(
    (seconds: number) => {
      if (!Number.isInteger(seconds) || seconds < AUDIO_DELAY_MIN_SECONDS || seconds > AUDIO_DELAY_MAX_SECONDS) return;
      const previous = audioDelaySeconds;
      setAudioDelaySecondsState(seconds);
      persist(
        DEVICE_SETTING_KEYS.audioDelaySeconds,
        String(seconds),
        () => setAudioDelaySecondsState(previous),
        undefined,
        () => setAudioDelaySecondsState(seconds),
      );
    },
    [audioDelaySeconds, persist],
  );

  const setHapticsPreference = useCallback(
    (enabled: boolean) => {
      const previous = hapticsEnabled;
      setHapticsEnabledState(enabled);
      persist(
        DEVICE_SETTING_KEYS.hapticsEnabled,
        String(enabled),
        () => setHapticsEnabledState(previous),
        undefined,
        () => setHapticsEnabledState(enabled),
      );
    },
    [hapticsEnabled, persist],
  );

  const accountPromoDismissed = isAccountPromoDismissed(accountPromoDismissedAt);

  const isRTL = uiLanguage === "ar";
  const quranRenderFontStyle: QuranFontStyle =
    Platform.OS !== "web" && isDark && quranFontStyle !== "qcf2" ? "qcf2" : quranFontStyle;

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
        systemTheme,
        themeSurface,
        themeColors,
        viewMode,
        setViewMode,
        quranFontStyle,
        quranRenderFontStyle,
        setQuranFontStyle,
        quranMarkerStyle,
        setQuranMarkerStyle,
        showAyahMarkers,
        setShowAyahMarkers,
        markSimilarVerses,
        setMarkSimilarVerses,
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
        accountPromoDismissed,
        dismissAccountPromo,
        bookmarksOrder,
        setBookmarksOrder,
        audioFollow,
        setAudioFollow,
        audioRepeatRange,
        setAudioRepeatRange,
        audioRepeatEach,
        setAudioRepeatEach,
        audioDelaySeconds,
        setAudioDelaySeconds,
        hapticsEnabled,
        setHapticsEnabled: setHapticsPreference,
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
