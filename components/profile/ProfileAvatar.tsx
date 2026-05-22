import { Image, Text, View } from "react-native";

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  isDark?: boolean;
};

export function ProfileAvatar({ avatarUrl, name, size = 48, isDark = false }: ProfileAvatarProps) {
  const trimmedName = name.trim();
  const initial = Array.from(trimmedName)[0]?.toUpperCase() || "H";
  const backgroundColor = isDark ? "#003638" : "#00595B";
  const textColor = "#FDDC91";
  const sharedStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor,
  };

  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={sharedStyle} />;
  }

  return (
    <View style={[sharedStyle, { alignItems: "center", justifyContent: "center" }]}>
      <Text
        style={{
          color: textColor,
          fontFamily: "Manrope_700Bold",
          fontSize: Math.max(11, Math.round(size * 0.34)),
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
