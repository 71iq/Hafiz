import { buildIssueReportUrl, ISSUE_COMPOSER_URL } from "@/lib/app-update/issue-report";
import { BUNDLED_RELEASE_NOTES, MAX_RELEASE_NOTE_BULLETS, releaseNotesFor } from "@/lib/app-update/release-notes";
import { parseWebRevision } from "@/lib/app-update/build-info";
import { accountSyncSummary, lastSyncedLabel } from "@/components/settings/AccountSyncCard";
import { logoutConfirmMessage } from "@/components/settings/LogoutConfirmDialog";
import { strings } from "@/lib/i18n/strings";

jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: false, isRTL: false, uiLanguage: "en" }) }));

function body(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("body") ?? "");
}

describe("Report an issue link", () => {
  it("carries only version, platform, language and an optional web build", () => {
    const url = buildIssueReportUrl({ version: "1.0.1", platform: "android", language: "ar", revision: "abc1234" });
    expect(url.startsWith(`${ISSUE_COMPOSER_URL}?`)).toBe(true);
    const text = body(url);
    expect(text).toContain("App version: 1.0.1");
    expect(text).toContain("Web build: abc1234");
    expect(text).toContain("Platform: android");
    expect(text).toContain("App language: ar");
    expect(new URL(url).searchParams.get("title")).toBeNull();
  });

  it("adds the canonical ayah reference with the active tab and source from ayah detail", () => {
    const url = buildIssueReportUrl({
      version: "1.0.1",
      platform: "web",
      language: "en",
      ayah: { surah: 2, ayah: 255, tab: "Tafsir", source: "Al-Muyassar" },
    });
    expect(new URL(url).searchParams.get("title")).toBe("Ayah 2:255: ");
    expect(body(url)).toContain("Ayah: 2:255\nTab: Tafsir\nSource: Al-Muyassar");
  });

  it("drops anything that is not public technical context", () => {
    const url = buildIssueReportUrl({
      version: "../../etc/passwd",
      platform: "linux",
      language: "en",
      revision: "not-a-sha",
      ayah: { surah: 2, ayah: 255, tab: "me@example.com", source: "/data/user/0/app/files" },
    });
    const text = body(url);
    expect(text).toContain("App version: unknown");
    expect(text).toContain("Platform: unknown");
    expect(text).not.toContain("Web build");
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("/data/user");
    expect(text).not.toContain("passwd");
    expect(
      buildIssueReportUrl({ version: "1", platform: "ios", language: "en", ayah: { surah: 115, ayah: 1 } }),
    ).not.toContain("title=");
  });
});

describe("bundled release notes", () => {
  it("keeps at most three bullets per version in both languages", () => {
    for (const notes of Object.values(BUNDLED_RELEASE_NOTES)) {
      expect(notes.en.length).toBeLessThanOrEqual(MAX_RELEASE_NOTE_BULLETS);
      expect(notes.ar.length).toBe(notes.en.length);
    }
  });

  it("returns nothing for a version without notes, so the sheet shows the plain empty state", () => {
    expect(releaseNotesFor("0.0.0-none", "en")).toBeNull();
    expect(releaseNotesFor(null, "ar")).toBeNull();
    const [version] = Object.keys(BUNDLED_RELEASE_NOTES);
    expect(releaseNotesFor(version, "ar")).toEqual(BUNDLED_RELEASE_NOTES[version].ar);
  });

  it("reads the exported web commit only from a valid release file", () => {
    expect(parseWebRevision({ commit: "a".repeat(40) })).toBe("aaaaaaa");
    expect(parseWebRevision({ commit: "main" })).toBeNull();
    expect(parseWebRevision(null)).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("account sync copy (%s)", (language) => {
  const s = strings[language];

  it("never reports success as a status, only the last sync time", () => {
    expect(accountSyncSummary({ status: "synced", pendingCount: 0, failure: null }, false, s, language).text).toBe(
      s.accountSyncUpToDate,
    );
    expect(lastSyncedLabel(null, s, language)).toBe(s.accountNotSyncedYet);
    const now = Date.parse("2026-11-15T10:05:00Z");
    expect(lastSyncedLabel("2026-11-15T10:00:00Z", s, language, now)).toMatch(
      language === "ar" ? /^آخر مزامنة: / : /^Last synced: /,
    );
  });

  it("names the failure class and the paused state", () => {
    const summary = (failure: "offline" | "partial" | "failed" | null, pendingCount = 0) =>
      accountSyncSummary({ status: failure ? "error" : "idle", pendingCount, failure }, false, s, language);
    expect(summary("offline").text).toBe(s.accountSyncFailedOffline);
    expect(summary("partial")).toEqual({ text: s.accountSyncFailedPartial, tone: "error" });
    expect(summary("failed")).toEqual({ text: s.accountSyncFailedServer, tone: "error" });
    expect(summary(null, 3).text).toContain(language === "ar" ? "٣" : "3");
    expect(accountSyncSummary({ status: "idle", pendingCount: 2, failure: "failed" }, true, s, language).text).toBe(
      s.accountSyncPausedHint,
    );
  });

  it("states the sign-out consequence and the real pending count, never a guessed zero", () => {
    expect(logoutConfirmMessage({ kind: "known", count: 4 }, s, language)).toContain(s.logoutConfirmLocal);
    expect(logoutConfirmMessage({ kind: "known", count: 4 }, s, language)).toContain(language === "ar" ? "٤" : "4");
    expect(logoutConfirmMessage({ kind: "unknown" }, s, language)).toContain(s.logoutPendingUnknown);
    expect(logoutConfirmMessage({ kind: "checking" }, s, language)).not.toMatch(/[0٠]/);
  });
});

it("uses the exact sign-out copy", () => {
  expect(strings.en.logoutConfirmLocal).toBe("Local study data stays on this device. Sync stops until you sign in.");
  expect(strings.ar.logoutConfirmLocal).toBe(
    "تبقى بيانات الدراسة المحلية على هذا الجهاز. تتوقف المزامنة حتى تسجّل الدخول.",
  );
});
