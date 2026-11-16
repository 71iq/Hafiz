import { isEncouragementTemplateId, type EncouragementTemplateId } from "@/lib/halaqa/api";
import type { UIStrings } from "@/lib/i18n/strings";

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

export function encouragementText(templateId: string | null, s: UIStrings): string {
  return isEncouragementTemplateId(templateId) ? s[ENCOURAGEMENT_STRING_KEYS[templateId]] : s.halaqaEncourageGeneric;
}
