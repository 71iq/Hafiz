export type CoverageStatus =
  | "strict"
  | "report-only"
  | "manual-native"
  | "live-env"
  | "blocked";

export type CoverageItem = {
  id: string;
  title: string;
  source: string;
  phase: string;
  status: CoverageStatus;
  tags: string[];
};

export const uiRouteCoverage: CoverageItem[] = [
  { id: "route.root-layout", title: "Root providers and stack boundaries", source: "ui-manual-matrix#root-and-shell-routes", phase: "route-smoke", status: "strict", tags: ["route", "provider"] },
  { id: "route.html", title: "Web metadata and bootstrap copy", source: "ui-manual-matrix#root-and-shell-routes", phase: "route-smoke", status: "strict", tags: ["route", "web"] },
  { id: "route.tabs-layout", title: "Tab layout, hidden routes, sync hook, navigation chrome", source: "ui-manual-matrix#root-and-shell-routes", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["route", "navigation"] },
  { id: "route.index-gate", title: "Onboarding gate and initial redirect", source: "ui-manual-matrix#root-and-shell-routes", phase: "route-smoke", status: "strict", tags: ["route", "onboarding"] },
  { id: "route.not-found", title: "Unknown route UI and return navigation", source: "ui-manual-matrix#root-and-shell-routes", phase: "route-smoke", status: "strict", tags: ["route"] },
  { id: "route.open", title: "Deep link bridge into Mushaf", source: "ui-manual-matrix#root-and-shell-routes", phase: "search-deeplinks-overlays", status: "report-only", tags: ["route", "deeplink"] },
  { id: "route.qa-ready", title: "QA readiness route", source: "ui-manual-matrix#root-and-shell-routes", phase: "route-smoke", status: "strict", tags: ["route", "harness"] },
  { id: "route.about", title: "About page", source: "ui-manual-matrix#public-routes", phase: "route-smoke", status: "strict", tags: ["route", "public"] },
  { id: "route.privacy", title: "Privacy page", source: "ui-manual-matrix#public-routes", phase: "route-smoke", status: "strict", tags: ["route", "public", "legal"] },
  { id: "route.terms", title: "Terms page", source: "ui-manual-matrix#public-routes", phase: "route-smoke", status: "strict", tags: ["route", "public", "legal"] },
  { id: "route.credits", title: "Credits and source notices page", source: "ui-manual-matrix#public-routes", phase: "route-smoke", status: "strict", tags: ["route", "public", "credits"] },
  { id: "route.login", title: "Login form and auth states", source: "ui-manual-matrix#auth-routes", phase: "route-smoke", status: "strict", tags: ["route", "auth"] },
  { id: "route.signup", title: "Signup form and validation", source: "ui-manual-matrix#auth-routes", phase: "route-smoke", status: "strict", tags: ["route", "auth"] },
  { id: "route.forgot-password", title: "Forgot password flow", source: "ui-manual-matrix#auth-routes", phase: "route-smoke", status: "strict", tags: ["route", "auth"] },
  { id: "route.reset-password", title: "Reset password flow", source: "ui-manual-matrix#auth-routes", phase: "route-smoke", status: "strict", tags: ["route", "auth"] },
  { id: "route.qf-callback", title: "QF callback placeholder and invalid params", source: "ui-manual-matrix#auth-routes", phase: "route-smoke", status: "strict", tags: ["route", "qf"] },
  { id: "route.onboarding", title: "Onboarding screens and persistence", source: "ui-manual-matrix#onboarding", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["route", "onboarding", "settings"] },
  { id: "route.home", title: "Home dashboard states", source: "ui-manual-matrix#main-tabs", phase: "flashcards-home-progress", status: "report-only", tags: ["route", "home"] },
  { id: "route.mushaf", title: "Main reader route", source: "ui-manual-matrix#main-tabs", phase: "mushaf-reader", status: "report-only", tags: ["route", "mushaf", "quran"] },
  { id: "route.leaderboard", title: "Leaderboard tabs and online states", source: "ui-manual-matrix#main-tabs", phase: "community-auth-online", status: "report-only", tags: ["route", "leaderboard", "supabase"] },
  { id: "route.progress", title: "Progress page states", source: "ui-manual-matrix#main-tabs", phase: "flashcards-home-progress", status: "report-only", tags: ["route", "progress"] },
  { id: "route.settings", title: "Settings sections and persistence", source: "ui-manual-matrix#main-tabs", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["route", "settings"] },
  { id: "route.flashcards", title: "Deck overview and actions", source: "ui-manual-matrix#main-tabs", phase: "flashcards-home-progress", status: "report-only", tags: ["route", "flashcards"] },
  { id: "route.search", title: "Hidden search redirect or launcher behavior", source: "ui-manual-matrix#main-tabs", phase: "search-deeplinks-overlays", status: "report-only", tags: ["route", "search"] },
  { id: "route.reflection-feed", title: "Reflection feed, filters, write entry points", source: "ui-manual-matrix#main-tabs", phase: "community-auth-online", status: "report-only", tags: ["route", "reflections", "supabase"] },
  { id: "route.reflection-journey", title: "Reflection journey content and states", source: "ui-manual-matrix#main-tabs", phase: "community-auth-online", status: "report-only", tags: ["route", "reflection-journey"] },
  { id: "route.flashcard-session", title: "Review session route", source: "ui-manual-matrix#flashcard-routes", phase: "flashcards-home-progress", status: "report-only", tags: ["route", "flashcards"] },
  { id: "route.vocab", title: "Vocabulary review route", source: "ui-manual-matrix#flashcard-routes", phase: "flashcards-home-progress", status: "report-only", tags: ["route", "flashcards", "vocab"] },
  { id: "route.profile-current", title: "Current user profile", source: "ui-manual-matrix#profile-routes", phase: "community-auth-online", status: "report-only", tags: ["route", "profile"] },
  { id: "route.profile-public", title: "Public profile route", source: "ui-manual-matrix#profile-routes", phase: "community-auth-online", status: "report-only", tags: ["route", "profile"] },
];

