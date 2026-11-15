import { Text, View } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { releaseNotesFor } from "@/lib/app-update/release-notes";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

/**
 * About > What's new. Bundled notes for this build's version only, opened from the About row; never
 * shown at launch and nothing is stored about having seen it.
 */
export function WhatsNewSheet({
  open,
  version,
  onClose,
}: {
  open: boolean;
  version: string | null;
  onClose: () => void;
}) {
  const s = useStrings();
  const { isRTL, uiLanguage } = useSettings();
  const notes = releaseNotesFor(version, uiLanguage);
  const textStyle = {
    fontFamily: "Manrope_400Regular",
    fontSize: 15,
    lineHeight: 24,
    ...textStartStyle(isRTL),
    writingDirection: isRTL ? "rtl" : "ltr",
  } as const;

  return (
    <ResponsiveSheet open={open} onClose={onClose} dismissOnBackdrop maxWidth={520} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader
        title={s.aboutWhatsNew}
        subtitle={version ? interpolate(s.aboutWhatsNewDesc, { version }) : undefined}
        onClose={onClose}
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pt-4 pb-6">
        {notes ? (
          <View className="gap-3" accessibilityRole="list">
            {notes.map((note) => (
              <View key={note} className="gap-3" style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row" }}>
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 15, lineHeight: 24 }}
                >
                  •
                </Text>
                <Text className="flex-1 text-warm-700 dark:text-neutral-300" style={textStyle}>
                  {note}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-warm-500 dark:text-neutral-400" style={textStyle}>
            {s.aboutNoReleaseNotes}
          </Text>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
