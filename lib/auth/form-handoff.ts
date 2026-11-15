/**
 * Ephemeral hand-off between the Login, Sign up and Forgot password screens.
 *
 * The typed email moves between those screens in memory only: never in a URL, log, analytics event
 * or persistent storage, and never with a password. A one-shot notice lets a screen show a result
 * produced by the previous one (for example a saved password). Both are cleared when the signed-in
 * account changes, so nothing typed for one identity is offered to another.
 */
export type AuthHandoffNotice = "password-updated";

let carriedEmail = "";
let notice: AuthHandoffNotice | null = null;

/** Remembers the email typed on the current auth screen for the next auth screen. */
export function carryAuthEmail(email: string): void {
  carriedEmail = typeof email === "string" ? email.trim().slice(0, 320) : "";
}

/** The carried email, or an empty string. Reading does not clear it. */
export function readCarriedAuthEmail(): string {
  return carriedEmail;
}

export function setAuthHandoffNotice(value: AuthHandoffNotice): void {
  notice = value;
}

export function peekAuthHandoffNotice(): AuthHandoffNotice | null {
  return notice;
}

/** Returns the pending notice once. */
export function takeAuthHandoffNotice(): AuthHandoffNotice | null {
  const value = notice;
  notice = null;
  return value;
}

/** Clears every hand-off value. Called on any session identity change. */
export function clearAuthHandoff(): void {
  carriedEmail = "";
  notice = null;
}
