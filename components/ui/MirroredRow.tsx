import { forwardRef, type ElementRef, type ReactNode } from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { cn } from "@/lib/utils";
import { useUIDirection, type Direction } from "@/lib/ui/direction";

type MirroredRowProps = ViewProps & {
  dir?: Direction;
};

type MirroredPressableRowProps = PressableProps & {
  dir?: Direction;
};

type DisclosureRowProps = Omit<MirroredPressableRowProps, "children"> & {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  contentClassName?: string;
};

type PressableRef = ElementRef<typeof Pressable>;

function mirroredRowStyle(dir: Direction): ViewStyle {
  return {
    direction: "ltr",
    flexDirection: dir === "rtl" ? "row-reverse" : "row",
  };
}

function mirroredRowClassName(dir: Direction) {
  return dir === "rtl" ? "flex-row-reverse" : "flex-row";
}

export const MirroredRow = forwardRef<View, MirroredRowProps>(
  ({ dir: explicitDir, className, style, ...props }, ref) => {
    const dir = useUIDirection(explicitDir);

    return (
      <View
        ref={ref}
        className={cn(className, mirroredRowClassName(dir))}
        style={[style, mirroredRowStyle(dir)]}
        {...props}
      />
    );
  }
);

MirroredRow.displayName = "MirroredRow";

export const MirroredPressableRow = forwardRef<PressableRef, MirroredPressableRowProps>(
  ({ dir: explicitDir, className, style, ...props }, ref) => {
    const dir = useUIDirection(explicitDir);

    return (
      <Pressable
        ref={ref}
        className={cn(className, mirroredRowClassName(dir))}
        style={(state: PressableStateCallbackType) => [
          typeof style === "function" ? style(state) : style,
          mirroredRowStyle(dir),
        ]}
        {...props}
      />
    );
  }
);

MirroredPressableRow.displayName = "MirroredPressableRow";

export const DisclosureRow = forwardRef<PressableRef, DisclosureRowProps>(
  (
    {
      dir,
      className,
      contentClassName,
      leading,
      children,
      trailing,
      ...props
    },
    ref
  ) => {
    const resolvedDir = useUIDirection(dir);

    return (
      <MirroredPressableRow
        ref={ref}
        dir={resolvedDir}
        className={cn("w-full items-center justify-between gap-3", className)}
        {...props}
      >
        {leading}
        <View className={cn("min-w-0 flex-1", resolvedDir === "rtl" ? "items-end" : "items-start", contentClassName)}>
          {children}
        </View>
        {trailing ? <View className="h-9 w-9 shrink-0 items-center justify-center">{trailing}</View> : null}
      </MirroredPressableRow>
    );
  }
);

DisclosureRow.displayName = "DisclosureRow";
