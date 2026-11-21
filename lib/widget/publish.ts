import type { AppDatabase } from "@/lib/database/types";
import type { ThemeMode, ThemePalette } from "@/lib/settings/context";
import { loadWidgetInput } from "@/lib/widget/load";
import { widgetPlatform } from "@/lib/widget/platform";
import type { WidgetPlacement } from "@/lib/widget/platform-types";
import { serializeWidgetTimeline } from "@/lib/widget/schema";
import { buildWidgetTimeline, selectWidgetEntry } from "@/lib/widget/timeline";

export type WidgetPublishOptions = Readonly<{
  language: "en" | "ar";
  themeMode: ThemeMode;
  effectiveTheme: ThemePalette;
}>;

export type WidgetPublishResult =
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "waiting" }>
  | Readonly<{ status: "published"; placement: WidgetPlacement }>
  | Readonly<{ status: "failed" }>;

let latestOptions: WidgetPublishOptions | null = null;
let queued: Promise<WidgetPublishResult> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** The app language and theme the next run words and colors the timeline with. */
export function setWidgetPublishOptions(options: WidgetPublishOptions): void {
  latestOptions = options;
}

/** Runs `work` after every run already queued, never alongside one. */
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work);
  chain = run.catch(() => undefined);
  return run;
}

async function runPublish(db: AppDatabase, milestone?: AbortSignal): Promise<WidgetPublishResult> {
  const now = new Date();
  if (!widgetPlatform.supported) return { status: "unsupported" };
  const options = latestOptions;
  if (!options || milestone?.aborted) return { status: "waiting" };
  let json: string;
  try {
    const input = await loadWidgetInput(db, { now, ...options });
    const timeline = buildWidgetTimeline(input);
    if (selectWidgetEntry(timeline, now.getTime(), true).kind !== "entry") {
      throw new Error("The new timeline has no entry for now");
    }
    json = serializeWidgetTimeline(timeline);
  } catch (error) {
    if (milestone?.aborted) return { status: "waiting" };
    // Never log the timeline itself: it holds the person's streak and plan.
    console.warn("[Widget] Could not publish:", error);
    await widgetPlatform.clear().catch((clearError: unknown) => console.warn("[Widget] Could not clear:", clearError));
    return { status: "failed" };
  }
  try {
    if (milestone?.aborted) return { status: "waiting" };
    return { status: "published", placement: await widgetPlatform.publish(json, Boolean(milestone)) };
  } catch (error) {
    // Native rejected it (E_WIDGET_INVALID) and has already cleared its stored timeline.
    console.warn("[Widget] Could not publish:", error);
    return { status: "failed" };
  }
}

/**
 * Spec 6.4: builds the next 7 days and hands them to the widget. Runs never overlap, and calls made
 * while one run waits share that queued run, which reads the latest options when it starts. It
 * publishes even with no widget placed, so a widget added later, or the add dialog's preview, shows
 * today's state at once. Any failure clears the widget to its neutral state rather than leave a
 * possibly stale one.
 */
export function publishWidget(db: AppDatabase, milestone?: AbortSignal): Promise<WidgetPublishResult> {
  // A new local event must get its own ordered update, even if a silent refresh is already queued.
  if (milestone) return serialized(() => runPublish(db, milestone));
  if (queued) return queued;
  const run: Promise<WidgetPublishResult> = serialized(() => {
    if (queued === run) queued = null;
    return runPublish(db);
  });
  queued = run;
  return run;
}

type RefreshListener = () => void;
const refreshListeners = new Set<RefreshListener>();

/** Asks the publishing lifecycle to republish now, as after Show numbers changes. */
export function requestWidgetRefresh(): void {
  for (const listener of refreshListeners) listener();
}

export function subscribeWidgetRefresh(listener: RefreshListener): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}
