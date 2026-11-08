/**
 * The `message` of a caught value when it is text. Supabase can reject with plain objects as well
 * as Error instances, so this reads any object's string `message`. Anything else, including a
 * thrown null, gives undefined so the caller's fallback text applies (RF194).
 */
export function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return undefined;
}
