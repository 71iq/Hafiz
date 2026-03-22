import {
  Modal,
  View,
  Pressable,
  type ModalProps,
  Animated,
  useWindowDimensions,
} from "react-native";
import { useColorScheme } from "nativewind";
import { cn } from "@/lib/utils";
import { forwardRef, useEffect, useRef } from "react";

type SheetProps = Omit<ModalProps, "animationType"> & {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

/**
 * Bottom sheet with tonal layering (no border).
 * Slides up from bottom with backdrop overlay.
 */
export const Sheet = forwardRef<View, SheetProps>(
  ({ open, onClose, children, className, ...props }, ref) => {
    const slideAnim = useRef(new Animated.Value(0)).current;
    const { height } = useWindowDimensions();
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";

    useEffect(() => {
      Animated.spring(slideAnim, {
        toValue: open ? 1 : 0,
        useNativeDriver: true,
        damping: 25,
        stiffness: 200,
      }).start();
    }, [open]);

    return (
      <Modal
        ref={ref}
        visible={open}
        transparent
        animationType="none"
        onRequestClose={onClose}
        {...props}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
          onPress={onClose}
        >
          <View className="flex-1" />
        </Pressable>
        <Animated.View
          className={cn("rounded-t-4xl", className)}
          style={{
            backgroundColor: isDark ? "#141414" : "#FFF8F1",
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height * 0.5, 0],
                }),
              },
            ],
          }}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-surface-high dark:bg-surface-dark-high" />
          </View>
          {children}
        </Animated.View>
      </Modal>
    );
  }
);

Sheet.displayName = "Sheet";

export const SheetHeader = forwardRef<View, { className?: string; children: React.ReactNode }>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-6 pb-4", className)} {...props} />
  )
);
SheetHeader.displayName = "SheetHeader";

export const SheetContent = forwardRef<View, { className?: string; children: React.ReactNode }>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-6 pb-8", className)} {...props} />
  )
);
SheetContent.displayName = "SheetContent";
