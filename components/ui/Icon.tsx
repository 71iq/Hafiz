import { type ComponentType } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { useUIDirection, type Direction } from "@/lib/ui/direction";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}>;

type IconProps = {
  as: IconComponent;
  dir?: Direction;
  mirrorInRTL?: boolean;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

export function Icon({
  as: IconComponent,
  dir: explicitDir,
  mirrorInRTL = false,
  size = 20,
  color,
  strokeWidth,
  className,
  style,
}: IconProps) {
  const dir = useUIDirection(explicitDir);
  const mirrorStyle = mirrorInRTL && dir === "rtl" ? { transform: [{ scaleX: -1 }] } : undefined;

  return (
    <IconComponent
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={cn(className)}
      style={[mirrorStyle, style]}
    />
  );
}
