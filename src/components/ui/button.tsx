import { Pressable, type PressableProps } from "react-native";
import { cn } from "../../lib/utils";
import { Text } from "./text";

type ButtonVariant =
  | "default"
  | "destructive"
  | "warning"
  | "success"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  className?: string;
  textClassName?: string;
  /** Tooltip shown on hover (web only) */
  title?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-primary active:opacity-80",
  destructive: "bg-destructive active:opacity-80",
  warning: "bg-warning active:opacity-80",
  success: "bg-success active:opacity-80",
  outline: "border border-border bg-transparent active:bg-accent",
  secondary: "bg-secondary active:opacity-80",
  ghost: "active:bg-accent",
  link: "",
};

const variantTextClasses: Record<ButtonVariant, string> = {
  default: "text-primary-foreground",
  destructive: "text-destructive-foreground",
  warning: "text-warning-foreground",
  success: "text-success-foreground",
  outline: "text-foreground",
  secondary: "text-secondary-foreground",
  ghost: "text-foreground",
  link: "text-primary underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "py-3 px-5 rounded-xl",
  sm: "py-2 px-3 rounded-lg",
  lg: "py-4 px-8 rounded-xl",
  icon: "w-9 h-9 rounded-lg items-center justify-center",
};

const sizeTextClasses: Record<ButtonSize, string> = {
  default: "text-base font-semibold",
  sm: "text-sm font-medium",
  lg: "text-base font-semibold",
  icon: "text-base",
};

export function Button({
  variant = "default",
  size = "default",
  className,
  textClassName,
  children,
  disabled,
  style,
  title,
  ...props
}: ButtonProps) {
  const isTextChild = typeof children === "string";
  return (
    <Pressable
      className={cn(
        "items-center flex-row justify-center",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled}
      style={[{ opacity: disabled ? 0.5 : 1 }, typeof style === "object" && !Array.isArray(style) ? style : undefined]}
      accessibilityLabel={title}
      {...(title ? { title } as any : {})}
      {...props}
    >
      {isTextChild ? (
        <Text
          className={cn(
            variantTextClasses[variant],
            sizeTextClasses[size],
            textClassName
          )}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
