import { Pressable, Animated, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { useEffect, useRef, type ReactNode } from "react";
import { useSettings } from "@/lib/settings/context";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

type SwitchControlProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

type Props = SwitchControlProps & {
  accessibilityLabel?: string;
};

type WebKeyEvent = {
  key: string;
  repeat: boolean;
  target: unknown;
  currentTarget: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
};

function switchControlProps({ value, onValueChange, disabled }: SwitchControlProps) {
  const toggle = () => onValueChange(!value);
  const onKeyDown = (event: WebKeyEvent) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggle();
  };
  return {
    accessibilityRole: "switch",
    accessibilityState: { checked: value, disabled },
    "aria-checked": value,
    disabled,
    onPress: toggle,
    ...(Platform.OS === "web" ? ({ onKeyDown } as object) : null),
  } as const;
}

function useSwitchLook(value: boolean, disabled: boolean | undefined) {
  const { themeColors } = useSettings();
  const thumbLeft = useRef(new Animated.Value(value ? 22 : 2)).current;

  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reduceMotion) {
      thumbLeft.setValue(value ? 22 : 2);
      return;
    }
    Animated.spring(thumbLeft, {
      toValue: value ? 22 : 2,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [reduceMotion, thumbLeft, value]);

  const track: ViewStyle = {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: value ? "#0d9488" : themeColors.surfaceHigh,
    opacity: disabled ? 0.4 : 1,
    position: "relative",
    overflow: "hidden",
  };
  const thumb = {
    position: "absolute",
    top: 2,
    left: thumbLeft,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  } as const;
  return { track, thumb };
}

export function Switch({ value, onValueChange, disabled, accessibilityLabel }: Props) {
  const look = useSwitchLook(value, disabled);
  return (
    <Pressable
      {...switchControlProps({ value, onValueChange, disabled })}
      accessibilityLabel={accessibilityLabel}
      style={STANDALONE_TARGET}
    >
      <View style={look.track}>
        <Animated.View style={look.thumb} />
      </View>
    </Pressable>
  );
}

const STANDALONE_TARGET = {
  paddingVertical: 10,
  paddingHorizontal: 4,
  marginVertical: -10,
  marginHorizontal: -4,
} as const;

export function SwitchTrack({ value, disabled }: { value: boolean; disabled?: boolean }) {
  const look = useSwitchLook(value, disabled);
  return (
    <View aria-hidden style={[look.track, { pointerEvents: "none" }]}>
      <Animated.View style={look.thumb} />
    </View>
  );
}

type SwitchRowProps = SwitchControlProps & {
  label: string;
  hint?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function SwitchRow({ label, hint, value, onValueChange, disabled, className, style, children }: SwitchRowProps) {
  return (
    <Pressable
      {...switchControlProps({ value, onValueChange, disabled })}
      accessibilityLabel={label}
      accessibilityHint={hint}
      className={className}
      style={style}
    >
      {children}
    </Pressable>
  );
}
