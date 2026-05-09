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
