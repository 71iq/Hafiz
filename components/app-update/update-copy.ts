import { megabytes, type UpdateView } from "@/lib/app-update/download-plan";
import { installUpdate, requestUpdateDownload, retryUpdate } from "@/lib/app-update/update-controller";
import { formatNumber } from "@/lib/i18n/count";
import { interpolate } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";

type Language = "en" | "ar";

export type UpdateCopy = Readonly<{
  title: string;
  description: string;
  /** The button label, or null while downloading. */
  action: string | null;
  /** Whole percent while downloading with a known size. */
  percent: number | null;
}>;

export function formatUpdateSize(bytes: number, s: UIStrings, language: Language): string {
  return interpolate(s.appUpdateSizeMb, { size: formatNumber(megabytes(bytes), language) });
}

/** Shared wording for the Home card and the Settings > About row. */
export function updateCopy(view: UpdateView, s: UIStrings, language: Language): UpdateCopy | null {
  if (view.kind === "none") return null;
  const version = view.release.versionName;
  switch (view.kind) {
    case "available":
      return {
        title: s.appUpdateTitle,
        description:
          view.release.size !== undefined
            ? interpolate(s.appUpdateSubtitleSize, { version, size: formatUpdateSize(view.release.size, s, language) })
            : interpolate(s.appUpdateSubtitle, { version }),
        action: s.appUpdateButton,
        percent: null,
      };
    case "downloading":
      return {
        title: s.appUpdateDownloadingTitle,
        description:
          view.percent === null
            ? interpolate(s.appUpdateDownloadingSubtitle, { version })
            : interpolate(s.appUpdateDownloadingProgress, {
                version,
                progress: interpolate(s.appUpdatePercent, { percent: formatNumber(view.percent, language) }),
              }),
        action: null,
        percent: view.percent,
      };
    case "ready":
      return {
        title: s.appUpdateReadyTitle,
        description: interpolate(s.appUpdateReadySubtitle, { version }),
        action: s.appUpdateInstallButton,
        percent: null,
      };
    case "failed":
      return {
        title: s.appUpdateFailedTitle,
        description:
          view.reason === "verify"
            ? s.appUpdateFailedVerify
            : view.reason === "install"
              ? s.appUpdateFailedInstall
              : s.appUpdateFailedDownload,
        action: s.sharedTryAgain,
        percent: null,
      };
  }
}

/** What the button does: download (after the size on metered networks), install, or try again. */
export function runUpdateAction(view: UpdateView): void {
  if (view.kind === "available") void requestUpdateDownload(view.release);
  else if (view.kind === "ready") void installUpdate();
  else if (view.kind === "failed") void retryUpdate();
}
