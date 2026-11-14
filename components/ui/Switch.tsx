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
  /** The setting's name, for screen readers, when the switch sits beside its label. */
  accessibilityLabel?: string;
};

/** The parts of a React DOM keyboard event the web key handler reads. */
type WebKeyEvent = {
  key: string;
  repeat: boolean;
  target: unknown;
  currentTarget: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * Role, state and keys for the Pressable that is the switch. Native reads accessibilityState.
 * React Native Web 0.21 ignores it, so aria-checked carries the state there, and its Pressable
 * presses only on Enter for this role, so Space is handled here without scrolling the page.
 */
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
    // Ambient teal-tinted shadow
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  } as const;
  return { track, thumb };
}

/** shadcn-style animated toggle switch, consistent on web + native */
export function Switch({ value, onValueChange, disabled, accessibilityLabel }: Props) {
  const look = useSwitchLook(value, disabled);
  return (
    <Pressable
      {...switchControlProps({ value, onValueChange, disabled })}
      accessibilityLabel={accessibilityLabel}
      style={look.track}
    >
      <Animated.View style={look.thumb} />
    </Pressable>
  );
}

/**
 * The switch's look inside a SwitchRow. The row is the switch, so the track has no role, name,
 * focus or touch of its own.
 */
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
  /** The row's text and a SwitchTrack, laid out by the caller. */
  children: ReactNode;
};

/** A labelled row that is the switch, so its whole area is the target rather than the 24 px track. */
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
