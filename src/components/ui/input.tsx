import { TextInput, type TextInputProps } from "react-native";
import { cn } from "../../lib/utils";

interface InputProps extends TextInputProps {
  className?: string;
  error?: boolean;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <TextInput
      className={cn(
        "border rounded-lg px-4 py-3 text-foreground bg-background",
        error ? "border-destructive" : "border-input",
        className
      )}
      placeholderTextColor="hsl(var(--muted-foreground))"
      {...props}
    />
  );
}
