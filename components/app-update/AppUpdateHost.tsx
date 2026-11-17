import { useCallback } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  cancelMeteredDownload,
  confirmMeteredDownload,
  dismissInstallPrompt,
  installUpdate,
} from "@/lib/app-update/update-controller";
import type { AndroidRelease } from "@/lib/app-update/release";
import { useUpdateState } from "@/lib/app-update/update-store";
import { useAppUpdateLifecycle } from "@/lib/app-update/use-app-update";
import { installedAndroidVersionCode } from "@/lib/app-update/use-android-update";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatUpdateSize } from "./update-copy";

/**
 * Mounted once in the root layout. On the Android app (not the QA build) it runs the update
 * lifecycle and owns the two update dialogs: the download size before a download on a metered
 * network, and Install now / Later once a download is verified. Later hides the prompt for that
 * version until the next launch; Home and Settings keep Install update.
 */
export function AppUpdateHost() {
  return installedAndroidVersionCode() === null ? null : <AndroidUpdateHost />;
}

function AndroidUpdateHost() {
  const s = useStrings();
  const { isDark, isRTL, isLoaded, uiLanguage, autoDownloadUpdates } = useSettings();
  const phase = useUpdateState((current) => current.phase);
  const promptDismissedVersion = useUpdateState((current) => current.promptDismissedVersion);
  const meteredConfirm = useUpdateState((current) => current.meteredConfirm);

  const readyNotice = useCallback(
    (release: AndroidRelease) => ({
      title: s.appUpdateReadyTitle,
      body: interpolate(s.appUpdateNotificationBody, { version: release.versionName }),
      channelName: s.appUpdateChannelName,
    }),
    [s],
  );
  useAppUpdateLifecycle({ autoDownload: autoDownloadUpdates, settingsLoaded: isLoaded, readyNotice });

  const ready = phase.status === "ready" ? phase.release : null;
  const promptVisible = ready !== null && promptDismissedVersion !== ready.versionCode && meteredConfirm === null;

  return (
    <>
      <ConfirmDialog
        visible={meteredConfirm !== null}
        title={s.appUpdateMeteredTitle}
        message={
          meteredConfirm?.size !== undefined
            ? interpolate(s.appUpdateMeteredMessage, {
                version: meteredConfirm.versionName,
                size: formatUpdateSize(meteredConfirm.size, s, uiLanguage),
              })
            : interpolate(s.appUpdateMeteredMessageNoSize, { version: meteredConfirm?.versionName ?? "" })
        }
        cancelLabel={s.appUpdateLater}
        confirmLabel={s.appUpdateDownloadNow}
        tone="info"
        isDark={isDark}
        isRTL={isRTL}
        onCancel={cancelMeteredDownload}
        onConfirm={confirmMeteredDownload}
      />
      <ConfirmDialog
        visible={promptVisible}
        title={s.appUpdateReadyTitle}
        message={interpolate(s.appUpdateReadyMessage, { version: ready?.versionName ?? "" })}
        cancelLabel={s.appUpdateLater}
        confirmLabel={s.appUpdateInstallNow}
        tone="info"
        isDark={isDark}
        isRTL={isRTL}
        onCancel={dismissInstallPrompt}
        onConfirm={() => void installUpdate()}
      />
    </>
  );
}
