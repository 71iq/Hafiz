import { Text, View } from "react-native";
import { ProfileAvatar } from "./ProfileAvatar";

type ProfileIdentityProps = {
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  isDark: boolean;
  isRTL?: boolean;
  avatarSize?: number;
  nameSize?: number;
  handleSize?: number;
  nameColor?: string;
  handleColor?: string;
  centered?: boolean;
};

export function ProfileIdentity({
  displayName,
  username,
  avatarUrl,
  isDark,
  isRTL = false,
  avatarSize = 40,
  nameSize = 14,
  handleSize = 11,
  nameColor,
  handleColor,
  centered = false,
}: ProfileIdentityProps) {
  const handle = username ? `@${username}` : "";
  const textAlign = centered ? "center" : isRTL ? "right" : "left";
  const rowDirection = isRTL ? "row-reverse" : "row";
  const resolvedNameColor = nameColor ?? (isDark ? "#f5f5f4" : "#2D2D2D");
  const resolvedHandleColor = handleColor ?? (isDark ? "#737373" : "#8A7764");

  return (
    <View
      className="min-w-0 items-center gap-2"
      style={{
        flexDirection: centered ? "column" : rowDirection,
        alignItems: centered ? "center" : "center",
        flex: centered ? undefined : 1,
        direction: centered ? undefined : "ltr",
      }}
    >
      <ProfileAvatar avatarUrl={avatarUrl} name={displayName} size={avatarSize} isDark={isDark} />
      <View className="min-w-0 flex-1" style={centered ? { flex: 0, alignItems: "center" } : undefined}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          numberOfLines={1}
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: nameSize,
            color: resolvedNameColor,
            textAlign,
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {displayName}
        </Text>
        {handle ? (
          <Text
            className="mt-0.5 text-warm-400 dark:text-neutral-500"
            numberOfLines={1}
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: handleSize,
              color: resolvedHandleColor,
              textAlign,
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {handle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
