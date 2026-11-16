export class ReflectionPrivacyChangedError extends Error {
  constructor() {
    super("privacy_changed");
    this.name = "ReflectionPrivacyChangedError";
  }
}

export function reflectionWriteError(error: unknown): unknown {
  return error && typeof error === "object" && "message" in error && error.message === "privacy_changed"
    ? new ReflectionPrivacyChangedError()
    : error;
}
