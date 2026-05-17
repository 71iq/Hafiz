// Shared viewport contract for web-first stabilization. Keep behavior changes
// separate from breakpoint ownership changes.
export const VIEWPORT_BREAKPOINTS = {
  phoneCompact: 360,
  phoneLarge: 412,
  sidebar: 768,
  sidebarValidation: 1024,
  desktop: 1440,
} as const;

export const SIDEBAR_BREAKPOINT = VIEWPORT_BREAKPOINTS.sidebar;
export const PERSISTENT_SIDEBAR_BREAKPOINT = VIEWPORT_BREAKPOINTS.sidebarValidation;
export const PERSISTENT_SIDEBAR_WIDTH = 248;
export const DESKTOP_CONTENT_MAX_WIDTH = 1040;
export const SETTINGS_CONTENT_MAX_WIDTH = 880;
export const LEADERBOARD_CONTENT_MAX_WIDTH = 900;
export const DESKTOP_CONTENT_GUTTER = 32;
