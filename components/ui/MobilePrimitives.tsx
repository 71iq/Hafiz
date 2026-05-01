import { forwardRef, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ModalProps,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { cn } from "@/lib/utils";

export function ScreenScaffold({ className, contentClassName, children, ...props }: ViewProps & {
  contentClassName?: string;
}) {
  return (
    <View className={cn("flex-1 bg-surface dark:bg-surface-dark", className)} {...props}>
      <View className={cn("flex-1 px-5", contentClassName)}>{children}</View>
    </View>
  );
}

export function Eyebrow({ className, ...props }: TextProps) {
  return (
    <Text
      className={cn("text-[11px] uppercase tracking-[1.2px] text-warm-400 dark:text-neutral-500", className)}
      style={[{ fontFamily: "Manrope_600SemiBold" }, props.style]}
      {...props}
    />
  );
}

export function MobileSectionLabel({ className, ...props }: TextProps) {
  return (
    <Text
      className={cn("text-xs text-warm-400 dark:text-neutral-500 mb-2", className)}
      style={[{ fontFamily: "Manrope_600SemiBold" }, props.style]}
      {...props}
    />
  );
}

export function EditorialHeader({
  title,
  subtitle,
  rightSlot,
  className,
}: {
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("flex-row items-start justify-between pt-7 pb-4", className)}>
      <View className="flex-1 pr-3">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          numberOfLines={2}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {rightSlot}
    </View>
  );
}

export function PillButton({ className, style, ...props }: PressableProps) {
  return (
    <Pressable
      className={cn("rounded-full px-4 py-2.5 bg-surface-high dark:bg-surface-dark-high", className)}
      style={(state) => [
        { transform: [{ scale: state.pressed ? 0.98 : 1 }] },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    />
  );
}

export function IconCircleButton({ className, style, ...props }: PressableProps) {
  return (
    <Pressable
      className={cn("h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high", className)}
      style={(state) => [
        { transform: [{ scale: state.pressed ? 0.98 : 1 }] },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    />
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <View className={cn("flex-row rounded-full bg-surface-mid dark:bg-surface-dark-mid p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            className={cn(
              "flex-1 items-center rounded-full px-3 py-2",
              active ? "bg-primary-soft" : "bg-transparent"
            )}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
          >
            <Text
              className={active ? "text-gold" : "text-warm-400 dark:text-neutral-400"}
              style={{ fontFamily: active ? "Manrope_600SemiBold" : "Manrope_500Medium", fontSize: 12 }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatNumber({
  value,
  label,
  className,
}: {
  value: string | number;
  label: string;
  className?: string;
}) {
  return (
    <View className={cn("items-start", className)}>
      <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}>
        {value}
      </Text>
      <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

export function HairlineProgress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const clamped = useMemo(() => Math.max(0, Math.min(1, value)), [value]);
  return (
    <View className={cn("h-[2px] w-full rounded-full bg-surface-dim dark:bg-surface-dark-bright/30 overflow-hidden", className)}>
      <View className="h-full rounded-full bg-primary-accent dark:bg-primary-bright" style={{ width: `${clamped * 100}%` }} />
    </View>
  );
}

export function MobileGlassBar({ className, ...props }: ViewProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  return (
    <View
      className={cn("rounded-3xl border border-white/15 px-3 py-2", className)}
      style={{
        backgroundColor: isDark ? "rgba(28,25,23,0.80)" : "rgba(255,248,241,0.80)",
        ...(typeof window !== "undefined" ? ({
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        } as any) : null),
      }}
      {...props}
    />
  );
}

type MobileBottomSheetProps = Omit<ModalProps, "animationType"> & {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function MobileBottomSheet({ open, onClose, className, children, ...props }: MobileBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      damping: 26,
      stiffness: 220,
    }).start();
  }, [open, progress]);

  return (
    <Modal transparent visible={open} animationType="none" onRequestClose={onClose} {...props}>
      <Pressable className="flex-1 bg-black/35" onPress={onClose} />
      <Animated.View
        className={cn("rounded-t-4xl px-5 pt-3 pb-7", className)}
        style={{
          backgroundColor: isDark ? "#141414" : "#FFF8F1",
          paddingBottom: Math.max(insets.bottom, 20),
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [height + 320, 0],
            }),
          }],
        }}
      >
        <View className="items-center pb-3">
          <View className="h-1 w-10 rounded-full bg-surface-high dark:bg-surface-dark-high" />
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}
