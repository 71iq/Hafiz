import { router, type Href } from "expo-router";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import type { ReminderRoute } from "@/lib/notifications/types";
import { resolveStudy, studyStepHref } from "@/lib/study/resolve";

/** Where the routes that need no database lead: Kahf opens Al-Kahf, Home opens Home. */
function fixedReminderHref(route: Exclude<ReminderRoute, "wird">): Href {
  return route === "kahf" ? { pathname: "/open", params: { surah: "18", ayah: "1" } } : "/(tabs)/home";
}

/**
 * Where a reminder leads now. The wird route asks the study resolver (SPEC 3.1), the same answer the
 * Study button and the widget get: the next step of today's study, or Home when nothing is left, no
 * plan is set up or a read fails.
 */
export async function resolveReminderHref(db: DatabaseExecutor, route: ReminderRoute): Promise<Href> {
  if (route !== "wird") return fixedReminderHref(route);
  return studyStepHref(await resolveStudy(db as AppDatabase));
}

function isHome(href: Href): boolean {
  return href === "/(tabs)/home";
}

/**
 * Opens what a reminder leads to, for notification taps, the in-app banner and the widget. A Home
 * result navigates, never pushes, so it never stacks a second tab tree (RF196).
 */
export async function openReminderRoute(db: DatabaseExecutor, route: ReminderRoute): Promise<void> {
  const href = await resolveReminderHref(db, route);
  if (isHome(href)) router.navigate(href);
  else router.push(href);
}
