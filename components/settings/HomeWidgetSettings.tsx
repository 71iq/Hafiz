import { Text, View } from "react-native";
import { Smartphone } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { useHomeWidget, type HomeWidgetState } from "@/lib/widget/use-home-widget";
import type { UIStrings } from "@/lib/i18n/strings";

type Row = Readonly<{ title: string; description: string; onPress?: () => void }>;

/** Spec 8.1: the add row follows what the launcher supports and what is already placed. */
function widgetRow(widget: HomeWidgetState, s: UIStrings): Row | null {
  const { canPin, placement } = widget;
  if (canPin === null || placement === null) return null;
  if (!canPin) return { title: s.widgetManualTitle, description: s.widgetManualDesc };
  const small = placement.small > 0;
  const medium = placement.medium > 0;
  if (!small && !medium)
    return { title: s.widgetAddTitle, description: s.widgetAddDesc, onPress: () => widget.requestPin("small") };
  if (small && !medium)
    return {
      title: s.widgetPlacedTitle,
      description: s.widgetAddLargerDesc,
      onPress: () => widget.requestPin("medium"),
    };
  if (!small && medium)
    return {
      title: s.widgetPlacedTitle,
      description: s.widgetAddSmallerDesc,
      onPress: () => widget.requestPin("small"),
    };
  return { title: s.widgetPlacedTitle, description: s.widgetPlacedBothDesc };
}

/**
 * Settings > General > Home screen widget (Android): add or report the widget, and Show numbers on
 * the widget. Nothing renders until its state is known, so no wrong state flashes.
 */
export function HomeWidgetSettings() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const widget = useHomeWidget(db);
  const row = widgetRow(widget, s);
  const textStyle = { ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" } as const;
  if (!row && widget.showNumbers === null) return null;

  return (
    <Card elevation="low" className="p-2 mb-8">
      <View className="gap-1">
        {row ? (
          <SettingsLinkRow
            icon={Smartphone}
            title={row.title}
            description={row.description}
            onPress={row.onPress}
            isDark={isDark}
            isRTL={isRTL}
          />
        ) : null}
        {widget.showNumbers !== null ? (
          <SwitchRow
            label={s.widgetShowNumbers}
            hint={s.widgetShowNumbersHint}
            value={widget.showNumbers}
            onValueChange={widget.setShowNumbers}
            className="items-center justify-between gap-3 px-3 py-3"
            style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", minHeight: 44 }}
          >
            <View className="min-w-0 flex-1">
              <Text
                className="mb-1 text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStyle }}
              >
                {s.widgetShowNumbers}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 16, ...textStyle }}
              >
                {s.widgetShowNumbersHint}
              </Text>
            </View>
            <SwitchTrack value={widget.showNumbers} />
          </SwitchRow>
        ) : null}
      </View>
    </Card>
  );
}
