export type RtlStyleAllowlistEntry = {
  file: string;
  pattern: string | RegExp;
  reason: string;
};

export const rtlStyleAllowlist: RtlStyleAllowlistEntry[] = [
  {
    file: "app/(tabs)/leaderboard.tsx",
    pattern: /left|right|ml-/,
    reason: "Existing leaderboard accents and score chip spacing are covered by later route-level RTL checks.",
  },
  {
    file: "app/(tabs)/mushaf.tsx",
    pattern: /left|right|marginLeft|marginRight|borderLeftWidth|borderRightWidth/,
    reason: "Reader route contains full-width overlays, page-spread coordinates, and Quran-specific geometry for later Playwright coverage.",
  },
  {
    file: "app/flashcards/session.tsx",
    pattern: /textAlign: "right"|mr-/,
    reason: "Flashcard Arabic/Quran answer text is intentionally RTL; session layout is deferred to route-level coverage.",
  },
  {
    file: "app/onboarding.tsx",
    pattern: /right|left|textAlign: "right"/,
    reason: "Onboarding has preexisting language-specific positioning that will be covered by the RTL route phase.",
  },
  {
    file: "components/SearchCommand.tsx",
    pattern: /marginLeft|marginRight|textAlign: "left"|textAlign: "right"|ml-/,
    reason: "Search results mix Quran, Arabic, and English text; modal layout is deferred to Playwright RTL checks.",
  },
  {
    file: "components/auth/AuthScreenShell.tsx",
    pattern: /left|right|borderLeftWidth|borderRightWidth/,
    reason: "Auth shell contains non-mirrored brand art and decorative coordinate-based botanical lines.",
  },
  {
    file: "components/mushaf/AyahBlock.tsx",
    pattern: /left|right/,
    reason: "Ayah block uses full-bleed overlays and icon badges around protected Quran text.",
  },
  {
    file: "components/mushaf/AyahDetailModal.tsx",
    pattern: /-right-/,
    reason: "Bookmark/status badge is icon-local until overlay RTL behavior is promoted from Playwright coverage.",
  },
  {
    file: "components/mushaf/FocusModeControls.tsx",
    pattern: /left|right|marginLeft/,
    reason: "Focus controls include full-width phone chrome and progress-thumb coordinates.",
  },
  {
    file: "components/mushaf/GoToNavigator.tsx",
    pattern: /textAlign: "right"/,
    reason: "Navigator displays fixed Arabic surah labels that intentionally align RTL.",
  },
  {
    file: "components/mushaf/MushafSlider.tsx",
    pattern: /paddingLeft|paddingRight/,
    reason: "Slider center padding is symmetric wheel geometry, not semantic inline spacing.",
  },
  {
    file: "components/mushaf/PageMushaf.tsx",
    pattern: /left|right/,
    reason: "Page reader uses horizontal page coordinates and full-width overlays around unmirrored Mushaf content.",
  },
  {
    file: "components/mushaf/PageViewNavigationSheet.tsx",
    pattern: /left|marginLeft|marginRight/,
    reason: "Floating page menu uses measured viewport coordinates and direction-aware icon spacing.",
  },
  {
    file: "components/mushaf/SurahHeader.tsx",
    pattern: /left|right/,
    reason: "Surah header has explicit decorative corner offsets that are already direction-branched in source.",
  },
  {
    file: "components/mushaf/WebSelectionMenu.tsx",
    pattern: /left|right/,
    reason: "Web selection menu placement uses measured browser selection coordinates.",
  },
  {
    file: "components/mushaf/WordTooltip.tsx",
    pattern: /borderLeft|borderRight/,
    reason: "Tooltip triangle uses transparent physical borders as a CSS drawing technique.",
  },
  {
    file: "components/progress/ActivityHeatmap.tsx",
    pattern: /left|marginLeft|marginRight/,
    reason: "Heatmap cells and month labels use chart coordinates; chronology must be checked explicitly later.",
  },
  {
    file: "components/progress/SurahProgressList.tsx",
    pattern: /textAlign: "right"/,
    reason: "Arabic surah labels intentionally align right inside a mixed-language progress row.",
  },
  {
    file: "components/ui/AppNavigation.tsx",
    pattern: /left|right/,
    reason: "Navigation contains direction-branched sidebar offsets plus centered absolute mobile chrome.",
  },
  {
    file: "components/ui/DropdownMenu.tsx",
    pattern: /left/,
    reason: "Dropdown placement uses measured trigger coordinates before internal menu rows mirror.",
  },
  {
    file: "components/ui/OfflineBanner.tsx",
    pattern: /left|right/,
    reason: "Offline banner is centered with full-width absolute positioning.",
  },
  {
    file: "components/ui/Skeleton.tsx",
    pattern: /pl-/,
    reason: "Skeleton indentation is a placeholder shape to revisit with row-level RTL skeleton tests.",
  },
  {
    file: "components/ui/Switch.tsx",
    pattern: /left/,
    reason: "Switch thumb position is internal control geometry, not page layout.",
  },
  {
    file: "components/ui/SyncIndicator.tsx",
    pattern: /-right-/,
    reason: "Sync status dot is icon-local and direction-neutral.",
  },
  {
    file: "components/ui/Toast.tsx",
    pattern: /left|right/,
    reason: "Toast is centered with full-width absolute positioning.",
  },
];
