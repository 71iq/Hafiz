import type { UIStrings } from "@/lib/i18n/strings";
import { socialFailureOf, type SocialRejectionCode } from "@/lib/social/remote";

const REJECTION_MESSAGES: Partial<Record<SocialRejectionCode, keyof UIStrings>> = {
  invalid_code: "socialErrorInvalidCode",
  halaqa_full: "socialErrorHalaqaFull",
  halaqa_limit: "socialErrorHalaqaLimit",
  minor_not_allowed: "socialErrorMinorMatched",
  invalid_name: "socialErrorName",
  invalid_nickname: "socialErrorNickname",
  nickname_required: "socialErrorNicknameRequired",
  already_encouraged_today: "socialErrorAlreadyEncouraged",
  not_a_member: "socialErrorNotMember",
  invalid_local_date: "socialErrorDate",
};

/** The user-facing message for a failed halaqa or board request, by cause (DEL-08). */
export function socialFailureMessage(error: unknown, s: UIStrings): string {
  const failure = socialFailureOf(error);
  switch (failure.kind) {
    case "unconfigured":
      return s.socialUnconfigured;
    case "offline":
      return s.socialErrorOffline;
    case "invalid_response":
      return s.socialErrorInvalidResponse;
    case "rejected": {
      const key = REJECTION_MESSAGES[failure.code];
      return key ? s[key] : s.socialErrorGeneric;
    }
    case "failed":
      return s.socialErrorGeneric;
  }
}
