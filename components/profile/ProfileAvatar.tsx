import { Image, Text, View } from "react-native";
import { UserRound } from "lucide-react-native";

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  isDark?: boolean;
};

type Segmenter = { segment: (input: string) => Iterable<{ segment: string }> };
type SegmenterConstructor = new (locale?: string, options?: { granularity: "grapheme" }) => Segmenter;

/**
 * The first visible character of a display name, Arabic or Latin. A grapheme keeps an accented
 * letter or an emoji whole where the runtime can segment; elsewhere the first code point is used.
 */
export function avatarInitial(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const SegmenterImpl = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (SegmenterImpl) {
    for (const { segment } of new SegmenterImpl(undefined, { granularity: "grapheme" }).segment(trimmed)) {
      return segment.toLocaleUpperCase();
    }
  }
  return (Array.from(trimmed)[0] ?? "").toLocaleUpperCase() || null;
}

/**
 * A person's photo, or the initial of their name on the teal disc. Zayt is never an avatar: a
 * shared mascot would stand for many people on the Board, and would stay visible to someone who
 * turned Zayt off. The name is always written beside the avatar, so the avatar is decorative.
 */
export function ProfileAvatar({ avatarUrl, name, size = 48, isDark = false }: ProfileAvatarProps) {
  const backgroundColor = isDark ? "#003638" : "#00595B";
  const foreground = isDark ? "#CCFBF1" : "#FFFFFF";
  const sharedStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor,
  };

  if (avatarUrl) return <Image source={{ uri: avatarUrl }} style={sharedStyle} />;

  const initial = avatarInitial(name);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[sharedStyle, { alignItems: "center", justifyContent: "center" }]}
    >
      {initial ? (
        <Text
          allowFontScaling={false}
          style={{ color: foreground, fontFamily: "Manrope_700Bold", fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.56) }}
        >
          {initial}
        </Text>
      ) : (
        <UserRound size={Math.round(size * 0.5)} color={foreground} />
      )}
    </View>
  );
}
