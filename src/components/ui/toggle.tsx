import { Pressable, type PressableProps } from "react-native";
import { cn } from "../../lib/utils";

interface ToggleProps extends PressableProps {
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Tooltip shown on hover (web only) */
  title?: string;
}

export function Toggle({
  pressed,
  className,
  children,
  title,
  ...props
}: ToggleProps) {
  return (
    <Pressable
      className={cn(
        "w-9 h-9 items-center justify-center rounded-lg active:bg-accent",
        pressed && "bg-accent",
        className
      )}
      accessibilityLabel={title}
      {...(title ? { title } as any : {})}
      {...props}
    >
      {children}
    </Pressable>
  );
}
