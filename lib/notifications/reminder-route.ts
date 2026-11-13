import { router, type Href } from "expo-router";
import type { DatabaseExecutor } from "@/lib/database/types";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import type { ReminderRoute } from "@/lib/notifications/types";

/**
 * Where a reminder leads. A wird reminder opens the page review when a hifz plan reviews pages or
 * half pages, and the ayah review otherwise, including when no plan is set up.
 */
export function reminderHref(route: ReminderRoute, plan: HifzPlan | null): Href {
  if (route === "wird") return plan && plan.unit !== "ayah" ? "/hifz/review" : "/flashcards/session";
  if (route === "kahf") return { pathname: "/open", params: { surah: "18", ayah: "1" } };
  return "/(tabs)/home";
}

/** reminderHref with the saved hifz plan. A plan that cannot be read opens the ayah review. */
export async function resolveReminderHref(db: DatabaseExecutor, route: ReminderRoute): Promise<Href> {
  if (route !== "wird") return reminderHref(route, null);
  const plan = await readHifzPlan(db).catch((error: unknown) => {
    console.warn("[Reminders] Could not read the hifz plan:", error);
    return null;
  });
  return reminderHref(route, plan);
}

/** Opens what a reminder leads to, for notification taps, the in-app banner and Home. */
export async function openReminderRoute(db: DatabaseExecutor, route: ReminderRoute): Promise<void> {
  const href = await resolveReminderHref(db, route);
  if (route === "home") router.navigate(href);
  else router.push(href);
}
