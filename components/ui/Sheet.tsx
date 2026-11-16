import { Modal, View, Pressable, Platform, type ModalProps, Animated, useWindowDimensions } from "react-native";
import { isTopOverlayLayer, registerOverlayLayer, useOverlayLayerId } from "@/components/ui/ResponsiveOverlay";
import { useSettings } from "@/lib/settings/context";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { cn } from "@/lib/utils";
import { forwardRef, useEffect, useRef } from "react";

type SheetProps = Omit<ModalProps, "animationType"> & {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export const Sheet = forwardRef<View, SheetProps>(({ open, onClose, children, className, ...props }, ref) => {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const { height } = useWindowDimensions();
  const { themeSurface } = useSettings();

  const reduceMotion = useReducedMotionPreference();
  const layerId = useOverlayLayerId("sheet");
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    if (!open) return;
    const unregister = registerOverlayLayer(layerId);
    if (Platform.OS !== "web" || typeof window === "undefined") return unregister;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !isTopOverlayLayer(layerId)) return;
      event.preventDefault();
      event.stopPropagation();
      latestClose.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      unregister();
    };
  }, [layerId, open]);

  useEffect(() => {
    if (reduceMotion) {
      slideAnim.setValue(open ? 1 : 0);
      return;
    }
    Animated.spring(slideAnim, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      damping: 25,
      stiffness: 200,
    }).start();
  }, [open, reduceMotion, slideAnim]);

  return (
    <Modal ref={ref} visible={open} transparent animationType="none" onRequestClose={onClose} {...props}>
      <Pressable className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.3)" }} onPress={onClose}>
        <View className="flex-1" />
      </Pressable>
      <Animated.View
        className={cn("rounded-t-4xl", className)}
        style={{
          backgroundColor: themeSurface,
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
        {children}
      </Animated.View>
    </Modal>
  );
});

Sheet.displayName = "Sheet";

export const SheetContent = forwardRef<View, { className?: string; children: React.ReactNode }>(
  ({ className, ...props }, ref) => <View ref={ref} className={cn("px-6 pb-8", className)} {...props} />,
);
SheetContent.displayName = "SheetContent";