export const uiComponentCoverage: CoverageItem[] = [
  { id: "component.global-navigation", title: "AppNavigation shell", source: "ui-manual-matrix#global-and-navigation-components", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["component", "navigation", "rtl"] },
  { id: "component.loading-offline-sync-toast-error", title: "Loading, offline, sync, toast, error boundary", source: "ui-manual-matrix#global-and-navigation-components", phase: "route-smoke", status: "strict", tags: ["component", "shell"] },
  { id: "component.search-command", title: "SearchCommand modal and results", source: "ui-manual-matrix#global-and-navigation-components", phase: "search-deeplinks-overlays", status: "report-only", tags: ["component", "search"] },
  { id: "component.ui-primitives", title: "Shared UI primitives", source: "ui-manual-matrix#ui-primitive-components", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["component", "primitive", "a11y"] },
  { id: "component.mushaf-reader", title: "Mushaf page, verse, slider, indicator, headers", source: "ui-manual-matrix#mushaf-components", phase: "mushaf-reader", status: "report-only", tags: ["component", "mushaf", "quran"] },
  { id: "component.word-interaction", title: "WordToken, tooltip, detail sheet, tabs", source: "ui-manual-matrix#mushaf-components", phase: "mushaf-reader", status: "report-only", tags: ["component", "word"] },
  { id: "component.ayah-detail", title: "Ayah detail modal and ayah tabs", source: "ui-manual-matrix#mushaf-components", phase: "search-deeplinks-overlays", status: "report-only", tags: ["component", "overlay", "mushaf"] },
  { id: "component.flashcard-sheets", title: "Deck sheets and QCF2 flashcard text", source: "ui-manual-matrix#flashcard-components", phase: "flashcards-home-progress", status: "report-only", tags: ["component", "flashcards"] },
  { id: "component.notes", title: "Private notes list and editor", source: "ui-manual-matrix#notes-components", phase: "community-auth-online", status: "report-only", tags: ["component", "notes"] },
  { id: "component.reflections", title: "Reflection cards, sections, composer, comments", source: "ui-manual-matrix#reflections-components", phase: "community-auth-online", status: "report-only", tags: ["component", "reflections", "supabase"] },
  { id: "component.profile-achievements", title: "Profile and achievement widgets", source: "ui-manual-matrix#profile-and-achievement-components", phase: "community-auth-online", status: "report-only", tags: ["component", "profile"] },
  { id: "component.progress", title: "Heatmap, default deck chart, Surah progress", source: "ui-manual-matrix#progress-components", phase: "flashcards-home-progress", status: "report-only", tags: ["component", "progress"] },
  { id: "component.settings-pickers", title: "Tafsir and translation pickers", source: "ui-manual-matrix#settings-components", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["component", "settings", "overlay"] },
  { id: "component.public-pages", title: "PublicPage legal/about shell", source: "ui-manual-matrix#public-page-components", phase: "route-smoke", status: "strict", tags: ["component", "public"] },
  { id: "component.zayt", title: "Zayt Rive preview wrappers", source: "ui-manual-matrix#zayt-components", phase: "community-auth-online", status: "report-only", tags: ["component", "zayt"] },
];

