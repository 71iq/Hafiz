import { View, Pressable, type ViewProps } from "react-native";
import { cn } from "../../lib/utils";
import { Text } from "./text";

interface TabsProps extends ViewProps {
  className?: string;
}

export function TabsList({ className, ...props }: TabsProps) {
  return (
    <View
      className={cn(
        "flex-row bg-muted rounded-lg p-1",
        className
      )}
      {...props}
    />
  );
}

interface TabsTriggerProps {
  active?: boolean;
  onPress?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function TabsTrigger({
  active,
  onPress,
  className,
  children,
}: TabsTriggerProps) {
  const isTextChild = typeof children === "string";
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-1 py-2 rounded-md items-center",
        active && "bg-background",
        className
      )}
    >
      {isTextChild ? (
        <Text
          className={cn(
            "text-sm font-medium",
            active ? "text-foreground" : "text-muted-foreground"
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
