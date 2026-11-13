import type { ReactElement, ReactNode } from "react";
import { View, type RefreshControlProps } from "react-native";
import { Screen, ScreenScrollView, TAB_SCREEN_BOTTOM_INSET } from "@/components/ui/ScreenContent";
import { Text } from "@/components/ui/Text";
import { LEADERBOARD_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";

/** The Halaqa and Board tab shell: a titled, scrollable rail with optional pull to refresh. */
export function SocialScreen({
  title,
  subtitle,
  children,
  refreshControl,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <Screen>
      <ScreenScrollView
        maxWidth={LEADERBOARD_CONTENT_MAX_WIDTH}
        topInset={16}
        bottomInset={TAB_SCREEN_BOTTOM_INSET}
        refreshControl={refreshControl}
      >
        <View className="mb-5 gap-1">
          <Text variant="display-md" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="body-sm" className="text-warm-700 dark:text-neutral-300">
            {subtitle}
          </Text>
        </View>
        <View className="gap-4">{children}</View>
      </ScreenScrollView>
    </Screen>
  );
}