export const uiFlowCoverage: CoverageItem[] = [
  { id: "flow.first-launch-shell", title: "First launch, loading, shell, offline banner, navigation chrome", source: "ui-manual-matrix#1-first-launch-and-shell", phase: "route-smoke", status: "strict", tags: ["flow", "shell"] },
  { id: "flow.onboarding", title: "Onboarding language/theme/persistence/safe-area", source: "ui-manual-matrix#2-onboarding", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["flow", "onboarding"] },
  { id: "flow.auth-account", title: "Login, signup, recovery, OAuth layout, logout", source: "ui-manual-matrix#3-auth-and-account", phase: "community-auth-online", status: "report-only", tags: ["flow", "auth"] },
  { id: "flow.settings", title: "Language, theme, reader, tafsir, translation, account, persistence", source: "ui-manual-matrix#4-settings", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["flow", "settings"] },
  { id: "flow.mushaf-verse", title: "Verse mode reading, actions, reflections, selection, RTL", source: "ui-manual-matrix#5-mushaf-verse-mode", phase: "mushaf-reader", status: "report-only", tags: ["flow", "mushaf"] },
  { id: "flow.mushaf-page-vertical", title: "Vertical page mode, font modes, word detail, selection", source: "ui-manual-matrix#6-mushaf-page-mode---vertical-scroll", phase: "mushaf-reader", status: "report-only", tags: ["flow", "mushaf", "quran"] },
  { id: "flow.mushaf-page-horizontal", title: "Horizontal page mode, swipe, selection, Safari behavior", source: "ui-manual-matrix#7-mushaf-page-mode---horizontal-swipe", phase: "mushaf-reader", status: "report-only", tags: ["flow", "mushaf", "quran"] },
  { id: "flow.word-interaction", title: "Word tooltip, detail tabs, custom meanings, RTL", source: "ui-manual-matrix#8-word-interaction", phase: "mushaf-reader", status: "report-only", tags: ["flow", "word"] },
  { id: "flow.ayah-detail", title: "Ayah detail panel and nested source picker", source: "ui-manual-matrix#9-ayah-detail-panel", phase: "search-deeplinks-overlays", status: "report-only", tags: ["flow", "overlay", "mushaf"] },
  { id: "flow.hifz-focus", title: "Hifz hide/reveal and focus mode controls", source: "ui-manual-matrix#10-hifz-and-focus-modes", phase: "mushaf-reader", status: "report-only", tags: ["flow", "hifz"] },
  { id: "flow.navigation-search-deeplink", title: "Go To, search, result navigation, deep links, direct routes", source: "ui-manual-matrix#11-navigation-search-and-deep-links", phase: "search-deeplinks-overlays", status: "report-only", tags: ["flow", "search", "deeplink"] },
  { id: "flow.bookmarks-highlights-notes-copy", title: "Bookmarks, highlights, notes, copy, share", source: "ui-manual-matrix#12-bookmarks-highlights-notes-and-copy", phase: "mushaf-reader", status: "report-only", tags: ["flow", "selection"] },
  { id: "flow.reflections", title: "Reflection feed, filters, composer, likes, comments, profile", source: "ui-manual-matrix#13-reflections", phase: "community-auth-online", status: "report-only", tags: ["flow", "reflections", "supabase"] },
  { id: "flow.reflection-journey", title: "Journey route loading, content, empty/error states", source: "ui-manual-matrix#14-reflection-journey", phase: "community-auth-online", status: "report-only", tags: ["flow", "reflection-journey"] },
  { id: "flow.flashcards-decks", title: "Deck overview, filters, deck cards, settings", source: "ui-manual-matrix#15-flashcards---decks", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "flashcards"] },
  { id: "flow.flashcards-session", title: "Review session modes, grading, options, summary", source: "ui-manual-matrix#16-flashcards---review-session", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "flashcards"] },
  { id: "flow.vocabulary", title: "Vocabulary deck add/review/edit/grade", source: "ui-manual-matrix#17-vocabulary", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "vocab"] },
  { id: "flow.home", title: "Home due/no-due/offline/signed-out/RTL states", source: "ui-manual-matrix#18-home", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "home"] },
  { id: "flow.progress", title: "Progress data, heatmap, charts, phone layout", source: "ui-manual-matrix#19-progress", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "progress"] },
  { id: "flow.leaderboard", title: "Leaderboard tabs, auth gate, offline, RTL numbers", source: "ui-manual-matrix#20-leaderboard", phase: "community-auth-online", status: "report-only", tags: ["flow", "leaderboard"] },
  { id: "flow.profile", title: "Current/public profile, avatar, stats, notes, missing user", source: "ui-manual-matrix#21-profile", phase: "community-auth-online", status: "report-only", tags: ["flow", "profile"] },
  { id: "flow.achievements", title: "Achievement locked/unlocked/progress/toast/public grid", source: "ui-manual-matrix#22-achievements", phase: "flashcards-home-progress", status: "report-only", tags: ["flow", "achievements"] },
  { id: "flow.public-pages", title: "About, privacy, terms, links, bilingual content", source: "ui-manual-matrix#23-public-pages", phase: "route-smoke", status: "strict", tags: ["flow", "public"] },
  { id: "flow.error-empty-loading-offline", title: "Offline, skeletons, empty states, error boundary, toasts", source: "ui-manual-matrix#24-error-empty-loading-and-offline-states", phase: "community-auth-online", status: "report-only", tags: ["flow", "offline"] },
  { id: "flow.sync-cross-device", title: "Cross-device sync and conflicts", source: "ui-manual-matrix#25-sync-and-cross-device", phase: "community-auth-online", status: "live-env", tags: ["flow", "sync", "supabase"] },
  { id: "flow.accessibility-keyboard", title: "Keyboard navigation, focus, Escape, labels, hit targets", source: "ui-manual-matrix#26-accessibility-and-keyboard", phase: "navigation-settings-rtl-theme", status: "report-only", tags: ["flow", "a11y"] },
  { id: "flow.rtl-automation", title: "RTL source, RNTL, and Arabic route automation", source: "ui-manual-matrix#rtl-automation", phase: "rtl-contract", status: "strict", tags: ["flow", "rtl", "automation"] },
];

export const uiCoverageItems = [
  ...uiRouteCoverage,
  ...uiComponentCoverage,
  ...uiFlowCoverage,
];

export function getCoverageByPhase(phase: string): CoverageItem[] {
  return uiCoverageItems.filter((item) => item.phase === phase);
}

export function getCoverageByStatus(status: CoverageStatus): CoverageItem[] {
  return uiCoverageItems.filter((item) => item.status === status);
}
