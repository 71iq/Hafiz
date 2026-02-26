import { Pressable, type PressableProps } from "react-native";
import { cn } from "../../lib/utils";

interface ToggleProps extends PressableProps {
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Toggle({
  pressed,
  className,
  children,
  ...props
}: ToggleProps) {
  return (
    <Pressable
      className={cn(
        "w-9 h-9 items-center justify-center rounded-lg active:bg-accent",
        pressed && "bg-accent",
        className
      )}
      {...props}
    >
      {children}
    </Pressable>
  );
}
