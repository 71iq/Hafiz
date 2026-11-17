import type { UIStrings } from "@/lib/i18n/strings";
import { socialFailureOf, type SocialRejectionCode } from "@/lib/social/remote";

const REJECTION_MESSAGES: Partial<Record<SocialRejectionCode, keyof UIStrings>> = {
  invalid_nickname: "socialErrorNickname",
  nickname_required: "socialErrorNicknameRequired",
  invalid_local_date: "socialErrorDate",
};

/** The user-facing message for a failed board or profile request, by cause (DEL-08). */
export function socialFailureMessage(error: unknown, s: UIStrings): string {
  const failure = socialFailureOf(error);
  switch (failure.kind) {
    case "unconfigured":
      return s.socialUnconfigured;
    case "offline":
      return s.socialErrorOffline;
    case "account_changed":
      return s.socialErrorAccountChanged;
    case "invalid_response":
      return s.socialErrorInvalidResponse;
    case "rejected": {
      const key = REJECTION_MESSAGES[failure.code];
      return key ? s[key] : s.socialErrorGeneric;
    }
    case "failed":
      return failure.message === "avatar_delete_incomplete" ? s.socialErrorPhotoNotRemoved : s.socialErrorGeneric;
  }
}
