/**
 * ETH-07: the server refused a reflection or comment that the screen showed as visible only to its
 * author, because the account is no longer marked as under 18. Nothing was posted. The screen
 * reloads the account's privacy and lets the person decide again.
 */
export class ReflectionPrivacyChangedError extends Error {
  constructor() {
    super("privacy_changed");
    this.name = "ReflectionPrivacyChangedError";
  }
}

/** Maps the server's refusal of a stale privacy promise to its own error and passes others through. */
export function reflectionWriteError(error: unknown): unknown {
  return error && typeof error === "object" && "message" in error && error.message === "privacy_changed"
    ? new ReflectionPrivacyChangedError()
    : error;
}
