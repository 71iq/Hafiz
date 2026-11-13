import { isEncouragementTemplateId, type EncouragementTemplateId } from "@/lib/halaqa/api";
import type { UIStrings } from "@/lib/i18n/strings";

/** SOC-06 templates, each in the reader's own language (MAT-01). No guilt, no reward claims (ETH-03, ETH-08). */
export const ENCOURAGEMENT_STRING_KEYS: Readonly<Record<EncouragementTemplateId, keyof UIStrings>> = {
  ease: "halaqaEncourageEase",
  missed_you: "halaqaEncourageMissedYou",
  keep_going: "halaqaEncourageKeepGoing",
  small_steady: "halaqaEncourageSmallSteady",
  dua: "halaqaEncourageDua",
  together: "halaqaEncourageTogether",
  welcome_back: "halaqaEncourageWelcomeBack",
  well_done: "halaqaEncourageWellDone",
  firm_heart: "halaqaEncourageFirmHeart",
};

/** A received template in this reader's language; a template this version doesn't know reads generically. */
export function encouragementText(templateId: string | null, s: UIStrings): string {
  return isEncouragementTemplateId(templateId) ? s[ENCOURAGEMENT_STRING_KEYS[templateId]] : s.halaqaEncourageGeneric;
}
