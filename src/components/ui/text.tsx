import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "../../lib/utils";

interface TextProps extends RNTextProps {
  variant?: "default" | "muted" | "destructive" | "primary" | "success";
}

const variantClasses: Record<NonNullable<TextProps["variant"]>, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
  primary: "text-primary",
  success: "text-success",
};

export function Text({ variant = "default", className, ...props }: TextProps) {
  return (
    <RNText className={cn(variantClasses[variant], className)} {...props} />
  );
}
