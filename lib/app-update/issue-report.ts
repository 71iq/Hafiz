export const ISSUE_COMPOSER_URL = "https://github.com/71iq/Hafiz/issues/new";

const PLATFORMS = new Set(["web", "android", "ios"]);
const MAX_LABEL = 80;

export type IssueReportContext = Readonly<{
  version: string | null;
  platform: string;
  language: "en" | "ar";
  revision?: string | null;
  ayah?: Readonly<{ surah: number; ayah: number; tab?: string | null; source?: string | null }>;
}>;

function safeVersion(value: string | null | undefined): string | null {
  return value && /^[0-9A-Za-z.+-]{1,32}$/.test(value) ? value : null;
}

function safeRevision(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{7,40}$/.test(value) ? value : null;
}

function safeLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_LABEL) return null;
  if (/[/\\@:<>{}\[\]`$=?&#%\u0000-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function safeReference(ayah: IssueReportContext["ayah"]): string | null {
  if (!ayah) return null;
  const { surah, ayah: verse } = ayah;
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  if (!Number.isInteger(verse) || verse < 1 || verse > 286) return null;
  return `${surah}:${verse}`;
}

export function buildIssueReportUrl(context: IssueReportContext): string {
  const version = safeVersion(context.version) ?? "unknown";
  const platform = PLATFORMS.has(context.platform) ? context.platform : "unknown";
  const revision = safeRevision(context.revision);
  const reference = safeReference(context.ayah);
  const lines = [
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
    "",
    "---",
    `App version: ${version}`,
    ...(revision ? [`Web build: ${revision}`] : []),
    `Platform: ${platform}`,
    `App language: ${context.language === "ar" ? "ar" : "en"}`,
  ];
  if (reference) {
    lines.push(`Ayah: ${reference}`);
    const tab = safeLabel(context.ayah?.tab);
    const source = safeLabel(context.ayah?.source);
    if (tab) lines.push(`Tab: ${tab}`);
    if (source) lines.push(`Source: ${source}`);
  }
  const params = [`body=${encodeURIComponent(lines.join("\n"))}`];
  if (reference) params.unshift(`title=${encodeURIComponent(`Ayah ${reference}: `)}`);
  return `${ISSUE_COMPOSER_URL}?${params.join("&")}`;
}
