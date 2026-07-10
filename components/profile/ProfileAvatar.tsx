import { Image } from "react-native";

const fallbackAvatarSource = require("@/assets/images/zayt.png");

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  isDark?: boolean;
};

export function ProfileAvatar({ avatarUrl, size = 48, isDark = false }: ProfileAvatarProps) {
  const backgroundColor = isDark ? "#003638" : "#00595B";
  const sharedStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor,
  };

  return <Image source={avatarUrl ? { uri: avatarUrl } : fallbackAvatarSource} style={sharedStyle} />;
}
