import {
  clampMaximumInterval,
  clampNewCardsLimit,
  clampRequestRetention,
  validateDailyReviewLimitText,
  type LimitTextResult,
} from "@/lib/fsrs/review-settings-draft";
import { formatStepText, validateStepText, type StepTextResult } from "@/lib/fsrs/review-step-text";
import type {
  DeckReviewSettings,
  NewCardSortOrder,
  NewReviewOrder,
  ReviewSortOrder,
  SchedulerStep,
} from "@/lib/fsrs/types";

/**
 * What the deck settings editors hold while the user edits the shared scheduler options. Typed
 * fields stay as text so an invalid entry is shown back with its error instead of being clamped.
 */
export type SchedulerDraft = {
  dailyLimitText: string;
  newCardsLimit: number;
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningStepsText: string;
  relearningStepsText: string;
  newReviewOrder: NewReviewOrder;
  reviewSortOrder: ReviewSortOrder;
  newCardSortOrder: NewCardSortOrder;
};

export type SchedulerDraftValidation = {
  dailyLimit: LimitTextResult;
  learningSteps: StepTextResult;
  relearningSteps: StepTextResult;
  ok: boolean;
};

type SchedulerFields = Pick<
  DeckReviewSettings,
  | "dailyReviewLimit"
  | "newCardsLimit"
  | "requestRetention"
  | "maximumInterval"
  | "enableFuzz"
  | "enableShortTerm"
  | "learningSteps"
  | "relearningSteps"
  | "newReviewOrder"
  | "reviewSortOrder"
  | "newCardSortOrder"
>;

export function schedulerDraftFromSettings(settings: DeckReviewSettings, isRTL: boolean): SchedulerDraft {
  return {
    dailyLimitText: String(settings.dailyReviewLimit),
    newCardsLimit: settings.newCardsLimit,
    requestRetention: settings.requestRetention,
    maximumInterval: settings.maximumInterval,
    enableFuzz: settings.enableFuzz,
    enableShortTerm: settings.enableShortTerm,
    learningStepsText: formatStepText(settings.learningSteps, isRTL),
    relearningStepsText: formatStepText(settings.relearningSteps, isRTL),
    newReviewOrder: settings.newReviewOrder,
    reviewSortOrder: settings.reviewSortOrder,
    newCardSortOrder: settings.newCardSortOrder,
  };
}

/** Apply an edit, keeping stepper values inside the domains the settings owner already enforces. */
export function applySchedulerDraftPatch(draft: SchedulerDraft, patch: Partial<SchedulerDraft>): SchedulerDraft {
  const next = { ...draft, ...patch };
  return {
    ...next,
    newCardsLimit: clampNewCardsLimit(next.newCardsLimit),
    requestRetention: clampRequestRetention(next.requestRetention),
    maximumInterval: clampMaximumInterval(next.maximumInterval),
  };
}

export function validateSchedulerDraft(draft: SchedulerDraft): SchedulerDraftValidation {
  const dailyLimit = validateDailyReviewLimitText(draft.dailyLimitText);
  const learningSteps = validateStepText(draft.learningStepsText);
  const relearningSteps = validateStepText(draft.relearningStepsText);
  return { dailyLimit, learningSteps, relearningSteps, ok: dailyLimit.ok && learningSteps.ok && relearningSteps.ok };
}

/** The scheduler fields a valid draft saves, or null while any typed field is invalid. */
export function schedulerFieldsFromDraft(draft: SchedulerDraft): SchedulerFields | null {
  const { dailyLimit, learningSteps, relearningSteps } = validateSchedulerDraft(draft);
  if (!dailyLimit.ok || !learningSteps.ok || !relearningSteps.ok) return null;
  return {
    dailyReviewLimit: dailyLimit.value,
    newCardsLimit: draft.newCardsLimit,
    requestRetention: draft.requestRetention,
    maximumInterval: draft.maximumInterval,
    enableFuzz: draft.enableFuzz,
    enableShortTerm: draft.enableShortTerm,
    learningSteps: learningSteps.steps,
    relearningSteps: relearningSteps.steps,
    newReviewOrder: draft.newReviewOrder,
    reviewSortOrder: draft.reviewSortOrder,
    newCardSortOrder: draft.newCardSortOrder,
  };
}

/** "1.50h" and "1.5h" are the same step. */
function stepKey(step: SchedulerStep): string {
  return `${parseFloat(step)}${step.slice(-1)}`;
}

function sameSteps(a: readonly SchedulerStep[], b: readonly SchedulerStep[]): boolean {
  return a.length === b.length && a.every((step, index) => stepKey(step) === stepKey(b[index]));
}

/**
 * Dirty means the values the draft would save differ from the loaded settings. Reformatted text
 * ("1m 10m" for "1m, 10m") is not a change; an invalid typed field is.
 */
export function isSchedulerDraftChanged(draft: SchedulerDraft, baseline: DeckReviewSettings): boolean {
  const fields = schedulerFieldsFromDraft(draft);
  if (!fields) return true;
  return (
    fields.dailyReviewLimit !== baseline.dailyReviewLimit ||
    fields.newCardsLimit !== baseline.newCardsLimit ||
    fields.requestRetention !== baseline.requestRetention ||
    fields.maximumInterval !== baseline.maximumInterval ||
    fields.enableFuzz !== baseline.enableFuzz ||
    fields.enableShortTerm !== baseline.enableShortTerm ||
    !sameSteps(fields.learningSteps, baseline.learningSteps) ||
    !sameSteps(fields.relearningSteps, baseline.relearningSteps) ||
    fields.newReviewOrder !== baseline.newReviewOrder ||
    fields.reviewSortOrder !== baseline.reviewSortOrder ||
    fields.newCardSortOrder !== baseline.newCardSortOrder
  );
}
