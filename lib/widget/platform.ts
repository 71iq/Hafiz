import { UNSUPPORTED_WIDGET_PLATFORM, type WidgetPlatform } from "@/lib/widget/platform-types";

/** Web and iOS have no home-screen widget: no Settings section, no session offer and no publishing. */
export const widgetPlatform: WidgetPlatform = UNSUPPORTED_WIDGET_PLATFORM;
