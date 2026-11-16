export type AuthHandoffNotice = "password-updated";

let carriedEmail = "";
let notice: AuthHandoffNotice | null = null;

export function carryAuthEmail(email: string): void {
  carriedEmail = typeof email === "string" ? email.trim().slice(0, 320) : "";
}

export function readCarriedAuthEmail(): string {
  return carriedEmail;
}

export function setAuthHandoffNotice(value: AuthHandoffNotice): void {
  notice = value;
}

export function peekAuthHandoffNotice(): AuthHandoffNotice | null {
  return notice;
}

export function takeAuthHandoffNotice(): AuthHandoffNotice | null {
  const value = notice;
  notice = null;
  return value;
}

export function clearAuthHandoff(): void {
  carriedEmail = "";
  notice = null;
}
