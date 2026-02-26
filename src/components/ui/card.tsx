import { View, type ViewProps } from "react-native";
import { cn } from "../../lib/utils";
import { Text } from "./text";

interface CardProps extends ViewProps {
  className?: string;
}

export function Card({ className, ...props }: CardProps) {
  return (
    <View
      className={cn("rounded-2xl border border-border bg-card", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <View className={cn("p-5 pb-0", className)} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <View className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return (
    <View
      className={cn("flex-row items-center p-5 pt-0", className)}
      {...props}
    />
  );
}

interface CardTitleProps {
  className?: string;
  children: React.ReactNode;
}

export function CardTitle({ className, children }: CardTitleProps) {
  return (
    <Text className={cn("text-lg font-semibold text-card-foreground", className)}>
      {children}
    </Text>
  );
}

export function CardDescription({ className, children }: CardTitleProps) {
  return (
    <Text className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </Text>
  );
}
