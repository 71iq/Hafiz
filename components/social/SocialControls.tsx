import { Pressable, View, type ViewStyle } from "react-native";
import { Info, LogIn, type LucideIcon } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { useSettings } from "@/lib/settings/context";

/** Rows mirror in Arabic; `direction: ltr` keeps the explicit order stable on web and native. */
export function socialRowStyle(isRTL: boolean): ViewStyle {
  return { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" };
}

export function useSocialAccent() {
  const { isDark } = useSettings();
  return {
    accent: isDark ? "#2dd4bf" : "#0d9488",
    muted: isDark ? "#a3a3a3" : "#8B8178",
  };
}

/** A calm status line: cached data, offline or a recoverable failure, with an optional action. */
export function SocialNotice({
  message,
  icon: Icon = Info,
  actionLabel,
  onAction,
}: {
  message: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { isRTL } = useSettings();
  const { muted } = useSocialAccent();
  const action =
    actionLabel && onAction ? (
      <Button
        variant="outline"
        className="h-11 px-4 border border-warm-300 dark:border-neutral-700"
        label={actionLabel}
        onPress={onAction}
      />
    ) : null;
  // A long message keeps its full width; its action goes below it, at the reading start.
  // Arabic notices run shorter in characters for the same lines, so the bar is low.
  const stacked = action !== null && message.length > 60;
  return (
    <Card elevation="mid" className="px-4 py-3">
      <View className="items-center gap-3" style={socialRowStyle(isRTL)}>
        <Icon size={18} color={muted} />
        <Text variant="body-sm" className="min-w-0 flex-1" accessibilityLiveRegion="polite">
          {message}
        </Text>
        {stacked ? null : action}
      </View>
      {stacked ? <View className="mt-2" style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}>{action}</View> : null}
    </Card>
  );
}

/** Shown on Halaqa and Board for signed-out viewers and for builds without the account service. */
export function SocialGate({
  icon: Icon,
  title,
  body,
  signInLabel,
  onSignIn,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  signInLabel?: string;
  onSignIn?: () => void;
}) {
  const { accent } = useSocialAccent();
  const { isRTL } = useSettings();
  return (
    <Card elevation="low" className="items-center gap-4 px-6 py-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
        <Icon size={28} color={accent} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      <Text variant="body-sm" align="center" className="text-warm-700 dark:text-neutral-300">
        {body}
      </Text>
      {signInLabel && onSignIn ? (
        <Button accessibilityLabel={signInLabel} onPress={onSignIn}>
          <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
            <LogIn size={16} color="#ffffff" />
            <Text variant="title-sm" className="text-white">
              {signInLabel}
            </Text>
          </View>
        </Button>
      ) : null}
    </Card>
  );
}

/** A labelled switch whose whole row is a 44 pt target. */
export function SocialToggleRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { isRTL } = useSettings();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      className="min-h-11 items-center gap-3 py-2"
      style={socialRowStyle(isRTL)}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text variant="title-sm">{label}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
      </View>
    </Pressable>
  );
}

export function SocialErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text variant="body-sm" className="text-red-600 dark:text-red-400" accessibilityRole="alert">
      {message}
    </Text>
  );
}
