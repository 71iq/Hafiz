import { forwardRef } from "react";
import { type ReactNode } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useColorScheme } from "nativewind";
import { useSettings } from "@/lib/settings/context";
import { useUIDirection, textAlignForDirection, type Direction } from "@/lib/ui/direction";
import { cn } from "@/lib/utils";

export type InputProps = TextInputProps & {
  className?: string;
  containerClassName?: string;
  dir?: Direction;
  invalid?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
};

export const Input = forwardRef<TextInput, InputProps>(
  (
    {
      className,
      containerClassName,
      dir: explicitDir,
      invalid = false,
      editable = true,
      multiline,
      placeholderTextColor,
      startIcon,
      endIcon,
      style,
      ...props
    },
    ref
  ) => {
    const dir = useUIDirection(explicitDir);
    const { colorScheme } = useColorScheme();
    const { themeColors } = useSettings();
    const fallbackPlaceholderColor = colorScheme === "dark" ? "#737373" : themeColors.surfaceDim;
    const input = (
      <TextInput
        ref={ref}
        editable={editable}
        multiline={multiline}
        placeholderTextColor={placeholderTextColor ?? fallbackPlaceholderColor}
        className={cn(
          "min-h-11 rounded-2xl bg-surface dark:bg-surface-dark-high px-4 py-3 text-charcoal dark:text-neutral-100",
          multiline && "min-h-[132px] rounded-3xl py-3.5",
          invalid && "border border-red-500",
          !editable && "opacity-50",
          startIcon || endIcon ? "min-w-0 flex-1 bg-transparent px-0" : "",
          className
        )}
        style={[
          {
            fontFamily: "Manrope_400Regular",
            fontSize: 15,
            textAlign: textAlignForDirection(dir),
            writingDirection: dir,
          },
          multiline ? { lineHeight: 22, textAlignVertical: "top" as const } : null,
          style,
        ]}
        {...props}
      />
    );

    if (!startIcon && !endIcon) return input;

    return (
      <View
        className={cn(
          "w-full flex-row items-center gap-2 rounded-2xl bg-surface dark:bg-surface-dark-high px-4",
          dir === "rtl" && "flex-row-reverse",
          invalid && "border border-red-500",
          containerClassName
        )}
      >
        {startIcon}
        {input}
        {endIcon}
      </View>
    );
  }
);

Input.displayName = "Input";
