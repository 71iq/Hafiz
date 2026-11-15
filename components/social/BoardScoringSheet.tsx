import { View } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

/**
 * The Board's current weekly rules: how points come from wird days, who appears, and what others
 * see. Read-only; it describes the server's scoring without excuses or any global ranking.
 */
export function BoardScoringSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStrings();
  const { isRTL } = useSettings();
  return (
    <ResponsiveSheet open={open} onClose={onClose} maxWidth={560} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader title={s.boardScoringTitle} onClose={onClose} isRTL={isRTL} />
      <OverlayBody contentContainerClassName="gap-4 px-5 pb-6 pt-2">
        <View className="gap-1.5">
          <Text variant="title-sm" accessibilityRole="header">
            {s.boardHowPoints}
          </Text>
          <Text variant="body-sm">{s.boardRules}</Text>
        </View>
        <Text variant="body-sm">{s.boardScoringEligibility}</Text>
        <Text variant="body-sm">{s.boardScoringPrivacy}</Text>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
