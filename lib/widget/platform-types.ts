export type WidgetKind = "small" | "medium";

/** Placed widget instances by provider: "Hafiz streak" (small) and "Hafiz wird" (medium). */
export type WidgetPlacement = Readonly<{ small: number; medium: number }>;

/**
 * The home-screen widget on this platform. Android implements it with the HafizWidget native module
 * (platform.android.ts); web and iOS report it unsupported and do nothing.
 */
export type WidgetPlatform = Readonly<{
  supported: boolean;
  /**
   * Validates and stores the timeline JSON, re-renders every placed widget, and returns the placement.
   * `celebrate` asks for the one-shot clip of a wird day or milestone earned in this app session.
   */
  publish: (json: string, celebrate?: boolean) => Promise<WidgetPlacement>;
  /** Removes the stored timeline, so placed widgets show the neutral state. */
  clear: () => Promise<void>;
  getPlacement: () => Promise<WidgetPlacement>;
  /** Whether the launcher can show Android's add-widget dialog. */
  canRequestPin: () => Promise<boolean>;
  /** Opens Android's add-widget dialog; false when the launcher cannot. */
  requestPin: (kind: WidgetKind) => Promise<boolean>;
  /** Called when a widget is placed or removed. Returns the unsubscribe function. */
  subscribePlacement: (listener: () => void) => () => void;
}>;

export const NO_WIDGETS: WidgetPlacement = { small: 0, medium: 0 };

/** Where there is no widget: every method is a resolved no-op. */
export const UNSUPPORTED_WIDGET_PLATFORM: WidgetPlatform = {
  supported: false,
  publish: async () => NO_WIDGETS,
  clear: async () => {},
  getPlacement: async () => NO_WIDGETS,
  canRequestPin: async () => false,
  requestPin: async () => false,
  subscribePlacement: () => () => {},
};
