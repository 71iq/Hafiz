import { View, type ViewProps } from "react-native";
import { cn } from "../../lib/utils";
import { Text } from "./text";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface BadgeProps extends ViewProps {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary",
  secondary: "bg-secondary",
  destructive: "bg-destructive",
  outline: "border border-border bg-transparent",
};

const textClasses: Record<BadgeVariant, string> = {
  default: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  destructive: "text-destructive-foreground",
  outline: "text-foreground",
};

export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: BadgeProps) {
  const isTextChild = typeof children === "string" || typeof children === "number";
  return (
    <View
      className={cn(
        "rounded-full px-2 py-0.5 items-center min-w-[24px]",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {isTextChild ? (
        <Text className={cn("text-xs font-semibold", textClasses[variant])}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}
