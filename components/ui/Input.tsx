import { forwardRef } from "react";
import { type ReactNode } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useSettings } from "@/lib/settings/context";
import { useUIDirection, inputTextStartStyle, type Direction } from "@/lib/ui/direction";
import { mutedIconColor } from "@/lib/ui/theme-icons";
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
    const { effectiveTheme } = useSettings();
    // Placeholders often name the field, so they use the theme's readable secondary text color.
    const fallbackPlaceholderColor = mutedIconColor(effectiveTheme);
    const wrapped = Boolean(startIcon || endIcon);
    // red-600 reads at 4.5:1 or more on white and beige; red-400 on the dark surfaces.
    const invalidEdge = "border border-red-600 dark:border-red-400";
    const input = (
      <TextInput
        ref={ref}
        editable={editable}
        multiline={multiline}
        placeholderTextColor={placeholderTextColor ?? fallbackPlaceholderColor}
        className={cn(
          "min-h-11 rounded-2xl bg-surface dark:bg-surface-dark-high px-4 py-3 text-charcoal dark:text-neutral-100",
          multiline && "min-h-[132px] rounded-3xl py-3.5",
          // A wrapped input's icon row draws the invalid edge, so the field has one border, not two.
          invalid && !wrapped && invalidEdge,
          !editable && "opacity-50",
          wrapped ? "min-w-0 flex-1 bg-transparent px-0" : "",
          className
        )}
        style={[
          {
            fontFamily: "Manrope_400Regular",
            fontSize: 15,
            ...inputTextStartStyle(dir),
          },
          multiline ? { lineHeight: 22, textAlignVertical: "top" as const } : null,
          style,
        ]}
        {...props}
      />
    );

    if (!wrapped) return input;

    return (
      <View
        className={cn(
          "w-full flex-row items-center gap-2 rounded-2xl bg-surface dark:bg-surface-dark-high px-4",
          dir === "rtl" && "flex-row-reverse",
          invalid && invalidEdge,
          containerClassName
        )}
        // row-reverse mirrors the icons by hand; under an inherited rtl direction it flipped them back to
        // the wrong sides, so the row is pinned to ltr.
        style={{ direction: "ltr" }}
      >
        {startIcon}
        {input}
        {endIcon}
      </View>
    );
  }
);

Input.displayName = "Input";
