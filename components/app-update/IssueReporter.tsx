import { useCallback, useRef, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Button } from "@/components/ui/Button";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";
import { installedAppVersion, useWebRevision } from "@/lib/app-update/build-info";
import { buildIssueReportUrl, type IssueReportContext } from "@/lib/app-update/issue-report";
import { systemConfirmsCopy } from "@/lib/clipboard-feedback";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

type AyahContext = IssueReportContext["ayah"];

/**
 * Report an issue: opens the GitHub composer with public technical context only, on a deliberate tap.
 * If the link cannot open, a dialog shows the same URL to copy. Nothing is ever submitted by the app.
 */
export function useIssueReporter(onNotice: (message: string) => void) {
  const { uiLanguage } = useSettings();
  const revision = useWebRevision();
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const attempt = useRef(0);

  const report = useCallback(
    (ayah?: AyahContext) => {
      const url = buildIssueReportUrl({
        version: installedAppVersion(),
        platform: Platform.OS,
        language: uiLanguage,
        revision,
        ayah,
      });
      const current = ++attempt.current;
      Linking.openURL(url).catch(() => {
        if (attempt.current === current) setFallbackUrl(url);
      });
    },
    [revision, uiLanguage],
  );

  const fallback = <IssueLinkFallback url={fallbackUrl} onClose={() => setFallbackUrl(null)} onNotice={onNotice} />;
  return { report, fallback };
}

function IssueLinkFallback({
  url,
  onClose,
  onNotice,
}: {
  url: string | null;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const copy = async () => {
    if (!url) return;
    try {
      await Clipboard.setStringAsync(url);
      if (!systemConfirmsCopy()) onNotice(s.linkCopied);
    } catch {
      onNotice(s.copyFailed);
    }
  };

  return (
    <ResponsiveModal open={url !== null} onClose={onClose} maxWidth={480} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader title={s.issueLinkFallbackTitle} onClose={onClose} isRTL={isRTL} />
      <OverlayBody contentContainerClassName="px-5 py-4">
        <Text
          className="text-warm-600 dark:text-neutral-300"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 21,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s.issueLinkFallbackBody}
        </Text>
        <View className="mt-3 rounded-2xl bg-surface-low p-3 dark:bg-surface-dark-low">
          <Text
            selectable
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, writingDirection: "ltr" }}
          >
            {url}
          </Text>
        </View>
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button variant="outline" onPress={onClose} label={s.genericClose} className="flex-1" />
        <Button onPress={() => void copy()} label={s.issueCopyLink} className="flex-1" />
      </OverlayFooter>
    </ResponsiveModal>
  );
}
