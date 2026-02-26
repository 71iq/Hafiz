import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "../../lib/utils";

interface InputProps extends TextInputProps {
  className?: string;
  error?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <TextInput
        ref={ref}
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
);
